'use strict';
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const env=vm.createContext({Map});
vm.runInContext(fs.readFileSync('rectangles.js','utf8'),env);
const rect=(a,b,box=[-100,20,600,800])=>env.rectangleAnnotation(a,b,box,3,'#123456',2.5);
const a=rect([40,120],[-30,60]);
assert.equal(a.type,'ink');assert.equal(a.color,'#123456');assert.equal(a.position.width,2.5);assert.equal(a.position.pageIndex,3);
assert.deepEqual(JSON.parse(JSON.stringify(a.position.paths)),[[-30,60,40,60,40,120,-30,120,-30,60]]);
assert.equal(a.sortIndex,'00003|000000|00680');
const clipped=rect([-300,0],[900,900]);
assert.deepEqual(JSON.parse(JSON.stringify(clipped.position.paths)),[[-100,20,600,20,600,800,-100,800,-100,20]]);
assert.equal(rect([50,50],[51,90]),null);assert.equal(rect([50,50],[50,50]),null);
assert.equal(rect([800,900],[1000,1200]),null);
console.log('PASS: closed native ink outline, reverse dragging, negative margins, page clipping, styling and click/degenerate rejection');
for(const [start,end]of [[[0,0],[100,0]],[[50,100],[50,0]],[[-50,50],[30,120]],[[50,50],[-50,50]]]) {
  const a=env.arrowAnnotation(start,end,[-100,0,200,200],0,'#abcdef',3);
  assert.deepEqual(JSON.parse(JSON.stringify(a.position.paths[0])),[...start,...end]);
  const head=a.position.paths[1];assert.equal(head.length,6);assert.equal(head[2],end[0]);assert.equal(head[3],end[1]);
  for(const [x,y]of [[head[0],head[1]],[head[4],head[5]]])assert.ok((x-end[0])*(end[0]-start[0])+(y-end[1])*(end[1]-start[1])<0,'arrow wings point behind the tip');
}
assert.equal(env.arrowAnnotation([0,0],[0,0],[0,0,100,100],0,'#000000',2),null);
const clippedArrow=env.arrowAnnotation([50,50],[500,500],[0,0,100,100],0,'#000000',2);
for(const path of clippedArrow.position.paths)assert.ok(path.every(v=>v>=0&&v<=100));
console.log('PASS: arrow direction, reverse/vertical/diagonal drags, arrowhead geometry, page boundaries and empty-click rejection');

const outline=rect([-30,60],[40,120]),plain=v=>JSON.parse(JSON.stringify(v));
const bounds=position=>plain(env.rectangleBounds({type:'ink',position}));
assert.deepEqual(bounds(outline.position),[-30,60,40,120]);
for(const [dir,dx,dy,expected]of [
  ['tr',30,0,[-30,60,70,120]],['tr',0,25,[-30,60,40,145]],
  ['bl',-20,-10,[-50,50,40,120]],['tl',-10,40,[-40,60,40,160]],
  ['br',40,-30,[-30,30,80,120]],['tr',-500,-500,[-30,60,-29,61]]
]){
  const resized=env.resizeRectanglePosition(outline,dir,dx,dy);
  assert.deepEqual(bounds(resized),expected);
  assert.equal(resized.width,2.5,'resizing leaves stroke width unchanged');
  assert.equal(resized.pageIndex,3);assert.deepEqual(bounds(outline.position),[-30,60,40,120],'source position is immutable');
}
for(const paths of [[[0,0,20,10,40,20,0,30,0,0]],[[0,0,40,30,0,30,40,0,0,0]],[[0,0,20,0,20,20,0,20]],[[0,0,20,0,20,20,0,20,0,0],[3,3]]]){
  assert.equal(env.resizeRectanglePosition({type:'ink',position:{paths}},'tr',10,20),null,'freehand, crossed paths and erased/multiple paths retain native behavior');
}
assert.equal(env.resizeRectanglePosition(clippedArrow,'tr',10,20),null);
assert.equal(env.resizeRectanglePosition({...outline,type:'image'},'tr',10,20),null);
assert.equal(env.resizeRectanglePosition(outline,'tr',NaN,20),null);
console.log('PASS: independent width/height and all corner directions, minimum size, old outlines, fixed line width and unrelated annotation exclusion');
