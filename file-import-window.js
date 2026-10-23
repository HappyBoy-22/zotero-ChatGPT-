/* UI for the trusted local importer window. All filenames render as text. */
window.addEventListener('load',()=>{
  const api = window.arguments[0],get = id=>document.getElementById(id);
  const destination = get('destination'),zone = get('drop-zone'),status = get('status'),log = get('log');
  const buttons = [get('choose-files'),get('choose-folder')],recognize = get('recognize'),cancel = get('cancel');
  let job = null;
  function refreshTargets() {
    const selected = destination.value || api.target;destination.replaceChildren();
    for (const target of api.targets()) {
      const option = document.createElementNS('http://www.w3.org/1999/xhtml','option');
      option.value = target.value;option.textContent = target.label;destination.append(option);
    }
    if ([...destination.options].some(option=>option.value===selected)) destination.value = selected;
    if (!destination.options.length) {status.textContent = '没有可添加文件的文库。';buttons.forEach(button=>button.disabled=true);}
  }
  window.enqueueImport = async paths=>{
    if (!paths.length) return;
    if (job) {status.textContent = '已有导入任务正在进行，请完成后再次拖入。';return;}
    refreshTargets();if (!destination.value) return;
    job = {cancelled:false};const currentJob = job;
    buttons.forEach(button=>button.disabled=true);destination.disabled = recognize.disabled = true;
    get('progress-row').hidden = false;cancel.disabled = false;get('progress').removeAttribute('value');log.textContent = '';
    try {
      const result = await api.run(paths,destination.value,job,(text,done,total)=>{
        if (window.closed) return;status.textContent = text;
        if (total) {get('progress').max = total;get('progress').value = done;}
      },recognize.checked);
      if (window.closed) return;
      status.textContent = `${result.cancelled?'已停止':'导入完成'}：新增 ${result.imported}，复用 ${result.reused}，跳过 ${result.skipped}，失败 ${result.failed}。`;
      log.textContent = result.errors.slice(0,50).map(error=>`${error.path}\n${error.message}`).join('\n\n');
    } catch (error) {
      if (!window.closed) {status.textContent = '导入失败：'+error.message+'。已完成的导入会保留，可重试。';api.report(error);}
    } finally {
      if (job===currentJob) job = null;
      if (!window.closed) {buttons.forEach(button=>button.disabled=false);destination.disabled = recognize.disabled = false;get('progress-row').hidden = true;}
    }
  };
  async function choose(folder) {
    if (job) return;
    try {await window.enqueueImport(await api.choose(window,folder));}
    catch (error) {status.textContent = '选择文件失败：'+error.message;api.report(error);}
  }
  buttons[0].addEventListener('click',()=>choose(false));buttons[1].addEventListener('click',()=>choose(true));
  cancel.addEventListener('click',()=>{if(job)job.cancelled=true;cancel.disabled=true;status.textContent='正在停止，已导入的论文会保留…';});
  // Prevent the chrome window from navigating to dropped files, even outside the zone.
  window.addEventListener('dragover',event=>{event.preventDefault();event.dataTransfer.dropEffect=job?'none':'copy';zone.classList.add('active');});
  window.addEventListener('dragleave',event=>{if (!event.relatedTarget) zone.classList.remove('active');});
  window.addEventListener('drop',event=>{event.preventDefault();event.stopPropagation();zone.classList.remove('active');
    const paths=api.droppedPaths(event.dataTransfer);if(paths.length)window.enqueueImport(paths);else status.textContent='请从系统文件管理器拖入文件或文件夹。';});
  window.addEventListener('unload',()=>{if(job)job.cancelled=true;},{once:true});
  recognize.checked=api.autoRecognize;refreshTargets();
  if (api.paths.length) window.enqueueImport(api.paths);
},{once:true});
