/* Local file/folder import. Copies through Zotero; never moves source files. */
var fileImportRootURI = '', fileImportWindow = null, fileImportJob = null;
var fileImportChromeHandle = null;
var fileImportDropHooks = new Map();
var fileImportNotices = new Map();

function importFileType(path) {
  const extension = String(path).match(/\.([^.\\/]+)$/)?.[1].toLowerCase();
  return extension === 'pdf' ? 'application/pdf' : extension === 'epub' ? 'application/epub+zip' : null;
}
function importPathKey(path) {
  const normalized = String(path).replace(/[\\/]+/g,'/').replace(/\/$/,'');
  return Zotero.isWin ? normalized.toLowerCase() : normalized;
}
function checkFileImport(job) {
  if (stopped || job.cancelled) throw Object.assign(Error('已停止导入'),{name:'AbortError'});
}
function fileImportTarget(libraryID, collectionID = null) {
  const library = Zotero.Libraries.get(Number(libraryID));
  if (!library || library.libraryType === 'feed' || !library.editable || !library.filesEditable)
    throw Error('目标文库不允许添加文件，请选择可写文库。');
  const collection = collectionID ? Zotero.Collections.get(Number(collectionID)) : null;
  if (collectionID && (!collection || collection.deleted || collection.libraryID !== library.libraryID))
    throw Error('目标分类已删除或不属于当前文库，请重新选择。');
  return {libraryID:library.libraryID,collectionID:collection?.id || null};
}
function fileImportTargets() {
  const result = [];
  for (const library of Zotero.Libraries.getAll()) {
    if (library.libraryType === 'feed' || !library.editable || !library.filesEditable) continue;
    result.push({value:`${library.libraryID}:`,label:library.name});
    const collections = Zotero.Collections.getByLibrary(library.libraryID,true);
    const fullName = collection => {
      const parts = [collection.name],seen = new Set([collection.id]);
      while (collection.parentID) {
        collection = Zotero.Collections.get(collection.parentID);
        if (!collection || seen.has(collection.id)) break;
        seen.add(collection.id);parts.unshift(collection.name);
      }
      return [library.name,...parts].join(' / ');
    };
    for (const collection of collections) result.push({value:`${library.libraryID}:${collection.id}`,label:fullName(collection)});
  }
  return result;
}
function selectedFileImportTarget(win) {
  try {
    const id = win.ZoteroPane.getSelectedLibraryIDs()[0];
    const collection = win.ZoteroPane.getSelectedCollections()[0];
    fileImportTarget(id,collection?.id);
    return `${id}:${collection?.id || ''}`;
  } catch (_) { return `${Zotero.Libraries.userLibraryID}:`; }
}

async function scanFileImport(paths, job, notify = () => {}) {
  const plan = {files:[],directories:[],skipped:0,errors:[]},seen = new Set();
  const roots = [...new Set(paths.map(path => Zotero.File.pathToFile(path).path))].sort((a,b)=>a.length-b.length);
  async function visit(path, parents, depth) {
    checkFileImport(job);
    const key = importPathKey(path);if (seen.has(key)) return;seen.add(key);
    if (depth > 128 || seen.size > 100000) throw Error('目录层级过深或文件过多，请拆分导入。');
    try {
      // Do not follow links/junctions into a different folder or a cycle.
      const stat = await IOUtils.stat(path,{followLinks:false});checkFileImport(job);
      if (stat.type === 'symlink' || Zotero.File.pathToFile(path).isSymlink()) {plan.skipped++;return;}
      if (stat.type === 'directory') {
        const dirs = [...parents,PathUtils.filename(path) || '导入文件夹'];
        plan.directories.push(dirs);
        notify(`扫描文件夹：${dirs.join(' / ')}`);
        for (const child of (await IOUtils.getChildren(path)).sort()) await visit(child,dirs,depth+1);
      } else if (stat.type === 'regular' && importFileType(path)) {
        plan.files.push({path,dirs:parents,size:stat.size});
      } else plan.skipped++;
    } catch (error) {
      if (error.name === 'AbortError' || /目录层级过深/.test(error.message)) throw error;
      plan.errors.push({path,message:error.message});
    }
  }
  for (const path of roots) await visit(path,[],0);
  return plan;
}

