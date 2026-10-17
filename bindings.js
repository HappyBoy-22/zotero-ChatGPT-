/* Store only conversation URLs, keyed by library and parent item key. */
function paperForWindow(win) {
  let item = currentItem(win);
  if (item?.parentItemID) item = Zotero.Items.get(item.parentItemID);
  if (!item?.key || !item.libraryID) return null;
  return item;
}

function bindingKey(item) {
  return `chatgptReader.conversations.${item.libraryID}.${item.key}`;
}

function conversationURL(value) {
  let url;
  try { url = new URL(value.trim()); }
  catch (_) { throw new Error('请粘贴完整的 ChatGPT 对话链接。'); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password
    || !['chatgpt.com', 'chat.openai.com'].includes(url.hostname)
    || !/^\/(?:g\/[a-zA-Z0-9_-]+\/)?c\/[a-zA-Z0-9_-]+(?:\/[^?#]*)?\/?$/.test(url.pathname)) {
    throw new Error('请使用自己已有对话的链接（https://chatgpt.com/c/…），不要使用分享链接。');
  }
  return 'https://chatgpt.com' + url.pathname.replace(/\/$/, '');
}

function boundConversation(item) {
  if (!item) return '';
  const saved = Zotero.Prefs.get(bindingKey(item));
  if (!saved) return '';
  try { return conversationURL(saved); } catch (_) { return ''; }
}

function syncPaperConversation(win, force = false) {
  const state = sidebars.get(win);
  if (!state) return;
  const item = paperForWindow(win);
  const identity = item ? bindingKey(item) : '';
  const bound = boundConversation(item);
  if (!force && state.paperIdentity === identity && state.boundURL === bound) return;
  const changed = state.paperIdentity !== identity;
  if (changed) {
    if (state.paperIdentity !== undefined && !state.everOpened) hideSidebar(win);
    state.prepareRequested = false;
    state.startRequested = false;
  }
  state.paperIdentity = identity;
  state.boundURL = bound;
  const title = item?.getField('title') || '未选择论文';
  state.bindingLabel.textContent = `${bound ? '已绑定' : '未绑定'} · ${title}`;
  state.bindingLabel.title = bound ? `${title}\n${bound}` : title;
  state.bindingInput.value = bound;
  state.bindingDetails.hidden = true;
  state.bindingSettings.setAttribute('aria-expanded', String(!state.bindingDetails.hidden));
  setSidebarStatus(win, '');
  for (const control of state.bindingControls) control.disabled = !item;
  if (typeof selectPaperView === 'function') selectPaperView(win,item,bound);
  // A hidden panel waits until reopened; selection changes never open it.
  if (!state.panel.hidden) {
    for (const popup of state.panel.querySelectorAll('.' + PREFIX + 'popup')) popup.remove();
    state.browser.hidden = false;
    const target = bound || 'https://chatgpt.com/';
    const loaded = state.activeView ? state.activeView.loaded : (!changed && state.loaded);
    if (!state.savingConversation && ((!bound && !loaded) || (bound && state.browser.currentURI?.spec.split(/[?#]/)[0] !== target))) navigateSidebar(state.browser, target);
    state.loaded = true;
    if (state.activeView) state.activeView.loaded = true;
  } else if (!state.activeView) state.loaded = false;
}

function bindConversation(win, useCurrent) {
  const state = sidebars.get(win);
  try {
    const item = paperForWindow(win);
    if (!item) throw new Error('请先选择论文或打开 PDF。');
    if (useCurrent && state.paperIdentity !== bindingKey(item)) {
      syncPaperConversation(win);
      throw new Error('论文刚刚切换，请在对应聊天加载后再绑定。');
    }
    const url = conversationURL(useCurrent ? state.browser.currentURI.spec : state.bindingInput.value);
    if (typeof preparedKey === 'function' && Zotero.Prefs.get(preparedKey(item)) === 'new') Zotero.Prefs.set(preparedKey(item),url);
    Zotero.Prefs.set(bindingKey(item), url);
    syncPaperConversation(win, true);
    setSidebarStatus(win, '');
  } catch (error) { setSidebarStatus(win, error.message); }
}

function unbindConversation(win) {
  const item = paperForWindow(win);
  if (!item) return;
  Zotero.Prefs.clear(bindingKey(item));
  syncPaperConversation(win, true);
  setSidebarStatus(win, '已解除绑定，ChatGPT 中的对话仍然保留');
}

function addBindingControls(win, state, before) {
  const doc = win.document;
  const details = doc.createXULElement('vbox');
  details.id = PREFIX + 'binding-details';
  const label = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
  label.id = PREFIX + 'binding-label';
  label.style.cssText = 'font-size:12px;padding:4px 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  const row = doc.createXULElement('hbox');
  row.style.cssText = 'padding:2px 6px;align-items:center;';
  const input = doc.createElementNS('http://www.w3.org/1999/xhtml', 'input');
  input.id = PREFIX + 'binding-input';
  input.type = 'url';
  input.placeholder = '可选：恢复已有对话链接';
  input.setAttribute('aria-label', '已有 ChatGPT 对话链接');
  input.style.cssText = 'min-width:0;flex:1;width:0;padding:5px;';
  const save = button(doc, '恢复已有对话', () => bindConversation(win, false));
  save.id = PREFIX + 'bind-link';
  row.append(input, save);
  const actions = doc.createXULElement('hbox');
  actions.style.cssText = 'padding:0 6px;';
  const current = button(doc, '恢复当前聊天', () => bindConversation(win, true));
  current.id = PREFIX + 'bind-current';
  const remove = button(doc, '重新建立对话', () => {
    if (typeof resetPaperConversation === 'function') resetPaperConversation(win);
    else unbindConversation(win);
  });
  remove.id = PREFIX + 'unbind';
  const back = button(doc, '返回绑定对话', () => {
    const bound = boundConversation(paperForWindow(win));
    navigateSidebar(state.browser, bound || 'https://chatgpt.com/');
  });
  actions.append(current, back, remove);
  details.append(label, row, actions);
  state.panel.insertBefore(details, before);
  Object.assign(state, {bindingDetails:details,bindingSettings:doc.getElementById(PREFIX + 'binding-settings'),bindingLabel:label,bindingInput:input,bindingControls:[input,save,current,remove,back]});
  state.selectionTimer = win.setInterval(() => {
    try { syncPaperConversation(win); } catch (error) { report(error); }
  }, 600);
}
