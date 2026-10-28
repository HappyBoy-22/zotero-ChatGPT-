'use strict';
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const prefs=new Map(),errors=[];let fail=false,flushes=0,refreshes=0;
const env=vm.createContext({Map,Set,Number,PREFIX:'chatgpt-reader-',stopped:false,report:e=>errors.push(e),run:fn=>fn(),
 Zotero:{Prefs:{get:key=>prefs.get(key),set:(key,value)=>prefs.set(key,value),clear:key=>prefs.delete(key)}},
 Services:{prefs:{savePrefFile(){if(fail)throw Error('disk full');flushes++;}}}
});
vm.runInContext(fs.readFileSync('reading-list.js','utf8'),env);vm.runInContext(fs.readFileSync('paper-summary.js','utf8'),env);env.refreshReadingColumn=()=>refreshes++;
const paper={id:1,key:'ABCDEFG2',libraryID:1,getField:()=>'<Title>',isRegularItem:()=>true,isPDFAttachment:()=>false};
assert.equal(env.getPaperSummary(paper),'');
env.setPaperSummary(paper,'研究问题\r\n方法：<script>alert(1)</script>\r结论');
assert.equal(env.getPaperSummary(paper),'研究问题\n方法：<script>alert(1)</script>\n结论');assert.equal(flushes,1);
assert.equal(env.getPaperSummary({...paper,libraryID:2}),'');assert.equal(env.getPaperSummary({...paper,key:'ABCDEFG3'}),'');
assert.equal(env.isPaperRead(paper),false);assert.equal(env.getPaperFlag(paper,'selfPresented'),false);
fail=true;assert.throws(()=>env.setPaperSummary(paper,'overwrite'),/disk full/);assert.match(env.getPaperSummary(paper),/研究问题/);
assert.throws(()=>env.setPaperSummary({...paper,key:'ABCDEFG3'},'new'),/disk full/);assert.equal(prefs.has(env.paperSummaryKey({...paper,key:'ABCDEFG3'})),false);fail=false;
assert.throws(()=>env.setPaperSummary(paper,5));assert.throws(()=>env.setPaperSummary(paper,'x'.repeat(20001)));assert.throws(()=>env.getPaperSummary({...paper,key:'../bad'}));
class Element {
 constructor(tag,doc){this.tag=tag;this.doc=doc;this.children=[];this.handlers={};this.dataset={};this.style={};this.isConnected=true;}
 append(...nodes){this.children.push(...nodes);nodes.forEach(node=>node.parent=this);}setAttribute(key,value){this[key]=value;}
 addEventListener(type,fn){this.handlers[type]=fn;}focus(){this.doc.activeElement=this;}remove(){this.isConnected=false;if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);}
}
const doc={createElementNS:(_,tag)=>new Element(tag,doc)};doc.documentElement=new Element('root',doc);
const win={document:doc,addEventListener(){},removeEventListener(){}};doc.defaultView=win;
const options=env.paperSummaryColumnOptions('test@local'),ctx={};win.ZoteroPane={itemsView:{getRow:()=>({ref:paper})}};
const cell=options.renderCell.call(ctx,0,options.dataProvider(paper),{className:'summary'},false,doc),button=cell.children[0].children[0];
assert.equal(button.title,env.getPaperSummary(paper),'hover contains full multiline summary, including literal markup');assert.equal(button.textContent,'研究问题 方法：<script>alert(1)</script> 结论');assert.match(button.style.cssText,/text-overflow:ellipsis/);
let stopped=false;button.handlers.click({stopPropagation:()=>stopped=true});assert.equal(stopped,true);
let state=env.paperSummaryEditors.get(win);assert.ok(state);assert.equal(state.input.value,button.title);
assert.equal(env.openPaperSummaryEditor(win,paper),state,'one editor per window');
state.input.value='不保存';state.root.handlers.keydown({key:'Escape',stopPropagation(){},preventDefault(){}});assert.equal(env.getPaperSummary(paper),button.title);assert.equal(env.paperSummaryEditors.size,0);
state=env.openPaperSummaryEditor(win,paper);state.input.value='新简介\n第二行';state.root.handlers.keydown({key:'Enter',ctrlKey:true,stopPropagation(){},preventDefault(){}});assert.equal(env.getPaperSummary(paper),'新简介\n第二行');assert.equal(env.paperSummaryEditors.size,0);
state=env.openPaperSummaryEditor(win,paper);state.input.value='failed';fail=true;state.root.handlers.keydown({key:'Enter',ctrlKey:true,stopPropagation(){},preventDefault(){}});assert.equal(env.paperSummaryEditors.get(win),state,'failed save retains draft/editor');assert.equal(env.getPaperSummary(paper),'新简介\n第二行');fail=false;state.dispose();
env.setPaperSummary(paper,' \n ');assert.equal(env.getPaperSummary(paper),'');assert.equal(prefs.has(env.paperSummaryKey(paper)),false);
assert.equal(options.renderCell.call(ctx,0,'',{className:'summary'},false,doc).children[0].children[0].textContent,'添加简介');
win.ZoteroPane.itemsView.getRow=()=>({ref:{isRegularItem:()=>false}});assert.equal(options.renderCell.call({},0,'',{className:'summary'},false,doc).children.length,0);
(async()=>{
 env.paperStatusColumnKeys.set('summary','summary');env.readingColumnKey='read';
 let settings={read:{ordinal:4,width:54},title:{ordinal:0,width:500}},writes=0,resets=0;
 const view={_getColumnPrefs:()=>settings,_getColumns:()=>[{dataKey:'read',ordinal:4}],_storeColumnPrefs:value=>settings=value,_writeColumnPrefsToFile:async force=>{assert.equal(force,true);writes++;},_resetColumns:async()=>resets++};
 await env.positionPaperSummaryColumn(view);assert.equal(settings.summary.ordinal,3.5);assert.equal(settings.title.width,500);assert.equal(writes,1);assert.equal(resets,1);
 settings.summary.ordinal=9;await env.positionPaperSummaryColumn(view);assert.equal(settings.summary.ordinal,9,'do not undo a user reorder');assert.equal(writes,1);
 console.log('PASS: summary persistence and rollback, library isolation, literal text/hover, ellipsis, edit/save/cancel/failure, empty clear, independent progress and initial column position');
})().catch(error=>{console.error(error);process.exitCode=1;});
