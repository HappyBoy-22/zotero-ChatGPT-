const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const prefs = new Map();
let selected;
const parent = {libraryID:1,key:'PAPER_A',getField:()=> 'Paper A'};
const other = {libraryID:2,key:'PAPER_A',getField:()=> 'Other library'};
const pdf = {parentItemID:10};
const state = {panel:{hidden:false,querySelectorAll:()=>[]}, browser:{hidden:false},bindingDetails:{},bindingSettings:{setAttribute:()=>{}},bindingLabel:{},bindingInput:{value:''},bindingControls:[]};
const nav=[];
const win={};
const env=vm.createContext({URL,currentItem:()=>selected,sidebars:new Map([[win,state]]),PREFIX:'chatgpt-reader-',
 Zotero:{Items:{get:()=>parent},Prefs:{get:k=>prefs.get(k),set:(k,v)=>prefs.set(k,v),clear:k=>prefs.delete(k)}},
 navigateSidebar:(b,u)=>nav.push(u),hideSidebar:()=>{},setSidebarStatus:()=>{}});
vm.runInContext(fs.readFileSync('bindings.js','utf8'),env);
assert.equal(env.conversationURL('https://chat.openai.com/c/abc-123?x=1#top'),'https://chatgpt.com/c/abc-123');
assert.equal(env.conversationURL('https://chatgpt.com/g/g-test/c/abc-123/'),'https://chatgpt.com/g/g-test/c/abc-123');
for(const bad of ['https://evil.com/c/123','https://chatgpt.com/share/123','javascript:alert(1)','https://chatgpt.com/','https://user@chatgpt.com/c/123','https://chatgpt.com:444/c/123']) assert.throws(()=>env.conversationURL(bad));
selected=pdf; env.syncPaperConversation(win);
state.bindingInput.value='https://chatgpt.com/c/chat-a';env.bindConversation(win,false);
assert.equal(prefs.get('chatgptReader.conversations.1.PAPER_A'),'https://chatgpt.com/c/chat-a');
selected=parent;env.syncPaperConversation(win);assert.equal(nav.at(-1),'https://chatgpt.com/c/chat-a');
const count=nav.length;env.syncPaperConversation(win);assert.equal(nav.length,count);
selected=other;env.syncPaperConversation(win);assert.equal(nav.at(-1),'https://chatgpt.com/');
state.browser.currentURI={spec:'https://chatgpt.com/c/chat-b'};
const beforeCurrent=nav.length;env.bindConversation(win,true);
assert.equal(nav.length,beforeCurrent,'binding the current chat must not reload it');
assert.equal(prefs.get('chatgptReader.conversations.2.PAPER_A'),'https://chatgpt.com/c/chat-b');
state.panel.hidden=true;selected=parent;const before=nav.length;env.syncPaperConversation(win);assert.equal(nav.length,before);assert.equal(state.loaded,false);
state.panel.hidden=false;env.syncPaperConversation(win,true);assert.equal(nav.at(-1),'https://chatgpt.com/c/chat-a');
env.unbindConversation(win);assert.equal(prefs.has('chatgptReader.conversations.1.PAPER_A'),false);
assert.equal(prefs.get('chatgptReader.conversations.2.PAPER_A'),'https://chatgpt.com/c/chat-b');
console.log('PASS: URL validation, PDF/parent identity, independent libraries, binding current/link, switching, hidden panel, unbind');
// Re-selecting an unbound paper must retain its live browser while the new
// conversation URL is still being created.
state.activeView={loaded:true};state.browser.currentURI={spec:'https://chatgpt.com/c/pending-paper'};
state.paperIdentity='different-paper';const beforePending=nav.length;
env.syncPaperConversation(win);
assert.equal(nav.length,beforePending,'do not reset a retained paper browser to the blank homepage');
