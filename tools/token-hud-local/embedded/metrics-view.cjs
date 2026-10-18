const {translate}=require('./i18n.js');
function formatMetrics(data,id,now=Date.now(),locale='en') {
  const t=(key,values)=>translate(locale,key,values);
  const empty=age=>({speed:'— tok/s',cache:'—%',age});
  if (!data || data.binding!=='ok' || data.thread_id!==id) return empty(t('waiting'));
  const heartbeat=now-data.updated_at_ms;
  if (!Number.isFinite(heartbeat) || heartbeat<0 || heartbeat>6000) return empty(t('disconnected'));
  if(data.source?.state!=='ok')return empty(t('waiting'));
  const metrics=data.metrics,last=metrics?.last;
  if (!last || last.model && metrics.model && last.model!==metrics.model) return empty(t('waiting'));
  if(metrics.stage!=='idle' && (metrics.turn_started_at_ms>last.measured_at_ms || metrics.turn_id && last.turn_id && metrics.turn_id!==last.turn_id))return empty(t('waiting'));
  const age=now-last.measured_at_ms;
  if(!Number.isFinite(age)||age<0)return empty(t('waiting'));
  if(age>=900000)return empty(t('expired'));
  const seconds=Math.floor(age/1000),time=seconds<2?t('justNow'):seconds<60?t('secondsAgo',{count:seconds}):t('minutesAgo',{count:Math.floor(seconds/60)});
  return {speed:Number.isFinite(last.rate)&&last.rate>=0?last.rate.toFixed(0)+' tok/s':'— tok/s',
    cache:Number.isFinite(last.cache_percent)&&last.cache_percent>=0&&last.cache_percent<=100?last.cache_percent.toFixed(0)+'%':'—%',age:time};
}
module.exports={formatMetrics};
