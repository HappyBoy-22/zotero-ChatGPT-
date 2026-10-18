'use strict';
const vm = require('node:vm'), fs = require('node:fs'), assert = require('node:assert/strict');
const lib = require('../vendor/pdf-lib.min.js');
const env = vm.createContext({Number,Uint8Array,Map});
vm.runInContext(fs.readFileSync('margins.js','utf8'),env);
(async()=>{
  const pdf = await lib.PDFDocument.create();
  for (const angle of [0,90,180,270]) {
    const page = pdf.addPage([600,800]);
    page.setCropBox(20,30,540,730); page.setRotation(lib.degrees(angle));
    page.drawText('Original text',{x:30,y:100});
  }
  const input = await pdf.save(), before = Buffer.from(input);
  const output = await env.expandPDFMargins(input,25.4,lib);
  assert.deepEqual(Buffer.from(input),before,'input bytes never mutated');
  const expanded = await lib.PDFDocument.load(output);
  for (const [i,p] of expanded.getPages().entries()) {
    assert.equal(p.getRotation().angle,[0,90,180,270][i]);
    const crop = p.getCropBox();
    assert.deepEqual(crop,i%2?{x:20,y:-42,width:540,height:874}:{x:-52,y:30,width:684,height:730});
    const media = p.getMediaBox();
    assert.ok(media.x<=crop.x&&media.y<=crop.y&&media.x+media.width>=crop.x+crop.width&&media.y+media.height>=crop.y+crop.height);
  }
  for (const bad of [0,-1,151,'oops','',Infinity]) await assert.rejects(env.expandPDFMargins(input,bad,lib));
  await assert.rejects(env.expandPDFMargins(new Uint8Array([1,2,3]),50,lib));
  console.log('PASS: nonzero crop origins, all four rotations, page bounds, invalid widths, corrupt PDFs and source immutability');
})().catch(e=>{console.error(e);process.exitCode=1;});
