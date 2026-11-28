const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {run,claim,observationCorrelation}=require('../../src/app/supervisor.cjs');
const {DisplayConnection}=require('../../src/runtime/connection.cjs');
const {Store}=require('../../src/platform/observability/store.cjs');
const {createDesktopPlatform,FAMILY}=require('../../src/platform/codex/desktop.cjs');
const {appearance}=require('../../src/platform/codex/settings.cjs');
const root=process.argv[2];fs.mkdirSync(root,{recursive:true});
const folder=()=>fs.mkdtempSync(path.join(root,'fixture-'));
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const stubUpdate=()=>({tick:async()=>({phase:'disabled'})});

test('one supervisor per canonical directory, release enables replacement',async()=>{
  const dir=folder(),release=await claim(dir);
  assert.equal(typeof release,'function');
  try{assert.equal(await claim(path.join(dir,'.')),null);}
  finally{await release();}
  const next=await claim(dir);assert.equal(typeof next,'function');await next();
});
test('status replacement failure and broken history do not stop the business loop',async()=>{
  const runtime=folder(),settings=path.join(runtime,'settings.json'),status=path.join(runtime,'supervisor.json');
  fs.writeFileSync(settings,'{"port":19163}');fs.mkdirSync(status);fs.writeFileSync(path.join(runtime,'runtime-history.db'),'corrupt');
  let ticks=0,stopped=0;
  const display={owner:null,async tick(){return {phase:'waiting-desktop-connection'};},async stop(){stopped++;}};
  assert.ok(await run(settings,runtime,{connect:()=>display,monitor:stubUpdate,pause:async()=>{
    assert.ok(!fs.existsSync(path.join(runtime,'stop')));
    if(++ticks===1)fs.rmdirSync(status);
    else{
      const value=read(status);
      assert.equal(value.phase,'waiting-desktop-connection');assert.equal(value.writes.failures,1);
      fs.writeFileSync(path.join(runtime,'stop'),'cancel marker');
    }
  }}));
  assert.equal(ticks,2);assert.equal(stopped,1);assert.equal(read(status).phase,'stopped');
  assert.equal(fs.readFileSync(path.join(runtime,'stop'),'utf8'),'cancel marker');
  assert.equal(fs.readFileSync(path.join(runtime,'runtime-history.db'),'utf8'),'corrupt');
});
test('desktop identity reuse retires only its controller and maps exact owner transitions',async()=>{
  const runtime=folder(),settings=path.join(runtime,'settings.json'),owner={pid:123,created:'133000000000000000',started:Date.now()/1000-30};
  fs.writeFileSync(settings,'{"port":19163}');
  const child=new EventEmitter();child.pid=456;
  let alive=true,kills=0,launches=0,polls=0;
  child.kill=()=>{kills++;child.emit('close',0);};
  const platform={listeners:async()=>alive?[owner]:[],discover:async()=>({packageVersion:'1.2.3.4'}),
    verifiedListener:rows=>rows[0],ownerAlive:async candidate=>candidate.created===owner.created&&alive};
  const display=new DisplayConnection({port:19163},settings,runtime,{platform,launch:(binary,args)=>{
    assert.equal(binary,process.execPath);assert.ok(args.some(arg=>arg.endsWith('controller.cjs')));launches++;return child;
  }});
  await run(settings,runtime,{connect:()=>display,monitor:stubUpdate,pause:async()=>{
    const status=read(path.join(runtime,'supervisor.json'));
    if(++polls===1){
      assert.equal(status.phase,'controller-running');assert.equal(status.desktopPid,123);assert.equal(status.controllerPid,456);alive=false;
    }else{
      assert.equal(status.phase,'waiting-desktop-connection');assert.equal(status.desktopPid,null);
      assert.deepEqual(status.desktopGone,[123,owner.started]);assert.equal(status.childExits,1);
      fs.writeFileSync(path.join(runtime,'stop'),'');
    }
  }});
  assert.equal(kills,1);assert.equal(launches,1);
  const store=new Store(runtime);
  assert.equal(store.query({kind:'desktop-start-observed'}).events.length,1);
  assert.equal(store.query({kind:'desktop-exit-observed'}).events.length,1);
});
test('conflicting, nonloopback, foreign-session and mismatched package listeners cannot attach',async()=>{
  const current={packageFamily:FAMILY,packageFullName:'fixture_full_name',executable:'C:/Fixture/ChatGPT.exe'};
  const owner={pid:123,created:'133000000000000000',started:10,address:'127.0.0.1',executable:'c:\\fixture\\chatgpt.exe',
    packageFamily:FAMILY,packageFullName:'fixture_full_name',currentSession:true};
  const calls=[],platform=createDesktopPlatform(async(cmd,args)=>{calls.push([cmd,args]);return {alive:true,processes:[{...owner,commandLine:'redacted',main:true}]};});
  const verified=platform.verifiedListener([owner],current);
  assert.deepEqual(verified,{pid:123,created:owner.created,started:10});
  await platform.ownerAlive(verified);
  assert.deepEqual(calls[0],['process-alive',['--pid','123','--created',owner.created]]);
  assert.ok(!Object.hasOwn((await platform.desktops(current))[0],'commandLine'));
  for(const changes of [{address:'0.0.0.0'},{address:'::1'},{currentSession:false},{packageFamily:'unknown'},
    {packageFullName:'prior'},{created:undefined},{executable:'C:\\Other\\ChatGPT.exe'}])
    assert.equal(platform.verifiedListener([{...owner,...changes}],current),null);
  assert.equal(platform.verifiedListener([owner,{...owner,address:'::'}],current),null);
});
test('correlation attaches to recent launch or newer update; stale receipts are not proof',()=>{
  const runtime=folder(),now=Date.now(),a='a'.repeat(32),b='b'.repeat(32),c='c'.repeat(32);
  const launch=at=>fs.writeFileSync(path.join(runtime,'launch-request.json'),JSON.stringify({correlation_id:a,checkedAtUtc:new Date(at).toISOString()}));
  launch(now-10000);assert.equal(observationCorrelation(runtime,{correlation_id:b,checkedAt:now/1000-20},c,now),a);
  assert.equal(observationCorrelation(runtime,{correlation_id:b,checkedAt:now/1000-5},c,now),b);
  launch(now-120000);assert.equal(observationCorrelation(runtime,{correlation_id:'bogus'},c,now),c);
  fs.unlinkSync(path.join(runtime,'launch-request.json'));assert.equal(observationCorrelation(runtime,{correlation_id:b},c,now),b);
});
test('safe read-only recovery appearance falls back without touching user settings',async()=>{
  const root=folder(),file=path.join(root,'config.toml');
  fs.writeFileSync(file,'[desktop]\nappearanceTheme="dark"\n[desktop.appearanceDarkChromeTheme]\nsurface="#aabbcc"');
  assert.deepEqual(await appearance(file,false),{dark:true,surface:'#aabbcc'});
  fs.writeFileSync(file,'[desktop]\nappearanceTheme="light"\nappearanceLightChromeTheme = \'{"surface":"#abcdef"}\'');
  assert.deepEqual(await appearance(file,true),{dark:false,surface:'#abcdef'});
  assert.deepEqual(await appearance(path.join(root,'missing'),undefined,async()=>({dark:true})),{dark:true,surface:'#111111'});
});
