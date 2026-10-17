const assert=require('node:assert/strict');
global.JSWindowActorChild=class {};
(async()=>{
 const {ReaderAssistantChild}=await import('../ReaderChild.sys.mjs');
 function fixture(kind='textarea'){
  const actor=new ReaderAssistantChild();let clicks=0;const users=[],listeners={};
  class Textarea{}
  Object.defineProperty(Textarea.prototype,'value',{get(){return this._value||'';},set(v){this._value=v;}});
  const editor=Object.assign(new Textarea(),{localName:kind,innerText:'',textContent:'',focus(){},dispatchEvent(){},closest:()=>null});
  const button={disabled:false,getAttribute:()=>null,click(){clicks++;listeners.click?.({target:{closest:()=>button}});users.push({textContent:kind==='textarea'?editor.value:editor.innerText});editor.value='';editor.innerText='';doc.location.href='https://chatgpt.com/c/generated';doc.location.pathname='/c/generated';}};
  const doc={location:{protocol:'https:',hostname:'chatgpt.com',pathname:'/',href:'https://chatgpt.com/'},
   addEventListener:(type,listener)=>{listeners[type]=listener;},
   querySelector(s){if(s.includes('accounts-profile-button'))return {};if(s.includes('send-button'))return button;if(s.includes('prompt-textarea'))return editor;return null;},
   querySelectorAll(s){return s.includes('data-message-author-role')?users:[];},
   createRange:()=>({selectNodeContents(){}}),execCommand:(a,b,text)=>{editor.innerText=text.replace(/\n/g,'\r\n');editor.textContent=text.replace(/\n/g,'');return true;}};
  actor.document=doc;actor.contentWindow={HTMLTextAreaElement:Textarea,InputEvent:class{},setTimeout:fn=>setTimeout(fn,0),getSelection:()=>({removeAllRanges(){},addRange(){}})};
  return {actor,doc,editor,button,users,clicks:()=>clicks};
 }
 const data={token:'论文分析编号：TEST',text:'Prompt and paper\n论文分析编号：TEST',expectedURL:'https://chatgpt.com/'};
 const a=fixture();
 const responses=await Promise.all([a.actor.receiveMessage({name:'initialize',data}),a.actor.receiveMessage({name:'initialize',data})]);
 assert.equal(a.clicks(),1,'concurrent initialization only clicks send once');
 assert.ok(responses.some(r=>r.state==='submitted'));
 assert.ok(a.actor.receiveMessage({name:'inspect',data:{token:data.token}}).markerFound);
 const b=fixture();b.editor.value='My draft';
 assert.equal((await b.actor.receiveMessage({name:'initialize',data})).state,'has-draft');assert.equal(b.clicks(),0);
 const c=fixture();c.button.disabled=true;
 assert.equal((await c.actor.receiveMessage({name:'initialize',data})).state,'draft-ready');assert.equal(c.clicks(),0);
 c.button.disabled=false;
 assert.equal((await c.actor.receiveMessage({name:'initialize',data})).state,'submitted');assert.equal(c.clicks(),1);
 const d=fixture();const init=d.actor.receiveMessage({name:'initialize',data});d.doc.location.href='https://chatgpt.com/c/other';d.doc.location.pathname='/c/other';
 assert.equal((await init).state,'wrong-conversation');assert.equal(d.clicks(),0);
 const e=fixture();const original=e.doc.querySelector;e.doc.querySelector=s=>s.includes('profile')?null:original(s);
 assert.equal((await e.actor.receiveMessage({name:'initialize',data})).state,'login-required');assert.equal(e.clicks(),0);
 const f=fixture('div');
 assert.equal((await f.actor.receiveMessage({name:'initialize',data:{...data,text:'联网检索论文\n标题：Test\n作者：Alice\n'+data.token}})).state,'submitted');assert.equal(f.clicks(),1);
 const g=fixture('div');g.editor.innerText='<论文资料>\n【PDF 正文】旧版乱码\n</论文资料>\n'+data.token;
 assert.equal((await g.actor.receiveMessage({name:'initialize',data:{...data,replaceOwned:true}})).state,'submitted');assert.equal(g.clicks(),1);
 const h=fixture('div');h.editor.innerText='My edited draft\n'+data.token;
 assert.equal((await h.actor.receiveMessage({name:'initialize',data:{...data,replaceOwned:true}})).state,'has-draft');assert.equal(h.clicks(),0);
 const matched=fixture();matched.users.push({textContent:'请联网检索论文。标题：DeepScheduler DOI：10.1109/example 论文分析编号：LN9XZJPN'});
 assert.equal(matched.actor.inspect({title:'DeepScheduler',doi:'10.1109/example'}).paperMatch,true,'find the plugin message when its durable journal is missing');
 const firstSend=fixture();firstSend.actor.inspect();firstSend.editor.value='测试';
 firstSend.button.click();
 firstSend.users.push({textContent:'测试'});firstSend.editor.value='';
 assert.equal(firstSend.actor.inspect().freshHomeSubmission,true,'record a first message sent from a blank home page after ChatGPT creates its /c/ URL');
 const existing=fixture();existing.doc.location.href='https://chatgpt.com/c/existing';existing.doc.location.pathname='/c/existing';
 existing.actor.inspect();existing.editor.value='继续追问';existing.button.click();
 existing.users.push({textContent:'继续追问'});
 assert.equal(existing.actor.inspect().freshHomeSubmission,false,'do not treat a message sent inside an existing conversation as a new paper chat');
 console.log('PASS: actor sends once, captures generated ID marker, preserves drafts, retries disabled send safely, requires login and matching chat');
})().catch(e=>{console.error(e);process.exitCode=1;});
