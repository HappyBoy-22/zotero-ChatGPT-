var sidebars = new Map();
var readerWindowListener = null;

function sidebarHost(win) {
  return win.document.getElementById('browser')
    || win.document.getElementById('zotero-reader')?.parentNode;
}

function setSidebarStatus(win, text) {
  const state = sidebars.get(win);
  if (!state) return;
  win.clearTimeout(state.statusTimer);
  state.status.textContent = text;
  state.status.hidden = !text;
  if (text) state.statusTimer = win.setTimeout(() => {
    state.status.hidden = true;
    state.status.textContent = '';
  }, 5000);
}

function navigateSidebar(browser, url = CHATGPT_HOME) {
  browser.browsingContext.sandboxFlags &= ~0x80;
  browser.loadURI(Services.io.newURI(url), {
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
  });
}

function openChat(win = Zotero.getMainWindow()) {
  let state = sidebars.get(win);
  if (!state) state = createSidebar(win);
  // The first invocation keeps the sidebar opt-in. Once the user has opened
  // it, paper switches should preserve the visible state.
  state.everOpened = true;
  syncPaperConversation(win);
  state.panel.hidden = false;
  state.splitter.hidden = false;
  win.document.getElementById(PREFIX + 'toggle')?.setAttribute('checked', 'true');
  if (!state.loaded) {
    navigateSidebar(state.browser, boundConversation(paperForWindow(win)) || 'https://chatgpt.com/');
    state.loaded = true;
    if (state.activeView) state.activeView.loaded = true;
  }
  return win;
}

function hideSidebar(win) {
  const state = sidebars.get(win);
  if (!state) return;
  state.panel.hidden = true;
  state.splitter.hidden = true;
  win.document.getElementById(PREFIX + 'toggle')?.removeAttribute('checked');
}

function toggleSidebar(win) {
  const state = sidebars.get(win);
  if (state && !state.panel.hidden) hideSidebar(win);
  else openChat(win);
}

