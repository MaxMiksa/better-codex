const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createRecovery,fileFor}=require('../../src/lifecycle/recovery/relaunch.cjs');
const {atomic,read,stateFor}=require('../../src/platform/paths.cjs');
const dir=process.argv[2];fs.mkdirSync(dir,{recursive:true});
const version='9.1.2.3',pkg={packageVersion:version,sha256:'fixture-hash'};
const original={pid:101,created:'133344445555000001',started:10,main:true};
const healthy={state:'pass'},fault={state:'warning',restartRecommended:true};
function fixture(options={}){
  const root=fs.mkdtempSync(path.join(dir,'relaunch-')),file=path.join(root,'.runtime/settings.json');
  const put=(target,data)=>atomic(target,JSON.stringify(data));
  put(file,{port:19163,node:process.execPath,runAsAdministrator:true});
  const f={file,root,pkg:{...pkg},desktops:[{...original}],calls:[],activity:'idle',now:1000000,port:19163,put,
    settings:()=>read(file),state:()=>read(fileFor(file))};
  f.worker=createRecovery({
    platform:{discover:async()=>({...f.pkg}),desktops:async()=>f.desktops},
    preflight:async settings=>{assert.ok(settings.port>=1024);if(f.dependencyMissing)throw Error('missing');},
    activity:async()=>({state:f.activity,activeCount:f.activity==='busy'?1:0}),
    close:async target=>{f.calls.push('close');assert.deepEqual(target,original);
      if(f.veto)return {ok:false};if(!f.stuck)f.desktops=[];return {ok:true};},
    start:async()=>{f.calls.push('start');if(f.rebase)put(file,{...read(file),port:f.rebase});return {exitCode:f.launchFailure?1:null};},
    verified:async(_p,settings)=>settings.port===f.port&&!f.launchFailure,
    delay:async n=>{f.now+=n;},clock:()=>f.now,emit:()=>{},...options});
  return f;
}
test('healthy, unknown, and unconfirmed failure do not arm',async()=>{
  const f=fixture();
  for(const enhancement of [healthy,{state:'unknown'},{state:'warning'}]){
    const plan=await f.worker.prepare(f.file,pkg,enhancement);assert.equal(plan.automatic,false);assert.equal(plan.needed,false);
  }
});
test('confirmed failure arms; current active/unknown work cancels and persists',async()=>{
  for(const value of ['busy','unknown']){
    const f=fixture();assert.equal((await f.worker.prepare(f.file,pkg,fault)).automatic,true);
    f.activity=value;
    const blocked=await f.worker.prepare(f.file,pkg,fault);
    assert.equal(blocked.allowed,false);assert.equal(blocked.cancelledForActivity,true);
    f.activity='idle';assert.equal((await f.worker.prepare(f.file,pkg,fault)).automatic,false);
    assert.deepEqual(f.calls,[]);
  }
});
test('update detection, cancellation, and plugin episode are separate',async()=>{
  const f=fixture();await f.worker.prepare(f.file,{...pkg,packageVersion:'9.1.2.2'},healthy);
  const plan=await f.worker.prepare(f.file,pkg,healthy);assert.equal(plan.reason,'updated');assert.equal(plan.automatic,true);
  await f.worker.cancel(f.file,plan.key);
  assert.equal((await f.worker.prepare(f.file,pkg,healthy,true)).automatic,false);
  assert.equal((await f.worker.prepare(f.file,pkg,fault)).automatic,true);
  await f.worker.cancel(f.file,'plugins:'+version);
  await f.worker.prepare(f.file,pkg,healthy);
  assert.deepEqual(f.state().attempted,['update:'+version]);
});
test('cancel during an updated check, but not a baseline, survives reopening',async()=>{
  const f=fixture();await f.worker.prepare(f.file,pkg,healthy);
  await f.worker.cancelCheck(f.file,version,false);assert.deepEqual(f.state().attempted,[]);
  await f.worker.cancelCheck(f.file,version,true);
  assert.equal((await f.worker.prepare(f.file,pkg,healthy,true)).automatic,false);
});
test('manual recovery rechecks activity; auto recovery also suppresses recurrence',async()=>{
  for(const enhancement of [healthy,fault]){
    const f=fixture(),plan=await f.worker.prepare(f.file,pkg,enhancement);
    f.activity='busy';
    const result=await f.worker.execute(f.file,plan);
    assert.equal(result.reason,'sessionBusy');assert.deepEqual(f.calls,[]);
    assert.equal(f.state().attempted.includes(plan.key),plan.automatic);
  }
});
test('normal close and relaunch reread the selected cold-start port',async()=>{
  const f=fixture(),plan=await f.worker.prepare(f.file,pkg,healthy);
  f.port=f.rebase=29881;
  assert.deepEqual(await f.worker.execute(f.file,plan),{success:true,reason:'relaunchComplete'});
  assert.deepEqual(f.calls,['close','start']);
});
test('with no desktop only the normal launch entry is used',async()=>{
  const f=fixture();f.desktops=[];
  const plan=await f.worker.prepare(f.file,pkg,fault);
  assert.equal((await f.worker.execute(f.file,plan)).success,true);assert.deepEqual(f.calls,['start']);
});
for(const [name,edit,expected,calls] of [
  ['PID reuse',f=>{f.desktops=[{...original,created:'133344445555000002'}];},'instanceChanged',[]],
  ['package changed',f=>{f.pkg.sha256='new';},'instanceChanged',[]],
  ['veto',f=>{f.veto=true;},'closeFailed',['close']],
  ['exit deadline',f=>{f.stuck=true;},'closeFailed',['close']],
  ['launch error',f=>{f.launchFailure=true;},'relaunchFailed',['close','start']]
])test(name,async()=>{
  const f=fixture(),plan=await f.worker.prepare(f.file,pkg,fault);edit(f);
  assert.equal((await f.worker.execute(f.file,plan)).reason,expected);
  assert.deepEqual(f.calls,calls);assert.ok(f.state().attempted.includes(plan.key));
});
test('multiple desktops or missing dependencies never request close',async()=>{
  const f=fixture();
  const plan=await f.worker.prepare(f.file,pkg,fault);
  f.desktops.push({...original,pid:102});assert.deepEqual(await f.worker.prepare(f.file,pkg,fault),{allowed:false});
  f.dependencyMissing=true;await assert.rejects(f.worker.execute(f.file,plan));assert.deepEqual(f.calls,[]);
});
test('nonce is single-use and file path or stale timestamp is refused',async()=>{
  const f=fixture(),plan=await f.worker.prepare(f.file,pkg,fault),nonce='a'.repeat(32);
  const work=path.join(stateFor(f.file),'startup-check',nonce),request=path.join(work,'request.json');
  await assert.rejects(f.worker.executeRequest(f.file,'../../escape'));
  f.put(request,{plan,nonce,createdAt:f.now/1000-121});await assert.rejects(f.worker.executeRequest(f.file,nonce));
  f.put(request,{plan,nonce,createdAt:f.now/1000});await f.worker.executeRequest(f.file,nonce);
  assert.equal(read(path.join(work,'action.json')).success,true);
  f.put(request,{plan,nonce,createdAt:f.now/1000});await f.worker.executeRequest(f.file,nonce);
  assert.deepEqual(f.calls,['close','start']);
});
test('a stale automatic plan cannot override durable cancellation',async()=>{
  const f=fixture(),plan=await f.worker.prepare(f.file,pkg,fault);
  await f.worker.cancel(f.file,plan.key);
  assert.equal((await f.worker.execute(f.file,plan)).success,false);assert.deepEqual(f.calls,[]);
});
