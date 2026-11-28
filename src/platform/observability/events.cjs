// Never serialize caller objects or exception text.
const {createHash,randomUUID}=require('node:crypto');
const SCHEMA_VERSION=1,RETENTION_SECONDS=5*86400;
const TOKEN=/^[A-Za-z][A-Za-z0-9_-]{0,79}$/,IDENTITY=/^[a-f0-9]{32,64}$/;
const STATES=new Set('pass fail warning unknown pending notApplicable healthy partial failed checking success blocked cancelled observed waiting loaded unavailable started stopped idle busy'.split(' '));
const FIELDS=new Set('phase reason previous_phase state activity_state gateway_state proxy_state network_state error_category'.split(' '));
const NUMBERS=new Set('pid controller_pid window_count active_count exit_code duration_ms'.split(' '));
const FLAGS=new Set('allowed automatic needed success complete after_update loaded'.split(' '));
const VERSIONS=new Set(['package_version','previous_version']);
const validId=value=>typeof value==='string'&&IDENTITY.test(value)&&!/\s/.test(value);
const symbol=value=>typeof value==='string'&&TOKEN.test(value)&&!/\s/.test(value);
const identity=()=>randomUUID().replaceAll('-','');
const hash=value=>createHash('sha256').update(value).digest('hex');
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
function timestamp(value=new Date()){
  if(typeof value==='string'){
    if(!/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d(?::\d\d(?:[.,]\d+)?)?(?:Z|[+-]\d\d(?::?\d\d)?)$/.test(value)||/[\r\n]/.test(value))
      throw new RangeError('timezone_required');
    const y=+value.slice(0,4),m=+value.slice(5,7),d=+value.slice(8,10);
    const check=new Date(0);check.setUTCFullYear(y,m-1,d);
    if(y<1||check.getUTCMonth()!==m-1||check.getUTCDate()!==d||+value.slice(11,13)>23)throw new RangeError('invalid_timestamp');
    value=new Date(value.replace(',','.').replace(/([+-]\d\d)$/,'$1:00'));
  }else if(typeof value==='number')value=new Date(value*1000);
  if(!(value instanceof Date)||!Number.isFinite(value.getTime())||value.getUTCFullYear()<1||value.getUTCFullYear()>9999)
    throw new RangeError('invalid_timestamp');
  return value.toISOString();
}
function payload(value){
  const result={};
  if(!object(value))return result;
  for(const [key,item] of Object.entries(value)){
    if(FIELDS.has(key)&&symbol(item)||NUMBERS.has(key)&&Number.isFinite(item)&&Math.abs(item)<1e12||
      FLAGS.has(key)&&typeof item==='boolean'||VERSIONS.has(key)&&typeof item==='string'&&/^\d{1,10}(?:\.\d{1,10}){1,3}$/.test(item)&&!/\s/.test(item))
      result[key]=item;
    else if(key==='checks'&&Array.isArray(item)){
      result.checks=item.slice(0,16).filter(row=>object(row)&&symbol(row.id)&&STATES.has(row.state)).map(row=>({
        id:row.id,state:row.state,...(Array.isArray(row.codes)?{codes:row.codes.slice(0,32).filter(symbol)}:{})}));
    }
  }
  return result;
}
function event(kind,status,source,correlation_id,instance,occurred_at,context){
  if(!symbol(kind)||!symbol(source)||!STATES.has(status))throw new TypeError('invalid_event');
  correlation_id=correlation_id||identity();
  if(!validId(correlation_id))throw new TypeError('invalid_correlation');
  const observed=timestamp();
  return {event_id:hash(source+':'+kind+':'+(instance||identity())),occurred_at:occurred_at==null?observed:timestamp(occurred_at),
    observed_at:observed,kind,status,source,correlation_id,payload:payload(context)};
}
function validate(value){
  if(!object(value)||!validId(value.event_id)||!validId(value.correlation_id)||
    !symbol(value.kind)||!symbol(value.source)||!STATES.has(value.status)||value.occurred_at==null||value.observed_at==null)
    throw new TypeError('invalid_event');
  const {event_id,kind,status,source,correlation_id}=value;
  return {event_id,occurred_at:timestamp(value.occurred_at),observed_at:timestamp(value.observed_at),
    kind,status,source,correlation_id,payload:payload(value.payload)};
}
module.exports={SCHEMA_VERSION,RETENTION_SECONDS,validId,identity,hash,timestamp,event,validate};
