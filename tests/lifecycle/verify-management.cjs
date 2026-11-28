const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {read,atomic}=require('../../src/platform/paths.cjs');
const {promptProbe,saveFailure}=require('../../src/app/startup-diagnostics.cjs');
const {Checks}=require('../../src/lifecycle/diagnostics/checks.cjs');
const m=require('../../src/lifecycle/diagnostics/management.cjs'),{t}=require('../../src/lifecycle/diagnostics/results.cjs');
const work=process.argv[2];fs.mkdirSync(work,{recursive:true});
const json=(file,value)=>atomic(file,JSON.stringify(value));
test('heartbeat uses exact 100ns Windows identity and stale processes fail closed',async()=>{
  const runtime=fs.mkdtempSync(path.join(work,'state-')),stamp='2025-01-02T03:04:05.0123456Z';
  const receipt={supervisorPid:100,startedAt:stamp,stamp:'A'},created=m.startedAt(receipt),now=Date.now();
  assert.equal(created,(BigInt(Date.parse(stamp))*10000n+3456n+116444736000000000n).toString());
  json(path.join(runtime,'launcher.json'),receipt);
  const status={checkedAt:now/1000,phase:'controller-running',updateRecovery:{phase:'baseline',observedVersion:'9.9.0.0'}};
  const file=path.join(runtime,'supervisor.json');json(file,status);
  const identify=async(pid,opts)=>{assert.equal(pid,100);assert.equal(opts.executable,process.execPath);return {matches:true,created};};
  assert.deepEqual((await m.supervisor({node:process.execPath},runtime,identify)).launcher,receipt);
  await assert.rejects(m.supervisor({node:process.execPath},runtime,async()=>({matches:true,created:String(BigInt(created)+1n)})));
  assert.equal((await m.updates({recoverAfterUpdate:false},runtime)).state,'notApplicable');
  assert.equal((await m.updates({recoverAfterUpdate:true},runtime,async()=>({status}))).state,'pass');
  json(path.join(runtime,'startup-relaunch.json'),{attempted:['update:9.9.0.0']});
  const result=await m.updates({recoverAfterUpdate:true},runtime,async()=>({status}));
  assert.ok(result.detail.includes(t('updatesHandled')));
  json(file,{...status,checkedAt:now/1000-60});
  await assert.rejects(m.supervisor({node:process.execPath},runtime,identify));
});
test('final update status reflects cancellation rather than falsely claiming monitor failed',()=>{
  const r=m.applyPlan({detail:'baseline'},{reason:'updated',cancelledForActivity:true});
  assert.equal(r.summary,t('updatesCancelled'));
  assert.match(r.detail,/baseline\n/);
});
test('runtime validation differentiates invalid settings, missing dependency and outdated stamp',async()=>{
  const runtime=fs.mkdtempSync(path.join(work,'standalone-')),settingsPath=path.join(runtime,'settings.json');
  const invalid=new Checks(settingsPath);
  assert.equal((await m.runtime(invalid)).summary,t('runtimeSettingsInvalid'));
  json(settingsPath,{node:process.execPath,port:19163,codexHome:runtime});
  atomic(path.join(runtime,'config.toml'),'[broken');
  const checks=new Checks(settingsPath);
  assert.equal(checks.configError,true);
  const old=await m.runtime(checks,{readSupervisor:async()=>({launcher:{stamp:'old'}}),probe:async()=>'new',ready:async()=>true});
  assert.equal(old.state,'warning');assert.ok(old.detail.includes(t('runtimeOldBackend')));
  checks.settings.node='not-an-executable';
  const missing=await m.runtime(checks);
  assert.ok(missing.detail.includes(t('runtimeDependenciesMissing')));
});
test('entry read probe reports unavailable when malformed and never writes',async()=>{
  for(const payload of ['invalid','[]','[{"code":"entryScope","state":"evil"}]'])
    assert.equal((await m.entries('unused',async()=>payload)).state,'unknown');
  assert.equal((await m.entries('unused',async()=>'[{"code":"entryLoginDisabled","state":"notApplicable"}]')).state,'notApplicable');
});
test('external prompt slot accepts only known state from an absolute script and forwards no private env',async()=>{
  const file=path.join(work,'synthetic probe.cjs');
  atomic(file,"console.log(JSON.stringify({state:process.env.BETTER_CODEX_PROMPT_DIAGNOSTICS==='read-only'&&!process.env.BC_PROBE_PRIVATE?'warning':'fail',detail:'raw probe output'}));");
  process.env.BC_PROBE_PRIVATE='private';
  try{
    assert.equal((await promptProbe({settings:{}})).state,'notApplicable');
    assert.equal((await promptProbe({settings:{promptDiagnosticsCommand:'relative.cjs'}})).state,'notApplicable');
    for(const key of ['promptDiagnosticsCommand','promptDiagnosticsProbe']){
      const result=await promptProbe({settings:{[key]:file}});
      assert.equal(result.state,'warning');assert.doesNotMatch(JSON.stringify(result),/raw probe output/);
    }
    for(const payload of ["process.stdout.write('x'.repeat(65536));","console.log('{}');process.exitCode=3;","setTimeout(()=>{},12000);"]){
      atomic(file,payload);const before=performance.now();
      assert.equal((await promptProbe({settings:{promptDiagnosticsCommand:file}})).state,'notApplicable');
      assert.ok(performance.now()-before<3000);
    }
  }finally{delete process.env.BC_PROBE_PRIVATE;}
});
test('worker failure receipt retains structural facts only and does not mask original error',()=>{
  const output=path.join(work,'report.json'),error=Object.assign(new TypeError('secret account path'),{errno:-13});
  saveFailure(output,error);
  const result=read(path.join(work,'failure.json'));
  assert.equal(result.errorType,'TypeError');assert.equal(result.errno,-13);
  assert.doesNotMatch(JSON.stringify(result),/secret|account|[A-Z]:\\\\/);
  assert.doesNotThrow(()=>saveFailure(path.join(path.win32.parse(work).root,'<>','report.json'),error));
});
