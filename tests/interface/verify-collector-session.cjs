// The sampler must never spawn, and restart attempts are scoped to this session.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {ChildProcess}=require('node:child_process');
const launch=ChildProcess.prototype.spawn;
let launched=0;
ChildProcess.prototype.spawn=function(){launched++;throw Error('Unexpected collector subprocess');};
const {createCollector}=require('../../src/runtime/collector-session.cjs');
const work=process.argv[2];fs.mkdirSync(work,{recursive:true});
const fixture=path.join(work,'metrics.json'),clock={value:1000};
const {setTimeout:pending}=require('node:timers/promises');
let created=0,fail=true;
const session=createCollector({settings:{codexHome:work},runtime:work,clock:()=>clock.value,
  makeSampler:()=>{
    created++;
    return async()=>{if(fail)throw Error('fixture');return {thread_id:'bound',collector_pid:process.pid};};
  }});
async function tick(now){clock.value=now;const status=session.tick();await pending(20);return status;}
(async()=>{
  try{
    fs.writeFileSync(fixture,'{"collector_pid":1,"updated_at_ms":999999999999999}');
    assert.equal(session.snapshot(),null); // Never trust a stale file, even with a newer timestamp.
    assert.equal((await tick(1000)).phase,'running');
    assert.equal((await tick(1100)).phase,'backoff');
    assert.equal(session.snapshot(),null);
    await tick(2000);await tick(3000);await tick(5000);assert.equal(created,3);
    fail=false;
    assert.equal((await tick(61000)).phase,'running');
    for(let i=0;!session.snapshot()&&i<30;i++)await pending();
    assert.equal(created,4);assert.equal(session.snapshot()?.collector_pid,process.pid);
    assert.equal(JSON.parse(fs.readFileSync(fixture,'utf8')).thread_id,'bound');
    await session.stop();
    await tick(62000);assert.equal(session.snapshot(),null);assert.equal(created,4);
    assert.equal(launched,0);
    console.log(JSON.stringify({passed:11,collectorSubprocessLaunches:0}));
  }finally{ChildProcess.prototype.spawn=launch;}
})().catch(error=>{console.error(error);process.exitCode=1;});
