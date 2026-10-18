/* PDF-only input handlers; never intercept the ChatGPT sidebar or text fields. */
var pdfGestureBindings = new Map();
var pdfGestureTimer = null;
const ANNOTATION_DEFAULTS = Object.freeze({textSize:14,textColor:'#000000',inkSize:2,inkColor:'#ff0000',eraserSize:16});
function normalizeAnnotationSettings(values,strict = false) {
  const result = {};
  const ranges = {textSize:[6,96,'文本字号'],inkSize:[0.25,20,'画笔粗细'],eraserSize:[2,100,'橡皮擦直径']};
  for (const [key,fallback] of Object.entries(ANNOTATION_DEFAULTS)) {
    const value = values?.[key];
    if (ranges[key]) {
      const [min,max,label] = ranges[key];
      const number = typeof value === 'number' || (typeof value === 'string' && value.trim()) ? Number(value) : NaN;
      if (!Number.isFinite(number) || number < min || number > max) {
        if (strict) throw new Error(`${label}请输入 ${min}–${max} 之间的数值。`);
        result[key] = fallback;
      } else result[key] = number;
    } else {
      if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) {
        if (strict) throw new Error('请选择有效的文本或画笔颜色。');
        result[key] = fallback;
      } else result[key] = value.toLowerCase();
    }
  }
  return result;
}
function getAnnotationSettings() {
  return normalizeAnnotationSettings(Object.fromEntries(Object.keys(ANNOTATION_DEFAULTS).map(key=>[key,Zotero.Prefs.get('chatgptReader.annotations.'+key)])));
}
function saveAnnotationSettings(values) {
  const settings = normalizeAnnotationSettings(values,true);
  // Mozilla preferences only support integers, so keep fractional sizes as
  // strings and normalize them back to numbers when constructing tools.
  for (const [key,value] of Object.entries(settings)) {
    const pref = 'chatgptReader.annotations.'+key;
    const old = Zotero.Prefs.get(pref);
    if (old !== undefined && typeof old !== 'string') Zotero.Prefs.clear(pref);
    Zotero.Prefs.set(pref,String(value));
  }
  Services.prefs.savePrefFile(null);
}
function annotationToolDefaults(type) {
  const settings = getAnnotationSettings();
  if (type === 'text') return {type,size:settings.textSize,color:settings.textColor};
  if (type === 'ink') return {type,size:settings.inkSize,color:settings.inkColor};
  if (type === 'eraser') return {type,size:settings.eraserSize};
  return {type};
}
function attachPDFGestures(win,internal = null,view = null) {
  const doc = win.document;
  const viewport = doc.getElementById('viewerContainer');
  if (!viewport) return null;
  const app = () => (win.wrappedJSObject || win).PDFViewerApplication;
  const editable = target => target?.closest?.('input,textarea,select,button,a,[contenteditable="true"],.popup');
  const inPage = event => viewport.contains(event.target) && !editable(event.target);
  const consume = event => { event.preventDefault(); event.stopImmediatePropagation(); };
  const clone = value => typeof Components !== 'undefined' ? Components.utils.cloneInto(value,win) : value;
  let space = false, textChord = false, savedTool = null, temporaryTool = '', stroke = false, eraseRight = false;
  let textEditing = false, priorTextIDs = new Set(), disposed = false;
  const switchTool = type => {
    if (!internal || internal._state?.readOnly) return;
    if (!savedTool) savedTool = {...(internal._state?.tool || view?._tool || {type:'pointer'})};
    internal.setTool(clone(annotationToolDefaults(type))); temporaryTool = type;
  };
  const restoreTool = () => {
    if (stroke || textEditing || !savedTool) return;
    const current = internal?._state?.tool?.type || view?._tool?.type;
    if (current === temporaryTool || (temporaryTool === 'text' && current === 'pointer')) internal.setTool(clone(savedTool));
    savedTool = null; temporaryTool = '';
  };
  const keydown = event => {
    if (textEditing && event.key === 'Escape') {
      textEditing = false;
      setTimeout(() => { if (!disposed) restoreTool(); },0);
      return;
    }
    if (editable(event.target) || event.altKey || event.metaKey || !internal) return;
    if (event.code === 'Space' || event.key === ' ') {
      consume(event); space = true; if (!stroke) switchTool('ink');
    } else if (event.ctrlKey && (event.code === 'KeyA' || event.key?.toLowerCase() === 'a')) {
      consume(event); textChord = true; if (!stroke) switchTool('text');
    }
  };
  const pointerdown = event => {
    if (textEditing) {
      if (event.target?.closest?.('textarea.textAnnotation')) return;
      textEditing = false; restoreTool();
    }
    if (!space && !(textChord && event.ctrlKey)) { down(event); return; }
    if (!inPage(event) || (!space && !(textChord && event.ctrlKey))) return;
    if (event.button !== 0 && !(space && event.button === 2)) return;
    const type = space ? (event.button === 2 ? 'eraser' : 'ink') : 'text';
    if (internal?._state?.readOnly) return;
    switchTool(type); stroke = true;
    if (type === 'text') {
      textEditing = true;
      priorTextIDs = new Set((internal._state?.annotations || []).filter(a=>a.type==='text').map(a=>a.id));
    }
    if (space && event.button === 2) {
      consume(event); eraseRight = true;
      // Zotero's eraser accepts left-button strokes. Translate only the
      // initial right-button press; native pointer moves/up finish the stroke.
      event.target.dispatchEvent(new win.MouseEvent('mousedown',clone({bubbles:true,cancelable:true,button:0,buttons:1,clientX:event.clientX,clientY:event.clientY})));
    }
  };
  const pointerup = () => {
    if (!stroke) return;
    setTimeout(() => {
      if (disposed) return;
      stroke = false; eraseRight = false;
      if (textEditing) {
        // setTool() deselects annotations and deletes empty text boxes. Keep
        // the new annotation selected through mouse/key release and focus it.
        const annotation = (internal._state?.annotations || []).find(a=>a.type==='text' && !priorTextIDs.has(a.id));
        const editor = annotation && [...doc.querySelectorAll('textarea.textAnnotation')].find(el=>el.getAttribute('data-id')===annotation.id);
        if (editor) { editor.classList.add('focusable'); editor.focus(); }
        else { textEditing = false; restoreTool(); }
        return;
      }
      if (space) switchTool('ink');
      else if (textChord) switchTool('text');
      else restoreTool();
    },0);
  };
  const contextmenu = event => { if ((space || eraseRight) && !editable(event.target)) consume(event); };
  let drag = null, previousCursor = '';
  const end = () => {
    if (!drag) return;
    drag = null;
    viewport.style.cursor = previousCursor;
  };
  const wheel = event => {
    if (!event.ctrlKey || event.altKey || event.metaKey || !inPage(event) || !event.deltaY) return;
    const pdf = app();
    if (!pdf?.pdfViewer) return;
    consume(event);
    if (event.deltaY < 0) pdf.zoomIn();
    else pdf.zoomOut();
  };
  const down = event => {
    if (space || (textChord && event.ctrlKey)) return;
    if (event.button !== 0 || !event.ctrlKey || event.altKey || event.metaKey || !inPage(event)) return;
    consume(event);
    previousCursor = viewport.style.cursor;
    drag = {x:event.clientX,y:event.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};
    viewport.style.cursor = 'grabbing';
    win.focus();
  };
  const move = event => {
    if (!drag) return;
    if (!event.ctrlKey || !(event.buttons & 1)) { end(); return; }
    consume(event);
    viewport.scrollLeft = drag.left + drag.x - event.clientX;
    viewport.scrollTop = drag.top + drag.y - event.clientY;
  };
  const up = event => { if (drag && event.button === 0) { consume(event); end(); } };
  const keyup = event => {
    if (event.key === 'Control' || !event.ctrlKey) end();
    if (event.code === 'Space' || event.key === ' ') { space = false; if (!editable(event.target)) consume(event); }
    if (event.code === 'KeyA' || event.key?.toLowerCase() === 'a' || event.key === 'Control') textChord = false;
    if (!space && !textChord) restoreTool();
  };
  const blur = event => {
    if (event?.type === 'blur' && event.target !== doc && event.target?.window !== event.target) return;
    end(); space = false; textChord = false;
    if (stroke) { view?._clearPointerAction?.(); stroke = false; }
    eraseRight = false; textEditing = false; restoreTool();
  };
  const focusout = event => {
    if (!textEditing || !event.target?.closest?.('textarea.textAnnotation')) return;
    setTimeout(() => {
      if (disposed || doc.activeElement?.closest?.('textarea.textAnnotation')) return;
      textEditing = false; restoreTool();
    },0);
  };
  const click = event => { if (!textEditing && event.ctrlKey && !textChord && event.button === 0 && inPage(event)) consume(event); };
  const registrations = [['wheel',wheel],['keydown',keydown],['pointerdown',pointerdown],['pointerup',pointerup],['pointercancel',blur],['contextmenu',contextmenu],['mousedown',down],['mousemove',move],['mouseup',up],['keyup',keyup],['focusout',focusout],['blur',blur],['click',click]];
  // The PDF window belongs to another compartment. Clone the options so
  // Gecko reads capture/passive instead of silently using its defaults.
  const options = typeof Components !== 'undefined'
    ? Components.utils.cloneInto({capture:true,passive:false},win)
    : {capture:true,passive:false};
  for (const [type,handler] of registrations) win.addEventListener(type,handler,options,true);
  const cleanup = () => {
    blur();
    disposed = true;
    for (const [type,handler] of registrations) win.removeEventListener(type,handler,true);
  };
  cleanup.document = doc;
  cleanup.shortcutState = () => ({space,textChord,stroke,eraseRight});
  return cleanup;
}
function refreshPDFGestures() {
  if(typeof refreshRectangleTools==='function')refreshRectangleTools();
  const live = new Set();
  for (const reader of Zotero.Reader._readers || []) {
    const internal = reader._internalReader;
    for (const view of [internal?._primaryView,internal?._secondaryView]) {
      const win = view?._iframeWindow;
      if (!win || win.closed) continue;
      live.add(win);
      const previous = pdfGestureBindings.get(win);
      if (previous && previous.document !== win.document) { previous(); pdfGestureBindings.delete(win); }
      if (!pdfGestureBindings.has(win)) {
        const cleanup = attachPDFGestures(win,internal,view);
        if (cleanup) { pdfGestureBindings.set(win,cleanup); Zotero.debug('ChatGPT Reader: PDF gesture listeners attached'); }
      }
    }
  }
  for (const [win,cleanup] of pdfGestureBindings) {
    if (!live.has(win)) { cleanup(); pdfGestureBindings.delete(win); }
  }
}
function startPDFGestures() {
  Zotero.ChatGPTReader.gestureStatus = target => ({count:pdfGestureBindings.size,matching:pdfGestureBindings.has(target),shortcuts:pdfGestureBindings.get(target)?.shortcutState()});
  refreshPDFGestures();
  pdfGestureTimer = setInterval(() => { try { refreshPDFGestures(); } catch(error) { report(error); } },600);
}
function stopPDFGestures() {
  if(typeof stopRectangleTools==='function')stopRectangleTools();
  clearInterval(pdfGestureTimer); pdfGestureTimer = null;
  for (const cleanup of pdfGestureBindings.values()) cleanup();
  pdfGestureBindings.clear();
}
