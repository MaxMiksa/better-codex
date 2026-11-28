const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {t,row,summarize}=require('../../src/lifecycle/diagnostics/results.cjs');
const {Checks,run,IDS,MANAGEMENT_IDS}=require('../../src/lifecycle/diagnostics/checks.cjs');
const gateway=require('../../src/lifecycle/startup/model-gateway.cjs');
const {atomic,read}=require('../../src/platform/paths.cjs');
const dir=process.argv[2];fs.mkdirSync(dir,{recursive:true});
const pkg={packageVersion:'9.1.2.3',executable:path.join(dir,'Store','app','ChatGPT.exe')};
const chosen={pid:123,created:'133344445555000001',started:10,main:true,windowHandle:'1',visible:true,responding:true,debuggingRequested:true};
function fixture(opts={}){
  const home=fs.mkdtempSync(path.join(dir,'diagnostics-')),file=path.join(home,'.runtime/settings.json');
  fs.mkdirSync(path.join(home,'sessions'));
  atomic(file,JSON.stringify({node:process.execPath,codexHome:home,port:19164}));
  fs.writeFileSync(path.join(home,'config.toml'),'[desktop]\nappearanceTheme="dark"\n');
  const fixture={home,file,main:[{...chosen}],alive:true,now:Date.now(),attempts:0};
  const platform={discover:async()=>pkg,desktops:async()=>fixture.main,ownerAlive:async()=>fixture.alive,
    listeners:async()=>fixture.listeners??[],verifiedListener:()=>fixture.verified};
  fixture.checks=new Checks(file,{platform,identify:async()=>({matches:true,created:chosen.created,elevated:false}),
    native:async()=>({}),environment:{},time:{app:30,hud:20,retry:8,poll:5},clock:()=>fixture.now,
    delay:async ms=>{fixture.now+=ms;},request:async()=>{fixture.attempts++;},...opts});
  fixture.checks.package=pkg;
  return fixture;
}
test('critical failure outranks unknown; enhancement failure is partial',()=>{
  assert.equal(summarize([row('app','fail'),row('network','unknown')]),'failed');
  assert.equal(summarize([row('enhancements','fail')]),'partial');
  assert.equal(summarize([row('enhancements','unknown'),row('prompts','notApplicable')]),'unknown');
});
for(const [name,edit,expected,retained] of [
  ['visible',()=>{},'pass',true],['hidden',f=>{f.main[0].visible=false;},'notApplicable',true],
  ['unresponsive',f=>{f.main[0].responding=false;},'fail',true],
  ['window not ready',f=>Object.assign(f.main[0],{visible:false,windowHandle:'0'}),'unknown',true],
  ['multiple mains',f=>f.main.push({...chosen,pid:124}),'unknown',false],
  ['absent',f=>{f.main=[];},'fail',false],['PID unavailable',f=>{f.alive=false;},'fail',false]
])test(name,async()=>{
  const f=fixture();edit(f);const result=await f.checks.app();
  assert.equal(result.state,expected);assert.equal(Boolean(f.checks.desktop),retained);
  assert.equal((await f.checks.permissions()).state,retained?'pass':'unknown');
});
test('report publishes pending and final, with six main and four management rows',async()=>{
  const f=fixture(),p=path.join(f.home,'report.json'),reports=[];
  const outputs={app:'pass',sessions:'pass',sandbox:'notApplicable',network:'pass',enhancements:'pass',permissions:'pass',prompts:'notApplicable'};
  for(const [id,state] of Object.entries(outputs))f.checks[id]=()=>row(id,state);
  await run(f.file,p,{checks:f.checks,observe:value=>reports.push(JSON.stringify(value)),
    recovery:{prepare:async()=>({allowed:false,activity:{state:'busy'},cancelledForActivity:true})}});
  const initial=JSON.parse(reports[0]),final=read(p);
  assert.equal(initial.state,'checking');
  assert.deepEqual(final.rows.map(r=>r.id),IDS);assert.deepEqual(final.managementRows.map(r=>r.id),MANAGEMENT_IDS);
  assert.ok(![...final.rows,...final.managementRows].some(r=>r.state==='pending'));
  assert.equal(final.rows[0].summary,t('sessionBusyCancelled'));
  assert.equal(final.modelMessageSent,false);
});
test('session checks parse a bounded first record and do not return its content',()=>{
  const f=fixture(),file=path.join(f.home,'sessions','fixture-private.jsonl');
  fs.writeFileSync(file,'{"token":"private-value"}\n');
  const db=new DatabaseSync(path.join(f.home,'state_5.sqlite'));
  db.exec('CREATE TABLE threads(rollout_path TEXT,updated_at INTEGER)');
  db.prepare('INSERT INTO threads VALUES (?, 10)').run('\\\\?\\'+file);db.close();
  const result=f.checks.sessions();
  assert.equal(result.state,'pass');assert.doesNotMatch(JSON.stringify(result),/private/);
  fs.writeFileSync(file,'{ broken }\n');assert.equal(f.checks.sessions().state,'fail');
});
test('sandbox probes only innocuous host commands and never provisions the legacy backend',async()=>{
  const calls=[],f=fixture({child:async(...args)=>{calls.push(args);return {stdout:'BETTER_CODEX_BASIC_OK BETTER_CODEX_MXC_OK'};}});
  f.checks.config={sandbox_mode:'danger-full-access'};
  assert.equal((await f.checks.sandbox()).state,'notApplicable');assert.equal(calls[0][0].endsWith('cmd.exe'),true);
  f.checks.config={windows:{sandbox:'unelevated'}};
  assert.equal((await f.checks.sandbox()).state,'fail');
  const resources=path.join(path.dirname(pkg.executable),'resources');
  atomic(path.join(resources,'codex.exe'),'');atomic(path.join(resources,'codex-command-runner.exe'),'');
  assert.equal((await f.checks.sandbox()).state,'unknown');assert.equal(calls.length,1);
  f.checks.config.windows.sandbox='mxc';
  assert.equal((await f.checks.sandbox()).state,'pass');
  assert.ok(calls[1][1].includes(':read-only')&&calls.length===2);
});
const magpie=url=>({model_provider:'local',model_providers:{local:{name:'Magpie',base_url:url}}});
test('gateway only identifies the selected provider and literal loopback',()=>{
  assert.deepEqual(gateway.endpoint(magpie('https://[::1]')), {host:'::1',port:443});
  assert.deepEqual(gateway.endpoint(magpie('http://localhost/v1')), {host:'localhost',port:80});
  assert.deepEqual(gateway.endpoint(magpie('http://127.0.0.1:4242/v1')), {host:'127.0.0.1',port:4242});
  for(const u of ['http://127.0.0.2','http://127.1','http://0x7f000001','https://magpie.invalid','ftp://localhost','http://localhost:0'])
    assert.equal(gateway.endpoint(magpie(u)),null);
  assert.equal(gateway.endpoint({...magpie('http://localhost:80'),model_provider:'other',openai_base_url:'http://localhost'}),null);
});
test('gateway tries exactly three times and a mismatched or stale listener cannot masquerade as Magpie',async()=>{
  let tries=0;
  assert.equal(await gateway.probe({host:'::1',port:23000},{connect:async addr=>{assert.equal(addr.host,'::1');return ++tries===3;},delay:async()=>{}}),true);
  assert.equal(tries,3);
  const native=(alive)=>async command=>command==='process-alive'?{alive}:{listeners:[
    {address:'127.0.0.1',created:'2',executable:'C:\\Magpie.exe',pid:1},
    {address:'::1',created:'3',executable:'C:\\foreign.exe',pid:2}
  ]};
  assert.equal(await gateway.owner({host:'::1',port:23000},native(false)),null);
  assert.equal(await gateway.owner({host:'::1',port:23000},native(true)),'foreign.exe');
});
test('HTTPS retries are bounded and receipts redact config data; TLS failures never retry',async()=>{
  const fixture=fixtureForNetwork(),{checks}=fixture;
  checks.request=async target=>{
    assert.equal(target.href,'https://test.invalid/');if(++fixture.attempts<3)throw Error('raw secrets');
  };
  const result=await checks.network();
  assert.equal(result.state,'pass');assert.equal(fixture.attempts,3);
  const evidence=read(path.join(checks.runtime,'last-network-check.json'));
  assert.equal(evidence.attempts.length,3);assert.doesNotMatch(JSON.stringify(evidence),/secrets|test\.invalid|secret-value/);
  fixture.attempts=0;checks.request=async()=>{fixture.attempts++;throw Object.assign(Error('self-signed'),{code:'DEPTH_ZERO_SELF_SIGNED_CERT'});};
  assert.equal((await checks.network()).detail,t('tlsFailed'));assert.equal(fixture.attempts,1);
});
function fixtureForNetwork(){
  const f=fixture();
  f.checks.config={chatgpt_base_url:'https://user:secret-value@test.invalid/private?token=secret-value'};
  return f;
}
test('proxy failure does not fall back to direct, and a foreign gateway folds into the network row',async()=>{
  const f=fixtureForNetwork();
  f.checks.native=async cmd=>cmd==='network-environment'?{proxy:'https=localhost:4200'}:cmd==='port-listeners'?
    {listeners:[{address:'127.0.0.1',created:'1',executable:'C:\\other.exe',pid:1}]}:{alive:true};
  f.checks.connect=async()=>false;assert.equal((await f.checks.network()).detail,t('proxyFailed'));assert.equal(f.attempts,0);
  f.checks.config={...magpie('http://127.0.0.1:33441'),chatgpt_base_url:'https://example.invalid'};
  f.checks.connect=async()=>true;
  const result=await f.checks.network();
  assert.equal(result.id,'network');assert.equal(result.state,'warning');assert.ok(result.detail.includes(t('gatewayForeign').replace(/[.。]+$/,'')));
});
test('only verified desktop evidence can recommend relaunch',async()=>{
  const f=fixture();f.checks.desktop=chosen;
  f.listeners=[{pid:999}];
  let result=await f.checks.enhancements();assert.equal(result.state,'unknown');assert.equal(result.restartRecommended,undefined);
  f.checks.desktop={...chosen,debuggingRequested:false};
  result=await f.checks.enhancements();assert.equal(result.restartRecommended,true);
  f.alive=false;result=await f.checks.enhancements();assert.equal(result.state,'unknown');
});
