var preferencePaneID = null;
var automationActor = false;
var assistantAPI = null;
const DEFAULT_PROMPT = '请联网检索这篇论文，并用中文分析研究问题、核心贡献、方法、实验结果与局限。请给出来源链接，区分原文结论和你的推断；无法获取的内容请明确说明。';
const LOGIN_ORIGIN = 'https://auth.openai.com';
const LOGIN_REALM = 'Zotero ChatGPT Reader';

function preparedKey(item) { return `chatgptReader.prepared.${item.libraryID}.${item.key}`; }
function prefValue(name, fallback) {
  const value = Zotero.Prefs.get('chatgptReader.' + name);
  return value === undefined ? fallback : value;
}
async function savedLogin() {
  const entries = await Services.logins.findLogins(LOGIN_ORIGIN, null, LOGIN_REALM);
  return entries[0] || null;
}
async function saveLogin(email, password) {
  const old = await savedLogin();
  if (!password) {
    if (old && old.username === email) return;
    throw new Error('请输入密码以保存新账号；留空可保留原密码。');
  }
  const login = Components.classes['@mozilla.org/login-manager/loginInfo;1'].createInstance(Components.interfaces.nsILoginInfo);
  login.init(LOGIN_ORIGIN, null, LOGIN_REALM, email, password, '', '');
  if (old) await Services.logins.modifyLogin(old,login);
  else await Services.logins.addLoginAsync(login);
}
async function forgetLogin() {
  const login = await savedLogin();
  if (login) await Services.logins.removeLogin(login);
}
function basicPaperInformation(item) {
  const plain = value => String(value || '').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
  const lines = ['【论文基本信息】'];
  for (const [field,label,max] of [['title','标题',1000],['publicationTitle','期刊 / 会议',500],['DOI','DOI',300],['url','链接',2000]]) {
    const value = plain(item.getField(field));
    if (value) lines.push(label + '：' + value.slice(0,max));
  }
  const date = plain(item.getField('date'));
  if (date) lines.push('年份：' + (date.match(/(?:19|20)\d{2}/)?.[0] || date));
  const creators = item.getCreators?.() || [];
  if (creators.length) lines.push('作者：' + creators.slice(0,20).map(c=>plain(c.name || [c.firstName,c.lastName].filter(Boolean).join(' '))).join('、') + (creators.length>20 ? ' 等（共 '+creators.length+' 位）' : ''));
  return lines.join('\n');
}
async function buildPaperDraft(win) {
  const item = paperForWindow(win);
  if (!item) throw new Error('请先选择论文或打开 PDF。');
  return `${prefValue('prompt',DEFAULT_PROMPT)}\n\n请先依据以下标题、作者和 DOI 联网检索论文，再进行分析。请引用找到的来源；如果当前对话无法联网或找不到原文，请明确说明，不要假装已读全文。\n\n${basicPaperInformation(item)}`;
}
async function automationTick(win) {
  const state = sidebars.get(win);
  if (!state || state.automationBusy) return;
  state.automationBusy = true;
  try {
    if (typeof capturePendingConversations === 'function') await capturePendingConversations(win);
    if (state.panel.hidden) return;
    if (prefValue('autoLogin',false)) {
      for (const b of state.panel.querySelectorAll('browser')) {
        if (b.currentURI?.prePath === LOGIN_ORIGIN) {
          const login = await savedLogin();
          if (login) await b.browsingContext.currentWindowGlobal.getActor('ReaderAssistant').sendQuery('login',{email:login.username,password:login.password});
        }
      }
      if (state.browser.currentURI?.host === 'chatgpt.com') {
        const login = await savedLogin();
        if (login) {
          const result = await state.browser.browsingContext.currentWindowGlobal.getActor('ReaderAssistant').sendQuery('signin',{});
          if (result.state === 'login-started') return;
        }
      }
    }
    if (!state.prepareRequested) {
      if (typeof autoPaperConversation === 'function') await autoPaperConversation(win);
      return;
    }
    const item = paperForWindow(win);
    if (!item || (!state.prepareRequested && !prefValue('autoPrepare',true))) return;
    const identity = bindingKey(item);
    if (state.paperIdentity !== identity) return;
    const conversation = boundConversation(item) || 'new';
    if (!state.prepareRequested && Zotero.Prefs.get(preparedKey(item)) === conversation) return;
    if (state.browser.currentURI?.host !== 'chatgpt.com' || state.browser.hidden) return;
    // Wait for the selected conversation, rather than filling the previous page.
    if (conversation !== 'new' && state.browser.currentURI.spec.split(/[?#]/)[0] !== conversation) return;
    const readyURL = state.browser.currentURI.spec.split(/[?#]/)[0];
    const actor = state.browser.browsingContext.currentWindowGlobal.getActor('ReaderAssistant');
    const status = (await actor.sendQuery('status',{})).state;
    if (status !== 'ready') {
      if (status === 'has-draft' && state.prepareRequested) {
        setSidebarStatus(win,'输入框已有内容，请发送或清空后再点“填入论文”');
        state.prepareRequested = false;
      }
      return;
    }
    const text = await buildPaperDraft(win);
    if (stopped || sidebars.get(win) !== state || state.panel.hidden || bindingKey(paperForWindow(win) || {}) !== identity || (boundConversation(paperForWindow(win)) || 'new') !== conversation) return;
    if (state.browser.currentURI.spec.split(/[?#]/)[0] !== readyURL) return;
    const expectedURL = readyURL;
    const result = await state.browser.browsingContext.currentWindowGlobal.getActor('ReaderAssistant').sendQuery('draft',{text,expectedURL});
    if (result.state === 'filled') {
      Zotero.Prefs.set(preparedKey(item),conversation);
      state.prepareRequested = false;
      setSidebarStatus(win,'论文和 prompt 已填入，检查后点击发送');
    } else if (result.state === 'has-draft') {
      if (state.prepareRequested) setSidebarStatus(win,'输入框已有内容，请发送或清空后再点“填入论文”');
      state.prepareRequested = false;
    }
  } catch (_) {
    // Page navigation destroys WindowActors. Retry on the next tick; never log credentials.
  } finally { state.automationBusy = false; }
}
function requestPaperDraft(win) {
  const state = sidebars.get(openChat(win));
  state.prepareRequested = true;
  run(() => automationTick(win));
}
async function registerAssistant(id,rootURI) {
  // Settings and shortcuts must not depend on the website actor starting.
  assistantAPI = {DEFAULT_PROMPT,savedLogin,saveLogin,forgetLogin,buildPaperDraft,ANNOTATION_DEFAULTS,getAnnotationSettings,saveAnnotationSettings,normalizeAnnotationSettings,getMarginWidth,saveMarginWidth,createMarginCopy,open:()=>openChat(),settings:()=>Zotero.Utilities.Internal.openPreferences('chatgpt-reader-preferences')};
  Zotero.ChatGPTReader = assistantAPI;
  const active = ()=>!stopped && Zotero.ChatGPTReader === assistantAPI;
  // A prior interrupted upgrade may have left a registered pane behind.
  try { Zotero.PreferencePanes.unregister('chatgpt-reader-preferences'); } catch (_) {}
  try {
    const pane = await Zotero.PreferencePanes.register({pluginID:id,id:'chatgpt-reader-preferences',label:'ChatGPT 论文助手',src:rootURI+'preferences.xhtml',scripts:[rootURI+'preferences.js'],image:'chrome://zotero/skin/20/universal/cog.svg'});
    if (!active()) return;
    preferencePaneID = pane;
  } catch(error) { report(error); }
  if (!active()) return;
  const resources = Services.io.getProtocolHandler('resource').QueryInterface(Components.interfaces.nsIResProtocolHandler);
  resources.setSubstitution('chatgpt-reader',Services.io.newURI(rootURI));
  try { ChromeUtils.unregisterWindowActor('ReaderAssistant'); } catch (_) {}
  ChromeUtils.registerWindowActor('ReaderAssistant',{
    child:{esModuleURI:'resource://chatgpt-reader/ReaderChild.sys.mjs'},
    matches:['https://chatgpt.com/*','https://auth.openai.com/*'],allFrames:false
  });
  automationActor = true;
}
function unregisterAssistant() {
  // A late shutdown from the old version must not erase the new API/pane.
  if (Zotero.ChatGPTReader !== assistantAPI) return;
  if (preferencePaneID) Zotero.PreferencePanes.unregister(preferencePaneID);
  preferencePaneID = null;
  if (automationActor) {
    ChromeUtils.unregisterWindowActor('ReaderAssistant');
    Services.io.getProtocolHandler('resource').QueryInterface(Components.interfaces.nsIResProtocolHandler).setSubstitution('chatgpt-reader',null);
  }
  automationActor = false;
  delete Zotero.ChatGPTReader;
  assistantAPI = null;
}
