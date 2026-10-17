const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const prefs=new Map(),messages=[];let flushes=0,selected;
const win={},state={panel:{hidden:false},paperViews:new Map()};
const env=vm.createContext({URL,Date,Math,stopped:false,sidebars:new Map([[win,state]]),
 bindingKey:i=>'binding.'+i.key,preparedKey:i=>'prepared.'+i.key,paperForWindow:()=>selected,
 boundConversation:i=>prefs.get('binding.'+i.key)||'',conversationURL:u=>{const x=new URL(u);if(x.origin!=='https://chatgpt.com'||!/^\/c\/[\w-]+$/.test(x.pathname))throw Error();return x.href;},prefValue:()=>true,
 buildPaperDraft:async()=> 'Basic metadata',syncPaperConversation:()=>{},setSidebarStatus:()=>{},
 Services:{prefs:{savePrefFile(){flushes++;}}},
 Zotero:{Prefs:{get:k=>prefs.get(k),set:(k,v)=>prefs.set(k,v),clear:k=>prefs.delete(k)}}});
vm.runInContext(fs.readFileSync('autochat.js','utf8'),env);
function view(key){const item={libraryID:1,key,getField:n=>n==='title'?'Paper '+key:''};
 const v={item,identity:'binding.'+key,info:{url:'https://chatgpt.com/',authenticated:true,editorReady:true,hasDraft:false,hasMessages:false}};
 v.browser={hidden:false,currentURI:{host:'chatgpt.com',spec:'https://chatgpt.com/'},browsingContext:{currentWindowGlobal:{getActor:()=>({sendQuery:async(name,data)=>{if(name==='inspect')return v.info;messages.push(data);return {state:'submitted'};}})}}};state.paperViews.set(v.identity,v);return v;}
(async()=>{
 const a=view('A'),b=view('B');selected=a.item;state.activeView=a;
 state.panel.hidden=true;await env.autoPaperConversation(win);assert.equal(messages.length,0);
 state.panel.hidden=false;await env.autoPaperConversation(win);await env.autoPaperConversation(win);assert.equal(messages.length,1);
 // The URL detector binds without a working child actor or plugin marker.
 env.observePaperLocation(win,a,'https://chatgpt.com/');selected=b.item;state.activeView=b;
 env.observePaperLocation(win,a,'https://chatgpt.com/c/first-A');
 assert.equal(prefs.get('binding.A'),'https://chatgpt.com/c/first-A');assert.equal(prefs.has('binding.B'),false);assert.ok(flushes>0);
 env.observePaperLocation(win,a,'https://chatgpt.com/c/unrelated');assert.equal(prefs.get('binding.A'),'https://chatgpt.com/c/first-A');
 // No title/marker is required for a manual first message in B's own view.
 await env.capturePendingConversations(win);b.info={...b.info,url:'https://chatgpt.com/c/manual-B',hasMessages:true};
 await env.capturePendingConversations(win);assert.equal(prefs.get('binding.B'),'https://chatgpt.com/c/manual-B');
 // A previously bound paper restores from disk without another send.
 a.job=null;selected=a.item;state.activeView=a;await env.autoPaperConversation(win);assert.equal(messages.length,1);
 const c=view('C');env.observePaperLocation(win,c,'https://example.com/');env.observePaperLocation(win,c,'https://chatgpt.com/c/other');assert.equal(prefs.has('binding.C'),false);
 console.log('PASS: first URL binds without actor/marker, correct paper after switch, manual first send, immediate disk flush, no overwrite/resend');
})().catch(e=>{console.error(e);process.exitCode=1;});
