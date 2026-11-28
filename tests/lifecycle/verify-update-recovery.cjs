const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {UpdateRecovery,initialize}=require('../../src/lifecycle/recovery/update-recovery.cjs');
const {validId}=require('../../src/platform/observability/events.cjs');
const root=process.argv[2];
fs.mkdirSync(root,{recursive:true});
async function fixture(){
  const runtime=fs.mkdtempSync(path.join(root,'fixture-')),settings=path.join(runtime,'settings.json');
  const enable=value=>fs.writeFileSync(settings,JSON.stringify({recoverAfterUpdate:value}));
  enable(true);
  let clock=1000,now=Date.now(),current='26.1.1.0',running=[],fail=false,revoke=false;
  const observations=[],calls=[];
  const platform={discover:async()=>({packageVersion:current}),async desktops(){
    if(fail)throw Error('identity unavailable');
    if(revoke)enable(false);
    return running;
  }};
  const options={platform,launch:async file=>{
    const state=JSON.parse(fs.readFileSync(path.join(runtime,'update-recovery.json'),'utf8'));
    assert.equal(state.attemptedVersion,current);assert.equal(state.pendingVersion,null);
    assert.ok(validId(state.correlation_id));calls.push(file);
  },clock:()=>clock,now:()=>now,recordEvents:(file,source,correlation_id)=>({emit:(kind,status,context)=>observations.push({kind,context,correlation_id})})};
  const make=()=>new UpdateRecovery(settings,runtime,options);
  let monitor=make();
  await monitor.tick();
  return {runtime,settings,options,enable,observations,calls,
    get monitor(){return monitor;},restart(){monitor=make();},platform,
    async pump(ms=16000){clock+=ms;now+=ms;return monitor.tick();},
    upgrade({mains=1,age=110000}={}){current='26.1.2.0';running=Array.from({length:mains},(_,n)=>({pid:n+1,main:true,started:(now-age)/1000}));},
    old(){current='26.1.0.0';},fail(){fail=true;},revoke(){revoke=true;}};
}
test('establish baseline without prompting; disable/re-enable initializer is safe',async()=>{
  const f=await fixture();
  const baseline=await f.pump();assert.equal(baseline.phase,'baseline');assert.deepEqual(f.calls,[]);
  await initialize(f.settings,f.runtime,f.platform);
  assert.equal(JSON.parse(fs.readFileSync(f.monitor.path,'utf8')).observedVersion,'26.1.1.0');
  f.enable(false);f.upgrade();
  await initialize(f.settings,f.runtime,f.platform);
  assert.equal(JSON.parse(fs.readFileSync(f.monitor.path,'utf8')).observedVersion,'26.1.2.0');
});
test('persist and delegate once, with a stable correlation after monitor restart',async()=>{
  const f=await fixture();f.upgrade();
  const state=await f.pump();
  assert.equal(state.phase,'startup-check-delegated');assert.deepEqual(f.calls,[f.settings]);
  assert.equal(f.observations[0].correlation_id,state.correlation_id);
  f.restart();const restarted=await f.pump();
  assert.equal(restarted.correlation_id,state.correlation_id);assert.equal(f.calls.length,1);
});
test('wait for a single updated desktop',async()=>{
  const f=await fixture();
  for(const mains of [0,2]){
    f.upgrade({mains});assert.equal((await f.pump()).phase,'waiting-updated-desktop');assert.equal(f.calls.length,0);
  }
  f.upgrade();assert.equal((await f.pump()).phase,'startup-check-delegated');assert.equal(f.calls.length,1);
});
test('wait at least 15 seconds for the updated desktop',async()=>{
  const f=await fixture();f.upgrade({age:-10000});
  assert.equal((await f.pump()).phase,'waiting-updated-desktop');assert.equal(f.calls.length,0);
  assert.equal((await f.pump()).phase,'startup-check-delegated');assert.equal(f.calls.length,1);
});
test('identity failure does not delegate',async()=>{
  const f=await fixture();f.upgrade();f.fail();
  assert.equal((await f.pump()).phase,'recovery-check-unavailable');assert.equal(f.calls.length,0);
});
test('stop, opt-out, and opt-out while awaiting identity prevent delegation',async()=>{
  for(const mode of ['stop','disabled','revoked']){
    const f=await fixture();f.upgrade();
    if(mode==='stop')fs.writeFileSync(path.join(f.runtime,'stop'),'');
    else if(mode==='disabled')f.enable(false);
    else f.revoke();
    const state=await f.pump();assert.equal(state.phase,mode==='disabled'?'disabled':'waiting-updated-desktop');
    assert.equal(f.calls.length,0);
  }
});
test('failed write forbids spawn',async()=>{
  const f=await fixture();f.upgrade();
  fs.unlinkSync(f.monitor.path);fs.mkdirSync(f.monitor.path);
  assert.equal((await f.pump()).phase,'recovery-check-unavailable');assert.equal(f.calls.length,0);
});
test('failed launch cannot replay after supervisor restart',async()=>{
  const f=await fixture();f.upgrade();
  f.monitor.launch=async()=>{throw Error('fixture');};
  assert.equal((await f.pump()).phase,'recovery-check-unavailable');
  f.restart();assert.equal((await f.pump()).phase,'startup-check-delegated');assert.equal(f.calls.length,0);
});
test('downgrade creates a baseline, never a recovery prompt',async()=>{
  const f=await fixture();f.old();const state=await f.pump();
  assert.equal(state.phase,'baseline');assert.equal(state.observedVersion,'26.1.0.0');assert.equal(f.calls.length,0);
});
test('a fresh opt-in baseline supersedes a cached pending version even between polls',async()=>{
  const f=await fixture();
  f.upgrade({mains:0});assert.equal((await f.pump()).phase,'waiting-updated-desktop');
  f.enable(false);await initialize(f.settings,f.runtime,f.platform);f.enable(true);
  f.upgrade();assert.equal((await f.pump()).phase,'baseline');assert.equal(f.calls.length,0);
});
