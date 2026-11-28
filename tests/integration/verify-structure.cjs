const fs=require('node:fs'),path=require('node:path'),{test}=require('node:test'),assert=require('node:assert/strict');
const {ROOT}=require('../../src/platform/paths.cjs');
const {features}=require('../../src/runtime/feature-registry.cjs');
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()&&!e.isSymbolicLink()&&e.name!=='node_modules'?
  walk(path.join(dir,e.name)):e.isFile()?[path.join(dir,e.name)]:[]);
test('Python, legacy bridges, and embedded dependency manifests are absent',()=>{
  for(const dir of ['src','scripts','tests'])assert.ok(!walk(path.join(ROOT,dir)).some(f=>/\.py$/i.test(f)),dir);
  for(const file of ['tools','requirements.txt'])assert.equal(fs.existsSync(path.join(ROOT,file)),false,file);
  const pack=require('../../package.json');
  assert.equal(pack.version,'1.0.0');assert.match(pack.engines.node,/24/);
  assert.deepEqual(Object.keys(require('../../scripts/portable-lock.json')),['node']);
});
test('source and runtime packaging keep the development boundary',async()=>{
  const {publicFiles}=await import('../../scripts/package.mjs'),runtime=publicFiles(false),source=publicFiles();
  for(const file of ['tsconfig.json','src/native/BetterCodexNative.cs','src/app/PortableLauncher.cs','scripts/check.mjs']){
    assert.ok(source.includes(file));assert.ok(!runtime.includes(file));
  }
  for(const file of ['src/generated/native/BetterCodexNative.exe','src/native/codex.ico','src/app/portable-bootstrap.cjs','src/lifecycle/diagnostics/StartupCheckDialog.cs','src/app/supervisor.cjs','src/runtime/controller.cjs'])
    assert.ok(runtime.includes(file),file);
  assert.ok(runtime.some(f=>f.startsWith('src/generated/ui/')));
  assert.ok(source.some(f=>/^src\/features\/.*\/ui\/.*\.css$/.test(f)));
  assert.ok(!runtime.some(f=>/\.(ts|css)$/.test(f)));
});
test('registered cases resolve, use direct entrypoints, and stay within the test tree',()=>{
  for(const c of Object.values(require('../cases.json'))){
    assert.ok(['node','powershell','pwsh'].includes(c.kind));assert.match(c.path,/^tests\//);
    assert.ok(fs.statSync(path.join(ROOT,c.path)).isFile());
  }
  const rootEntries={'Start.cmd':['src\\app\\Start-ComposerHud.ps1','start-better-codex.vbs'],
    'Stop.cmd':['src\\lifecycle\\startup\\Stop-ComposerHud.ps1'],'Install.ps1':['src/app/portable-bootstrap.cjs'],
    'Finish-Rename.cmd':['src\\lifecycle\\installation\\Repair-WorkspacePaths.ps1']};
  for(const [file,expect] of Object.entries(rootEntries)){
    const value=fs.readFileSync(path.join(ROOT,file),'utf8');
    for(const fragment of expect)assert.ok(value.includes(fragment),file+' '+fragment);
    assert.doesNotMatch(value,/python|tools[\\/]token-hud-local/i);
  }
});
test('feature layer remains isolated and any generated paths in the registry exist',()=>{
  const file=path.join(ROOT,'src/runtime/feature-registry.cjs'),source=fs.readFileSync(file,'utf8');
  assert.match(source,/['"]ui['"]/);
  for(const {name} of fs.readdirSync(path.join(ROOT,'src/features'),{withFileTypes:true}).filter(e=>e.isDirectory())){
    const base=path.join(ROOT,'src/features',name);
    for(const file of walk(base).filter(f=>/\.cjs$/.test(f)&&!f.endsWith('config-parsers.cjs'))){
      const src=fs.readFileSync(file,'utf8');
      for(const match of src.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)){
        const target=path.relative(path.join(ROOT,'src/features'),path.resolve(path.dirname(file),match[1]));
        assert.ok(target.startsWith('..'+path.sep)||target.split(path.sep)[0]===name,name+' imports '+target);
      }
    }
  }
  assert.ok(features.length>0);
  for(const {file} of features)assert.ok(fs.statSync(path.join(ROOT,'src/generated/ui',file+'.js')).isFile());
});
