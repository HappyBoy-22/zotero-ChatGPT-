export class ReaderAssistantChild extends JSWindowActorChild {
  findEditor() {
    const selector = '#prompt-textarea,#mobile-composer-prompt,textarea[data-id="root"],textarea[placeholder],[contenteditable="true"][role="textbox"]';
    return [...this.document.querySelectorAll(selector)].find(el=>!el.hidden && (!el.getClientRects || el.getClientRects().length)) || this.document.querySelector(selector);
  }
  editorText(editor) {
    return editor.localName === 'textarea' ? editor.value : (editor.innerText ?? editor.textContent ?? '');
  }
  watchFreshHomeSubmission() {
    const doc = this.document;
    if (this.freshHomeSubmissionWatcher || !doc?.addEventListener) return;
    const isHome = () => doc.location?.hostname === 'chatgpt.com' && doc.location?.pathname === '/';
    const editorFor = () => this.findEditor();
    const record = event => {
      if (!isHome()) return;
      const editor = editorFor();
      const text = editor ? this.editorText(editor).trim() : '';
      if (!text) return;
      if (event.type === 'keydown') {
        const inEditor = event.target === editor || editor?.contains?.(event.target);
        if (!inEditor || event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
      } else {
        const send = event.target?.closest?.('[data-testid="send-button"],#composer-submit-button,button[aria-label*="send" i],button[aria-label*="发送"],button[title*="send" i],button[title*="发送"],button[type="submit"]');
        if (!send || send.disabled || send.getAttribute('aria-disabled') === 'true') return;
      }
      this.freshHomeSubmissionText = text;
    };
    doc.addEventListener('click', record, true);
    doc.addEventListener('keydown', record, true);
    this.freshHomeSubmissionWatcher = {doc,record};
  }
  inspect(input = {}) {
    const options = typeof input === 'string' ? {token:input} : (input || {});
    const token = options.token || '';
    const doc = this.document;
    this.watchFreshHomeSubmission();
    const visible = el => el && !el.hidden && (!el.getClientRects || el.getClientRects().length);
    const login = [...doc.querySelectorAll('[data-testid="login-button"],a[href^="/auth/login"]')].some(visible);
    const profile = doc.querySelector('[data-testid="profile-button"],[data-testid="user-menu-button"],[data-testid="accounts-profile-button"],button[aria-label*="profile menu" i],button[aria-label*="个人资料"],button[aria-label*="个人菜单"]');
    const users = [...doc.querySelectorAll('[data-message-author-role="user"],[data-turn="user"],[data-testid*="conversation-turn"]')];
    const userTexts = users.map(el => el.innerText || el.textContent || '');
    const editor = this.findEditor();
    const text = editor ? this.editorText(editor) : '';
    const pageText = doc.body?.innerText || doc.body?.textContent || '';
    const searchableTexts = userTexts.length ? userTexts : [pageText];
    const normalize = value => String(value || '').normalize('NFKC').replace(/\s+/g,' ').trim().toLocaleLowerCase();
    const title = normalize(options.title);
    const doi = normalize(options.doi);
    const freshHomeSubmission = !!this.freshHomeSubmissionText
      && /^\/(?:g\/[a-zA-Z0-9_-]+\/)?c\/[a-zA-Z0-9_-]+/.test(doc.location.pathname || '')
      && userTexts.some(message => normalize(message).includes(normalize(this.freshHomeSubmissionText)));
    const paperMatch = !!title && searchableTexts.some(message => {
      const normalized = normalize(message);
      const hasPluginMarker = token ? normalized.includes(normalize(token)) : /论文分析编号\s*[:：]/.test(normalized);
      return hasPluginMarker && normalized.includes(title) && (!doi || normalized.includes(doi));
    });
    return {url:doc.location.href,authenticated:!login && !!(profile || doc.querySelector('a[href^="/c/"]')),editorReady:!!editor,hasDraft:!!text.trim(),draftTokenMatch:!!token && text.includes(token),hasMessages:!!users.length,markerFound:!!token && (userTexts.some(message=>message.includes(token)) || pageText.includes(token)),paperMatch,freshHomeSubmission,submittedToken:this.lastSubmittedToken || ''};
  }
  async initialize(data) {
    const clean = value => value.replace(/\s+/g,' ').trim();
    const doc = this.document;
    const expected = () => doc.location.protocol === 'https:' && doc.location.hostname === 'chatgpt.com' && doc.location.href.split(/[?#]/)[0] === data.expectedURL && doc.location.pathname === '/';
    if (!expected()) return {state:'wrong-conversation'};
    if (this.lastSubmittedToken === data.token) return {state:'already-submitted'};
    const info = this.inspect(data.token);
    if (!info.authenticated) return {state:'login-required'};
    if (info.hasMessages) return {state:'not-new-chat'};
    const editor = this.findEditor();
    if (!editor) return {state:'not-ready'};
    const actual = this.editorText(editor);
    if (actual.trim()) {
      if (!actual.includes(data.token)) return {state:'has-draft'};
      if (clean(actual) !== clean(data.text)) {
        const legacy = actual.includes('<论文资料>') && actual.includes('</论文资料>') && /【(?:PDF 正文|未提取到 PDF|设置中已关闭 PDF 正文|PDF 正文提取失败|未找到本地 PDF)/.test(actual);
        if (!data.replaceOwned || !legacy) return {state:'has-draft'};
        const replacement = this.receiveMessage({name:'draft',data:{...data,replaceOwned:true}});
        if (replacement.state !== 'filled') return replacement;
      }
    } else {
      const result = this.receiveMessage({name:'draft',data});
      if (result.state !== 'filled') return result;
    }
    await new Promise(resolve=>this.contentWindow.setTimeout(resolve,150));
    if (this.lastSubmittedToken === data.token) return {state:'already-submitted'};
    if (!expected() || !this.inspect().authenticated) return {state:'wrong-conversation'};
    const current = this.editorText(editor);
    if (clean(current) !== clean(data.text)) return {state:'has-draft'};
    const visible = el => el && !el.hidden && (!el.getClientRects || el.getClientRects().length);
    const sendSelectors = '[data-testid*="send" i],[id*="send" i],button[aria-label*="send" i],button[aria-label*="发送"],button[title*="send" i],button[title*="发送"]';
    const form = editor.closest?.('form');
    const directSend = doc.querySelector('[data-testid="send-button"],#composer-submit-button,button[aria-label="Send prompt"],button[aria-label="发送提示"],button[aria-label="发送消息"]');
    const send = [directSend, ...doc.querySelectorAll(sendSelectors), ...(form?.querySelectorAll('button[type="submit"]') || [])]
      .find(button => visible(button) && !button.disabled && button.getAttribute('aria-disabled') !== 'true');
    if (!send || send.disabled || send.getAttribute('aria-disabled') === 'true') return {state:'draft-ready'};
    this.lastSubmittedToken = data.token;
    send.click();
    // ChatGPT changes the home URL to /c/<id> after accepting the message.
    // Wait briefly so the parent can persist the generated conversation link
    // before the reader tab is switched or the sidebar is reopened.
    for (let i=0; i<20; i++) {
      const path = doc.location.pathname || '';
      if (/^\/(?:g\/[a-zA-Z0-9_-]+\/)?c\/[a-zA-Z0-9_-]+/.test(path)) {
        return {state:'submitted',url:doc.location.href.split(/[?#]/)[0]};
      }
      await new Promise(resolve=>this.contentWindow.setTimeout(resolve,200));
    }
    return {state:'submitted'};
  }
  receiveMessage({name, data}) {
    const doc = this.document;
    const location = doc.location;
    if (location.protocol !== 'https:') return {state:'wrong-origin'};
    if (name === 'login' && location.hostname === 'auth.openai.com') {
      const visible = selector => [...doc.querySelectorAll(selector)].find(el => !el.disabled && el.getClientRects().length);
      const password = visible('input[type="password"]');
      const email = visible('input[type="email"], input[name="username"]');
      const field = password || email;
      const value = password ? data.password : data.email;
      if (!field || !value) return {state:'manual'};
      const stage = password ? 'password' : 'email';
      this.loginStages ||= new Set();
      if (this.loginStages.has(stage)) return {state:'waiting'};
      const setter = Object.getOwnPropertyDescriptor(this.contentWindow.HTMLInputElement.prototype, 'value').set;
      setter.call(field, value);
      field.dispatchEvent(new this.contentWindow.Event('input', {bubbles:true}));
      field.dispatchEvent(new this.contentWindow.Event('change', {bubbles:true}));
      const submit = field.form?.querySelector('button[type="submit"]');
      if (submit && !submit.disabled) { this.loginStages.add(stage); submit.click(); }
      return {state:'login-filled'};
    }
    if (location.hostname !== 'chatgpt.com') return {state:'wrong-origin'};
    if (name === 'inspect') return this.inspect(data);
    if (name === 'initialize') return this.initialize(data);
    if (name === 'draft' && data.expectedURL && location.href.split(/[?#]/)[0] !== data.expectedURL) return {state:'wrong-conversation'};
    if (name === 'signin') {
      const login = doc.querySelector('[data-testid="login-button"], a[href^="/auth/login"]');
      if (login && !this.loginStarted) { this.loginStarted = true; login.click(); }
      return {state:login ? 'login-started' : 'ready'};
    }
    const editor = this.findEditor();
    if (!editor) return {state:'not-ready'};
    const existing = this.editorText(editor);
    if (name === 'status') return {state:existing.trim() ? 'has-draft' : 'ready'};
    if (name !== 'draft') return {state:'unknown'};
    if (existing.trim() && !(data.replaceOwned && data.token && existing.includes(data.token))) return {state:'has-draft'};
    editor.focus();
    if (editor.localName === 'textarea') {
      Object.getOwnPropertyDescriptor(this.contentWindow.HTMLTextAreaElement.prototype,'value').set.call(editor,data.text);
    } else {
      const selection = this.contentWindow.getSelection();
      const range = doc.createRange(); range.selectNodeContents(editor);
      selection.removeAllRanges(); selection.addRange(range);
      if (!doc.execCommand('insertText', false, data.text)) editor.textContent = data.text;
    }
    editor.dispatchEvent(new this.contentWindow.InputEvent('input',{bubbles:true,inputType:'insertText'}));
    const actual = this.editorText(editor);
    const normalized = value => value.replace(/\s+/g,' ').trim();
    return {state:normalized(actual) === normalized(data.text) ? 'filled' : 'failed'};
  }
}