function createSidebar(win) {
  const doc = win.document;
  const host = sidebarHost(win);
  if (!host) throw new Error('当前窗口没有可用的阅读区域。');
  const panel = doc.createXULElement('vbox');
  panel.id = PREFIX + 'sidebar';
  panel.hidden = true;
  const stored = Number(Zotero.Prefs.get('chatgptReader.width')) || 440;
  const width = Math.max(320, Math.min(stored, Math.max(320, win.innerWidth - 500), 800));
  panel.setAttribute('width', width);
  panel.setAttribute('style', 'min-width:320px;max-width:800px;min-height:0;background:var(--material-background,#fff);border-inline-start:1px solid var(--material-border,#ddd);');
  panel.style.width = width + 'px';
  panel.style.flexShrink = '0';
  const header = doc.createXULElement('hbox');
  header.setAttribute('align', 'center');
  header.setAttribute('style', 'padding:6px;');
  const title = doc.createXULElement('label');
  title.setAttribute('value', 'ChatGPT');
  title.setAttribute('flex', '1');
  title.setAttribute('style', 'font-weight:600;');
  const settings = button(doc, '对话管理', () => {
    const state = sidebars.get(win);
    state.bindingDetails.hidden = !state.bindingDetails.hidden;
    settings.setAttribute('aria-expanded', String(!state.bindingDetails.hidden));
  });
  settings.id = PREFIX + 'binding-settings';
  settings.setAttribute('aria-controls', PREFIX + 'binding-details');
  header.append(title, settings, button(doc,'设置',()=>Zotero.ChatGPTReader.settings()),button(doc, '收起', () => hideSidebar(win)));
  const toolbar = doc.createXULElement('hbox');
  toolbar.id = PREFIX + 'bar';
  toolbar.setAttribute('style', 'display:flex;flex-wrap:wrap;padding:2px 6px;gap:2px;');
  const browser = doc.createXULElement('browser');
  browser.id = PREFIX + 'web';
  for (const [key, value] of Object.entries({type:'content',flex:'1',remote:'false',maychangeremoteness:'true',disableglobalhistory:'true',messagemanagergroup:'basicViewer'})) {
    browser.setAttribute(key, value);
  }
  if (doc.getElementById('contentAreaContextMenu')) browser.setAttribute('context', 'contentAreaContextMenu');
  browser.setAttribute('style', 'min-width:0;min-height:0;');
  toolbar.append(
    button(doc, '开始分析', () => requestAutomaticAnalysis(win)),
    button(doc, '返回对话', () => navigateSidebar(sidebars.get(win).browser,boundConversation(paperForWindow(win)) || CHATGPT_HOME)),
    button(doc, '刷新', () => sidebars.get(win).browser.reload()),
    button(doc, '浏览器打开', () => Zotero.launchURL(boundConversation(paperForWindow(win)) || 'https://chatgpt.com/'))
  );
  const status = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
  status.id = PREFIX + 'status';
  status.hidden = true;
  status.style.cssText = 'font-size:11px;padding:4px 8px;color:var(--fill-secondary,#666);';
  panel.append(header, toolbar, status, browser);
  const splitter = doc.createXULElement('splitter');
  splitter.id = PREFIX + 'splitter';
  splitter.setAttribute('resizebefore', 'closest');
  splitter.setAttribute('resizeafter', 'closest');
  splitter.setAttribute('style', 'min-width:5px;cursor:col-resize;');
  // Keep drag behavior explicit: Zotero's modern flex layout does not always
  // honor the legacy XUL splitter's width attribute.
  const drag = event => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panel.getBoundingClientRect().width;
    const move = e => {
      const max = Math.max(320, Math.min(800, host.getBoundingClientRect().width - 400));
      const next = Math.round(Math.max(320, Math.min(max, startWidth + startX - e.clientX)));
      panel.style.width = next + 'px';
      panel.setAttribute('width', next);
    };
    const end = () => {
      win.removeEventListener('mousemove', move, true);
      win.removeEventListener('mouseup', end, true);
      state.endDrag = null;
      saveWidth();
    };
    state.endDrag = end;
    win.addEventListener('mousemove', move, true);
    win.addEventListener('mouseup', end, true);
  };
  splitter.addEventListener('mousedown', drag);
  const content = splitter.previousElementSibling || host.firstElementChild;
  const contentStyle = content.getAttribute('style');
  content.style.minWidth = '0';
  content.style.flex = '1 1 0';
  content.style.overflow = 'hidden';
  const saveWidth = () => {
    const current = Math.round(panel.getBoundingClientRect().width);
    if (current >= 320) Zotero.Prefs.set('chatgptReader.width', current);
  };
  win.addEventListener('mouseup', saveWidth);
  host.append(splitter, panel);
  const state = {panel, splitter, browser, status, saveWidth, content, contentStyle, loaded:false,everOpened:false,paperViews:new Map()};
  sidebars.set(win, state);
  addBindingControls(win, state, status);
  state.automationTimer = win.setInterval(() => run(() => automationTick(win)),1200);
  installPopupRouter(win, state);
  return state;
}

