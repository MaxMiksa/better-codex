function formatMetrics(data,id,now=Date.now()) {
  const empty=age=>({speed:'— tok/s',cache:'—%',age});
  if (!data || data.binding!=='ok' || data.thread_id!==id) return empty('等待统计');
  const heartbeat=now-data.updated_at_ms;
  if (!Number.isFinite(heartbeat) || heartbeat<0 || heartbeat>6000) return empty('采集未连接');
  if(data.source?.state!=='ok')return empty('等待统计');
  const metrics=data.metrics,last=metrics?.last;
  if (!last || last.model && metrics.model && last.model!==metrics.model) return empty('等待统计');
  if(metrics.stage!=='idle' && (metrics.turn_started_at_ms>last.measured_at_ms || metrics.turn_id && last.turn_id && metrics.turn_id!==last.turn_id))return empty('等待统计');
  const age=now-last.measured_at_ms;
  if(!Number.isFinite(age)||age<0)return empty('等待统计');
  if(age>=900000)return empty('数据已过期');
  const seconds=Math.floor(age/1000),time=seconds<2?'刚刚':seconds<60?seconds+'秒前':Math.floor(seconds/60)+'分钟前';
  return {speed:Number.isFinite(last.rate)&&last.rate>=0?last.rate.toFixed(0)+' tok/s':'— tok/s',
    cache:Number.isFinite(last.cache_percent)&&last.cache_percent>=0&&last.cache_percent<=100?last.cache_percent.toFixed(0)+'%':'—%',age:time};
}
module.exports={formatMetrics};
