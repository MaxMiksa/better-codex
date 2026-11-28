// Only bounded boundary names and aggregate state leave the read-only worker.
const fs=require('node:fs'),path=require('node:path');
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const {DatabaseSync}=require('node:sqlite');
const {codexHome}=require('../startup/model-gateway.cjs'),{info}=require('../../platform/process.cjs');
const starts=new Set(['task_started','turn_started']);
const ends=new Set(['task_complete','task_completed','turn_complete','turn_aborted']);
const LIMIT=8*1024*1024;
const result=(state,activeCount=0)=>({state,activeCount,checkedAt:Date.now()/1000});
function sessionFile(home,name){
  const file=fs.realpathSync.native(path.resolve(home,name.replace(/^\\\\\?\\/,'')).normalize());
  const owned=['sessions','archived_sessions'].some(dir=>{
    const relative=path.relative(path.join(home,dir),file);
    return relative&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);
  });
  if(!owned)throw Error('Unowned session path');
  return file;
}
function latestBoundary(file,started,budget){
  const before=fs.statSync(file);
  if(!before.isFile())return 'unknown';
  if(before.mtimeMs<started*1000)return 'idle';
  const length=Math.min(before.size,budget.bytes),offset=before.size-length;
  if(!length)return 'unknown';
  const tail=Buffer.alloc(length),fd=fs.openSync(file,'r');
  try{budget.bytes-=length;if(fs.readSync(fd,tail,0,length,offset)!==length)return 'unknown';}
  finally{fs.closeSync(fd);}
  if(tail.at(-1)!==10)return 'unknown';
  for(let end=length-1;end>=0;){
    if(performance.now()>budget.deadline)return 'unknown';
    const previous=end>0?tail.lastIndexOf(10,end-1):-1,start=previous+1;
    if(end===0||previous<0&&offset)break;
    if(end-start<=65536){
      const event=JSON.parse(tail.toString('utf8',start,end)),kind=event?.payload?.type;
      if(event?.type==='event_msg'&&(starts.has(kind)||ends.has(kind))){
        const stamp=Date.parse(event.timestamp)/1000;
        if(!(stamp>=started&&stamp<=Date.now()/1000+2))return 'unknown';
        if(starts.has(kind))return 'busy';
        const after=fs.statSync(file);
        return before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ino===after.ino&&before.dev===after.dev?'idle':'unknown';
      }
    }
    end=previous;
  }
  return 'unknown';
}
function snapshot(home,started,{milliseconds=1800,bytes=LIMIT,boundary=latestBoundary}={}){
  const budget={bytes,deadline:performance.now()+milliseconds};
  let db;
  try{
    home=fs.realpathSync.native(home);
    db=new DatabaseSync(path.join(home,'state_5.sqlite'),{readOnly:true,timeout:200});
    db.exec('PRAGMA query_only=ON');
    const version=()=>db.prepare('PRAGMA data_version').get().data_version,before=version();
    const rows=db.prepare('SELECT rollout_path FROM threads WHERE updated_at >= ? LIMIT 257').all(Math.floor(started)-1);
    let unknown=rows.length>256,active=0;
    for(const row of rows.slice(0,256)){
      if(performance.now()>=budget.deadline){unknown=true;break;}
      let state;
      try{state=boundary(sessionFile(home,row.rollout_path),started,budget);}catch{state='unknown';}
      if(state==='busy')active++;
      if(state==='unknown')unknown=true;
    }
    return active?result('busy',active):result(unknown||performance.now()>=budget.deadline||before!==version()?'unknown':'idle');
  }catch{return result('unknown');}finally{db?.close();}
}
async function assess(settings,target,{identify=info}={}){
  if(!target)return result('idle');
  const deadline=performance.now()+2000;
  try{
    const p=await identify(target.pid,{timeout:Math.max(1,Math.floor(deadline-performance.now()))});
    if(!p.matches||!Number.isFinite(p.started)||(target.created?p.created!==target.created:!(Math.abs(p.started-target.started)<=.000001)))
      return result('unknown');
    const remaining=deadline-performance.now();
    if(remaining<=0)return result('unknown');
    return await new Promise(resolve=>{
      const worker=new Worker(__filename,{workerData:{home:codexHome(settings),started:p.started,milliseconds:remaining}});
      const finish=value=>{clearTimeout(timer);worker.terminate().catch(()=>{});resolve(value);};
      const timer=setTimeout(()=>finish(result('unknown')),remaining);
      worker.once('message',finish);
      worker.once('error',()=>finish(result('unknown')));
      worker.once('exit',()=>finish(result('unknown')));
    });
  }catch{return result('unknown');}
}
if(!isMainThread&&workerData)parentPort.postMessage(snapshot(workerData.home,workerData.started,workerData));
module.exports={assess,snapshot,latestBoundary,sessionFile};
