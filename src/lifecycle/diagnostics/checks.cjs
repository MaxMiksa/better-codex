const fs=require('node:fs'),path=require('node:path'),https=require('node:https');
const {DatabaseSync}=require('node:sqlite'),{setTimeout:sleep}=require('node:timers/promises');
const {read,atomic,stateFor}=require('../../platform/paths.cjs');
const {text}=require('../../platform/i18n/localization.cjs');
const {readSettings,appearance}=require('../../platform/codex/settings.cjs');
const {createDesktopPlatform}=require('../../platform/codex/desktop.cjs');
const {run:runChild,info}=require('../../platform/process.cjs'),{checked}=require('../../platform/windows/native.cjs');
const {t,row,report,severity}=require('./results.cjs'),management=require('./management.cjs');
const gateway=require('../startup/model-gateway.cjs');
const {sessionFile}=require('../recovery/session-activity.cjs');
const {createRecovery}=require('../recovery/relaunch.cjs');
const IDS=['app','sessions','sandbox','network','enhancements','permissions'];
const MANAGEMENT_IDS=['prompts','updates','entries','runtime'];
function withGateway(result,other){
  if(!other)return result;
  const detail=[result.detail,other.detail].filter(Boolean).map(s=>s.replace(/[.。]+$/,'')).join('\n');
  const worse=severity[other.state]>severity[result.state];
  return {...result,detail,state:worse?other.state:result.state,status:worse?other.status:result.status,
    suggestion:(worse?other.suggestion:result.suggestion)||other.suggestion};
}
function firstJson(file,requireNewline){
  const fd=fs.openSync(file,'r'),buffer=Buffer.alloc(1024*1024);
  try{
    const n=fs.readSync(fd,buffer),end=buffer.subarray(0,n).indexOf(10);
    if(end<0&&(requireNewline||n===buffer.length))throw Error();
    const line=buffer.toString('utf8',0,end>=0?end:n).replace(/^\uFEFF/,'').trim();
    if(line||requireNewline)JSON.parse(line);
  }finally{fs.closeSync(fd);}
}
function head(target,proxy,timeout=6000){
  const agent=new https.Agent({rejectUnauthorized:true,proxyEnv:proxy?{HTTPS_PROXY:proxy.href}:{}});
  return new Promise((resolve,reject)=>{
    const req=https.request(target,{method:'HEAD',agent,rejectUnauthorized:true,headers:{'User-Agent':'Better-Codex-Startup-Check'}},response=>{
      response.destroy();resolve();
    });
    const timer=setTimeout(()=>req.destroy(new Error('Deadline')),timeout);
    req.once('close',()=>{clearTimeout(timer);agent.destroy();});
    req.once('error',reject);
    req.end();
  });
}
function proxyUrl(home,nativeProxy,env=process.env,target){
  const values={};
  for(const [key,value] of Object.entries(env))values[key.toUpperCase()]=value;
  try{
    for(const line of fs.readFileSync(path.join(home,'.env'),'utf8').split(/\r?\n/)){
      const p=/^\s*(?:export\s+)?(https_proxy|http_proxy|all_proxy|no_proxy)\s*=\s*(.*?)\s*$/i.exec(line);
      if(p)values[p[1].toUpperCase()]??=p[2].replace(/^(['"])(.*)\1$/,'$2');
    }
  }catch{}
  if(target&&values.NO_PROXY?.split(/[,\s]+/).some(token=>{
    if(token==='*')return true;
    const match=/^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(token.toLowerCase());
    if(!match||match[2]&&match[2]!==String(target.port||443))return false;
    const host=match[1].replace(/^\*?\./,''),name=target.hostname.toLowerCase();
    return name===host||name.endsWith('.'+host);
  }))return null;
  const fields=nativeProxy?.split(';')??[];
  return values.HTTPS_PROXY||values.ALL_PROXY||fields.find(s=>s.startsWith('https='))?.slice(6)||fields.find(s=>!s.includes('='));
}
class Checks{
  constructor(settingsPath,{platform=createDesktopPlatform(),native=checked,identify=info,delay=sleep,clock=Date.now,
    request=head,connect=gateway.reachable,child=runChild,environment=process.env,prompts=()=>row('prompts','notApplicable',t('promptUnavailable')),
    time={app:30000,hud:10000,retry:8000,poll:500}}={}){
    Object.assign(this,{settingsPath,platform,native,identify,delay,clock,request,connect,child,environment,prompts,time});
    this.runtime=stateFor(settingsPath);this.started=clock();
    try{this.settings=readSettings(settingsPath);}catch{this.settings={};this.settingsError=true;}
    this.home=gateway.codexHome(this.settings);
    try{this.config=this.settingsError?{}:gateway.configFor(this.settings);}catch{this.config={};this.configError=true;}
  }
  launchReason(){
    try{
      const data=read(path.join(this.runtime,'launch-receipt.json')),stamp=Date.parse(data.checkedAtUtc);
      if(stamp>=this.started-4000&&stamp<=this.clock()+2000)return data.hudReason;
    }catch{}
  }
  async app(){
    if(!this.package)return row('app','unknown',t('packageUnavailable'),t('appHint'));
    const deadline=this.clock()+this.time.app;
    let main,p;
    do{
      let running;
      try{running=await this.platform.desktops(this.package);}catch{return row('app','unknown',t('packageUnavailable'),t('appHint'));}
      const mains=running.filter(x=>x.main);
      if(mains.length>1||running.length&&!mains.length)return row('app','unknown',t('packageUnavailable'),t('appHint'));
      main=mains[0];p=main;
      if(main?.visible&&main.responding&&await this.platform.ownerAlive(main)){
        this.desktop=main;return row('app','pass',t('appReady'),'',{summary:t('previewApp')});
      }
      if(!running.length&&this.launchReason()==='activation-failed')
        return row('app','fail',text('launch.activation-failed'),t('appHint'),{summary:t('activationFailed')});
      if(this.clock()>=deadline)break;
      await this.delay(this.time.poll);
    }while(this.clock()<deadline);
    if(p&&await this.platform.ownerAlive(p)){
      this.desktop=p;
      if(p.windowHandle!=='0'&&!p.visible)return row('app','notApplicable',t('appHidden'),'',{status:t('appBackground')});
      if(p.visible&&!p.responding)return row('app','fail',t('appUnresponsive'),t('appHint'));
      return row('app','unknown',t('appWindowUnknown'),t('appHint'));
    }
    return row('app','fail',t('appMissing'),t('appHint'));
  }
  sessions(){
    let db;
    try{
      const index=path.join(this.home,'session_index.jsonl');
      const files=fs.existsSync(this.home)?fs.readdirSync(this.home,{withFileTypes:true}):[];
      const databases=files.filter(d=>d.isFile()&&/^state_\w+\.sqlite$/.test(d.name)).map(d=>path.join(this.home,d.name));
      if(!fs.existsSync(index)&&!databases.length)return row('sessions','notApplicable',t('sessionsEmpty'));
      if(fs.existsSync(index))firstJson(index,false);
      if(!databases.length)return row('sessions','unknown',t('sessionsBusy'),t('sessionsHint'));
      const newest=databases.map(file=>[file,fs.statSync(file).mtimeMs]).sort((a,b)=>b[1]-a[1])[0][0];
      db=new DatabaseSync(newest,{readOnly:true,timeout:200});
      db.exec('PRAGMA query_only=ON');
      const home=fs.realpathSync.native(this.home),rows=db.prepare('SELECT rollout_path FROM threads ORDER BY updated_at DESC LIMIT 5').all();
      for(const record of rows)firstJson(sessionFile(home,record.rollout_path),true);
      return row('sessions',rows.length?'pass':'notApplicable',rows.length?t('sessionsReady',{count:rows.length}):t('sessionsEmpty'),
        '',{summary:rows.length?t('previewSessions'):null});
    }catch(error){
      return ['ERR_SQLITE_ERROR','ENOENT'].includes(error.code)||error.message==='Unowned session path'?
        row('sessions','unknown',t('sessionsBusy'),t('sessionsHint')):row('sessions','fail',t('sessionsUnavailable'),t('sessionsHint'));
    }finally{db?.close();}
  }
  async sandbox(){
    try{
      const cmd=path.join(process.env.WINDIR,'System32/cmd.exe');
      if(this.config.sandbox_mode==='danger-full-access'){
        const {stdout}=await this.child(cmd,['/d','/c','echo','BETTER_CODEX_BASIC_OK'],{timeout:5000});
        return stdout.includes('BETTER_CODEX_BASIC_OK')?row('sandbox','notApplicable',t('executionReady'),'',{status:t('fullAccess')}):
          row('sandbox','fail',t('executionFailed'));
      }
      if(!this.package)return row('sandbox','unknown',t('packageUnavailable'),t('sandboxHint'));
      const resources=path.join(path.dirname(this.package.executable),'resources'),codex=path.join(resources,'codex.exe');
      if(!fs.existsSync(codex)||!fs.existsSync(path.join(resources,'codex-command-runner.exe')))
        return row('sandbox','fail',t('sandboxMissing'),t('sandboxHint'));
      if(this.config.windows?.sandbox==='mxc'){
        const {stdout}=await this.child(codex,['-c','approval_policy="never"','sandbox','--include-managed-config',
          '--permission-profile',':read-only','--',cmd,'/d','/c','echo','BETTER_CODEX_MXC_OK'],{timeout:8000}).catch(()=>({}));
        if(stdout?.includes('BETTER_CODEX_MXC_OK'))return row('sandbox','pass',t('mxcReady'),'',{status:t('basicPassed')});
      }
      return row('sandbox','unknown',t('sandboxUnconfirmed'),t('sandboxHint'));
    }catch{return row('sandbox','unknown',t('executionFailed'),t('sandboxHint'));}
  }
  async gateway(){
    const address=gateway.endpoint(this.config);
    if(!address)return null;
    if(!await gateway.probe(address,{connect:this.connect,delay:this.delay}))return row('gateway','fail',t('gatewayDown'),t('gatewayHint'));
    const owner=await gateway.owner(address,this.native).catch(()=>null);
    if(owner&&!owner.includes('magpie'))return row('gateway','warning',t('gatewayForeign'),t('gatewayHint'));
    const catalog=this.config.model_catalog_json;
    if(typeof catalog==='string'&&catalog&&!fs.statSync(path.resolve(this.home,catalog),{throwIfNoEntry:false})?.isFile())
      return row('gateway','warning',t('gatewayCatalogMissing'),t('gatewayHint'));
    return row('gateway','pass',t('gatewayReady'));
  }
  async networkAttempt(){
    const failed=(id,state='fail')=>row('network',state,t(id),t('networkHint'));
    let target,proxy;
    const environment=await this.native('network-environment',[],{timeout:1500}).catch(()=>({}));
    try{
      const provider=this.config.model_provider??'openai';
      const url=this.config.model_providers?.[provider]?.base_url||this.config.chatgpt_base_url||'https://chatgpt.com/';
      const u=new URL(url);
      if(u.protocol!=='https:')return failed('networkFailed','unknown');
      target=new URL(u.origin);
      const raw=proxyUrl(this.home,environment.proxy,this.environment,target);
      if(raw){
        proxy=new URL(raw.includes('://')?raw:'http://'+raw);
        if(!['http:','https:'].includes(proxy.protocol))return failed('networkFailed','unknown');
        proxy.username=proxy.password='';
        if(!await this.connect({host:proxy.hostname.replace(/^\[|\]$/g,''),port:Number(proxy.port||(proxy.protocol==='https:'?443:80))},2000))
          return failed('proxyFailed');
      }
    }catch{return failed('networkFailed','unknown');}
    try{await this.request(target,proxy);}
    catch(error){return failed(/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/.test(error.code??'')?'tlsFailed':'networkFailed');}
    const {vpnInstalled,vpnCore,vpnService}=await this.native('network-environment',[],{timeout:1500}).catch(()=>({}));
    if((vpnInstalled||vpnCore||vpnService)&&!(vpnCore&&vpnService))return failed('vpnDown','warning');
    return row('network','pass',t(vpnCore&&vpnService?'vpnReady':'networkReady'));
  }
  async network(){
    const startedAt=new Date().toISOString(),attempts=[];
    let result;
    for(let i=0;i<3;i++){
      result=await this.networkAttempt();
      attempts.push({checkedAt:new Date().toISOString(),state:result.state,detail:result.detail});
      if(!['fail','warning'].includes(result.state)||result.detail===t('tlsFailed'))break;
      if(i<2)await this.delay(this.time.retry);
    }
    const local=await this.gateway().catch(()=>null);
    try{atomic(path.join(this.runtime,'last-network-check.json'),JSON.stringify({startedAt,attempts,gateway:local?.state??'notApplicable'}));}catch{}
    return withGateway(result,local);
  }
  async enhancements(){
    const unavailable=()=>row('enhancements','unknown',t('hudUnavailable'),t('hudHint'));
    const chosen=this.desktop;
    if(!chosen||!await this.platform.ownerAlive(chosen))return unavailable();
    const deadline=this.clock()+this.time.hud,fresh=(value,ms)=>value<=this.clock()+2000&&value>this.clock()-ms;
    do{
      try{
        const {launcher,status}=await management.supervisor(this.settings,this.runtime,this.identify,this.clock);
        const view=read(path.join(this.runtime,'view-status.json'));
        const owner=this.platform.verifiedListener(await this.platform.listeners(this.settings.port),this.package);
        if(owner?.created===chosen.created&&owner.pid===chosen.pid&&status.desktopPid===owner.pid&&
          status.controllerPid===view.controllerPid&&fresh(status.checkedAt*1000,10000)&&fresh(view.checkedAt,8000)){
          const process=await this.identify(status.controllerPid,{executable:this.settings.node});
          if(process.matches&&process.parent===launcher.supervisorPid){
            let windows=view.windows.filter(w=>w.visible||w.readingWidth?.applied);
            if(!windows.length)windows=view.windows;
            if(windows.length&&windows.every(w=>fresh(w.checkedAt,8000))){
              const loaded=windows.every(w=>Number.isInteger(w.fileChanges?.cards)&&!w.readingWidth?.reason?.startsWith('layout-or-settings'));
              if(loaded&&windows.some(w=>w.visible&&w.readingWidth?.applied))return row('enhancements','pass',t('hudReady'),'',{summary:t('previewEnhancements')});
              if(loaded)return row('enhancements','notApplicable',t('hudWaiting'),'',{status:t('pass')});
              return {...row('enhancements','warning',t('hudPartial'),t('hudHint')),restartRecommended:true};
            }
          }
        }
      }catch{}
      if(this.clock()>=deadline)break;
      await this.delay(this.time.poll);
    }while(this.clock()<deadline);
    if(!await this.platform.ownerAlive(chosen))return unavailable();
    let reason=this.launchReason();
    if(!chosen.debuggingRequested)reason='restart-required';
    const summary={'restart-required':'hudNoInterface','unverified-listener':'hudIdentityUnverified','hud-preparation-failed':'hudDependencies'}[reason];
    if(summary)return {...row('enhancements','warning',text('launch.'+reason),t('hudHint'),{summary:t(summary)}),restartRecommended:reason==='restart-required'};
    const absent=await this.platform.listeners(this.settings.port).then(rows=>rows.length===0,()=>false);
    return absent?{...unavailable(),state:'warning',status:t('warning'),restartRecommended:true}:unavailable();
  }
  async permissions(){
    let elevated;
    if(this.desktop){
      const p=await this.identify(this.desktop.pid,{executable:this.package.executable}).catch(()=>({}));
      if(p.matches&&p.created===this.desktop.created)elevated=p.elevated;
    }
    return typeof elevated==='boolean'?row('permissions','pass',t('permissionReady'),'',{status:t(elevated?'admin':'ordinary')}):
      row('permissions','unknown',t('permissionUnknown'));
  }
}
async function run(settings,output,{afterUpdate=false,observe=()=>{},checks=new Checks(settings),recovery=createRecovery()}={}){
  const keys=[...IDS,...MANAGEMENT_IDS],rows=Object.fromEntries(keys.map(id=>[id,row(id,'pending')]));
  let look;
  const publish=async(final=false)=>{
    const data=report(keys.map(id=>rows[id]),checks.package?.packageVersion);
    data.rows=IDS.map(id=>rows[id]);data.managementRows=MANAGEMENT_IDS.map(id=>rows[id]);
    if(look)data.appearance=look;
    if(final&&checks.package){
      try{
        const plan=data.relaunch=await recovery.prepare(settings,checks.package,rows.enhancements,afterUpdate);
        if(['busy','unknown'].includes(plan.activity?.state)){
          const key=plan.activity.state==='busy'?'sessionBusy':'sessionUnknown';
          rows.app.summary=t(key+(plan.cancelledForActivity?'Cancelled':''));
          if(rows.app.state==='pass'){rows.app.state='warning';rows.app.status=t(key==='sessionBusy'?'sessionBusyStatus':'unknownStatus');}
        }
        rows.updates=management.applyPlan(rows.updates,plan);
        if(plan.automatic&&plan.reason==='updated'){rows.app.summary=t('updatedSummary');rows.app.status=t('updatedStatus');}
        if(data.state==='healthy'&&(rows.app.state==='warning'||plan.automatic&&plan.reason==='updated')){
          Object.assign(data,{state:'partial',title:t('partial'),description:t('partialDescription')});
        }
      }catch{data.relaunch={allowed:false};}
      data.managementRows=MANAGEMENT_IDS.map(id=>rows[id]);
    }
    try{observe(data);}catch{}
    for(let i=0;;i++){
      try{atomic(output,JSON.stringify(data));return;}
      catch(error){if(i===5||!['EPERM','EACCES','EBUSY'].includes(error.code))throw error;await sleep(50);}
    }
  };
  await publish();
  const packageReady=checks.settingsError?Promise.resolve():checks.platform.discover({digest:true}).then(pkg=>{checks.package=pkg;},()=>{});
  const appReady=packageReady.then(()=>checks.settingsError?row('app','unknown',t('runtimeSettingsInvalid')):checks.app()).catch(()=>row('app','unknown',t('workerUnavailable')));
  const jobs={
    app:()=>appReady,sessions:()=>checks.sessions(),sandbox:async()=>{await packageReady;return checks.sandbox();},
    network:()=>checks.network(),enhancements:async()=>{await appReady;return checks.enhancements();},
    permissions:async()=>{await appReady;return checks.permissions();},prompts:()=>checks.prompts(checks),
    updates:async()=>{await appReady;return management.updates(checks.settings,checks.runtime);},
    entries:()=>management.entries(checks.settingsPath),runtime:async()=>{
      if(!checks.settingsError){const timer=AbortSignal.timeout(24000);await Promise.race([appReady,new Promise(resolve=>timer.addEventListener('abort',resolve,{once:true}))]);}
      return management.runtime(checks);
    }
  };
  let queue=Promise.resolve(),total=keys.length;
  await Promise.all(keys.map(async id=>{
    let value;
    try{
      if(checks.settingsError&&!['app','runtime','prompts'].includes(id))value=row(id,'unknown',t('runtimeSettingsInvalid'));
      else if(checks.configError&&['sandbox','network'].includes(id))value=row(id,'unknown',t('runtimeConfigInvalid'));
      else value=await jobs[id]();
    }catch{value=row(id,'unknown',t('workerUnavailable'));}
    queue=queue.then(async()=>{rows[id]=value;if(--total)await publish();});
    await queue;
  }));
  look=await appearance(path.join(checks.home,'config.toml')).catch(()=>undefined);
  await publish(true);
}
module.exports={Checks,run,withGateway,proxyUrl,IDS,MANAGEMENT_IDS};
