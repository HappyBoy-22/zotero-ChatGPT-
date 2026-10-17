const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const paper = {
  getField: name => ({title:'Test paper', abstractNote:'Example abstract', DOI:'10.123/example'}[name] || ''),
  getCreators: () => [{firstName:'A',lastName:'Researcher'}],
  getAttachments: () => [2],
  isAttachment: () => false
};
const pdf = {
  isAttachment: () => true, parentItemID: 1,
  isPDFAttachment: () => true,
  getAnnotations: () => [{annotationText:'Finding',annotationComment:'Question',annotationPageLabel:'3'}]
};
let reader = {itemID:2};
let selected = [paper];
const errors = [];
const sandbox = vm.createContext({
  Zotero: {
    getMainWindow: () => ({Zotero_Tabs:{selectedID:'pdf'},ZoteroPane:{getSelectedItems:()=>selected}}),
    Reader:{getByTabID:()=>reader}, Items:{get:id=>id===1?paper:pdf},
    logError: error=>errors.push(error)
  }
});
vm.runInContext(fs.readFileSync('bootstrap.js','utf8'), sandbox);
vm.runInContext(fs.readFileSync('sidebar.js','utf8'), sandbox);
sandbox.Services = {wm:{getEnumerator:()=>({hasMoreElements:()=>false})}};
(async () => {
  const full = await sandbox.context(true);
  assert.match(full,/标题：Test paper/);
  assert.match(full,/作者：A Researcher/);
  assert.match(full,/页 3：Finding/);
  assert.match(full,/笔记：Question/);
  assert.doesNotMatch(await sandbox.context(false),/Finding/);
  reader = null;
  assert.match(await sandbox.context(true),/Finding/);
  selected = [];
  await assert.rejects(sandbox.context(true),/请先选择论文/);
  let removed = 0;
  vm.runInContext('mainWindows.add(testWin)', Object.assign(sandbox, {
    testWin:{document:{getElementById:id=>id==='chatgpt-reader-menu'?{remove:()=>removed++}:null}}
  }));
  sandbox.shutdown();
  assert.equal(removed,1);
  assert.equal(errors.length,0);
  console.log('PASS: reader and library context, annotations, empty selection, shutdown cleanup');
})().catch(error=>{ console.error(error);process.exitCode=1; });
