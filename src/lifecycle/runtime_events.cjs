const fs=require('node:fs'),path=require('node:path');
const {stateFor}=require('../platform/paths.cjs');
const MESSAGES=require('../platform/i18n/messages.json');
const {identity,validId}=require('../platform/observability/events.cjs');
const {Recorder}=require('../platform/observability/store.cjs');
const CHECK_IDS='app sessions sandbox network enhancements permissions prompts updates entries runtime'.split(' ');
function correlation(value){
  value=value||process.env.BETTER_CODEX_CORRELATION_ID;
  return validId(value)?value:identity();
}
const recorder=(settings,source,id)=>new Recorder(stateFor(settings),source,correlation(id));
const escaped=value=>value.replace(/[.*+?^\x24{}()|[\]\\]/g,'\\$&');
const reasonPatterns=Object.values(MESSAGES).flatMap(catalog=>Object.entries(catalog)
  .filter(([key,template])=>/^(?:check|launch)\./.test(key)&&typeof template==='string')
  .map(([key,template])=>[key.slice(key.indexOf('.')+1),
    new RegExp('(?:^|\\n)'+template.split(/(\{\w+\})/).map(part=>/^\{\w+\}$/.test(part)?'[^\\n]*':escaped(part)).join('')+'(?:$|\\n)')]));
function reasons(row){
  const codes=[...new Set(reasonPatterns.filter(([,pattern])=>['detail','summary','suggestion']
    .some(key=>typeof row[key]==='string'&&pattern.test(row[key]))).map(([code])=>code))].sort();
  return codes.length?codes:['evidenceUnavailable'];
}
function checkRows(data,terminal){
  const rows=new Map([...(data.rows??[]),...(data.managementRows??[])].filter(Boolean).map(row=>[row.id,row]));
  return CHECK_IDS.map(id=>{
    const row=rows.get(id)??{state:'pending'},unfinished=terminal&&row.state==='pending';
    return {id,state:unfinished?'unknown':row.state??'unknown',codes:unfinished?[terminal]:reasons(row)};
  });
}
function diagnostic(rec,data,instance,terminal){
  const checks=checkRows(data,terminal);
  if(!terminal&&checks.some(row=>row.state==='pending'))return;
  if(terminal)rec.emit('diagnostic-ended',terminal==='cancelled'?'cancelled':'unknown',{reason:terminal},instance);
  rec.emit('diagnostic-completed',terminal?'unknown':data.state??'unknown',
    {checks,complete:!terminal,package_version:data.packageVersion,reason:terminal||'completed'},instance,data.checkedAt);
  const network=checks.find(row=>row.id==='network');
  const previous=rec.store.query({kind:'network-state',limit:1});
  if(JSON.stringify(previous.events[0]?.payload.checks)!==JSON.stringify([network]))
    rec.emit('network-state',network.state,{checks:[network]},instance);
  const plan=data.relaunch;
  if(plan?.needed){
    rec.emit('recovery-triggered',plan.allowed?'observed':'blocked',{reason:plan.reason,allowed:Boolean(plan.allowed),
      automatic:Boolean(plan.automatic),activity_state:plan.activity?.state},instance);
    if(!plan.allowed)rec.emit('recovery-blocked','blocked',{reason:plan.activity?.state==='busy'?'sessionBusy':'sessionUnknown'},instance);
  }
}
function update(rec,state){
  const phase=state.phase??'unknown',id=validId(state.correlation_id)?state.correlation_id:rec.correlation_id;
  rec.change('update',[phase,state.observedVersion,state.pendingVersion],'update-state',
    phase==='recovery-check-unavailable'?'unavailable':'observed',
    {phase,package_version:state.observedVersion,previous_version:state.previousVersion},id,state.checkedAt);
}
function recovery(settings,kind,status,plan={},reason,instance){
  return recorder(settings,'recovery',plan.correlation_id).emit(kind,status,{reason:reason||plan.reason,
    package_version:plan.packageVersion,activity_state:plan.activity?.state,
    allowed:Boolean(plan.allowed),automatic:Boolean(plan.automatic)},instance);
}
function updateCorrelation(runtime,afterUpdate){
  if(afterUpdate)try{
    const {correlation_id:id}=JSON.parse(fs.readFileSync(path.join(runtime,'update-recovery.json'),'utf8'));
    if(validId(id))return id;
  }catch{}
  return correlation();
}
module.exports={correlation,recorder,reasons,checkRows,diagnostic,update,recovery,updateCorrelation,CHECK_IDS};