async function hashImportFile(path, job) {
  checkFileImport(job);
  const before = await IOUtils.stat(path);
  const hash = Components.classes['@mozilla.org/security/hash;1'].createInstance(Components.interfaces.nsICryptoHash);
  hash.init(hash.SHA256);
  for (let offset = 0;offset < before.size;offset += 1024*1024) {
    checkFileImport(job);
    const bytes = await IOUtils.read(path,{offset,maxBytes:Math.min(1024*1024,before.size-offset)});
    if (!bytes.length) throw Error('读取文件不完整，请重试。');
    hash.update(bytes,bytes.length);
  }
  const after = await IOUtils.stat(path);checkFileImport(job);
  if (before.size !== after.size || before.lastModified !== after.lastModified) throw Error('文件正在被修改，请关闭编辑程序后重试。');
  return Array.from(hash.finish(false),char=>char.charCodeAt(0).toString(16).padStart(2,'0')).join('');
}
function importRecordForAttachment(attachment) {
  if (!attachment || attachment.deleted) return null;
  const item = attachment.parentItemID ? Zotero.Items.get(attachment.parentItemID) : attachment;
  return item && !item.deleted && item.libraryID === attachment.libraryID ? item : null;
}
async function buildImportIndex(libraryID, sizes, job, notify) {
  const index = new Map();
  const items = await Zotero.Items.getAll(libraryID,false,false);
  for (const attachment of items) {
    checkFileImport(job);
    if (!attachment.isAttachment() || !['application/pdf','application/epub+zip'].includes(attachment.attachmentContentType)
        || !importRecordForAttachment(attachment)) continue;
    try {
      const path = await attachment.getFilePathAsync();if (!path) continue;
      const stat = await IOUtils.stat(path);if (!sizes.has(stat.size)) continue;
      notify('检查文库中的相同文件…');
      const hash = await hashImportFile(path,job);
      const previous = index.get(hash);
      // Prefer a bibliographic record over a pre-existing standalone duplicate.
      if (!previous || (!previous.parentItemID && attachment.parentItemID)) index.set(hash,attachment);
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      // Missing/offline attachments cannot be compared. Keep them untouched.
      report(error);
    }
  }
  return index;
}
async function importFolderCollection(dirs, target, cache, job) {
  let parentID = target.collectionID;
  for (const name of dirs) {
    checkFileImport(job);fileImportTarget(target.libraryID,parentID);
    const key = JSON.stringify([parentID,name]);
    let collection = cache.get(key);
    if (!collection || collection.deleted) {
      const children = parentID ? Zotero.Collections.getByParent(parentID) : Zotero.Collections.getByLibrary(target.libraryID);
      collection = children.find(child=>!child.deleted && child.name === name);
      if (!collection) {
        collection = new Zotero.Collection();collection.libraryID = target.libraryID;
        collection.name = name;if (parentID) collection.parentID = parentID;
        await collection.saveTx();
      }
      cache.set(key,collection);
    }
    parentID = collection.id;
  }
  return parentID;
}
async function runFileImport(paths, destination, job, notify = () => {}, recognize = true) {
  if (fileImportJob) throw Error('已有导入任务正在进行，请等它完成。');
  const [libraryID,collectionID] = destination.split(':').map(Number);
  const target = fileImportTarget(libraryID,collectionID);fileImportJob = job;
  const result = {imported:0,reused:0,skipped:0,failed:0,cancelled:false,errors:[],itemIDs:[]},added = [];
  try {
    const plan = await scanFileImport(paths,job,notify);
    result.skipped = plan.skipped;result.errors.push(...plan.errors);result.failed = plan.errors.length;
    const index = await buildImportIndex(libraryID,new Set(plan.files.map(file=>file.size)),job,notify),collections = new Map();
    for (const dirs of plan.directories) await importFolderCollection(dirs,target,collections,job);
    for (let i=0;i<plan.files.length;i++) {
      const file = plan.files[i];checkFileImport(job);
      notify(`正在导入 ${i+1} / ${plan.files.length}：${PathUtils.filename(file.path)}`,i,plan.files.length);
      try {
        const hash = await hashImportFile(file.path,job);checkFileImport(job);
        const collection = await importFolderCollection(file.dirs,target,collections,job);
        fileImportTarget(libraryID,collection);checkFileImport(job);
        let attachment = index.get(hash),item = importRecordForAttachment(attachment);
        if (item) {
          // Collections belong to the bibliographic parent, not its child PDF.
          await item.loadDataType('collections');checkFileImport(job);
          if (collection && !item.inCollection(collection)) {item.addToCollection(collection);await item.saveTx();}
          result.reused++;
        } else {
          attachment = await Zotero.Attachments.importFromFile({file:file.path,libraryID,
            collections:collection?[collection]:undefined,contentType:importFileType(file.path),
            title:PathUtils.filename(file.path).replace(/\.(pdf|epub)$/i,'')});
          item = attachment;index.set(hash,attachment);added.push(attachment);result.imported++;
        }
        result.itemIDs.push(item.id);
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        result.failed++;result.errors.push({path:file.path,message:error.message});report(error);
      }
    }
    checkFileImport(job);
  } catch (error) {
    if (error.name === 'AbortError') result.cancelled = true;
    else throw error;
  } finally {
    if (fileImportJob === job) fileImportJob = null;
  }
  // Same opt-in preference as Zotero's native file import. Runs in background.
  if (recognize && added.length && !job.cancelled && !stopped)
    Promise.resolve().then(()=>Zotero.RecognizeDocument.autoRecognizeItems(added)).catch(report);
  return result;
}

