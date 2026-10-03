const test=require('node:test'), assert=require('node:assert/strict');
const C=require('../renderer/floatball-config');
test('floatball settings recover valid preferences and discard malformed persisted fields',()=>{
  const recovered=C.normalize({mode:'low',shape:'nuage',size:78,followAccent:false,color:'#AABBCC',expression:'hilare',opacity:-1,idle:'true',unknown:true});
  assert.equal(recovered.mode,'low');assert.equal(recovered.shape,'nuage');assert.equal(recovered.size,78);
  assert.equal(recovered.opacity,100);assert.equal(recovered.idle,true);assert.equal(recovered.color,'#AABBCC');
  assert.equal(Object.hasOwn(recovered,'unknown'),false);
  assert.deepEqual(C.normalize(null),C.defaults);
});
test('floatball IPC patches reject unsupported fields and invalid types or bounds',()=>{
  for(const patch of [null,[],{},true,{mode:'sleep'},{size:500},{opacity:NaN},{followAccent:1},{color:'url(x)'},{expression:'__proto__'},{shape:'constructor'},{__proto__:null,unknown:0},{clickExpression:'???'}]) assert.equal(C.validPatch(patch),false,JSON.stringify(patch));
  assert.equal(C.validPatch({...C.defaults,mode:'static',followAccent:false,color:'#ffffff'}),true);
  for(const key of ['clickExpression','contextExpression','hoverExpression','dragExpression'])assert.equal(C.validPatch({[key]:'heureux'}),true);
  assert.equal(C.validPatch({orientation:'front'}),true);
  assert.equal(C.validPatch({orientation:'right'}),false);
});

test('face looks inward in all screen corners and centers symmetrically',()=>{
  const {facingForPosition}=require('../main/floatball-motion');
  const area={x:-1920,y:200,width:1920,height:1080};
  const topLeft=facingForPosition({x:-1908,y:212},area);
  const bottomRight=facingForPosition({x:-132,y:1148},area);
  assert.ok(topLeft.yaw>0&&topLeft.pitch<0);
  assert.ok(bottomRight.yaw<0&&bottomRight.pitch>0);
  assert.deepEqual(facingForPosition({x:-1020,y:680},area),{yaw:0,pitch:-0});
});
test('native drag samples cursor independently, caches display bounds and keeps a fixed grab offset',()=>{
  const {NativeFloatballDrag}=require('../main/floatball-motion');
  let cursor={x:450,y:350},reads=0,tick,cancelled=false;
  const positions=[];
  const drag=new NativeFloatballDrag({getCursor:()=>cursor,getAreas:()=>{reads++;return [{x:0,y:0,width:1920,height:1080}]},move:p=>positions.push(p),every:(fn,ms)=>{assert.ok(ms<=1000/60);tick=fn;return 7;},cancel:id=>{assert.equal(id,7);cancelled=true;}});
  drag.start({x:400,y:300},{x:450,y:350});
  for(let i=0;i<40;i++){cursor={x:450+i*3,y:350+i*2};tick();}
  assert.equal(reads,1);assert.deepEqual(positions.at(-1),{x:517,y:378});
  const count=positions.length;tick();assert.equal(positions.length,count);
  drag.stop();assert.equal(cancelled,true);assert.equal(drag.timer,null);
});
test('drag clamps across negative-origin displays without trapping the ball on the first screen',()=>{
  const {clampToAreas}=require('../main/floatball-motion');
  const areas=[{x:-1920,y:0,width:1920,height:1080},{x:0,y:0,width:2560,height:1440}];
  assert.deepEqual(clampToAreas({x:-1800,y:200},areas),{x:-1800,y:200});
  assert.deepEqual(clampToAreas({x:1200,y:900},areas),{x:1200,y:900});
  assert.deepEqual(clampToAreas({x:4000,y:4000},areas),{x:2428,y:1308});
});
test('new preference IPC keeps main and float permissions separate',()=>{
  const {guardedIpc}=require('../main/ipc-security');
  const calls=new Map(), results=[];
  const frame=file=>({url:require('url').pathToFileURL(require('path').resolve(file)).href});
  const win={isDestroyed:()=>false,webContents:{mainFrame:frame('index.html')}},ball={isDestroyed:()=>false,webContents:{mainFrame:frame('floatball.html')}};
  const ipc={handle:(name,fn)=>calls.set(name,fn),on:()=>{}};
  const guard=guardedIpc(ipc,{getWindow:()=>win,getFloat:()=>ball,indexFile:require('path').resolve('index.html'),floatFile:require('path').resolve('floatball.html')});
  guard.handle('get-floatball-settings',()=>results.push('main'));
  guard.handle('float-ball-get-settings',()=>results.push('ball'));
  const event=window=>({sender:window.webContents,senderFrame:window.webContents.mainFrame});
  calls.get('get-floatball-settings')(event(ball));
  calls.get('float-ball-get-settings')(event(win));
  assert.deepEqual(results,[]);
  calls.get('get-floatball-settings')(event(win));calls.get('float-ball-get-settings')(event(ball));
  assert.deepEqual(results,['main','ball']);
});
