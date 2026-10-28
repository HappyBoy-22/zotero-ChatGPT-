/* User-written summaries. Keyed like reading progress, never sent to ChatGPT. */
var paperSummaryEditors = new Map(), paperSummaryColumnViews = new Map();
const PAPER_SUMMARY_LIMIT = 20000;
function paperSummaryKey(item) {
  // Reuse the existing identity validation without changing read status.
  return readingStatusKey(item).replace('chatgptReader.read.','chatgptReader.summary.');
}
function getPaperSummary(item) {
  const value = Zotero.Prefs.get(paperSummaryKey(item));return typeof value==='string'?value:'';
}
function setPaperSummary(item,value) {
  if (typeof value!=='string') throw Error('简介必须为文字。');
  value=value.replace(/\r\n?/g,'\n');if(value.length>PAPER_SUMMARY_LIMIT)throw Error('简介最多可保存 20000 个字符。');
  if (!value.trim()) value='';
  const key=paperSummaryKey(item),previous=Zotero.Prefs.get(key);
  try {if(value)Zotero.Prefs.set(key,value);else Zotero.Prefs.clear(key);Services.prefs.savePrefFile(null);}
  catch(error){if(previous===undefined)Zotero.Prefs.clear(key);else Zotero.Prefs.set(key,previous);throw error;}
  refreshReadingColumn(item);
}
function paperSummaryColumnOptions(pluginID) {
  return {
    dataKey:'paperSummary',label:'简介',pluginID,enabledTreeIDs:['main'],defaultIn:['*'],
    width:'240',flex:1,minWidth:100,zoteroPersist:['width','hidden','sortDirection'],
    dataProvider:item=>readingPaper(item)?getPaperSummary(item):'',
    renderCell(index,data,column,isFirstColumn,doc) {
      const cell=doc.createElementNS('http://www.w3.org/1999/xhtml','span');cell.className='cell '+column.className;
      cell.style.cssText='display:flex;align-items:center;min-width:0;';
      const item=doc.defaultView.ZoteroPane?.itemsView?.getRow(index)?.ref;if(!readingPaper(item))return cell;
      const text=getPaperSummary(item),content=doc.createElementNS('http://www.w3.org/1999/xhtml','span');
      content.className='cell-text';content.style.cssText='min-width:0;flex:1;';
      const edit=doc.createElementNS('http://www.w3.org/1999/xhtml','button');edit.type='button';edit.dataset.paperSummary=String(item.id);
      edit.textContent=text.replace(/\s+/g,' ').trim()||'添加简介';
      edit.title=text||'点击添加这篇论文的简介';
      edit.setAttribute('aria-label','编辑简介：'+(item.getField('title')||'未命名论文'));
      edit.style.cssText='display:block;width:100%;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;border:0;background:transparent;color:inherit;font:inherit;padding:0;cursor:pointer;'+(text?'':'opacity:.55;');
      for(const type of ['pointerdown','mousedown','mouseup','dblclick'])edit.addEventListener(type,event=>event.stopPropagation());
      edit.addEventListener('keydown',event=>event.stopPropagation());
      edit.addEventListener('click',event=>{event.stopPropagation();openPaperSummaryEditor(doc.defaultView,item);});
      content.append(edit);cell.append(content);return cell;
    }
  };
}
function openPaperSummaryEditor(win,item) {
  if(!readingPaper(item))throw Error('请先选择论文。');
  const old=paperSummaryEditors.get(win);
  if(old){old.input.focus();return old;}
  const doc=win.document,html=(tag,text)=>{const e=doc.createElementNS('http://www.w3.org/1999/xhtml',tag);if(text!==undefined)e.textContent=text;return e;};
  const previousFocus=doc.activeElement,root=html('div');root.id=PREFIX+'summary-editor';
  root.style.cssText='position:fixed;inset:0;z-index:11000;background:#0003;display:flex;align-items:center;justify-content:center;';
  const dialog=html('section');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','编辑论文简介');
  dialog.style.cssText='box-sizing:border-box;width:620px;max-width:90vw;max-height:90vh;overflow:auto;padding:24px;border:1px solid #8e9bb0;border-radius:12px;background:light-dark(#fff,#292c32);color:light-dark(#252a34,#eee);box-shadow:0 12px 50px #0004;font:14px system-ui;';
  const title=html('h2','论文简介');title.style.cssText='font-size:20px;margin:0 0 10px;';
  const paper=html('p',item.getField('title')||'未命名论文');paper.style.cssText='margin:0 0 16px;line-height:1.6;opacity:.7;overflow-wrap:anywhere;';
  const input=html('textarea');input.id=PREFIX+'summary-input';input.rows=7;input.maxLength=PAPER_SUMMARY_LIMIT;
  input.setAttribute('aria-label','论文简介');input.placeholder='用自己的话概括：这篇论文研究什么、采用什么方法、主要结论是什么……';input.value=getPaperSummary(item);
  input.style.cssText='box-sizing:border-box;width:100%;min-height:180px;max-height:45vh;resize:vertical;padding:12px;font:15px/1.65 system-ui;border:1px solid #8e9bb0;border-radius:7px;background:transparent;color:inherit;';
  const error=html('p');error.setAttribute('role','alert');error.hidden=true;error.style.cssText='color:#c74332;line-height:1.5;';
  const footer=html('div');footer.style.cssText='display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:16px;';
  const hint=html('span','Ctrl + Enter 保存 · Esc 取消');hint.style.cssText='font-size:12px;opacity:.65;';const actions=html('div');actions.style.cssText='display:flex;gap:10px;';
  const cancel=html('button','取消'),save=html('button','保存');
  for(const button of [cancel,save]){button.type='button';button.style.cssText='font:inherit;padding:8px 20px;border:1px solid #8e9bb0;border-radius:6px;background:transparent;color:inherit;cursor:pointer;';}
  save.style.cssText+='background:#3478f6;border-color:#3478f6;color:white;';actions.append(cancel,save);footer.append(hint,actions);
  dialog.append(title,paper,input,error,footer);root.append(dialog);doc.documentElement.append(root);
  const state={root,input,item,dispose(){
    root.remove();win.removeEventListener('unload',unload);if(paperSummaryEditors.get(win)===state)paperSummaryEditors.delete(win);
    if(previousFocus?.isConnected)previousFocus.focus();
  }};
  const unload=()=>state.dispose();win.addEventListener('unload',unload,{once:true});paperSummaryEditors.set(win,state);
  const submit=()=>{try{setPaperSummary(item,input.value);state.dispose();}catch(e){report(e);error.textContent='保存失败：'+e.message;error.hidden=false;input.focus();}};
  save.addEventListener('click',submit);cancel.addEventListener('click',()=>state.dispose());
  root.addEventListener('keydown',event=>{
    event.stopPropagation();
    if(event.key==='Escape'){event.preventDefault();state.dispose();}
    else if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();submit();}
    else if(event.key==='Tab'){
      const controls=[input,cancel,save],index=controls.indexOf(doc.activeElement);
      if(event.shiftKey&&index===0){event.preventDefault();save.focus();}
      else if(!event.shiftKey&&index===2){event.preventDefault();input.focus();}
    }
  });
  for(const type of ['pointerdown','mousedown','mouseup','click','dblclick'])root.addEventListener(type,event=>event.stopPropagation());
  input.focus();return state;
}
// Initialize only the new column's position. Preserve all user column settings.
async function positionPaperSummaryColumn(view) {
  const summary=paperStatusColumnKeys.get('summary');if(!summary||!view?._getColumnPrefs)return;
  const prefs=view._getColumnPrefs();if(prefs[summary]?.ordinal!==undefined)return;
  const read=view._getColumns().find(c=>c.dataKey===readingColumnKey);if(!read||!Number.isFinite(read.ordinal))return;
  view._storeColumnPrefs({...prefs,[summary]:{...prefs[summary],ordinal:read.ordinal-.5}});
  await view._writeColumnPrefsToFile(true);await view._resetColumns();
}
function watchPaperSummaryColumn(win) {
  if(paperSummaryColumnViews.has(win))return;
  const view=win.ZoteroPane?.itemsView;if(!view)return;
  const refresh=()=>{if(!stopped)run(()=>positionPaperSummaryColumn(view));};
  view.onRefresh.addListener(refresh);paperSummaryColumnViews.set(win,{view,refresh});refresh();
}
function stopPaperSummaryWindow(win) {
  paperSummaryEditors.get(win)?.dispose();
  const state=paperSummaryColumnViews.get(win);if(state){state.view.onRefresh.removeListener(state.refresh);paperSummaryColumnViews.delete(win);}
}
function stopPaperSummaries() {
  for(const win of new Set([...paperSummaryEditors.keys(),...paperSummaryColumnViews.keys()])) {
    try{stopPaperSummaryWindow(win);}catch(error){report(error);}
  }
}
