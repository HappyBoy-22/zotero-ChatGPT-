'use strict';
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const files=new Map(),items=[],collections=[],warnings=[];let nextID=10,copies=0;
const dir=p=>files.set(p,{type:'directory',size:0,lastModified:1});
const file=(p,content)=>files.set(p,{type:'regular',bytes:Buffer.from(content),size:Buffer.byteLength(content),lastModified:1});
dir('/papers');dir('/papers/A');dir('/papers/B');dir('/papers/Empty');
file('/papers/A/paper.pdf','same paper');file('/papers/B/renamed.PDF','same paper');file('/papers/B/paper.pdf','different paper');
file('/papers/readme.txt','skip');files.set('/papers/link',{type:'symlink',size:0,lastModified:1});
const env=vm.createContext({stopped:false,Map,Set,Number,Promise,Array,Error,report:e=>warnings.push(e),
  PathUtils:{filename:path.posix.basename},
  IOUtils:{stat:async p=>{if(!files.has(p))throw Error('missing file');return files.get(p);},
    getChildren:async p=>[...files.keys()].filter(key=>key!==p&&path.posix.dirname(key)===p),
    read:async(p,options)=>files.get(p).bytes.subarray(options.offset,options.offset+options.maxBytes)},
  Components:{interfaces:{nsICryptoHash:{},nsIFile:{}},classes:{'@mozilla.org/security/hash;1':{createInstance:()=>{
    let hash;return{SHA256:1,init(){hash=crypto.createHash('sha256');},update:bytes=>hash.update(bytes),finish:()=>hash.digest('latin1')};
  }}}},
  Zotero:{isWin:false,File:{pathToFile:p=>({path:p,isSymlink:()=>files.get(p)?.type==='symlink',isDirectory:()=>files.get(p)?.type==='directory'})},
    Libraries:{userLibraryID:1,get:id=>id===1?{libraryID:1,editable:true,filesEditable:true}:id===2?{libraryID:2,editable:false,filesEditable:false}:null},
    Collections:{get:id=>collections.find(c=>c.id===id),getByLibrary:id=>collections.filter(c=>c.libraryID===id&&!c.parentID),getByParent:id=>collections.filter(c=>c.parentID===id)},
    Items:{getAll:async id=>items.filter(i=>i.libraryID===id),get:id=>items.find(i=>i.id===id)},
    Collection:function(){this.saveTx=async()=>{this.id=nextID++;collections.push(this);};},
    RecognizeDocument:{autoRecognizeItems:async()=>{throw Error('recognition must be disabled for fixtures');}},
    Attachments:{importFromFile:async options=>{
      copies++;const item=attachment(options.file);item.groups=new Set(options.collections||[]);items.push(item);return item;
    }}
  }
});
function attachment(p,parentItemID=null){return{id:nextID++,key:'ABCDEFGH',libraryID:1,attachmentContentType:'application/pdf',parentItemID,groups:new Set(),isAttachment:()=>true,getFilePathAsync:async()=>p,
  loadDataType:async type=>assert.equal(type,'collections'),inCollection(id){return this.groups.has(id);},addToCollection(id){this.groups.add(id);},saveTx:async()=>{}};}
