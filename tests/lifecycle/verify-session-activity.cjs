const fs=require('node:fs'),path=require('node:path'),{test}=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {assess,snapshot}=require('../../src/lifecycle/recovery/session-activity.cjs');
const dir=process.argv[2],started=Date.now()/1000-20;
fs.mkdirSync(dir,{recursive:true});
function fixture(){
  const home=fs.mkdtempSync(path.join(dir,'activity-')),dbFile=path.join(home,'state_5.sqlite');
  fs.mkdirSync(path.join(home,'sessions'));
  const db=new DatabaseSync(dbFile);
  db.exec('CREATE TABLE threads(rollout_path TEXT,updated_at INTEGER)');
  const insert=db.prepare('INSERT INTO threads VALUES (?,?)');
  return {home,db,dbFile,add(name,values,time=Date.now()/1000){
    const file=path.join(home,'sessions',name+'.jsonl');
    fs.writeFileSync(file,values.map(x=>JSON.stringify(x)+'\n').join(''));
    insert.run(file,Math.floor(time));return file;
  },insert};
}
const event=(type,at=started+1)=>({timestamp:new Date(at*1000).toISOString(),type:'event_msg',payload:{type}});
const state=(f,options)=>snapshot(f.home,started,options).state;
for(const [name,data,expected] of [
  ['unfinished',[event('task_started')],'busy'],['done',[event('task_started'),event('task_complete')],'idle'],
  ['aborted',[event('turn_started'),event('turn_aborted')],'idle'],
  ['text-lure',[event('task_started'),{type:'response_item',payload:{text:'task_complete'}}],'busy'],
  ['non-boundaries',[{type:'response_item'}],'unknown'],['old-boundary',[event('task_started',started-30)],'unknown'],
  ['future-boundary',[event('task_complete',Date.now()/1000+20)],'unknown'],
])test(name,()=>{
  const f=fixture();try{f.add(name,data);assert.equal(state(f),expected);}finally{f.db.close();}
});
test('background work and privacy',()=>{
  const f=fixture();
  try{f.add('private-name',[event('task_started')]);f.add('idle',[event('task_complete')]);
    const result=snapshot(f.home,started);
    assert.deepEqual(Object.keys(result),['state','activeCount','checkedAt']);
    assert.equal(result.activeCount,1);assert.doesNotMatch(JSON.stringify(result),/private-name|task_started/);
  }finally{f.db.close();}
});
test('incomplete, bounded and pre-launch tails fail closed',()=>{
  const f=fixture();
  try{
    const file=f.add('a',[event('task_complete'),{type:'response_item',payload:'x'.repeat(1000)}]);
    assert.equal(state(f,{bytes:120}),'unknown');
    fs.appendFileSync(file,'{"type":');assert.equal(state(f),'unknown');
    fs.utimesSync(file,started-100,started-100);assert.equal(state(f),'idle');
  }finally{f.db.close();}
});
test('reject unrelated paths and bound candidate count',()=>{
  const f=fixture();
  try{
    const foreign=path.join(f.home,'foreign.jsonl');fs.writeFileSync(foreign,JSON.stringify(event('task_complete'))+'\n');
    f.insert.run(foreign,Math.floor(started+3));assert.equal(state(f),'unknown');
    f.db.exec('DELETE FROM threads');
    const file=f.add('same',[event('task_complete')]);for(let n=0;n<256;n++)f.insert.run(file,Math.floor(started+2));
    assert.equal(state(f),'unknown');
    assert.equal(state(f,{milliseconds:0}),'unknown');
  }finally{f.db.close();}
});
test('a database commit during the snapshot cannot authorize closing',()=>{
  const f=fixture();
  try{
    f.add('a',[event('task_complete')]);
    assert.equal(state(f,{boundary:()=>{f.insert.run('new-session',Math.floor(started+2));return 'idle';}}),'unknown');
  }finally{f.db.close();}
});
test('no target is idle; missing database or a reused PID is unknown',async()=>{
  const f=fixture();f.db.close();fs.rmSync(f.dbFile);
  assert.equal((await assess({codexHome:f.home},null)).state,'idle');
  assert.equal((await assess({codexHome:f.home},{pid:1,started,created:'A'},{identify:async()=>({matches:true,created:'B'})})).state,'unknown');
  assert.equal((await assess({codexHome:f.home},{pid:1,started,created:'A'},{identify:async()=>({matches:true,created:'A',started})})).state,'unknown');
});
test('activity worker uses read-only SQLite and only the verified target',async()=>{
  const f=fixture();
  try{
    f.add('busy',[event('turn_started')]);
    const before=fs.readFileSync(f.dbFile);
    const result=await assess({codexHome:f.home},{pid:1,started:started+900,created:'A'},
      {identify:async()=>({matches:true,created:'A',started})});
    assert.equal(result.state,'busy');assert.deepEqual(fs.readFileSync(f.dbFile),before);
  }finally{f.db.close();}
});
