/* Expanded PDF snapshots; source files and annotations are never rewritten. */
var marginRootURI = '', marginLibrary = null;
var marginJobs = new Map();
function marginWidth(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 10 || n > 150) throw new Error('每侧留白宽度请输入 10–150 毫米。');
  return n;
}
function getMarginWidth() {
  try { return marginWidth(Zotero.Prefs.get('chatgptReader.marginWidth') ?? 50); }
  catch (_) { return 50; }
}
function saveMarginWidth(value) {
  Zotero.Prefs.set('chatgptReader.marginWidth',String(marginWidth(value)));
  Services.prefs.savePrefFile(null);
}
function marginPDFLibrary() {
  if (!marginLibrary) {
    marginLibrary = new Components.utils.Sandbox(Services.scriptSecurityManager.getSystemPrincipal(),{sandboxName:'ChatGPT Reader PDF margins',wantXrays:false});
    marginLibrary.setTimeout = setTimeout;
    marginLibrary.console = {log(){},warn(){},error(){}};
    Services.scriptloader.loadSubScript(marginRootURI+'vendor/pdf-lib.min.js',marginLibrary);
  }
  return marginLibrary;
}
async function expandPDFMargins(bytes,widthMM,lib) {
  const width = marginWidth(widthMM)*72/25.4;
  const pdf = await lib.PDFDocument.load(bytes,{updateMetadata:false});
  for (const page of pdf.getPages()) {
    const crop = page.getCropBox(), media = page.getMediaBox();
    const sideways = Math.abs(page.getRotation().angle % 180) === 90;
    const x = crop.x-(sideways?0:width), y = crop.y-(sideways?width:0);
    const w = crop.width+(sideways?0:width*2), h = crop.height+(sideways?width*2:0);
    const mx = Math.min(media.x,x), my = Math.min(media.y,y);
    page.setMediaBox(mx,my,Math.max(media.x+media.width,x+w)-mx,Math.max(media.y+media.height,y+h)-my);
    page.setCropBox(x,y,w,h);
    // Mask newly exposed artwork outside the old crop box with white strips.
    const strips = sideways
      ? [{x,y,width:w,height:width},{x,y:crop.y+crop.height,width:w,height:width}]
      : [{x,y,width,height:h},{x:crop.x+crop.width,y,width,height:h}];
    for (const strip of strips) page.drawRectangle({...strip,color:lib.rgb(1,1,1),borderWidth:0});
  }
  return pdf.save();
}
async function createMarginCopy(win = Zotero.getMainWindow()) {
  let source = currentItem(win);
  if (source && !source.isAttachment()) source = (source.getAttachments?.() || []).map(id=>Zotero.Items.get(id)).find(item=>item.isPDFAttachment());
  if (!source?.isPDFAttachment()) throw new Error('请先打开或选择一份 PDF 附件。');
  const library = Zotero.Libraries.get(source.libraryID);
  if (!library.editable || !library.filesEditable) throw new Error('当前文库不允许添加附件。');
  const identity = source.libraryID+'.'+source.key;
  if (Zotero.Prefs.get('chatgptReader.marginSource.'+identity)) { await Zotero.Reader.open(source.id); return source; }
  if (marginJobs.has(identity)) return marginJobs.get(identity);
  const job = (async () => {
    const width = getMarginWidth(), pref = 'chatgptReader.marginCopy.'+identity+'.'+width;
    const existingID = Zotero.Prefs.get(pref), existing = existingID && Zotero.Items.get(existingID);
    if (existing && !existing.deleted) {
      const path = await existing.getFilePathAsync();
      if (path && await IOUtils.exists(path)) { await Zotero.Reader.open(existing.id); return existing; }
    }
    const path = await source.getFilePathAsync();
    if (!path || !await IOUtils.exists(path)) throw new Error('PDF 文件不在本机，请先下载附件。');
    const directory = Zotero.getTempDirectory();
    directory.append('chatgpt-reader-margins');
    directory.createUnique(Components.interfaces.nsIFile.DIRECTORY_TYPE,0o700);
    const input = directory.clone(); input.append('source.pdf');
    const output = directory.clone(); output.append('留白笔记.pdf');
    try {
      await Zotero.PDFWorker.export(source.id,input.path,true,undefined,false);
      const sandbox = marginPDFLibrary();
      const bytes = Components.utils.cloneInto(await IOUtils.read(input.path),sandbox);
      const expanded = await expandPDFMargins(bytes,width,sandbox.PDFLib);
      await IOUtils.write(output.path,new Uint8Array(expanded));
      const copy = await Zotero.Attachments.importFromFile({file:output.path,libraryID:source.libraryID,
        parentItemID:source.parentItemID || undefined,collections:source.parentItemID?undefined:source.getCollections(),
        title:(source.getField('title') || 'PDF')+' · 两侧留白 '+width+' mm'});
      Zotero.Prefs.set(pref,copy.id);
      Zotero.Prefs.set('chatgptReader.marginSource.'+copy.libraryID+'.'+copy.key,source.key);
      Services.prefs.savePrefFile(null);
      await Zotero.Reader.open(copy.id);
      return copy;
    } finally { await IOUtils.remove(directory.path,{recursive:true}); }
  })();
  marginJobs.set(identity,job);
  try { return await job; } finally { marginJobs.delete(identity); }
}
function openMarginCopy(win) {
  createMarginCopy(win).catch(error=>{ report(error); win.alert('创建留白副本失败：'+error.message); });
}
