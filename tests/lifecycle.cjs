const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const errors=[],calls=[];
const env=vm.createContext({Zotero:{logError:e=>errors.push(e)},Map,Set});
vm.runInContext(fs.readFileSync('bootstrap.js','utf8'),env);
env.stopPDFGestures=()=>{calls.push('gestures');throw Error('dead object');};
env.stopReaderWindows=()=>calls.push('readers');env.unregisterAssistant=()=>calls.push('api');
env.onMainWindowUnload=({window})=>{calls.push(window);if(window===1)throw Error('closed window');};
vm.runInContext('mainWindows.add(1);mainWindows.add(2)',env);env.shutdown();
assert.deepEqual(calls,['gestures','readers','api',1,2]);
assert.equal(vm.runInContext('mainWindows.size',env),0);

let timerCleared=false,secondCleaned=false;
const gestures=vm.createContext({clearInterval:()=>timerCleared=true,report:e=>errors.push(e),stopRectangleTools(){throw Error('dead shape frame');}});
vm.runInContext(fs.readFileSync('gestures.js','utf8'),gestures);
gestures.pdfGestureBindings.set(1,()=>{throw Error('dead PDF frame');});gestures.pdfGestureBindings.set(2,()=>secondCleaned=true);
gestures.stopPDFGestures();assert.ok(timerCleared&&secondCleaned);assert.equal(gestures.pdfGestureBindings.size,0);

const panes=new Map(),sandbox={
  stopped:false,report:e=>errors.push(e),getMarginWidth(){},saveMarginWidth(){},createMarginCopy(){},
  ANNOTATION_DEFAULTS:{},getAnnotationSettings(){},saveAnnotationSettings(){},normalizeAnnotationSettings(){},
  Components:{interfaces:{nsIResProtocolHandler:{}}},Services:{io:{getProtocolHandler:()=>({QueryInterface:()=>({setSubstitution(){}})}),newURI:x=>x}},
  ChromeUtils:{unregisterWindowActor(){},registerWindowActor(){throw Error('actor unavailable');}},
  Zotero:{PreferencePanes:{unregister:id=>panes.delete(id),register:async p=>{panes.set(p.id,p);return p.id;}}}
};
const analysis=vm.createContext(sandbox);vm.runInContext(fs.readFileSync('analysis.js','utf8'),analysis);
(async()=>{
  await assert.rejects(analysis.registerAssistant('test','file:///plugin/'),/actor unavailable/);
  assert.ok(analysis.Zotero.ChatGPTReader,'settings API survives optional actor failure');
  assert.ok(panes.has('chatgpt-reader-preferences'),'native settings pane survives optional actor failure');
  const replacement={version:'new'};analysis.Zotero.ChatGPTReader=replacement;
  analysis.unregisterAssistant();assert.equal(analysis.Zotero.ChatGPTReader,replacement,'late old shutdown must not remove new API');
  assert.ok(panes.has('chatgpt-reader-preferences'),'late old shutdown must not unregister the new pane');
  console.log('PASS: exhaustive shutdown after dead windows, timers stopped before fragile cleanup, settings independent of actor, late shutdown ownership');
})().catch(e=>{console.error(e);process.exitCode=1;});