function installPopupRouter(win, state) {
  const original = win.browserDOMWindow;
  if (!original) return;
  state.originalAccess = original;
  const fromSidebar = info => {
    const opener = info?.parent || info?.openerBrowser?.browsingContext;
    return opener?.top?.id === state.browser.browsingContext?.top?.id;
  };
  const popup = (uri, info, principal, csp, skip) => {
    const doc = win.document;
    const box = doc.createXULElement('vbox');
    box.setAttribute('flex', '1');
    box.className = PREFIX + 'popup';
    const b = doc.createXULElement('browser');
    for (const [k,v] of Object.entries({type:'content',flex:'1',remote:'false',maychangeremoteness:'true'})) b.setAttribute(k,v);
    if (info) b.openWindowInfo = info;
    const close = () => { box.remove(); state.browser.hidden = false; };
    box.append(button(doc, '返回聊天', close), b);
    state.browser.hidden = true;
    state.panel.append(box);
    if (uri && !skip) b.loadURI(uri, {triggeringPrincipal:principal || Services.scriptSecurityManager.getSystemPrincipal(),csp});
    return b;
  };
  const iface = {
    QueryInterface: ChromeUtils.generateQI(['nsIBrowserDOMWindow']),
    openURI(uri,info,where,flags,principal,csp) {
      if (!fromSidebar(info)) return original.openURI(uri,info,where,flags,principal,csp);
      if (uri?.schemeIs('chrome')) return null;
      return popup(uri,info,principal,csp,false).browsingContext;
    },
    createContentWindow(uri,info,where,flags,principal,csp) {
      if (!fromSidebar(info)) return original.createContentWindow(uri,info,where,flags,principal,csp);
      return popup(null,info,principal,csp,true).browsingContext;
    },
    openURIInFrame(uri,params,where,flags,name) {
      if (!fromSidebar(params.openWindowInfo)) return original.openURIInFrame(uri,params,where,flags,name);
      if (uri?.schemeIs('chrome')) return null;
      return popup(uri,params.openWindowInfo,params.triggeringPrincipal,params.csp,false);
    },
    createContentWindowInFrame(uri,params,where,flags,name) {
      if (!fromSidebar(params.openWindowInfo)) return original.createContentWindowInFrame(uri,params,where,flags,name);
      return popup(null,params.openWindowInfo,params.triggeringPrincipal,params.csp,true);
    },
    canClose() { return original.canClose(); },
    get tabCount() { return original.tabCount; }
  };
  win.browserDOMWindow = iface;
}

function addSidebarToggle(win) {
  const doc = win.document;
  if (doc.getElementById(PREFIX + 'toggle')) return;
  const node = button(doc, 'ChatGPT', () => toggleSidebar(win));
  node.id = PREFIX + 'toggle';
  node.setAttribute('tooltiptext', '显示 / 收起 ChatGPT 侧边栏');
  node.setAttribute('style', 'padding:4px 8px;min-width:72px!important;width:72px!important;flex-shrink:0;');
  const target = doc.getElementById('zotero-pq-buttons') || doc.getElementById('zotero-tabs-toolbar') || doc.getElementById('main-menubar') || doc.querySelector('menubar');
  target?.prepend(node);
  const margins = button(doc,'两侧留白',()=>openMarginCopy(win));
  margins.id = PREFIX+'margins';
  margins.setAttribute('tooltiptext','打开 / 创建可批注的左右留白 PDF 副本');
  target?.prepend(margins);
}

function cleanupSidebar(win) {
  const state = sidebars.get(win);
  if (state) {
    if (typeof releasePaperViews === 'function') releasePaperViews(state);
    win.clearInterval(state.automationTimer);
    win.clearTimeout(state.statusTimer);
    win.clearInterval(state.selectionTimer);
    state.endDrag?.();
    win.removeEventListener('mouseup', state.saveWidth);
    if (state.originalAccess) win.browserDOMWindow = state.originalAccess;
    state.panel.remove(); state.splitter.remove();
    if (state.contentStyle === null) state.content.removeAttribute('style');
    else state.content.setAttribute('style', state.contentStyle);
    sidebars.delete(win);
  }
  win.document.getElementById(PREFIX + 'toggle')?.remove();
  win.document.getElementById(PREFIX + 'margins')?.remove();
}

function watchReaderWindows() {
  const attach = win => {
    if (stopped || win.location.href !== 'chrome://zotero/content/reader.xhtml') return;
    addSidebarToggle(win);
  };
  readerWindowListener = {
    onOpenWindow(xul) {
      const win = xul.docShell.domWindow;
      win.addEventListener('load', () => attach(win), {once:true});
    },
    onCloseWindow(xul) { cleanupSidebar(xul.docShell.domWindow); }
  };
  Services.wm.addListener(readerWindowListener);
  const windows = Services.wm.getEnumerator('zotero:reader');
  while (windows.hasMoreElements()) attach(windows.getNext());
}

function stopReaderWindows() {
  if (readerWindowListener) Services.wm.removeListener(readerWindowListener);
  readerWindowListener = null;
  for (const win of [...sidebars.keys()]) cleanupSidebar(win);
  const windows = Services.wm.getEnumerator('zotero:reader');
  while (windows.hasMoreElements()) cleanupSidebar(windows.getNext());
}
