/* Loaded by Zotero's native preferences pane sandbox. */
setTimeout(function initReaderPreferences() {
  const root = document.getElementById('chatgpt-reader-prefs');
  if (!root) { setTimeout(initReaderPreferences,50); return; }
  if (root.dataset.initialized) return;
  root.dataset.initialized = 'true';
  const api = Zotero.ChatGPTReader;
  const $ = id => document.getElementById('cr-' + id);
  const get = (key,fallback) => Zotero.Prefs.get('chatgptReader.' + key) ?? fallback;
  $('margin-width').value = api.getMarginWidth();
  $('save-margins').addEventListener('click',()=>{
    try { api.saveMarginWidth($('margin-width').value); $('margin-status').textContent = '已保存。回到原 PDF 点击“两侧留白”即可创建或打开副本。'; }
    catch (e) { $('margin-status').textContent = e.message; }
  });
  const annotationFields = {textSize:'text-size',textColor:'text-color',inkSize:'ink-size',inkColor:'ink-color',eraserSize:'eraser-size'};
  const fillAnnotations = settings => { for (const [key,id] of Object.entries(annotationFields)) $(id).value = settings[key]; };
  const readAnnotations = () => Object.fromEntries(Object.entries(annotationFields).map(([key,id])=>[key,$(id).value]));
  fillAnnotations(api.getAnnotationSettings());
  $('save-annotations').addEventListener('click',() => {
    try { api.saveAnnotationSettings(readAnnotations()); $('annotation-status').textContent = '已保存。下次使用快捷键创建批注时生效。'; }
    catch (e) { $('annotation-status').textContent = e.message; }
  });
  $('reset-annotations').addEventListener('click',() => {
    api.saveAnnotationSettings(api.ANNOTATION_DEFAULTS); fillAnnotations(api.getAnnotationSettings());
    $('annotation-status').textContent = '已恢复默认样式：文本 14 pt 黑色，画笔 2 pt 红色，橡皮擦 16 pt。';
  });
  $('prompt').value = get('prompt',api.DEFAULT_PROMPT);
  $('auto').checked = get('autoStart',true);
  $('login').checked = get('autoLogin',false);
  api.savedLogin().then(login => {
    $('email').value = login?.username || '';
    $('login-state').textContent = login ? '已保存登录信息；密码不会在此回显。' : '尚未保存账号密码。';
  }).catch(() => { $('login-state').textContent = '密码管理器暂不可用，可直接在官网手动登录。'; });
  $('save').addEventListener('click',async () => {
    try {
      const annotationSettings = api.normalizeAnnotationSettings(readAnnotations(),true);
      if ($('password').value) {
        if (!$('email').value.trim()) throw new Error('请填写邮箱。');
        await api.saveLogin($('email').value.trim(),$('password').value);
      }
      if ($('login').checked) {
        const login = await api.savedLogin();
        if (!login || login.username !== $('email').value.trim()) throw new Error('请先保存对应账号的邮箱和密码。');
      }
      for (const [name,value] of Object.entries({prompt:$('prompt').value,autoStart:$('auto').checked,autoLogin:$('login').checked})) Zotero.Prefs.set('chatgptReader.'+name,value);
      api.saveAnnotationSettings(annotationSettings);
      $('password').value = '';
      $('status').textContent = '已保存设置和批注样式。新样式用于下次快捷键创建的批注；已有对话不会重复发送。';
    } catch (e) { $('status').textContent = e.message; }
  });
  $('open').addEventListener('click',()=>api.open());
  $('forget').addEventListener('click',async () => {
    try {
      await api.forgetLogin();
      Zotero.Prefs.set('chatgptReader.autoLogin',false);
      $('login').checked = false; $('password').value = ''; $('email').value = '';
      $('login-state').textContent = '已删除保存的账号密码；官网现有登录状态不受影响。';
    } catch (e) { $('status').textContent = e.message; }
  });
},0);
