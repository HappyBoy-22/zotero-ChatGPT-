/* A view per paper keeps pending creations alive when the reader switches tabs. */
var initializationOwners = new Map();
function initializationKey(item) { return `chatgptReader.initialization.${item.libraryID}.${item.key}`; }
function readInitialization(item) {
  try { return JSON.parse(Zotero.Prefs.get(initializationKey(item)) || 'null'); }
  catch (_) { return null; }
}
function persistInitialization(view) {
  Zotero.Prefs.set(initializationKey(view.item),JSON.stringify(view.job));
  flushConversationPreferences();
}
function flushConversationPreferences() {
  if (typeof Services !== 'undefined') Services.prefs.savePrefFile(null);
}
function savePaperConversation(win,view,url) {
  url = conversationURL(url);
  if (!view.item || boundConversation(view.item)) return;
  Zotero.Prefs.set(bindingKey(view.item),url);
  Zotero.Prefs.set(preparedKey(view.item),url);
  view.job ||= {};
  view.job.phase = 'bound'; view.job.url = url;
  persistInitialization(view);
  view.boundURL = url; view.loaded = true;
  initializationOwners.delete(view.identity);
  const state = sidebars.get(win);
  if (state?.activeView === view) {
    state.savingConversation = true;
    try { syncPaperConversation(win); }
    finally { state.savingConversation = false; }
  }
}
function observePaperLocation(win,view,location) {
  if (!view.item || boundConversation(view.item)) return;
  let url;
  try { url = new URL(location); } catch (_) { return; }
  if (url.origin !== 'https://chatgpt.com') return;
  if (url.pathname === '/') { view.observedHome = true; return; }
  // The browser belongs to one paper. The first conversation reached from
  // its new-chat page is that paper's conversation, including manual sends.
  if (view.observedHome) {
    try { savePaperConversation(win,view,url.href); } catch (_) {}
  }
}
function watchPaperLocation(win,view) {
  if (typeof ChromeUtils === 'undefined') return;
  const listener = {
    QueryInterface:ChromeUtils.generateQI(['nsIWebProgressListener','nsISupportsWeakReference']),
    onLocationChange(progress,request,location) {
      if (progress.isTopLevel) observePaperLocation(win,view,location.spec);
    },
    onStateChange(){},onProgressChange(){},onStatusChange(){},onSecurityChange(){},onContentBlockingEvent(){}
  };
  try { view.browser.addProgressListener(listener); view.locationListener = listener; }
  catch (error) { report(error); }
}
function selectPaperView(win,item,bound) {
  const state = sidebars.get(win);
  if (!state?.paperViews) return;
  const key = item ? bindingKey(item) : '';
  let view = state.paperViews.get(key);
  if (!view) {
    let browser;
    if (!state.paperViews.size) browser = state.browser;
    else {
      browser = win.document.createXULElement('browser');
      for (const {name,value} of state.browser.attributes) if (name !== 'id' && name !== 'hidden' && name !== 'src') browser.setAttribute(name,value);
      browser.setAttribute('flex','1');
      state.panel.append(browser);
    }
    view = {browser,item,identity:key,loaded:false,boundURL:bound,job:item ? readInitialization(item) : null};
    state.paperViews.set(key,view);
    watchPaperLocation(win,view);
  }
  for (const v of state.paperViews.values()) {
    v.browser.hidden = v !== view;
    v.browser.removeAttribute('id');
  }
  state.browser = view.browser;
  state.browser.id = PREFIX + 'web';
  state.activeView = view;
  if (view.boundURL !== bound) {
    view.boundURL = bound;
    view.loaded = !!bound && view.browser.currentURI?.spec.split(/[?#]/)[0] === bound;
  }
  state.loaded = view.loaded;
  // Retain in-flight creations; finished conversations can be restored from URLs.
  if (state.paperViews.size > 6) {
    for (const [id,old] of state.paperViews) {
      if (old !== view && !initializationOwners.has(id) && (!old.job || old.job.phase === 'bound')) {
        if (old.locationListener) old.browser.removeProgressListener(old.locationListener);
        old.browser.remove(); state.paperViews.delete(id); break;
      }
    }
  }
}
async function capturePendingConversations(win) {
  const state = sidebars.get(win);
  if (!state?.paperViews) return;
  for (const view of state.paperViews.values()) {
    if (!view.item) continue;
    observePaperLocation(win,view,view.browser.currentURI?.spec);
    const existing = boundConversation(view.item);
    const pending = !!view.job && ['submitting','submitted','uncertain'].includes(view.job.phase);
    if (existing && (!view.job || view.job.phase === 'bound')) continue;
    try {
      const info = await view.browser.browsingContext.currentWindowGlobal.getActor('ReaderAssistant').sendQuery('inspect',{
        token:view.job?.token,
        title:view.item.getField('title'),
        doi:view.item.getField('DOI')
      });
      observePaperLocation(win,view,info.url);
      if (boundConversation(view.item)) continue;
      let url = '';
      for (const candidate of [info.url, view.browser.currentURI?.spec]) {
        try { url = conversationURL(candidate); break; } catch (_) {}
      }
      if (!url) continue;
      const tokenMatch = !!view.job?.token && (info.markerFound || info.submittedToken === view.job.token);
      // A user's first send from ChatGPT's blank home page creates the /c/<id>
      // URL. The child actor records that send and verifies its text appears in
      // the new conversation, so a plain first message can be bound as well.
      const freshHomeMatch = !!info.freshHomeSubmission && info.hasMessages;
      if (!info.paperMatch && !freshHomeMatch && !(pending && (tokenMatch || view.job.phase === 'submitted'))) continue;
      if (existing === url && view.job?.phase === 'bound') continue;
      // Save the original paper, even if a different PDF is now selected.
      savePaperConversation(win,view,url);
      if (state.activeView === view) {
        syncPaperConversation(win);
        setSidebarStatus(win,'已自动绑定这篇论文的对话');
      }
    } catch (_) { /* Loading or login pages may not have an actor yet. */ }
  }
}
async function autoPaperConversation(win) {
  const state = sidebars.get(win);
  const item = paperForWindow(win);
  const view = state?.activeView;
  if (!item || !view || state.panel.hidden || (!state.startRequested && !prefValue('autoStart',true)) || view.identity !== bindingKey(item)) return;
  if (boundConversation(item)) {
    if (state.startRequested) setSidebarStatus(win,'已恢复这篇论文的对话，不重复发送初始化消息');
    state.startRequested = false; return;
  }
  const owner = initializationOwners.get(view.identity);
  if (owner && owner !== view) { setSidebarStatus(win,'此论文正在另一个阅读窗口建立对话'); return; }
  if (!owner) {
    // Another reader may have submitted after this view was created.
    const saved = readInitialization(item);
    if (saved && (!view.job || saved.token !== view.job.token || ['submitting','submitted','uncertain','bound'].includes(saved.phase))) {
      if (saved.token !== view.job?.token) view.initialText = null;
      view.job = saved;
    }
    if (view.job?.phase === 'bound' && view.job.url) {
      Zotero.Prefs.set(bindingKey(item),conversationURL(view.job.url));
      syncPaperConversation(win); return;
    }
  }
  if (view.job && ['submitting','submitted','uncertain'].includes(view.job.phase)) {
    if (view.job.phase === 'submitted' && Date.now() - (view.job.submittedAt || 0) > 45000) {
      view.job.phase = 'uncertain'; persistInitialization(view);
    }
    // A browser restart can leave the owned draft on the home page even
    // though the previous actor response was recorded as submitted. It was
    // not sent in that case, so safely retry the same token instead of
    // creating a fresh conversation or waiting forever.
    if (view.browser.currentURI?.host === 'chatgpt.com' && new URL(view.browser.currentURI.spec).pathname === '/') {
      try {
        const pending = await view.browser.browsingContext.currentWindowGlobal.getActor('ReaderAssistant').sendQuery('inspect',{token:view.job.token});
        if (pending.draftTokenMatch && !pending.hasMessages) {
          view.job.phase = 'draft-ready'; persistInitialization(view);
        }
      } catch (_) {}
    }
    if (view.job.phase === 'draft-ready') {
      // Continue through the normal initialize path below.
    } else {
    setSidebarStatus(win, view.job.phase === 'submitted' ? '正在保存新对话…' : '上次发送结果尚未确认，请检查聊天记录；可在“对话管理”中恢复对话');
    return;
    }
  }
  if (view.browser.currentURI?.host !== 'chatgpt.com' || view.browser.hidden) return;
  const actor = view.browser.browsingContext.currentWindowGlobal.getActor('ReaderAssistant');
  const info = await actor.sendQuery('inspect',{token:view.job?.token});
  if (!info.authenticated) { setSidebarStatus(win,'登录 ChatGPT 后将自动开始分析'); return; }
  // Never accidentally send into an unrelated conversation opened in the website.
  if (new URL(info.url).pathname !== '/' || info.hasMessages) {
    setSidebarStatus(win,'请在“对话管理”中恢复当前对话，或重新建立独立对话'); return;
  }
  if (!info.editorReady) return;
  const ownedDraft = view.job && ['ready','draft-ready'].includes(view.job.phase) && info.draftTokenMatch;
  if (info.hasDraft && view.job?.phase !== 'draft-ready' && !ownedDraft) { setSidebarStatus(win,'输入框已有草稿，请清空后自动开始'); return; }
  initializationOwners.set(view.identity,view);
  try {
    if (!view.job) view.job = {token:`论文分析编号：${item.key}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`,phase:'ready'};
    if (!view.initialText) {
      setSidebarStatus(win,'正在准备基本信息并自动发送…');
      view.initialText = `${await buildPaperDraft(win)}\n\n${view.job.token}`;
    }
    if (stopped || sidebars.get(win) !== state || state.panel.hidden || state.activeView !== view || bindingKey(paperForWindow(win) || {}) !== view.identity) {
      initializationOwners.delete(view.identity); return;
    }
    const url = view.browser.currentURI.spec.split(/[?#]/)[0];
    if (new URL(url).pathname !== '/') { initializationOwners.delete(view.identity); return; }
    // Persist before clicking: a lost browser response must not cause a blind resend.
    const replaceOwned = !!ownedDraft && view.job.payloadKind !== 'basic-v1';
    view.job.phase = 'submitting'; view.job.payloadKind = 'basic-v1'; persistInitialization(view);
    let result;
    try { result = await view.browser.browsingContext.currentWindowGlobal.getActor('ReaderAssistant').sendQuery('initialize',{token:view.job.token,text:view.initialText,expectedURL:url,replaceOwned}); }
    catch (_) { view.job.phase = 'uncertain'; persistInitialization(view); return; }
    if (['submitted','already-submitted'].includes(result.state)) {
      let generatedURL = '';
      try { if (result.url) generatedURL = conversationURL(result.url); } catch (_) {}
      if (!generatedURL) {
        try { generatedURL = conversationURL(view.browser.currentURI?.spec || ''); } catch (_) {}
      }
      if (generatedURL) {
        savePaperConversation(win,view,generatedURL);
        state.startRequested = false;
        persistInitialization(view);
        syncPaperConversation(win);
        return;
      }
      view.job.phase = 'submitted';
      view.job.submittedAt = Date.now();
      state.startRequested = false;
    } else if (result.state === 'draft-ready') {
      view.job.phase = 'draft-ready';
    } else {
      view.job.phase = 'ready';
      initializationOwners.delete(view.identity);
      if (result.state === 'has-draft') setSidebarStatus(win,'已有草稿未覆盖，请清空后继续');
    }
    persistInitialization(view);
    await capturePendingConversations(win);
  } catch (error) {
    if (!['submitting','submitted','uncertain'].includes(view.job?.phase)) initializationOwners.delete(view.identity);
    throw error;
  }
}
function requestAutomaticAnalysis(win) {
  const state = sidebars.get(openChat(win));
  state.startRequested = true;
  run(()=>automationTick(win));
}
function resetPaperConversation(win) {
  const state = sidebars.get(win);
  const item = paperForWindow(win);
  if (!item || !state) return;
  const key = bindingKey(item);
  const owner = initializationOwners.get(key);
  if (owner && owner !== state.activeView) { setSidebarStatus(win,'请在正在建立对话的阅读窗口中操作'); return; }
  Zotero.Prefs.clear(key); Zotero.Prefs.clear(preparedKey(item)); Zotero.Prefs.clear(initializationKey(item));
  initializationOwners.delete(key);
  const view = state.paperViews.get(key);
  if (view) { view.job = null; view.initialText = null; view.loaded = false; view.boundURL = ''; }
  state.boundURL = undefined;
  syncPaperConversation(win,true);
  navigateSidebar(state.browser,CHATGPT_HOME);
  state.loaded = true; if (view) view.loaded = true;
}
function releasePaperViews(state) {
  for (const [key,view] of state.paperViews || []) {
    if (view.locationListener) view.browser.removeProgressListener(view.locationListener);
    if (initializationOwners.get(key) === view) initializationOwners.delete(key);
  }
}