vm.runInContext(fs.readFileSync('file-import.js','utf8'),env);
(async()=>{
  assert.equal(env.importFileType('x.PDF'),'application/pdf');assert.equal(env.importFileType('x.epub'),'application/epub+zip');
  for(const value of ['x','x.txt','x.__proto__','x.constructor','x.toString'])assert.equal(env.importFileType(value),null);
  const plan=await env.scanFileImport(['/papers','/papers/A','/papers'],{});
  assert.equal(plan.files.length,3,'overlapping roots scan once');assert.equal(plan.directories.length,4,'empty folders preserved');assert.equal(plan.skipped,2,'unrelated files and links skipped');
  const hash=await env.hashImportFile('/papers/A/paper.pdf',{});assert.equal(hash,crypto.createHash('sha256').update('same paper').digest('hex'));
  // An existing child PDF must reuse its parent record and its read/chat identity.
  const parent=attachment('/unused');parent.id=1;parent.isAttachment=()=>false;items.push(parent,attachment('/papers/A/paper.pdf',1));
  let result=await env.runFileImport(['/papers'],'1:',{},()=>{},false);
  assert.equal(result.imported,1);assert.equal(result.reused,2);assert.equal(result.skipped,2);assert.equal(result.failed,0);assert.equal(copies,1);
  assert.equal(parent.groups.size,2,'one parent belongs to both source folders');
  const child=items.find(i=>i.parentItemID);assert.equal(child.groups.size,0,'do not put the child PDF into collections');
  result=await env.runFileImport(['/papers'],'1:',{},()=>{},false);assert.equal(result.imported,0);assert.equal(result.reused,3);assert.equal(copies,1,'repeat imports do not create duplicate attachments or collections');assert.equal(collections.length,4);
  await assert.rejects(env.runFileImport(['/papers'],'2:',{},()=>{},false),/不允许/);
  await assert.rejects(env.runFileImport(['/papers'],'1:999',{},()=>{},false),/目标分类/);
  const cancelled={cancelled:true};result=await env.runFileImport(['/papers'],'1:',cancelled,()=>{},false);assert.equal(result.cancelled,true);assert.equal(copies,1);
  const partial={};result=await env.runFileImport(['/papers/A/paper.pdf','/papers/B/paper.pdf'],'1:',partial,()=>{partial.cancelled=true;},false);assert.equal(result.cancelled,true);
  // A missing input reports a failure, while readable inputs still import/reuse.
  result=await env.runFileImport(['/missing.pdf','/papers/A/paper.pdf'],'1:',{},()=>{},false);assert.equal(result.failed,1);assert.equal(result.reused,1);
  // Parent in trash must never be reused.
  parent.deleted=true;const index=await env.buildImportIndex(1,new Set([10]),{},()=>{});assert.equal(index.size,0);
  // Drop parsing ignores internal Zotero item drags and deduplicates OS paths.
  const transfer={mozItemCount:3,mozGetDataAt:(_,i)=>i===2?null:{QueryInterface:()=>({path:'/papers'})}};
  assert.deepEqual(Array.from(env.droppedImportPaths(transfer)),['/papers']);
  const handlers={},received=[];env.run=fn=>fn();env.importFilesIntoWindow=(win,paths,target)=>received.push({paths,target});
  const win={Zotero_Tabs:{selectedID:'zotero-pane'},ZoteroPane:{getSelectedLibraryIDs:()=>[1],getSelectedCollections:()=>[]},addEventListener:(type,fn)=>handlers[type]=fn,removeEventListener:type=>delete handlers[type]};
  env.installFileImportDrop(win);
  function drop(p,extra={}){let prevented=false;handlers.drop({type:'drop',dataTransfer:{mozItemCount:1,mozGetDataAt:()=>({QueryInterface:()=>({path:p})})},preventDefault:()=>prevented=true,stopImmediatePropagation(){},...extra});return prevented;}
  assert.equal(drop('/papers'),true);assert.equal(drop('/papers/A/paper.pdf'),true);assert.equal(received.length,2);assert.equal(received[0].target,'1:');
  assert.equal(drop('/papers/readme.txt'),false);assert.equal(drop('/papers',{shiftKey:true}),false);win.Zotero_Tabs.selectedID='reader';assert.equal(drop('/papers'),false);
  env.stopFileImportWindow(win);assert.equal(Object.keys(handlers).length,0,'main-window drag listeners are removed');
  assert.equal(env.fileImportJob,null);assert.equal(warnings.length,0);
  console.log('PASS: recursive folder scan, symlinks/overlap, SHA-256, parent record reuse, multi-collection dedup, repeat import, permissions, cancellation, partial failures and native drop payloads');
})().catch(error=>{console.error(error);process.exitCode=1;});
