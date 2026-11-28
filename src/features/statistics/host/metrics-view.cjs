const {translate}=require('../../../platform/i18n/i18n.js');
function formatMetrics(data,id,now=Date.now(),locale='en') {
  const t=(key,values)=>translate(locale,key,values);
  const empty=age=>({ttft:'-s',speed:'- tok/s',cache:'-%',age});
  if (!data || data.binding!=='ok' || data.thread_id!==id) return empty(t('waiting'));
  const heartbeat=now-data.updated_at_ms;
  if (!Number.isFinite(heartbeat) || heartbeat<0 || heartbeat>6000) return empty(t('disconnected'));
  if(data.source?.state!=='ok')return empty(t('waiting'));
  const metrics=data.metrics,last=metrics?.last;
  if (!last || last.model && metrics.model && last.model!==metrics.model) return empty(t('waiting'));
  if(metrics.turn_started_at_ms>last.measured_at_ms || metrics.turn_id && last.turn_id && metrics.turn_id!==last.turn_id)return empty(t('waiting'));
  const age=now-last.measured_at_ms;
  if(!Number.isFinite(age)||age<0)return empty(t('waiting'));
  const ttft=Number.isFinite(metrics.turn_ttft_ms)&&metrics.turn_ttft_ms>0?(metrics.turn_ttft_ms/1000).toFixed(2)+'s':'-s';
  const mode=metrics.speed_mode??'magpie',sample=metrics.turn_speed??(metrics.speed_mode?null:last);
  const current=sample&&(!metrics.turn_id||sample.turn_id===metrics.turn_id)&&
    (!metrics.turn_started_at_ms||sample.measured_at_ms>=metrics.turn_started_at_ms)&&
    (!metrics.turn_speed||sample.turn_started_at_ms===metrics.turn_started_at_ms)&&
    (!sample.model||!metrics.model||sample.model===metrics.model)&&sample.measured_at_ms<=now;
  const basis=mode==='local'?sample?.source==='response'&&sample?.rate_basis==='response-request-average-v2':
    sample?.source==='magpie'&&sample?.rate_basis==='magpie-native-speed-v1';
  const speed=current&&basis&&Number.isFinite(sample.rate)&&sample.rate>0?sample.rate.toFixed(0)+' tok/s':'- tok/s';
  if(age>=900000)return {...empty(t('expired')),ttft,speed:mode==='magpie'&&metrics.turn_speed?speed:'- tok/s'};
  const seconds=Math.floor(age/1000),time=seconds<60?seconds+'s':Math.floor(seconds/60)+'min';
  return {ttft,
    speed,
    cache:Number.isFinite(last.cache_percent)&&last.cache_percent>=0&&last.cache_percent<=100?last.cache_percent.toFixed(0)+'%':'-%',age:time};
}
module.exports={formatMetrics};