function droppedImportPaths(transfer) {
  const paths = [];
  for (let i=0;i<(transfer?.mozItemCount || 0);i++) {
    try {
      const file = transfer.mozGetDataAt('application/x-moz-file',i)?.QueryInterface(Components.interfaces.nsIFile);
      if (file?.path) paths.push(file.path);
    } catch (_) { /* Other drag payloads, including Zotero items, are not files. */ }
  }
  return [...new Set(paths)];
}
async function chooseImportPaths(win, folder) {
  const {FilePicker} = ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs'),fp = new FilePicker();
  fp.init(win,folder?'选择要导入的文件夹':'选择论文文件',folder?fp.modeGetFolder:fp.modeOpenMultiple);
  if (!folder) fp.appendFilter('论文（PDF、EPUB）','*.pdf; *.epub');
  if (await fp.show() === fp.returnCancel) return [];
  return folder ? [fp.file] : fp.files;
}
function openFileImport(sourceWindow = Zotero.getMainWindow(), paths = []) {
  if (fileImportWindow && !fileImportWindow.closed) {
    fileImportWindow.focus();if (paths.length) fileImportWindow.enqueueImport?.(paths);return fileImportWindow;
  }
  const win = sourceWindow?.ZoteroPane ? sourceWindow : Zotero.getMainWindow();
  if (!fileImportChromeHandle) {
    const registry = Components.classes['@mozilla.org/addons/addon-manager-startup;1'].getService(Components.interfaces.amIAddonManagerStartup);
    fileImportChromeHandle = registry.registerChrome(Services.io.newURI(fileImportRootURI+'manifest.json'),
      [['content','chatgpt-reader-import','./']]);
  }
  const args = {paths,target:selectedFileImportTarget(win),targets:fileImportTargets,run:runFileImport,
    droppedPaths:droppedImportPaths,choose:chooseImportPaths,report,
    autoRecognize:!!Zotero.Prefs.get('autoRecognizeFiles')};
  fileImportWindow = win.openDialog('chrome://chatgpt-reader-import/content/file-import.xhtml','chatgpt-reader-import',
    'chrome,centerscreen,resizable,width=820,height=670',args);
  return fileImportWindow;
}
function addFileImportButton(win,target) {
  if (win.document.getElementById(PREFIX+'file-import')) return;
  const node = button(win.document,'导入文件',()=>openFileImport(win));node.id = PREFIX+'file-import';
  node.setAttribute('style','padding:4px 8px;min-width:88px!important;width:88px!important;flex-shrink:0;');
  node.setAttribute('tooltiptext','批量导入 PDF / EPUB，支持拖入整个文件夹');target?.prepend(node);
}
function droppedImportTarget(win, event) {
  const rowNode = event.target?.closest?.('[id^="collection-tree-row-"]');
  if (rowNode) {
    const index = Number(rowNode.id.match(/(\d+)$/)?.[1]),row = win.ZoteroPane.collectionsView.getRow(index);
    if (!row || (!row.isCollection() && !row.isLibrary())) throw Error('请拖到普通文库或分类，不能拖到回收站、搜索或订阅。');
    const libraryID = row.ref.libraryID,collectionID = row.isCollection()?row.ref.id:null;
    fileImportTarget(libraryID,collectionID);return `${libraryID}:${collectionID || ''}`;
  }
  return selectedFileImportTarget(win);
}
async function importFilesIntoWindow(win, paths, destination) {
  const doc = win.document,html = (tag,text)=>{const node=doc.createElementNS('http://www.w3.org/1999/xhtml',tag);if(text!==undefined)node.textContent=text;return node;};
  const previous = fileImportNotices.get(win);
  if (fileImportJob) {
    if (previous) previous.status.textContent = '导入正在进行，请完成后再次拖入。';
    else win.alert('已有导入任务正在进行，请完成后再次拖入。');
    return null;
  }
  previous?.root.remove();
  const root = html('section');root.id = PREFIX+'import-progress';root.setAttribute('role','status');root.setAttribute('aria-live','polite');
  root.style.cssText = 'position:fixed;bottom:22px;right:26px;z-index:10000;width:480px;max-width:85vw;padding:16px 18px;background:light-dark(#fff,#292c32);color:light-dark(#252a34,#eee);border:1px solid #98adc9;border-radius:10px;box-shadow:0 5px 24px #0002;font:14px system-ui;';
  const heading = html('strong','正在导入论文'),status = html('p','正在扫描文件…');status.style.cssText='margin:8px 0 12px;overflow-wrap:anywhere;line-height:1.5;';
  const cancel = html('button','停止导入'),close = html('button','关闭');close.hidden = true;
  for (const button of [cancel,close]) {button.type='button';button.style.cssText='padding:5px 12px;border:1px solid #98adc9;border-radius:5px;background:transparent;color:inherit;cursor:pointer;';}
  const details = html('details');details.hidden = true;details.append(html('summary','查看未导入的文件'));const errors=html('pre');errors.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;max-height:160px;overflow:auto;font-size:12px;';details.append(errors);
  root.append(heading,status,cancel,close,details);doc.documentElement.append(root);
  const job={cancelled:false},state={root,status,job};fileImportNotices.set(win,state);
  cancel.addEventListener('click',()=>{job.cancelled=true;cancel.disabled=true;status.textContent='正在停止，已完成的导入会保留…';});
  close.addEventListener('click',()=>{root.remove();if(fileImportNotices.get(win)===state)fileImportNotices.delete(win);});
  try {
    const result = await runFileImport(paths,destination,job,text=>{status.textContent=text;},true);
    heading.textContent=result.cancelled?'已停止导入':'导入完成';
    status.textContent=`新增 ${result.imported}，复用 ${result.reused}，跳过 ${result.skipped}，失败 ${result.failed}。`;
    if(result.errors.length){details.hidden=false;errors.textContent=result.errors.slice(0,50).map(error=>error.path+'\n'+error.message).join('\n\n');}
    return result;
  } catch(error) {heading.textContent='导入失败';status.textContent=error.message+'；已完成的导入会保留，可重新拖入重试。';report(error);return null;}
  finally {cancel.hidden=true;close.hidden=false;}
}
function installFileImportDrop(win) {
  if (fileImportDropHooks.has(win)) return;
  const drop = event => {
    if (win.Zotero_Tabs.selectedID !== 'zotero-pane' || event.altKey || event.shiftKey) return;
    const paths = droppedImportPaths(event.dataTransfer);
    if (!paths.some(path=>{try{return importFileType(path)||Zotero.File.pathToFile(path).isDirectory();}catch(_){return false;}})) return;
    event.preventDefault();event.stopImmediatePropagation();
    if (event.type === 'drop') run(()=>{
      let target;
      try {target=droppedImportTarget(win,event);}
      catch(error){report(error);win.alert('导入失败：'+error.message);return;}
      return importFilesIntoWindow(win,paths,target);
    });
    else event.dataTransfer.dropEffect = 'copy';
  };
  win.addEventListener('dragover',drop,true);win.addEventListener('drop',drop,true);fileImportDropHooks.set(win,drop);
}
function stopFileImportWindow(win) {
  const drop = fileImportDropHooks.get(win);
  if (drop) {win.removeEventListener('dragover',drop,true);win.removeEventListener('drop',drop,true);fileImportDropHooks.delete(win);}
  const notice=fileImportNotices.get(win);if(notice){notice.job.cancelled=true;notice.root.remove();fileImportNotices.delete(win);}
}
function stopFileImports() {
  if (fileImportJob) fileImportJob.cancelled = true;
  const cleanup = action=>{try{action();}catch(error){report(error);}};
  cleanup(()=>{if (fileImportWindow && !fileImportWindow.closed) fileImportWindow.close();});fileImportWindow = null;
  for (const win of [...fileImportDropHooks.keys()]) cleanup(()=>stopFileImportWindow(win));
  cleanup(()=>fileImportChromeHandle?.destruct());fileImportChromeHandle = null;
}
