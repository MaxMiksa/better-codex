const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{test}=require('node:test');
const {spawn}=require('node:child_process');
const {layout,read,atomic}=require('../../src/platform/paths.cjs');
const {checked}=require('../../src/platform/windows/native.cjs');
const {install,inspect,sameDirectory}=require('../../src/lifecycle/installation/install-taskbar-entry.cjs');
const {createRelocation}=require('../../src/lifecycle/installation/workspace-relocation.cjs');
const work=path.resolve(process.argv[2]);fs.mkdirSync(work,{recursive:true});
async function fixture(){
  const base=fs.mkdtempSync(path.join(work,'rename-')),old=path.join(base,'旧 名称'),next=path.join(base,'Better-Codex'),appdata=path.join(base,'appdata');
  const dependency=path.join(old,'node/node.exe');
  atomic(dependency,'synthetic');
  atomic(layout(old).settings,JSON.stringify({node:dependency,readingWidth:1100,unknown:{keep:true}}));
  await install({root:old,appdata});
  const project=root=>path.join(root,'launchers/Codex.lnk');
  const runner=options=>createRelocation({root:next,appdata,...options});
  const first=createRelocation({root:old,appdata});
  assert.equal(await first('prepare'),'prepared');assert.equal(await first('apply'),'prepared');
  fs.renameSync(old,next);
  return {old,next,appdata,dependency,project,runner};
}
test('move with spaces and Chinese rewrites only owned entries and local Node, and safely removes alias',async()=>{
  const f=await fixture(),run=f.runner();
  const project=f.project(f.next),before=fs.readFileSync(project);
  assert.equal(await run('check'),'ready');assert.deepEqual(fs.readFileSync(project),before);
  assert.equal(await run('apply'),'applied');assert.equal(sameDirectory(f.old,f.next),true);
  assert.equal((await inspect(project)).arguments,'"'+layout(f.next).wrapper+'"');
  assert.deepEqual(read(layout(f.next).settings),{node:path.join(f.next,'node/node.exe'),readingWidth:1100,unknown:{keep:true}});
  assert.equal(await run('apply'),'applied');
  const busy=spawn(process.execPath,['-e','process.stdin.resume()',f.old],{stdio:['pipe','ignore','ignore'],windowsHide:true});
  try{
    await new Promise((resolve,reject)=>{busy.once('spawn',resolve);busy.once('error',reject);});
    await assert.rejects(run('finalize'),/old-path-still-in-use/);
    assert.ok(sameDirectory(f.old,f.next));
  }finally{await new Promise(resolve=>{busy.once('close',resolve);busy.stdin.end();});}
  assert.equal(await run('finalize'),'finalized');
  assert.equal(fs.existsSync(f.old),false);assert.ok(fs.existsSync(project));
  assert.equal(await run('apply'),'finalized');
});
test('occupied former path never changes user files',async()=>{
  const f=await fixture(),run=f.runner();
  atomic(path.join(f.old,'keep.txt'),'user');
  await assert.rejects(run('apply'),/previous-path-occupied/);
  assert.equal(fs.readFileSync(path.join(f.old,'keep.txt'),'utf8'),'user');
});
test('failed install rolls back Node and links but preserves a concurrent preference patch',async()=>{
  const f=await fixture(),project=f.project(f.next),before=fs.readFileSync(project);
  const run=f.runner({install:async()=>{
    const {createSettingsStore}=require('../../src/platform/settings/settings-store.cjs');
    await createSettingsStore(layout(f.next).settings).patch({readingWidth:1408});
    atomic(project,'partial');throw Error('synthetic fault');
  }});
  await assert.rejects(run('apply'),/synthetic fault/);
  assert.deepEqual(fs.readFileSync(project),before);
  assert.deepEqual(read(layout(f.next).settings),{node:f.dependency,readingWidth:1408,unknown:{keep:true}});
  assert.equal(sameDirectory(f.old,f.next),true);
});
test('native path probe does not echo its input',async()=>{
  const {status}=await checked('path-in-use',['--path',path.join(work,'unknown directory')]);
  assert.equal(status,'unused');
});
