'use strict';
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const prefs=new Map(),errors=[];let flushes=0,fail=false;
const env=vm.createContext({Map,Set,Number,report:e=>errors.push(e),
  Zotero:{Prefs:{get:k=>prefs.get(k),set:(k,v)=>prefs.set(k,v),clear:k=>prefs.delete(k)}},
  Services:{prefs:{savePrefFile(){if(fail)throw Error('disk full');flushes++;}}}
});vm.runInContext(fs.readFileSync('reading-list.js','utf8'),env);
const item=(id,key,title,libraryID=1,extra={})=>({id,key,libraryID,getField:()=>title,isRegularItem:()=>true,isPDFAttachment:()=>false,...extra});
const a=item(1,'ABCDEFG2','Alpha <paper>'),b=item(2,'ABCDEFG3','第二篇',2),pdf=item(3,'ABCDEFG4','Standalone PDF',1,{isRegularItem:()=>false,isPDFAttachment:()=>true});
const rows=env.readingListRows([a,b,pdf,item(4,'ABCDEFG5','Child PDF',1,{parentItemID:1}),item(5,'ABCDEFG6','deleted',1,{deleted:true}),item(6,'ABCDEFG7','note',1,{isRegularItem:()=>false})],new Map([[1,'My Library'],[2,'Group']]));
assert.equal(rows.length,3,'one row per parent, standalone PDFs included, notes/children/trash omitted');
assert.equal(env.isPaperRead(a),false);env.setPaperRead(a,true);assert.equal(env.isPaperRead(a),true);assert.equal(flushes,1);
assert.equal(env.isPaperRead({...a,libraryID:2}),false,'same key in different libraries remains independent');
assert.equal(env.readingListFilter(rows,'','alpha','all').length,1);assert.equal(env.readingListFilter(rows,'','', 'read').length,1);
assert.equal(env.readingListFilter(rows,'2','', 'read').length,0);assert.equal(env.readingListFilter(rows,'','', 'unread').length,2);
env.setPaperRead(a,false);assert.equal(env.isPaperRead(a),false,'manual uncheck persists too');
fail=true;assert.throws(()=>env.setPaperRead(a,true),/disk full/);assert.equal(env.isPaperRead(a),false,'failed flush rolls back');assert.throws(()=>env.setPaperRead(b,true));assert.equal(prefs.has(env.readingStatusKey(b)),false,'failed first save leaves no flag');fail=false;
assert.throws(()=>env.setPaperRead(a,'yes'));assert.throws(()=>env.isPaperRead({...a,key:'../bad'}));
let rendered=0;env.readingLists.set(1,{render:()=>rendered++});env.readingLists.set(2,{disposed:true,render(){throw Error('dead window');}});env.setPaperRead(a,true);assert.equal(rendered,1);env.readingLists.clear();
env.readingLists.set(1,{render(){throw Error('dead object');}});env.readingLists.set(2,{render:()=>rendered++});env.setPaperRead(a,false);assert.equal(rendered,2,'one stale page cannot block another');assert.equal(errors.length,1);errors.length=0;env.readingLists.clear();
const original=()=>[{type:'library'},{type:'reader'},{type:'chatgptReadingList'}];
const win={addEventListener(){},removeEventListener(){},Zotero_Tabs:{getState:original,tabHooks:{undoClose:{}},_history:[[{type:'reader'},{type:'chatgptReadingList'}],[{type:'chatgptReadingList'}]]}};
env.installReadingTabHooks(win);assert.deepEqual(win.Zotero_Tabs.getState().map(t=>t.type),['library','reader'],'custom page cannot corrupt native session restoration');
env.stopReadingListWindow(win);assert.equal(win.Zotero_Tabs.getState,original);assert.deepEqual(win.Zotero_Tabs._history,[[{type:'reader'}]]);assert.equal(win.Zotero_Tabs.tabHooks.undoClose.chatgptReadingList,undefined);
assert.equal(errors.length,0);
console.log('PASS: paper deduplication, library isolation, explicit check/uncheck, durable preference flush/rollback, filters, stale windows and native tab session/undo cleanup');
