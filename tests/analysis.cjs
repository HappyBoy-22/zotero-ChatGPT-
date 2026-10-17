const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const prefs=new Map([['chatgptReader.prompt','My custom prompt'],['chatgptReader.includeFullText',true]]);
const fields={title:'<i>Test</i> Paper',publicationTitle:'Test Journal',date:'2025-10-15',DOI:'10.123/test',url:'https://example.org/paper',abstractNote:'PRIVATE ABSTRACT'};
const paper={libraryID:1,key:'A',getField:k=>fields[k]||'',getCreators:()=>[{firstName:'Alice',lastName:'Researcher'}],getAttachments:()=>{throw Error('Must not read attachments');}};
let selected=paper;
const sent=[];
const actor={sendQuery:async(name,data)=>{if(name==='draft')sent.push(data);return {state:name==='status'?'ready':'filled'};}};
const state={prepareRequested:true,paperIdentity:'A',panel:{hidden:false},browser:{hidden:false,currentURI:{host:'chatgpt.com',spec:'https://chatgpt.com/c/a'},browsingContext:{currentWindowGlobal:{getActor:()=>actor}}}};
const win={};
const env=vm.createContext({stopped:false,sidebars:new Map([[win,state]]),paperForWindow:()=>selected,
 bindingKey:item=>item.key,boundConversation:()=> 'https://chatgpt.com/c/a',
 context:()=>{throw Error('Must not read abstracts or annotations');},setSidebarStatus:()=>{},
 Zotero:{Prefs:{get:k=>prefs.get(k),set:(k,v)=>prefs.set(k,v)},PDFWorker:{getFullText:()=>{throw Error('Must not extract PDF');}}}});
vm.runInContext(fs.readFileSync('analysis.js','utf8'),env);
(async()=>{
 const draft=await env.buildPaperDraft(win);
 assert.ok(draft.startsWith('My custom prompt'));assert.match(draft,/联网检索/);
 for(const text of ['标题：Test Paper','年份：2025','期刊 / 会议：Test Journal','DOI：10.123\/test','作者：Alice Researcher','https:\/\/example.org\/paper'])assert.match(draft,new RegExp(text));
 assert.doesNotMatch(draft,/PRIVATE ABSTRACT|PDF 正文|批注/);
 await env.automationTick(win);assert.equal(sent.length,1);
 await env.automationTick(win);assert.equal(sent.length,1);
 state.prepareRequested=true;await env.automationTick(win);assert.equal(sent.length,2);
 let release;actor.sendQuery=(name,data)=>name==='status'?new Promise(resolve=>release=resolve):Promise.resolve({state:'filled'});
 state.prepareRequested=true;const pending=env.automationTick(win);await new Promise(resolve=>setImmediate(resolve));
 selected={...paper,key:'B'};release({state:'ready'});await pending;assert.equal(sent.length,2);
 console.log('PASS: basic fields only, retrieval instruction, no abstract/annotations/PDF access even with old full-text setting, custom prompt and selection protection');
})().catch(e=>{console.error(e);process.exitCode=1;});
