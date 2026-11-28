const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{test}=require('node:test');
const {layout,atomic,read}=require('../../src/platform/paths.cjs');
const {migrate,createSettingsStore}=require('../../src/platform/settings/settings-store.cjs');
const work=process.argv[2];
fs.mkdirSync(work,{recursive:true});
const preferences={
  readingWidth:1290,assistantFontSize:16,chatTitleCentered:true,workspaceTreeEnabled:true,composerAutoHide:true,
  composerAutoHideStyle:'minimal',composerAutoHideAfterSend:true,fileChangesDefaultCollapsed:true,customAccent:false,
  tableEnabled:true,tableCentered:true,tableSortMode:'numeric',commandMenuEnabled:true,commandVisible:{side:false},
  commandGroupOrder:['project','chat'],commandItemOrder:{project:['rename']},commandSectionOrder:['command','skill'],
  skillVisible:{helper:false},metricOrder:['tps','ttft'],metricVisible:{tps:true,ttft:false},port:19421,
  codexHome:'D:\\旧 用户\\Codex',node:process.execPath,recoverAfterUpdate:true,workspaceTreeQuickLookPath:'C:\\QuickLook.exe',
  workspaceTreePreviewPath:'C:\\Preview.exe',promptDiagnosticsCommand:'D:\\只读 probe.cjs',unknown:{nested:['配置',null,7]}
};
test('legacy preferences, unknown values, and both update-replay receipts migrate losslessly once',async()=>{
  const p=layout(fs.mkdtempSync(path.join(work,'旧版 settings-')));
  const prior=Buffer.from('\uFEFF'+JSON.stringify(preferences,null,2).replace(/\n/g,'\r\n').replace(/}$/,',"unsafeInteger":9007199254740993,"neg":-0}'));
  const observe=Buffer.from('{"phase":"startup-check-delegated","attemptedVersion":"1.2.3.4","pendingVersion":null}');
  const action=Buffer.from('{"attempted":["update:1.2.3.4"],"consumedRequests":["'+ 'a'.repeat(32)+'"]}');
  atomic(p.legacySettings,prior);
  atomic(path.join(p.legacyState,'update-recovery.json'),observe);
  atomic(path.join(p.legacyState,'startup-relaunch.json'),action);
  const before=fs.readdirSync(p.legacy);
  assert.deepEqual((await Promise.all([migrate(p.root),migrate(p.root),migrate(p.root)])).sort(),[false,false,true]);
  assert.deepEqual(fs.readFileSync(p.settings),prior);
  assert.deepEqual(fs.readFileSync(path.join(p.state,'update-recovery.json')),observe);
  assert.deepEqual(fs.readFileSync(path.join(p.state,'startup-relaunch.json')),action);
  assert.equal(await migrate(p.root),false);
  const store=createSettingsStore(p.settings);
  await Promise.all([store.patch({port:20304}),store.patch({readingWidth:1420})]);
  const final=read(p.settings);
  assert.deepEqual(final,{...preferences,port:20304,readingWidth:1420,unsafeInteger:9007199254740992,neg:-0});
  assert.match(fs.readFileSync(p.settings,'utf8'),/9007199254740993/);
  assert.deepEqual(fs.readFileSync(p.legacySettings),prior);
  assert.deepEqual(fs.readdirSync(p.legacy),before);
});
test('existing canonical settings and interrupted newer state are never overwritten',async()=>{
  const p=layout(fs.mkdtempSync(path.join(work,'existing-')));
  atomic(p.legacySettings,'{"port":19163}');atomic(p.settings,'{"port":29163}');
  atomic(path.join(p.legacyState,'update-recovery.json'),'{"attemptedVersion":"1.0.0.0"}');
  const to=path.join(p.state,'update-recovery.json');atomic(to,'{"attemptedVersion":"2.0.0.0"}');
  assert.equal(await migrate(p.root),false);assert.equal(read(p.settings).port,29163);
  fs.unlinkSync(p.settings);
  assert.equal(await migrate(p.root),true);assert.equal(read(to).attemptedVersion,'2.0.0.0');
});
test('a malformed legacy file is left untouched and migration does not invent defaults',async()=>{
  const p=layout(fs.mkdtempSync(path.join(work,'invalid-')));
  atomic(p.legacySettings,'{invalid');
  await assert.rejects(migrate(p.root));
  assert.equal(fs.existsSync(p.settings),false);
  assert.equal(fs.readFileSync(p.legacySettings,'utf8'),'{invalid');
});
