const assert=require('node:assert/strict');
global.JSWindowActorChild=class {};
(async()=>{
 const {ReaderAssistantChild}=await import('../ReaderChild.sys.mjs');
 const actor=new ReaderAssistantChild();
 let value='',clicks=0,mode='email';
 class Input {}
 Object.defineProperty(Input.prototype,'value',{set(v){value=v;}});
 const submit={disabled:false,click:()=>clicks++};
 const field={disabled:false,getClientRects:()=>[{}],dispatchEvent:()=>{},form:{querySelector:()=>submit}};
 actor.contentWindow={HTMLInputElement:Input,Event:class{}};
 actor.document={location:{protocol:'https:',hostname:'example.com'},querySelectorAll:s=>s.includes(mode)?[field]:[]};
 const request={name:'login',data:{email:'test@example.invalid',password:'test-secret'}};
 assert.equal(actor.receiveMessage(request).state,'wrong-origin');assert.equal(value,'');
 actor.document.location.hostname='chatgpt.com';actor.document.querySelector=()=>null;
 assert.equal(actor.receiveMessage(request).state,'not-ready');assert.equal(value,'');
 actor.document.location.hostname='auth.openai.com';
 actor.receiveMessage(request);assert.equal(value,'test@example.invalid');assert.equal(clicks,1);
 actor.receiveMessage(request);assert.equal(clicks,1,'do not repeatedly submit login');
 mode='password';actor.receiveMessage(request);assert.equal(value,'test-secret');assert.equal(clicks,2);
 actor.document.location.protocol='http:';value='';actor.receiveMessage(request);assert.equal(value,'');
 actor.document.location={protocol:'https:',hostname:'chatgpt.com',href:'https://chatgpt.com/c/other'};
 assert.equal(actor.receiveMessage({name:'draft',data:{text:'Paper A',expectedURL:'https://chatgpt.com/c/a'}}).state,'wrong-conversation');
 console.log('PASS: credential origin/HTTPS restrictions, email/password stages, one submit per stage, stale-conversation protection');
})().catch(e=>{console.error(e);process.exitCode=1;});
