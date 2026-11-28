import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {parseArgs,isDeepStrictEqual} from 'node:util';
import {ROOT,NATIVE,publicFiles,productVersion,readJson,sha,workDirectory} from './package.mjs';
import {readZip} from './release-zip.mjs';
import shortcuts from '../src/lifecycle/installation/install-taskbar-entry.cjs';

const {values}=parseArgs({options:{source:{type:'string'},portable:{type:'string'},work:{type:'string'}}});
if(!values.source||!values.portable||!values.work)throw Error('Specify --source, --portable and a fresh --work');
const work=workDirectory(values.work,{fresh:true}),version=productVersion(),checks=[];
function check(name,condition){assert.ok(condition,name);checks.push(name);}
const bytes=Object.fromEntries(['source','portable'].map(key=>[key,fs.readFileSync(path.resolve(values[key]))]));
function contents(key,kind){
  const files=readZip(bytes[key]),prefix='better-codex-v'+version+'-'+kind+'/';
  check(key+'-versioned-root',files.size>0&&[...files.keys()].every(name=>name.startsWith(prefix)));
  const all=new Map([...files].map(([name,read])=>[name.slice(prefix.length),read()]));
  check(key+'-checked-crc-and-unique-bounded-paths',files.size===all.size);
  return all;
}
const source=contents('source','source'),portable=contents('portable','windows-x64-portable');
const product=publicFiles(false),sourceFiles=publicFiles();
const exact=(files,expected)=>files.size===expected.length&&expected.every(name=>files.get(name)?.equals(fs.readFileSync(path.join(ROOT,name))));
check('source-file-set-and-content',exact(source,sourceFiles));
check('portable-product-content',product.every(name=>portable.get(name)?.equals(fs.readFileSync(path.join(ROOT,name)))));
const names=[...source.keys(),...portable.keys()];
check('no-private-state',!names.some(name=>name.split('/').some(part=>/^(\.runtime|\.validation-runtime|node_modules|__pycache__|prompts|evidence|files)$/i.test(part))));
check('zero-retired-runtime-files',!names.some(name=>/^(tools|runtime\/python)\//i.test(name)||/\.(py|pyc|pyd|whl)$/i.test(name)||/requirements\.txt$/i.test(name)));
check('portable-has-builds-not-development-sources',!Array.from(portable.keys()).some(name=>/^(tests|scripts)\//.test(name)||
  /\.(ts|css)$/.test(name)||name==='tsconfig.json'||/^src\/native\/.*\.cs$/.test(name))&&portable.has(NATIVE)&&
  Array.from(portable.keys()).some(name=>name.startsWith('src/generated/ui/')));
const manifest=JSON.parse(portable.get('runtime/manifest.json')),runtimes=['runtime/node/node.exe','runtime/node/LICENSE'];
const shipped=[...runtimes,NATIVE,'BetterCodex.exe'];
check('portable-manifest-version-and-lock',manifest.productVersion===version&&manifest.architecture==='windows-x64'&&
  isDeepStrictEqual(manifest.dependencies,readJson(path.join(ROOT,'scripts/portable-lock.json'))));
check('portable-only-pinned-node',Object.keys(manifest.dependencies).join()==='node'&&/^24\./.test(manifest.dependencies.node.version));
check('portable-runtime-digests',Object.keys(manifest.files).length===shipped.length&&
  shipped.every(name=>sha(portable.get(name))===manifest.files[name]));
const expectedPortable=new Set([...product,...runtimes,'BetterCodex.exe','runtime/manifest.json']);
check('portable-exact-file-set',portable.size===expectedPortable.size&&[...expectedPortable].every(name=>portable.has(name)));
for(const key of ['source','portable']){
  const file=path.resolve(values[key]),lines=fs.readFileSync(path.join(path.dirname(file),'SHA256SUMS.txt'),'utf8').split(/\r?\n/);
  check(key+'-archive-sha256',lines.includes(sha(bytes[key])+'  '+path.basename(file)));
}
const app=path.join(work,'portable'),appdata=path.join(work,'appdata'),home=path.join(work,'synthetic-home');
for(const [name,content] of portable){
  const file=path.join(app,name);
  fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content,{flag:'wx'});
}
const env={...process.env,PATH:path.join(process.env.WINDIR,'System32'),APPDATA:appdata,CODEX_HOME:home};
delete env.NODE_OPTIONS;delete env.NODE_PATH;
function invoke(folder,mode,locale='auto'){
  const result=spawnSync(path.join(folder,'BetterCodex.exe'),[mode],{cwd:folder,env:{...env,BETTER_CODEX_LANGUAGE:locale},
    encoding:'utf8',windowsHide:true,timeout:90000});
  if(result.error)throw result.error;
  assert.equal(result.status,0,mode+': '+result.stdout+result.stderr);
  return JSON.parse(result.stdout.replace(/^\uFEFF/,''));
}
for(const locale of ['en','zh-CN','auto']){
  const receipt=invoke(app,'--check',locale);
  check('restricted-path-check-'+locale,receipt.status==='ready'&&receipt.downloads===false&&
    receipt.writesPerformed===false&&(locale==='auto'||receipt.locale===locale));
}
check('check-does-not-create-state',!fs.existsSync(path.join(app,'.runtime'))&&!fs.existsSync(appdata));
for(let i=0;i<2;i++)check('prepare-idempotent-'+i,invoke(app,'--prepare-only').status==='prepared');
const settings='.runtime/settings.json',project='launchers/Codex.lnk';
const config=readJson(path.join(app,settings));
check('fresh-settings-no-retired-fields',Object.keys(config).sort().join()==='codexHome,node,port'&&config.codexHome===home);
const installed=await shortcuts.inspect(path.join(app,project));
check('source-copy-entry-resolves-to-flat-wrapper',installed.arguments==='"'+path.join(app,'.runtime/launchers/start-better-codex.vbs')+'"');
fs.writeFileSync(path.join(app,settings),JSON.stringify({...config,readingWidth:1280,customAccent:false,unknown:{keep:true}}));
const moved=path.join(work,'移动后的 portable');
fs.renameSync(app,moved);
check('prepare-after-unicode-space-move',invoke(moved,'--prepare-only').status==='prepared');
const data=readJson(path.join(moved,settings));
check('move-keeps-preferences',data.readingWidth===1280&&data.customAccent===false&&data.unknown.keep);
check('move-rebases-only-private-runtime',data.node===path.join(moved,'runtime/node/node.exe')&&data.codexHome===home);
const repaired=await shortcuts.inspect(path.join(moved,project));
check('move-repairs-owned-link',repaired.appId===shortcuts.APP_ID&&repaired.workingDirectory===moved&&
  repaired.arguments==='"'+path.join(moved,'.runtime/launchers/start-better-codex.vbs')+'"');
const migration=path.join(work,'旧版 文件夹');
fs.mkdirSync(migration);fs.cpSync(moved,migration,{recursive:true,filter:source=>{
  const rel=path.relative(moved,source);
  return !rel||!['.runtime','launchers'].includes(rel.split(path.sep)[0]);
}});
const legacy=path.join(migration,'.runtime/token-hud/embedded'),snapshot='{"node":'+JSON.stringify(path.join(migration,'runtime/node/node.exe'))+
  ',"codexHome":'+JSON.stringify(home)+',"port":19263,"readingWidth":1199,"unknown":9007199254740993}';
fs.mkdirSync(path.join(legacy,'runtime'),{recursive:true});
fs.writeFileSync(path.join(legacy,'settings.json'),snapshot);
const update='{"observedVersion":"1.2.3.4","attemptedVersion":"1.2.3.4","pendingVersion":null}';
fs.writeFileSync(path.join(legacy,'runtime/update-recovery.json'),update);
check('prepare-migrates-legacy-install',invoke(migration,'--prepare-only').status==='prepared');
check('legacy-is-not-overwritten',fs.readFileSync(path.join(legacy,'settings.json'),'utf8')===snapshot&&
  fs.readFileSync(path.join(legacy,'runtime/update-recovery.json'),'utf8')===update);
check('settings-and-recovery-lossless',fs.readFileSync(path.join(migration,settings),'utf8').includes('9007199254740993')&&
  readJson(path.join(migration,settings)).readingWidth===1199&&
  fs.readFileSync(path.join(migration,'.runtime/state/update-recovery.json'),'utf8')===update);
const result={passed:checks.length,checks,sourceFiles:source.size,portableFiles:portable.size,
  sourceBytes:bytes.source.length,portableBytes:bytes.portable.length,scope:'ZIPs and non-activating modes; synthetic APPDATA and home'};
fs.writeFileSync(path.join(work,'results.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
