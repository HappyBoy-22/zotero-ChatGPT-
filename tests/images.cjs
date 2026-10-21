'use strict';
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const lib=require('../vendor/pdf-lib.min.js');
const disk=new Map(),writes=[],errors=[];
const env=vm.createContext({Uint8Array,Number,Map,Set,PathUtils:{join:path.join,parent:path.dirname},
  Zotero:{DataDirectory:{dir:'/library'},getMainWindow:()=>({alert(){}})},report:e=>errors.push(e),
  IOUtils:{exists:async p=>disk.has(p),readJSON:async p=>disk.get(p),makeDirectory:async()=>{},writeJSON:async(p,d)=>{await new Promise(r=>setTimeout(r,2));disk.set(p,d);writes.push(d.images.length);}}
});
vm.runInContext(fs.readFileSync('images.js','utf8'),env);
const plain=v=>JSON.parse(JSON.stringify(v));
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH90AAAAASUVORK5CYII=';
const image={id:'image-1',pageIndex:0,rect:[-40,20,160,120],rotation:0,ratio:2,src:png};
assert.ok(env.validPicture(image));
for(const override of [{src:'https://example.com/tracker.png'},{src:'data:image/svg+xml;base64,PHN2Zz4='},{pageIndex:-1},{rect:[0,0,0,3]},{rect:[0,0,NaN,4]},{rotation:45},{id:'../bad'}])assert.ok(!env.validPicture({...image,...override}));
assert.deepEqual(plain(env.pictureBox([10,20,110,70],'se',60,0,[0,0,400,500])),[10,20,170,70]);
assert.deepEqual(plain(env.pictureBox([10,20,110,70],'s',0,40,[0,0,400,500])),[10,20,110,110]);
assert.deepEqual(plain(env.pictureBox([10,20,110,70],'move',-80,900,[0,0,400,500])),[0,450,100,500]);
assert.deepEqual(plain(env.pictureBox([10,20,110,70],'nw',200,200,[0,0,400,500])),[102,62,110,70]);
for(const rotate of [0,90,180,270]){
  const viewport={convertToViewportPoint:(x,y)=>rotate===0?[x+100,800-y]:rotate===90?[y,x+100]:rotate===180?[700-x,y]:[800-y,700-x],
    convertToPdfPoint:(x,y)=>rotate===0?[x-100,800-y]:rotate===90?[y-100,x]:rotate===180?[700-x,y]:[700-y,800-x]};
  assert.deepEqual(plain(env.picturePDFRect(env.pictureViewportRect(image,{viewport}),{viewport})),image.rect,'negative margins and rotated viewport round-trip');
}
(async()=>{
  const item={libraryID:1,key:'ABCDEFG2'},other={libraryID:1,key:'ABCDEFG3'};
  const model=await env.pictureDocument(item);assert.equal(await env.pictureDocument(item),model,'same PDF shares a model');
  assert.notEqual(await env.pictureDocument(other),model,'different attachments retain independent images');
  model.images.push(image);const first=env.savePictures(model);model.images.push({...image,id:'image-2'});await env.savePictures(model);await first;
  assert.deepEqual(writes,[1,2],'ordered immutable snapshots');assert.equal(disk.get(model.path).images.length,2);
  env.imageDocuments.clear();assert.equal((await env.pictureDocument(item)).images.length,2,'reload restores image bytes and position');
  disk.set(env.picturePath(other),{version:1,images:[{src:'file:///private'}]});env.imageDocuments.clear();await assert.rejects(env.pictureDocument(other),/损坏/);
  assert.throws(()=>env.picturePath({libraryID:1,key:'../bad'}));
  const pdf=await lib.PDFDocument.create();for(const angle of [0,90,180,270]){const p=pdf.addPage([600,800]);p.setCropBox(-60,0,660,800);p.setRotation(lib.degrees(angle));}
  const bytes=await pdf.save(),before=Buffer.from(bytes);
  const pictures=[0,90,180,270].map((rotation,pageIndex)=>({...image,id:'image-'+pageIndex,rotation,pageIndex}));
  const out=await env.embedPictures(bytes,pictures,lib),loaded=await lib.PDFDocument.load(out);
  assert.deepEqual(Buffer.from(bytes),before,'export leaves original bytes unchanged');
  for(const [i,page]of loaded.getPages().entries()){assert.equal(page.getRotation().angle,i*90);assert.ok(page.node.Resources().lookup(lib.PDFName.of('XObject')).keys().length>0,'exported PDF contains embedded image objects');}
  const calls=[],fake={PDFDocument:{load:async()=>({getPageCount:()=>4,embedPng:async()=>({}),getPage:()=>({drawImage:(_,o)=>calls.push(o)}),save:async()=>new Uint8Array()})},degrees:x=>x};
  await env.embedPictures(bytes,pictures,fake);
  assert.deepEqual(calls.map(c=>[c.x,c.y,c.width,c.height,c.rotate]),[[-40,20,200,100,0],[160,20,100,200,90],[160,120,200,100,180],[-40,120,100,200,270]]);
  await assert.rejects(env.embedPictures(bytes,[{...image,pageIndex:50}],lib));
  console.log('PASS: image validation, independent resizing, bounds, rotations, durable ordered per-PDF storage, corruption protection and real PDF image export');
})().catch(e=>{console.error(e);process.exitCode=1;});
