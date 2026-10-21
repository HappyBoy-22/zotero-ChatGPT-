/* Local picture layers. Originals stay untouched; export embeds pictures in a PDF copy. */
var imageReaders = new Map(), imageDocuments = new Map();
function validPicture(p) {
  return p && typeof p.id==='string' && /^[a-zA-Z0-9-]{1,80}$/.test(p.id)
    && Number.isInteger(p.pageIndex) && p.pageIndex>=0
    && Array.isArray(p.rect) && p.rect.length===4 && p.rect.every(Number.isFinite)
    && p.rect[2]>p.rect[0] && p.rect[3]>p.rect[1]
    && [0,90,180,270].includes(p.rotation) && Number.isFinite(p.ratio) && p.ratio>0
    && typeof p.src==='string' && /^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(p.src);
}
function pictureBox(box,handle,dx,dy,bounds) {
  const b=box.slice(),clamp=(v,a,z)=>Math.max(a,Math.min(z,v));
  if(handle==='move') {
    dx=clamp(dx,bounds[0]-b[0],bounds[2]-b[2]);dy=clamp(dy,bounds[1]-b[1],bounds[3]-b[3]);
    return [b[0]+dx,b[1]+dy,b[2]+dx,b[3]+dy];
  }
  if(!['n','s','e','w','ne','nw','se','sw'].includes(handle))return b;
  const min=Math.min(8,bounds[2]-bounds[0],bounds[3]-bounds[1]);
  if(handle.includes('w'))b[0]=clamp(b[0]+dx,bounds[0],b[2]-min);
  if(handle.includes('e'))b[2]=clamp(b[2]+dx,b[0]+min,bounds[2]);
  if(handle.includes('n'))b[1]=clamp(b[1]+dy,bounds[1],b[3]-min);
  if(handle.includes('s'))b[3]=clamp(b[3]+dy,b[1]+min,bounds[3]);
  return b;
}
function pictureViewportRect(p,page) {
  const a=page.viewport.convertToViewportPoint(p.rect[0],p.rect[1]),b=page.viewport.convertToViewportPoint(p.rect[2],p.rect[3]);
  return [Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])];
}
function picturePDFRect(box,page) {
  const a=page.viewport.convertToPdfPoint(box[0],box[1]),b=page.viewport.convertToPdfPoint(box[2],box[3]);
  return [Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])];
}
function picturePath(item) {
  if(!Number.isInteger(item?.libraryID)||!/^[A-Z0-9]{8}$/.test(item?.key||''))throw Error('无法识别当前 PDF。');
  return PathUtils.join(Zotero.DataDirectory.dir,'chatgpt-reader','images',item.libraryID+'-'+item.key+'.json');
}
async function pictureDocument(item) {
  const path=picturePath(item);
  if(!imageDocuments.has(path)) {
    const promise=(async()=>{
      let images=[];
      if(await IOUtils.exists(path)) {
        const data=await IOUtils.readJSON(path);
        if(data.version!==1||!Array.isArray(data.images)||!data.images.every(validPicture))throw Error('图片记录损坏，已停止加载以保护原记录。');
        images=data.images;
      }
      return {path,images,listeners:new Set(),write:Promise.resolve()};
    })();
    imageDocuments.set(path,promise);
    promise.catch(()=>{if(imageDocuments.get(path)===promise)imageDocuments.delete(path);});
  }
  return imageDocuments.get(path);
}
function savePictures(model) {
  const data=JSON.parse(JSON.stringify({version:1,images:model.images}));
  // Serialize snapshots. Failed writes are reported but cannot block a later save.
  model.write=model.write.catch(()=>{}).then(async()=>{
    await IOUtils.makeDirectory(PathUtils.parent(model.path),{createAncestors:true});
    await IOUtils.writeJSON(model.path,data,{tmpPath:model.path+'.tmp'});
  });
  model.write.catch(error=>{report(error);Zotero.getMainWindow()?.alert('图片保存失败：'+error.message);});
  for(const listener of model.listeners){try{listener();}catch(error){report(error);}}
  return model.write;
}
async function readPicture(path,win=Zotero.getMainWindow()) {
  const stat=await IOUtils.stat(path);
  if(stat.size>20*1024*1024)throw Error('请选择不超过 20 MB 的图片。');
  const bytes=await IOUtils.read(path);
  let mime;
  if(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71)mime='image/png';
  else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)mime='image/jpeg';
  else if(String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')mime='image/webp';
  else throw Error('支持 PNG、JPG 和 WebP 图片。');
  let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.slice(i,i+32768));
  const img=new win.Image();
  await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('无法读取这张图片。'));img.src='data:'+mime+';base64,'+win.btoa(binary);});
  if(!img.naturalWidth||!img.naturalHeight||img.naturalWidth*img.naturalHeight>100000000)throw Error('图片尺寸过大或无效。');
  const scale=Math.min(1,4096/Math.max(img.naturalWidth,img.naturalHeight));
  const canvas=win.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');
  canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
  canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
  return {src:canvas.toDataURL('image/png'),ratio:canvas.width/canvas.height};
}
async function choosePicture(owner) {
  if(owner.busy||owner.internal._state.readOnly)return;
  owner.busy=true;
  try {
    const {FilePicker}=ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs'),fp=new FilePicker();
    fp.init(Zotero.getMainWindow(),'插入图片',fp.modeOpen);fp.appendFilter('图片（PNG、JPG、WebP）','*.png; *.jpg; *.jpeg; *.webp');
    if(await fp.show()===fp.returnCancel)return;
    await owner.import(fp.file);
  }catch(error){report(error);Zotero.getMainWindow()?.alert('插入图片失败：'+error.message);}
  finally{owner.busy=false;}
}
function attachPictureView(win,view,owner) {
  const doc=win.document,app=win.PDFViewerApplication,viewport=doc.getElementById('viewerContainer');
  const nodes=new Map(),clone=v=>Components.utils.cloneInto(v,owner.reader._iframeWindow);
  const consume=e=>{e.preventDefault();e.stopImmediatePropagation();};
  const editable=t=>t?.closest?.('input,textarea,button,select,a,[contenteditable="true"],.popup');
  const reserved=e=>e.ctrlKey||e.altKey||e.metaKey||pdfGestureBindings.get(win)?.shortcutState().space;
  let selected=null,drag=null,disposed=false;
  const hint=doc.createElement('div');hint.textContent='点击页面放置图片 · Esc 取消';
  hint.style.cssText='display:none;position:fixed;bottom:18px;left:50%;transform:translateX(-50%);padding:8px 14px;background:#20252b;color:white;border-radius:6px;z-index:9999;pointer-events:none;font:13px sans-serif;';doc.body.append(hint);
  const clearNative=()=>view._clearPointerAction?.();
  const render=()=>{
    if(disposed)return;
    const pictures=owner.model?.images||[],live=new Set(),tool=owner.internal._state.tool.type;
    hint.style.display=owner.pending?'block':'none';
    for(const p of pictures){
      const page=app.pdfViewer._pages[p.pageIndex];if(!page?.div?.isConnected)continue;
      live.add(p.id);let node=nodes.get(p.id);
      if(node&&node.parentElement!==page.div){node.remove();nodes.delete(p.id);node=null;}
      if(!node){
        node=doc.createElement('div');node.setAttribute('data-cr-picture',p.id);node.tabIndex=0;node.setAttribute('role','img');node.setAttribute('aria-label','图片：拖动移动，拖动控制点缩放，Delete 删除');
        node.style.cssText='position:absolute;z-index:6;box-sizing:border-box;outline:none;touch-action:none;user-select:none;';
        const img=doc.createElement('img');img.src=p.src;img.draggable=false;img.style.cssText='position:absolute;left:50%;top:50%;pointer-events:none;max-width:none;max-height:none;';node.append(img);
        for(const h of ['nw','n','ne','e','se','s','sw','w']){
          const dot=doc.createElement('span');dot.setAttribute('data-cr-handle',h);
          const x=h.includes('w')?0:h.includes('e')?100:50,y=h.includes('n')?0:h.includes('s')?100:50;
          dot.style.cssText=`position:absolute;left:${x}%;top:${y}%;width:9px;height:9px;box-sizing:border-box;background:white;border:1.5px solid #388aff;transform:translate(-50%,-50%);z-index:2;cursor:${h}-resize;`;node.append(dot);
        }
        const remove=doc.createElement('button');remove.type='button';remove.textContent='删除图片';remove.setAttribute('data-cr-delete',p.id);
        remove.style.cssText='position:absolute;right:0;bottom:calc(100% + 9px);font:12px sans-serif;padding:3px 7px;border:1px solid #bbb;border-radius:4px;background:white;color:#333;cursor:pointer;';node.append(remove);
        page.div.append(node);nodes.set(p.id,node);
      }
      const box=pictureViewportRect(p,page),w=box[2]-box[0],h=box[3]-box[1];
      Object.assign(node.style,{left:box[0]+'px',top:box[1]+'px',width:w+'px',height:h+'px',pointerEvents:tool==='pointer'&&!owner.pending?'auto':'none',cursor:'move',outline:selected===p.id?'1px dashed #388aff':'none'});
      const rotation=((page.viewport.rotation-p.rotation)%360+360)%360,sideways=rotation%180!==0;
      Object.assign(node.firstChild.style,{width:(sideways?h:w)+'px',height:(sideways?w:h)+'px',transform:`translate(-50%,-50%) rotate(${rotation}deg)`});
      for(const child of [...node.children].slice(1))child.style.display=selected===p.id&&!owner.internal._state.readOnly&&tool==='pointer'?'block':'none';
    }
    for(const[id,node]of nodes)if(!live.has(id)){node.remove();nodes.delete(id);}
  };
  const cancel=()=>{if(drag){const p=owner.model.images.find(p=>p.id===drag.id);if(p)p.rect=drag.original;drag=null;clearNative();render();}};
  const down=e=>{
    if(e.button!==0)return;
    const element=e.target.closest?.('[data-cr-picture]');
    if(!owner.model||owner.internal._state.readOnly||reserved(e)){if(selected){selected=null;render();}return;}
    if(owner.pending&&!editable(e.target)){
      const pageIndex=app.pdfViewer._pages.findIndex(p=>p.div===e.target.closest?.('.page'));if(pageIndex<0)return;
      consume(e);clearNative();const page=app.pdfViewer._pages[pageIndex],r=page.div.getBoundingClientRect(),bounds=[0,0,page.viewport.width,page.viewport.height];
      const width=Math.min(240*page.viewport.scale,bounds[2]*0.5,bounds[3]*0.5*owner.pending.ratio),height=width/owner.pending.ratio;
      const x=Math.max(0,Math.min(bounds[2]-width,e.clientX-r.left)),y=Math.max(0,Math.min(bounds[3]-height,e.clientY-r.top));
      const p={...owner.pending,id:Services.uuid.generateUUID().toString().replace(/[{}]/g,''),pageIndex,rect:picturePDFRect([x,y,x+width,y+height],page),rotation:((page.viewport.rotation%360)+360)%360};
      owner.pending=null;owner.model.images.push(p);selected=p.id;owner.internal.setSelectedAnnotations(clone([]));savePictures(owner.model);render();nodes.get(p.id)?.focus();return;
    }
    if(!element||owner.internal._state.tool.type!=='pointer'){if(selected){selected=null;render();}return;}
    const id=element.getAttribute('data-cr-picture'),p=owner.model.images.find(p=>p.id===id);if(!p)return;
    consume(e);clearNative();owner.internal.setSelectedAnnotations(clone([]));
    if(e.target.closest?.('[data-cr-delete]')){owner.model.images=owner.model.images.filter(p=>p.id!==id);selected=null;savePictures(owner.model);render();return;}
    selected=id;const page=app.pdfViewer._pages[p.pageIndex];
    drag={id,page,original:p.rect.slice(),box:pictureViewportRect(p,page),x:e.clientX,y:e.clientY,handle:e.target.getAttribute('data-cr-handle')||'move',pointerID:e.pointerId};render();element.focus();
  };
  const move=e=>{
    if(!drag||e.pointerId!==drag.pointerID)return;
    consume(e);clearNative();const p=owner.model.images.find(p=>p.id===drag.id);if(!p)return;
    const box=pictureBox(drag.box,drag.handle,e.clientX-drag.x,e.clientY-drag.y,[0,0,drag.page.viewport.width,drag.page.viewport.height]);
    p.rect=picturePDFRect(box,drag.page);render();
  };
  const up=e=>{if(!drag||e.pointerId!==drag.pointerID)return;move(e);consume(e);clearNative();drag=null;savePictures(owner.model);};
  const mouse=e=>{if(drag||e.target.closest?.('[data-cr-picture]')&&!reserved(e)&&owner.internal._state.tool.type==='pointer'){consume(e);clearNative();}};
  const key=e=>{
    if(editable(e.target))return;
    if(e.key==='Escape'){cancel();selected=null;owner.pending=null;render();}
    if(selected&&['Delete','Backspace'].includes(e.key)&&!owner.internal._state.readOnly&&!reserved(e)){
      consume(e);cancel();owner.model.images=owner.model.images.filter(p=>p.id!==selected);selected=null;savePictures(owner.model);render();
    }
  };
  const blur=e=>{if(e.type==='pointercancel'||e.target===win||e.target===doc)cancel();};
  const events=[['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',blur],['mousedown',mouse],['keydown',key],['blur',blur]];
  const options=Components.utils.cloneInto({capture:true,passive:false},win);
  for(const[type,fn]of events)win.addEventListener(type,fn,options,true);
  const bus=app.eventBus;for(const event of ['pagerendered','scalechanging','rotationchanging'])bus.on(event,render);
  owner.model?.listeners.add(render);render();
  const cleanup=()=>{disposed=true;cancel();owner.model?.listeners.delete(render);for(const[type,fn]of events)win.removeEventListener(type,fn,true);for(const event of ['pagerendered','scalechanging','rotationchanging'])bus.off(event,render);for(const node of nodes.values())node.remove();hint.remove();};
  cleanup.render=render;cleanup.document=doc;return cleanup;
}
function refreshPictureTools() {
  const live=new Set();
  for(const reader of Zotero.Reader._readers||[]){try{
    const internal=reader._internalReader,doc=reader._iframeWindow?.document;
    const anchor=doc?.querySelector('.chatgpt-reader-arrow');if(!internal?._primaryView||!anchor)continue;
    live.add(reader);let owner=imageReaders.get(reader);
    if(owner&&owner.document!==doc){owner.cleanup();imageReaders.delete(reader);owner=null;}
    if(!owner){
      owner={reader,internal,document:doc,views:new Map(),model:null,pending:null,disposed:false};imageReaders.set(reader,owner);
      const b=doc.createElement('button');b.type='button';b.className='toolbar-button chatgpt-reader-image';b.title='插入图片：选择文件后点击页面放置；拖动控制点缩放';b.setAttribute('aria-label','插入图片');
      const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 20 20');svg.setAttribute('width','20');svg.setAttribute('height','20');
      const path=doc.createElementNS('http://www.w3.org/2000/svg','path');for(const[k,v]of Object.entries({d:'M 3 3 H 17 V 17 H 3 Z M 3 14 L 8 9 L 12 13 L 14 11 L 17 14 M 13 6 H 14',fill:'none',stroke:'currentColor','stroke-width':'1.5'}))path.setAttribute(k,v);svg.append(path);b.append(svg);anchor.after(b);owner.button=b;
      owner.import=async path=>{
        const data=await readPicture(path);await owner.ready;if(owner.disposed||internal._state.readOnly)return;
        rectangleReaders.get(reader)?.deactivate();internal.setTool(Components.utils.cloneInto({type:'pointer'},reader._iframeWindow));owner.pending=data;for(const c of owner.views.values())c.render();internal._primaryView._iframeWindow.focus();
      };
      b.addEventListener('click',()=>choosePicture(owner));
      owner.cleanup=()=>{owner.disposed=true;owner.pending=null;const actions=[()=>b.remove(),...owner.views.values()];owner.views.clear();for(const action of actions){try{action();}catch(_){}}};
      owner.ready=pictureDocument(Zotero.Items.get(reader.itemID)).then(model=>{if(!owner.disposed){owner.model=model;refreshPictureTools();}return model;}).catch(error=>{report(error);b.disabled=true;b.title='图片记录加载失败：'+error.message;throw error;});owner.ready.catch(()=>{});
    }
    owner.button.disabled=!owner.model||!!internal._state.readOnly;
    if(!owner.model)continue;
    if(internal._state.tool.type!=='pointer')owner.pending=null;
    const views=new Set();
    for(const view of [internal._primaryView,internal._secondaryView]){
      const win=view?._iframeWindow;if(!win?.document.getElementById('viewerContainer')||!win.PDFViewerApplication?.pdfViewer?._pages||!win.PDFViewerApplication?.eventBus)continue;views.add(win);
      const old=owner.views.get(win);if(old&&old.document!==win.document){old();owner.views.delete(win);}
      if(!owner.views.has(win))owner.views.set(win,attachPictureView(win,view,owner));
      owner.views.get(win).render();
    }
    for(const[win,c]of owner.views)if(!views.has(win)){c();owner.views.delete(win);}
  }catch(error){const owner=imageReaders.get(reader);imageReaders.delete(reader);try{owner?.cleanup();}catch(_){}if(!String(error).includes('dead object'))report(error);}}
  for(const[reader,owner]of imageReaders)if(!live.has(reader)){imageReaders.delete(reader);try{owner.cleanup();}catch(_){}}
}
function stopPictureTools(){const owners=[...imageReaders.values()];imageReaders.clear();for(const owner of owners){try{owner.cleanup();}catch(_){}}imageDocuments.clear();}
async function embedPictures(bytes,pictures,lib) {
  const pdf=await lib.PDFDocument.load(bytes,{updateMetadata:false});
  for(const p of pictures){
    if(!validPicture(p)||p.pageIndex>=pdf.getPageCount())throw Error('图片位置记录无效，无法导出。');
    const image=await pdf.embedPng(p.src),[left,bottom,right,top]=p.rect,w=right-left,h=top-bottom,angle=p.rotation;
    pdf.getPage(p.pageIndex).drawImage(image,{x:angle===90||angle===180?right:left,y:angle===180||angle===270?top:bottom,width:angle%180?h:w,height:angle%180?w:h,rotate:lib.degrees(angle)});
  }
  return pdf.save();
}
async function exportPicturePDF(item,path) {
  const model=await pictureDocument(item);await model.write;
  const pictures=JSON.parse(JSON.stringify(model.images));if(!pictures.length)throw Error('这份 PDF 还没有插入图片。');
  const temp=Zotero.getTempDirectory();temp.append('chatgpt-reader-picture-export');temp.createUnique(Components.interfaces.nsIFile.DIRECTORY_TYPE,0o700);
  const input=temp.clone();input.append('annotated.pdf');
  try{
    await Zotero.PDFWorker.export(item.id,input.path,true,undefined,false);
    const sandbox=marginPDFLibrary(),bytes=Components.utils.cloneInto(await IOUtils.read(input.path),sandbox);
    const output=await embedPictures(bytes,pictures,sandbox.PDFLib);await IOUtils.write(path,new Uint8Array(output),{tmpPath:path+'.tmp'});
  }finally{await IOUtils.remove(temp.path,{recursive:true});}
}
async function openPictureExport(win=Zotero.getMainWindow()) {
  try{
    const item=currentItem(win);if(!item?.isPDFAttachment())throw Error('请先打开插入过图片的 PDF。');
    const model=await pictureDocument(item);if(!model.images.length)throw Error('这份 PDF 还没有插入图片。');
    const source=await item.getFilePathAsync(),{FilePicker}=ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs'),fp=new FilePicker();
    fp.init(win,'导出含图片的 PDF',fp.modeSave);fp.defaultString='含图片笔记.pdf';fp.defaultExtension='pdf';fp.appendFilter('PDF','*.pdf');
    if(await fp.show()===fp.returnCancel)return;
    if(PathUtils.normalize(fp.file).toLowerCase()===PathUtils.normalize(source).toLowerCase())throw Error('请选择另一个文件名，保留原 PDF。');
    await exportPicturePDF(item,fp.file);win.alert('已导出含图片和原生批注的 PDF。');
  }catch(error){report(error);win.alert('导出失败：'+error.message);}
}
