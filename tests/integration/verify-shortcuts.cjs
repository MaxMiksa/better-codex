const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{test}=require('node:test');
const entries=require('../../src/lifecycle/installation/install-taskbar-entry.cjs');
const {checked}=require('../../src/platform/windows/native.cjs');
const {ROOT,layout,atomic}=require('../../src/platform/paths.cjs');
const work=process.argv[2];
fs.mkdirSync(work,{recursive:true});
const win=path.join(process.env.WINDIR,'System32/wscript.exe');
async function link(file,wrapper,appId=entries.APP_ID,workingDirectory){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  return checked('shortcut-install',['--input-stdin'],{input:{path:file,target:win,arguments:'"'+wrapper+'"',appId,workingDirectory}});
}
test('legacy project, numbered pins and login migrate, but a different copy and old bytes are preserved',async()=>{
  const base=fs.mkdtempSync(path.join(work,'快捷方式-')),root=path.join(base,'owned copy'),other=path.join(base,'different copy'),appdata=path.join(base,'appdata');
  fs.mkdirSync(other);
  const p=layout(root),[early,later]=p.legacyWrappers;
  atomic(early,'old project and login wrapper');atomic(later,'old taskbar wrapper');
  const [project,startup]=entries.links(root,appdata).map(x=>x.file);
  const pin=path.join(appdata,'Microsoft/Internet Explorer/Quick Launch/User Pinned/TaskBar/Codex.lnk');
  const numbered=path.join(path.dirname(pin),'Codex (2).lnk'),foreign=path.join(path.dirname(pin),'Codex (3).lnk');
  await link(project,early,entries.APP_ID,root);
  await link(startup,early,entries.APP_ID,root);
  await link(pin,later,entries.APP_ID,root);
  await link(numbered,early,'com.openai.codex',root);
  await link(foreign,layout(other).wrapper,entries.APP_ID,other);
  const before=fs.readFileSync(foreign),oldPin=fs.readFileSync(pin);
  const result=await entries.install({root,previousRoot:other,appdata});
  assert.equal(result.updatedShortcuts.length,4);
  assert.deepEqual(result.skippedUnmanagedShortcuts,[foreign]);
  for(const file of [project,startup,pin,numbered]){
    const info=await entries.inspect(file);
    assert.equal(info.arguments,'"'+p.wrapper+'"');assert.equal(info.appId,entries.APP_ID);
    assert.equal(info.workingDirectory,root);assert.equal(info.icon,path.join(p.launchers,'codex.ico'));
  }
  assert.deepEqual(fs.readFileSync(foreign),before);
  assert.deepEqual(fs.readFileSync(path.join(result.recovery,'taskbar.lnk')),oldPin);
  assert.equal(fs.readFileSync(early,'utf8'),'old project and login wrapper');
  assert.equal(fs.readFileSync(later,'utf8'),'old taskbar wrapper');
  assert.ok(fs.readFileSync(p.wrapper,'utf16le').includes(path.join(root,'src/app/Start-ComposerHud.ps1')));
  assert.equal((await entries.install({root,appdata})).updatedShortcuts.length,4);
});
test('foreign project entry and a replaced wrapper fail closed before any shortcut write',async()=>{
  const root=fs.mkdtempSync(path.join(work,'foreign-')),appdata=path.join(root,'appdata'),p=layout(root);
  const [{file:project}]=entries.links(root,appdata);
  await link(project,layout(ROOT).wrapper);
  const bytes=fs.readFileSync(project);
  await assert.rejects(entries.install({root,appdata}),/shortcut-ownership-conflict/);
  assert.deepEqual(fs.readFileSync(project),bytes);
  fs.unlinkSync(project);
  atomic(p.wrapper,'modified');
  await assert.rejects(entries.install({root,appdata}),/wrapper-ownership-conflict/);
  assert.equal(fs.existsSync(project),false);
});
