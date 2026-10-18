/* Rectangle outlines stored as native ink: compatible with undo and PDF export. */
var rectangleReaders = new Map();
function arrowAnnotation(start,end,bounds,pageIndex,color,width) {
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  const sx=clamp(start[0],bounds[0],bounds[2]),sy=clamp(start[1],bounds[1],bounds[3]);
  const ex=clamp(end[0],bounds[0],bounds[2]),ey=clamp(end[1],bounds[1],bounds[3]);
  const length=Math.hypot(ex-sx,ey-sy);
  if(length<3)return null;
  const ux=(ex-sx)/length,uy=(ey-sy)/length;
  const head=Math.min(length*0.35,Math.max(10,width*4));
  const wing=sign=>[clamp(ex-head*ux+sign*head*0.5*uy,bounds[0],bounds[2]),clamp(ey-head*uy-sign*head*0.5*ux,bounds[1],bounds[3])];
  const left=wing(1),right=wing(-1);
  return {type:'ink',color,position:{pageIndex,width,paths:[[sx,sy,ex,ey],[...left,ex,ey,...right]]},
    sortIndex:String(pageIndex).padStart(5,'0')+'|000000|'+String(Math.max(0,Math.floor(bounds[3]-Math.max(sy,ey,left[1],right[1])))).padStart(5,'0')};
}
function rectangleAnnotation(start,end,bounds,pageIndex,color,width) {
  const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));
  const x1=clamp(Math.min(start[0],end[0]),bounds[0],bounds[2]);
  const y1=clamp(Math.min(start[1],end[1]),bounds[1],bounds[3]);
  const x2=clamp(Math.max(start[0],end[0]),bounds[0],bounds[2]);
  const y2=clamp(Math.max(start[1],end[1]),bounds[1],bounds[3]);
  if (x2-x1<2 || y2-y1<2) return null;
  return {type:'ink',color,position:{pageIndex,width,paths:[[x1,y1,x2,y1,x2,y2,x1,y2,x1,y1]]},
    sortIndex:String(pageIndex).padStart(5,'0')+'|000000|'+String(Math.max(0,Math.floor(bounds[3]-y2))).padStart(5,'0')};
}
// Recognize earlier versions' outlines too, without changing arbitrary ink.
function rectangleBounds(annotation) {
  const paths=annotation?.position?.paths;
  if(annotation?.type!=='ink'||paths?.length!==1||paths[0].length!==10)return null;
  const p=paths[0];
  if(!p.every(Number.isFinite))return null;
  const near=(a,b)=>Math.abs(a-b)<0.02;
  if(!near(p[0],p[8])||!near(p[1],p[9]))return null;
  const xs=[p[0],p[2],p[4],p[6]],ys=[p[1],p[3],p[5],p[7]];
  const b=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
  if(b[2]-b[0]<1||b[3]-b[1]<1)return null;
  const corners=new Set();
  for(let i=0;i<8;i+=2){
    const x=near(p[i],b[0])?0:near(p[i],b[2])?1:-1;
    const y=near(p[i+1],b[1])?0:near(p[i+1],b[3])?1:-1;
    if(x<0||y<0||(!near(p[i],p[i+2])&&!near(p[i+1],p[i+3])))return null;
    corners.add(x+','+y);
  }
  return corners.size===4?b:null;
}
function resizeRectanglePosition(annotation,dir,dx,dy) {
  const b=rectangleBounds(annotation);
  if(!b||!['tl','tr','bl','br','l','r','t','b'].includes(dir)||!Number.isFinite(dx)||!Number.isFinite(dy))return null;
  const r=b.slice();
  if(dir.includes('l'))r[0]=Math.min(b[2]-1,b[0]+dx);
  if(dir.includes('r'))r[2]=Math.max(b[0]+1,b[2]+dx);
  if(dir.includes('b'))r[1]=Math.min(b[3]-1,b[1]+dy);
  if(dir.includes('t'))r[3]=Math.max(b[1]+1,b[3]+dy);
  const sx=(r[2]-r[0])/(b[2]-b[0]),sy=(r[3]-r[1])/(b[3]-b[1]);
  return {...annotation.position,paths:[annotation.position.paths[0].map((v,i)=>i%2?r[1]+(v-b[1])*sy:r[0]+(v-b[0])*sx)]};
}
function attachRectangleView(win,view,internal,owner) {
  const doc=win.document, viewport=doc.getElementById('viewerContainer');
  const clone=value=>Components.utils.cloneInto(value,owner.reader._iframeWindow);
  const consume=e=>{e.preventDefault();e.stopImmediatePropagation();};
  const editable=t=>t?.closest?.('input,textarea,button,select,a,[contenteditable="true"],.popup');
  const reserved=e=>e.ctrlKey||e.altKey||e.metaKey||pdfGestureBindings.get(win)?.shortcutState().space;
  let drag=null;
  const resize=e=>{
    const action=view.action,start=view.pointerDownPosition;
    if(drag||owner.active||internal._state.readOnly||action?.annotation?.readOnly||action?.type!=='resize'||!start||!rectangleBounds(action.annotation))return false;
    const point=view.pointerEventToAltPosition(e,start.pageIndex)?.rects?.[0],origin=start.rects[0];
    if(!point)return false;
    const position=resizeRectanglePosition(action.annotation,action.dir,point[0]-origin[0],point[1]-origin[1]);
    if(!position)return false;
    action.position=clone(position);action.triggered=true;
    view._onSetAnnotationPopup?.();view._onSetSelectionPopup?.();view._render?.();
    return true;
  };
  const cancel=()=>{if(drag){drag.preview.remove();drag=null;view._clearPointerAction?.();}};
  const down=e=>{
    if (!owner.active || internal._state.readOnly || e.button!==0 || reserved(e) || editable(e.target)) return;
    const pageDiv=e.target.closest?.('.page');
    const pages=win.PDFViewerApplication?.pdfViewer?._pages || [];
    const pageIndex=pages.findIndex(p=>p.div===pageDiv);
    if(pageIndex<0)return;
    // Zotero's capture listener ran before ours and may already have started
    // a native ink action. Consuming pointerup alone leaves that action alive.
    consume(e);cancel();view._clearPointerAction?.();win.focus();
    const page=pages[pageIndex], rect=pageDiv.getBoundingClientRect();
    const preview=owner.shape==='arrow'?doc.createElementNS('http://www.w3.org/2000/svg','svg'):doc.createElement('div');
    preview.style.cssText='position:absolute;pointer-events:none;z-index:1000;box-sizing:border-box;';
    const color=internal._state.tool.color||getAnnotationSettings().inkColor;
    if(owner.shape==='arrow') {
      preview.setAttribute('width',String(rect.width));preview.setAttribute('height',String(rect.height));preview.style.left='0';preview.style.top='0';
      const path=doc.createElementNS('http://www.w3.org/2000/svg','path');
      path.setAttribute('stroke',color);path.setAttribute('stroke-width','2');path.setAttribute('fill','none');preview.append(path);
    } else preview.style.border='2px solid '+color;
    pageDiv.append(preview);
    drag={page,pageIndex,preview,shape:owner.shape,start:page.viewport.convertToPdfPoint(e.clientX-rect.left,e.clientY-rect.top),x:e.clientX-rect.left,y:e.clientY-rect.top,pointerID:e.pointerId};
    move(e);
  };
  const move=e=>{
    // Capture before native ink's proportional resize. Keep the native action
    // so pointerup still commits through Zotero's normal undo/save machinery.
    if(resize(e)){consume(e);return;}
    if(!drag || (e.pointerId!==undefined&&e.pointerId!==drag.pointerID))return;
    consume(e);
    const rect=drag.page.div.getBoundingClientRect();
    const x=Math.max(0,Math.min(rect.width,e.clientX-rect.left)),y=Math.max(0,Math.min(rect.height,e.clientY-rect.top));
    if(drag.shape==='arrow') {
      const a=arrowAnnotation([drag.x,drag.y],[x,y],[0,0,rect.width,rect.height],0,'#000000',2);
      drag.preview.firstChild.setAttribute('d',a?a.position.paths.map(p=>'M '+p.reduce((s,v,i)=>s+(i&&i%2===0?' L ':' ')+v,'')).join(' '):'');
    } else Object.assign(drag.preview.style,{left:Math.min(drag.x,x)+'px',top:Math.min(drag.y,y)+'px',width:Math.abs(x-drag.x)+'px',height:Math.abs(y-drag.y)+'px'});
    drag.end=drag.page.viewport.convertToPdfPoint(x,y);
  };
  const up=e=>{
    if(!drag&&view.action?.type==='resize'&&view.action.triggered){resize(e);return;}
    if(!drag || e.button!==0 || (e.pointerId!==undefined&&e.pointerId!==drag.pointerID))return;
    move(e);
    const data=drag;
    const tool=internal._state.tool, defaults=getAnnotationSettings();
    const annotation=(data.shape==='arrow'?arrowAnnotation:rectangleAnnotation)(data.start,data.end,data.page.pdfPage.view,data.pageIndex,tool.color||defaults.inkColor,tool.size||defaults.inkSize);
    cancel();
    if(annotation && !internal._state.readOnly) {
      annotation.pageLabel=view._getPageLabel?.(data.pageIndex,true)||String(data.pageIndex+1);
      try {view._onAddAnnotation(clone(annotation));}catch(error){report(error);}
      // One shape per activation. Never leave the native ink tool armed.
      owner.deactivate();owner.sync?.();win.focus();
    }
  };
  const mouse=e=>{
    if(owner.active && !reserved(e) && e.button===0 && viewport.contains(e.target) && !editable(e.target)){
      consume(e);view._clearPointerAction?.();
    }
  };
  const key=e=>{if(e.key==='Escape'&&owner.active){consume(e);cancel();owner.deactivate();}};
  const blur=e=>{if(e.type==='pointercancel'||e.target===win||e.target===doc)cancel();};
  const events=[['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',blur],['blur',blur],['keydown',key],['mousedown',mouse],['click',mouse]];
  const options=Components.utils.cloneInto({capture:true,passive:false},win);
  for(const [type,fn]of events)win.addEventListener(type,fn,options,true);
  const cleanup=()=>{cancel();for(const [type,fn]of events)win.removeEventListener(type,fn,true);};
  cleanup.document=doc;
  cleanup.cancel=cancel;
  return cleanup;
}
function refreshRectangleTools() {
  const live=new Set();
  for(const reader of Zotero.Reader._readers||[]) {
    try {
    const internal=reader._internalReader, doc=reader._iframeWindow?.document;
    if(!internal?._state?.tool||!doc)continue;
    live.add(reader);
    let owner=rectangleReaders.get(reader);
    if(owner&&owner.document!==doc){owner.cleanup();rectangleReaders.delete(reader);owner=null;}
    const ink=doc.querySelector('.toolbar .tools .ink');
    if(!ink)continue;
    if(!owner) {
      owner={reader,document:doc,active:false,views:new Map()};
      owner.deactivate=()=>{owner.active=false;for(const cleanup of owner.views.values())cleanup.cancel();internal.setTool(Components.utils.cloneInto({type:'pointer'},reader._iframeWindow));};
      owner.toolbarClick=e=>{
        const b=e.target.closest?.('button');
        if(b&&b!==owner.button&&b!==owner.arrow&&!b.classList.contains('toolbar-dropdown-button')) {owner.active=false;for(const c of owner.views.values())c.cancel();}
      };
      ink.parentElement.addEventListener('click',owner.toolbarClick,true);
      owner.host=ink.parentElement;
      owner.cleanup=()=>{
        const actions=[()=>{if(owner.active)owner.deactivate();},()=>owner.button?.remove(),()=>owner.arrow?.remove(),()=>owner.host.removeEventListener('click',owner.toolbarClick,true),...owner.views.values()];
        owner.views.clear();for(const action of actions){try{action();}catch(_) {}}
      };
      rectangleReaders.set(reader,owner);
    }
    if(!owner.button?.isConnected) {
      const b=doc.createElement('button');b.type='button';b.className='toolbar-button chatgpt-reader-rectangle';
      b.title='方框：拖动绘制；Esc 退出';b.setAttribute('aria-label','绘制方框');b.setAttribute('aria-pressed','false');
      const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 20 20');svg.setAttribute('width','20');svg.setAttribute('height','20');svg.setAttribute('aria-hidden','true');
      const rect=doc.createElementNS('http://www.w3.org/2000/svg','rect');
      for(const[k,v]of Object.entries({x:3,y:4,width:14,height:12,rx:0.5,fill:'none',stroke:'currentColor','stroke-width':1.5}))rect.setAttribute(k,String(v));
      svg.append(rect);b.append(svg);
      b.addEventListener('click',e=>{e.preventDefault();if(internal._state.readOnly)return;for(const c of owner.views.values())c.cancel();if(owner.active&&owner.shape==='rectangle')owner.deactivate();else{internal.setTool(Components.utils.cloneInto(annotationToolDefaults('ink'),reader._iframeWindow));owner.shape='rectangle';owner.active=true;}sync();internal._primaryView?._iframeWindow?.focus();});
      ink.after(b);owner.button=b;
    }
    if(!owner.arrow?.isConnected) {
      const b=doc.createElement('button');b.type='button';b.className='toolbar-button chatgpt-reader-arrow';b.title='箭头：从起点拖向终点；Esc 退出';b.setAttribute('aria-label','绘制箭头');b.setAttribute('aria-pressed','false');
      const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 20 20');svg.setAttribute('width','20');svg.setAttribute('height','20');svg.setAttribute('aria-hidden','true');
      const path=doc.createElementNS('http://www.w3.org/2000/svg','path');for(const[k,v]of Object.entries({d:'M 3 16 L 16 3 M 7 3 L 16 3 L 16 12',fill:'none',stroke:'currentColor','stroke-width':'1.5'}))path.setAttribute(k,v);svg.append(path);b.append(svg);
      b.addEventListener('click',e=>{e.preventDefault();if(internal._state.readOnly)return;for(const c of owner.views.values())c.cancel();if(owner.active&&owner.shape==='arrow')owner.deactivate();else{internal.setTool(Components.utils.cloneInto(annotationToolDefaults('ink'),reader._iframeWindow));owner.shape='arrow';owner.active=true;}sync();internal._primaryView?._iframeWindow?.focus();});
      owner.button.after(b);owner.arrow=b;
    }
    function sync(){
      const temporary=[...owner.views.keys()].some(win=>{
        const s=pdfGestureBindings.get(win)?.shortcutState();return s&&(s.space||s.textChord||s.stroke||s.textEditing);
      });
      if((internal._state.tool.type!=='ink'&&!temporary)||internal._state.readOnly){owner.active=false;for(const c of owner.views.values())c.cancel();}
      owner.button.classList.toggle('active',owner.active&&owner.shape==='rectangle');owner.button.setAttribute('aria-pressed',String(owner.active&&owner.shape==='rectangle'));owner.button.disabled=!!internal._state.readOnly;
      if(owner.arrow){owner.arrow.classList.toggle('active',owner.active&&owner.shape==='arrow');owner.arrow.setAttribute('aria-pressed',String(owner.active&&owner.shape==='arrow'));owner.arrow.disabled=!!internal._state.readOnly;}
      if(owner.active)ink.classList.remove('active');
    }
    owner.sync=sync;
    sync();
    const views=new Set();
    for(const view of [internal._primaryView,internal._secondaryView]){
      const win=view?._iframeWindow;if(!win?.document.getElementById('viewerContainer'))continue;
      views.add(win);
      const old=owner.views.get(win);
      if(old&&old.document!==win.document){old();owner.views.delete(win);}
      if(!owner.views.has(win))owner.views.set(win,attachRectangleView(win,view,internal,owner));
    }
    for(const[win,c]of owner.views)if(!views.has(win)){c();owner.views.delete(win);}
    } catch(error) {
      const owner=rectangleReaders.get(reader);rectangleReaders.delete(reader);
      try {owner?.cleanup();}catch(_) {}
      if(!String(error).includes('dead object'))report(error);
    }
  }
  for(const[reader,owner]of rectangleReaders)if(!live.has(reader)){rectangleReaders.delete(reader);try{owner.cleanup();}catch(_) {}}
}
function stopRectangleTools(){const owners=[...rectangleReaders.values()];rectangleReaders.clear();for(const owner of owners){try{owner.cleanup();}catch(_) {}}}
