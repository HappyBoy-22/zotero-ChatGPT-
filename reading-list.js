/* Manual paper progress, independent flags per bibliographic item (or standalone PDF). */
var readingLists = new Map(), readingTabHooks = new Map();
var readingColumnKey = null;
var paperStatusColumnKeys = new Map();
const PAPER_STATUS_COLUMNS = [
  {flag:'read',dataKey:'paperRead',label:'已读',width:54},
  {flag:'selfPresented',dataKey:'paperSelfPresented',label:'自己已讲',width:88},
  {flag:'labPresented',dataKey:'paperLabPresented',label:'实验室已讲',width:104}
];
function startReadingColumn(pluginID) {
  if (paperStatusColumnKeys.size) return;
  try {
    for (const status of PAPER_STATUS_COLUMNS) {
      const key = Zotero.ItemTreeManager.registerColumn(paperStatusColumnOptions(pluginID,status));
      if (!key) throw Error('无法注册'+status.label+'复选框列。');
      paperStatusColumnKeys.set(status.flag,key);
    }
    readingColumnKey = paperStatusColumnKeys.get('read');
  } catch(error) {stopReadingColumn();throw error;}
}
function paperStatusColumnOptions(pluginID,status) {
  return {
    dataKey:status.dataKey,label:status.label,pluginID,enabledTreeIDs:['main'],defaultIn:['*'],
    width:String(status.width),flex:0,fixedWidth:true,staticWidth:true,minWidth:status.width-6,
    zoteroPersist:['width','hidden','sortDirection'],
    dataProvider:item=>readingPaper(item)?`${getPaperFlag(item,status.flag)?1:0}:${item.id}`:'',
    renderCell(index,data,column,isFirstColumn,doc) {
      const cell = doc.createElementNS('http://www.w3.org/1999/xhtml','span');
      cell.className = 'cell '+column.className;cell.style.cssText = 'display:flex;align-items:center;justify-content:center;';
      if (!data) return cell;
      const item = Zotero.Items.get(Number(data.split(':')[1]));if (!item || !readingPaper(item)) return cell;
      const checkbox = doc.createElementNS('http://www.w3.org/1999/xhtml','input');
      checkbox.type = 'checkbox';checkbox.checked = getPaperFlag(item,status.flag);
      checkbox.dataset.paperStatus = status.flag;checkbox.dataset.paperId = String(item.id);
      if (status.flag==='read') checkbox.dataset.paperRead = String(item.id);
      checkbox.style.cssText = 'width:17px;height:17px;accent-color:#3478f6;cursor:pointer;margin:0;';
      checkbox.setAttribute('aria-label',status.label+'：'+(item.getField('title')||'未命名论文'));
      checkbox.title = '勾选 / 取消'+status.label;
      for (const type of ['pointerdown','mousedown','mouseup','click','dblclick']) checkbox.addEventListener(type,event=>event.stopPropagation());
      checkbox.addEventListener('keydown',event=>{if (event.code==='Space'||event.key==='Enter') event.stopPropagation();});
      checkbox.addEventListener('change',()=>{
        try {setPaperFlag(item,status.flag,checkbox.checked);}
        catch (error) {checkbox.checked = getPaperFlag(item,status.flag);report(error);doc.defaultView.alert('保存'+status.label+'状态失败：'+error.message);}
      });
      const content=doc.createElementNS('http://www.w3.org/1999/xhtml','span');content.className='cell-text';content.append(checkbox);cell.append(content);return cell;
    }
  };
}
function stopReadingColumn() {
  for (const key of paperStatusColumnKeys.values()) {
    try {Zotero.ItemTreeManager.unregisterColumn(key);} catch(error) {report(error);}
  }
  paperStatusColumnKeys.clear();readingColumnKey = null;
}
function refreshReadingColumn(item) {
  for (const win of Zotero.getMainWindows?.() || []) {
    try {
      const view = win.ZoteroPane?.itemsView;if (!view) continue;
      view.invalidateRowCache([item.id]);
      const index = view.getRowIndexByID(item.id);
      if (index !== false && index !== undefined) view.tree?.invalidateRow(index);
    } catch (error) {report(error);}
  }
}
function installReadingTabHooks(win) {
  if(readingTabHooks.has(win))return;
  const tabs=win.Zotero_Tabs,type='chatgptReadingList',original=tabs.getState;
  // Zotero restores only built-in content types. Keep our temporary page out
  // of its session file; reading flags themselves persist independently.
  const getState=function(...args){return original.apply(this,args).filter(tab=>tab.type!==type);};
  const undo=tabs.tabHooks.undoClose[type];
  const undoClose=async()=>{openReadingList(win);return true;};
  tabs.getState=getState;tabs.tabHooks.undoClose[type]=undoClose;
  const cleanup=()=>stopReadingListWindow(win);
  win.addEventListener('unload',cleanup,{once:true});
  readingTabHooks.set(win,{original,getState,undo,undoClose,cleanup});
}
function readingStatusKey(item) {
  return paperFlagKey(item,'read');
}
function paperFlagKey(item,flag) {
  if (!PAPER_STATUS_COLUMNS.some(status=>status.flag===flag)) throw Error('无法识别论文状态。');
  if(!Number.isInteger(item?.libraryID)||!/^[A-Z0-9]{8}$/.test(item?.key||''))throw Error('无法识别论文条目。');
  return 'chatgptReader.'+flag+'.'+item.libraryID+'.'+item.key;
}
function getPaperFlag(item,flag){return Zotero.Prefs.get(paperFlagKey(item,flag))===true;}
function isPaperRead(item){return getPaperFlag(item,'read');}
function setPaperRead(item,value){setPaperFlag(item,'read',value);}
function setPaperFlag(item,flag,value) {
  if(typeof value!=='boolean')throw Error('论文状态必须为复选框值。');
  const key=paperFlagKey(item,flag),previous=Zotero.Prefs.get(key);
  try{Zotero.Prefs.set(key,value);Services.prefs.savePrefFile(null);}
  catch(error){if(previous===undefined)Zotero.Prefs.clear(key);else Zotero.Prefs.set(key,previous);throw error;}
  refreshReadingColumn(item);
  if (flag==='read') for(const state of readingLists.values())if(!state.disposed){try{state.render();}catch(error){report(error);}}
}
function readingPaper(item) {
  return !!item&&!item.deleted&&!item.parentItemID&&(item.isRegularItem?.()||item.isPDFAttachment?.())
    && Zotero.Libraries?.get?.(item.libraryID)?.libraryType !== 'feed';
}
function readingListRows(items,libraryNames) {
  return items.filter(readingPaper).map(item=>({item,title:item.getField('title')||'未命名论文',library:libraryNames.get(item.libraryID)||'文库'}))
    .sort((a,b)=>a.title.localeCompare(b.title,'zh-CN',{numeric:true,sensitivity:'base'})||a.item.id-b.item.id);
}
function readingListFilter(rows,libraryID,query,status) {
  const text=query.trim().toLocaleLowerCase();
  return rows.filter(row=>(!libraryID||row.item.libraryID===Number(libraryID))&&(!text||row.title.toLocaleLowerCase().includes(text))
    &&(status==='all'||isPaperRead(row.item)===(status==='read')));
}
function addReadingListButton(win,target) {
  if(win.document.getElementById(PREFIX+'reading-list'))return;
  const node=button(win.document,'阅读清单',()=>openReadingList(win));node.id=PREFIX+'reading-list';
  node.setAttribute('style','padding:4px 8px;min-width:88px!important;width:88px!important;flex-shrink:0;');
  node.setAttribute('tooltiptext','查看全部论文，手动勾选已读');target?.prepend(node);
}
function openReadingList(sourceWindow=Zotero.getMainWindow()) {
  const win=sourceWindow?.Zotero_Tabs?sourceWindow:Zotero.getMainWindow();
  if(!win?.Zotero_Tabs)throw Error('请先打开 Zotero 主窗口。');
  const previous=readingLists.get(win);
  if(previous&&!previous.disposed&&previous.root.isConnected){win.Zotero_Tabs.select(previous.id);previous.refresh();return previous;}
  const doc=win.document,html=(tag,text)=>{const e=doc.createElementNS('http://www.w3.org/1999/xhtml',tag);if(text!==undefined)e.textContent=text;return e;};
  installReadingTabHooks(win);
  let state;
  const tab=win.Zotero_Tabs.add({type:'chatgptReadingList',title:'阅读清单',data:{},select:false,onClose:()=>state?.dispose()});
  const root=html('section');root.className='cr-reading-list';root.setAttribute('aria-label','论文阅读清单');
  root.style.cssText='height:100%;min-height:0;flex:1;';
  const style=html('style');style.textContent=`
    .cr-reading-list{display:flex;flex-direction:column;box-sizing:border-box;padding:28px 36px;background:var(--material-background,#fff);color:var(--fill-primary,#252a34);font:14px system-ui,sans-serif;overflow:hidden}
    .cr-reading-list *{box-sizing:border-box}.cr-reading-list h1{font-size:25px;margin:0 0 6px;letter-spacing:.02em}.cr-reading-list .intro{margin:0;color:var(--fill-secondary,#647084)}
    .cr-reading-list .heading{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:22px}.cr-reading-list .summary{font-variant-numeric:tabular-nums;color:var(--fill-secondary,#647084);white-space:nowrap}
    .cr-reading-list .controls{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px}.cr-reading-list input[type=search]{flex:1;min-width:200px}
    .cr-reading-list input[type=search],.cr-reading-list select,.cr-reading-list button{font:inherit;color:inherit;background:var(--material-background,#fff);border:1px solid var(--material-border,#d9dfe7);border-radius:6px;padding:8px 11px}
    .cr-reading-list button{cursor:pointer}.cr-reading-list button:hover{background:var(--material-button-hover,#f0f4f8)}.cr-reading-list button:disabled{opacity:.5;cursor:default}
    .cr-reading-list :focus-visible{outline:2px solid #3478f6;outline-offset:2px}.cr-reading-list .scroll{overflow:auto;min-height:0;flex:1;border:1px solid var(--material-border,#dfe4ec);border-radius:8px}
    .cr-reading-list table{width:100%;border-collapse:collapse;table-layout:fixed}.cr-reading-list th{position:sticky;top:0;text-align:left;background:var(--material-background,#f8fafc);font-size:12px;color:var(--fill-secondary,#647084);z-index:1}
    .cr-reading-list th,.cr-reading-list td{padding:13px 18px;border-bottom:1px solid var(--material-border,#e7ebf0)}.cr-reading-list th:last-child,.cr-reading-list td:last-child{width:96px;text-align:center}
    .cr-reading-list .paper-title{display:block;width:100%;text-align:left;border:0;padding:0;background:transparent;border-radius:2px;line-height:1.55;overflow-wrap:anywhere}.cr-reading-list .paper-title:hover{background:transparent;color:#3478f6;text-decoration:underline}
    .cr-reading-list .library-name{margin-top:4px;font-size:12px;color:var(--fill-secondary,#758195)}.cr-reading-list input[type=checkbox]{width:19px;height:19px;accent-color:#3478f6;cursor:pointer;margin:0}
    .cr-reading-list .empty{text-align:center;padding:56px 18px;color:var(--fill-secondary,#758195)}.cr-reading-list .footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:14px}.cr-reading-list .pages{display:flex;gap:8px}.cr-reading-list .message{margin:0 0 10px;color:#b44832}.cr-reading-list [hidden]{display:none!important}
    @media(max-width:780px){.cr-reading-list{padding:20px}.cr-reading-list .heading{align-items:flex-start;flex-direction:column;gap:10px}.cr-reading-list th,.cr-reading-list td{padding:12px}}
    @media(prefers-color-scheme:dark){.cr-reading-list{background:var(--material-background,#252525);color:var(--fill-primary,#eee)}.cr-reading-list input[type=search],.cr-reading-list select,.cr-reading-list button,.cr-reading-list th{background:var(--material-background,#292929);color:inherit}.cr-reading-list .intro,.cr-reading-list .summary,.cr-reading-list .library-name,.cr-reading-list .empty{color:var(--fill-secondary,#aaa)}}`;
  const heading=html('div');heading.className='heading';const title=html('div'),h1=html('h1','阅读清单'),intro=html('p','读完一篇，勾选一篇。阅读进度由你决定。');intro.className='intro';title.append(h1,intro);
  const summary=html('div');summary.className='summary';summary.id=PREFIX+'reading-summary';heading.append(title,summary);
  const controls=html('div');controls.className='controls';const search=html('input');search.type='search';search.placeholder='搜索论文名';search.setAttribute('aria-label','搜索论文名');search.id=PREFIX+'reading-search';
  const libraries=html('select');libraries.setAttribute('aria-label','筛选文库');libraries.id=PREFIX+'reading-library';
  const option=(value,label)=>{const o=html('option',label);o.value=value;return o;};libraries.append(option('','全部文库'));
  const status=html('select');status.setAttribute('aria-label','筛选阅读状态');status.id=PREFIX+'reading-filter';status.append(option('all','全部状态'),option('unread','未读'),option('read','已读'));
  const refresh=html('button','刷新');refresh.type='button';controls.append(search,libraries,status,refresh);
  const message=html('p');message.className='message';message.setAttribute('role','alert');message.hidden=true;
  const scroll=html('div');scroll.className='scroll';const table=html('table'),thead=html('thead'),headRow=html('tr');headRow.append(html('th','论文'),html('th','已读'));thead.append(headRow);const body=html('tbody');body.id=PREFIX+'reading-rows';table.append(thead,body);scroll.append(table);
  const footer=html('div');footer.className='footer';const count=html('span');count.setAttribute('aria-live','polite');const pages=html('div');pages.className='pages';const prev=html('button','上一页'),next=html('button','下一页');prev.type=next.type='button';pages.append(prev,next);footer.append(count,pages);
  root.append(style,heading,controls,message,scroll,footer);tab.container.append(root);
  state={win,id:tab.id,root,rows:[],page:0,disposed:false,request:0,observer:null,timer:null};readingLists.set(win,state);
  const showError=error=>{report(error);message.textContent='操作失败：'+error.message+'，请重试。';message.hidden=false;};
  state.render=()=>{
    if(state.disposed)return;
    const scope=state.rows.filter(row=>!libraries.value||row.item.libraryID===Number(libraries.value)),read=scope.filter(row=>isPaperRead(row.item)).length;
    summary.textContent=`共 ${scope.length} 篇 · 已读 ${read} 篇 · 未读 ${scope.length-read} 篇`;
    const rows=readingListFilter(state.rows,libraries.value,search.value,status.value),size=100;
    state.page=Math.max(0,Math.min(state.page,Math.ceil(rows.length/size)-1));const start=state.page*size;
    const fragment=doc.createDocumentFragment();
    for(const row of rows.slice(start,start+size)){
      const tr=html('tr');tr.setAttribute('data-paper-key',readingStatusKey(row.item));const paper=html('td'),link=html('button',row.title);link.className='paper-title';link.type='button';link.title='在 Zotero 文库中定位这篇论文';
      link.addEventListener('click',()=>run(async()=>{win.Zotero_Tabs.select('zotero-pane');await win.ZoteroPane.selectItem(row.item.id);}));
      const library=html('div',row.library);library.className='library-name';paper.append(link,library);
      const done=html('td'),checkbox=html('input');checkbox.type='checkbox';checkbox.checked=isPaperRead(row.item);checkbox.setAttribute('aria-label','已读：'+row.title);
      checkbox.addEventListener('change',()=>{
        try{setPaperRead(row.item,checkbox.checked);message.hidden=true;}
        catch(error){checkbox.checked=isPaperRead(row.item);showError(error);}
      });done.append(checkbox);tr.append(paper,done);fragment.append(tr);
    }
    if(!rows.length){const tr=html('tr'),td=html('td',state.rows.length?'没有找到符合条件的论文。':'文库中还没有论文。');td.colSpan=2;td.className='empty';tr.append(td);fragment.append(tr);}
    const top=scroll.scrollTop;body.replaceChildren(fragment);scroll.scrollTop=top;
    count.textContent=rows.length?`显示 ${start+1}–${Math.min(start+size,rows.length)}，共 ${rows.length} 篇`:'共 0 篇';prev.disabled=state.page===0;next.disabled=start+size>=rows.length;
  };
  state.refresh=async()=>{
    const request=++state.request;refresh.disabled=true;root.setAttribute('aria-busy','true');
    try{
      const all=Zotero.Libraries.getAll().filter(library=>library.libraryType!=='feed'),names=new Map(all.map(library=>[library.libraryID,library.name]));
      const items=(await Promise.all(all.map(library=>Zotero.Items.getAll(library.libraryID,true,false)))).flat();
      await Zotero.Items.loadDataTypes(items,['itemData']);
      if(state.disposed||request!==state.request)return;
      const selected=libraries.value;libraries.replaceChildren(option('','全部文库'),...all.map(library=>option(String(library.libraryID),library.name)));libraries.value=all.some(l=>String(l.libraryID)===selected)?selected:'';
      state.rows=readingListRows(items,names);message.hidden=true;state.render();
    }catch(error){if(!state.disposed&&request===state.request)showError(error);}
    finally{if(!state.disposed&&request===state.request){refresh.disabled=false;root.removeAttribute('aria-busy');}}
  };
  state.dispose=()=>{
    if(state.disposed)return;state.disposed=true;state.request++;if(readingLists.get(win)===state)readingLists.delete(win);
    for(const action of [()=>win.clearTimeout(state.timer),()=>{if(state.observer!==null)Zotero.Notifier.unregisterObserver(state.observer);},()=>root.remove()]){try{action();}catch(error){report(error);}}
  };
  for(const element of [search,libraries,status])element.addEventListener(element===search?'input':'change',()=>{state.page=0;scroll.scrollTop=0;state.render();});
  prev.addEventListener('click',()=>{state.page--;scroll.scrollTop=0;state.render();});next.addEventListener('click',()=>{state.page++;scroll.scrollTop=0;state.render();});refresh.addEventListener('click',()=>state.refresh());
  state.observer=Zotero.Notifier.registerObserver({notify(){if(state.disposed)return;win.clearTimeout(state.timer);state.timer=win.setTimeout(()=>state.refresh(),150);}},['item'],'chatgpt-reading-list');
  state.render();state.ready=state.refresh();win.Zotero_Tabs.select(tab.id);return state;
}
function stopReadingListWindow(win) {
  const state=readingLists.get(win),hooks=readingTabHooks.get(win);readingTabHooks.delete(win);
  const actions=[];
  if(state)actions.push(()=>state.dispose(),()=>win.Zotero_Tabs.close(state.id));
  if(hooks)actions.push(()=>{
    const tabs=win.Zotero_Tabs;if(tabs.getState===hooks.getState)tabs.getState=hooks.original;
    if(tabs.tabHooks.undoClose.chatgptReadingList===hooks.undoClose){if(hooks.undo===undefined)delete tabs.tabHooks.undoClose.chatgptReadingList;else tabs.tabHooks.undoClose.chatgptReadingList=hooks.undo;}
    tabs._history=tabs._history.map(entry=>entry.filter(tab=>tab.type!=='chatgptReadingList')).filter(entry=>entry.length);
    win.removeEventListener('unload',hooks.cleanup);
  });
  for(const action of actions){try{action();}catch(error){report(error);}}
}
function stopReadingLists(){for(const win of new Set([...readingLists.keys(),...readingTabHooks.keys()]))stopReadingListWindow(win);}
