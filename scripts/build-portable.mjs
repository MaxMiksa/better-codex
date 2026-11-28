import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {spawnSync} from 'node:child_process';
import {archive,ROOT,publicFiles,productVersion,readJson,sha,workDirectory,NATIVE} from './package.mjs';
import {readZip} from './release-zip.mjs';

const {values}=parseArgs({options:{work:{type:'string',default:'.validation-runtime/portable-build'}}});
const work=workDirectory(values.work);
const lock=readJson(path.join(ROOT,'scripts/portable-lock.json')),v=productVersion();
if(Object.keys(lock).join()!=='node'||!/^24\.\d+\.\d+$/.test(lock.node.version)||!/^[a-f0-9]{64}$/.test(lock.node.sha256)||
  lock.node.url!=='https://nodejs.org/dist/v'+lock.node.version+'/node-v'+lock.node.version+'-win-x64.zip')
  throw Error('Portable lock must contain only the pinned Node.js 24 x64 distribution');
const downloads=path.join(work,'downloads');
fs.mkdirSync(downloads,{recursive:true});
if(fs.realpathSync.native(downloads).toLowerCase()!==downloads.toLowerCase())throw Error('Redirected runtime cache');
const cache=path.join(downloads,path.basename(lock.node.url));
let upstream;
if(fs.existsSync(cache)){
  if(fs.lstatSync(cache).isSymbolicLink())throw Error('Redirected runtime download');
  upstream=fs.readFileSync(cache);
}else{
  const response=await fetch(lock.node.url,{signal:AbortSignal.timeout(90000)});
  if(!response.ok)throw Error('Node download failed: '+response.status);
  const chunks=[];let bytes=0;
  for await(const chunk of response.body){
    if((bytes+=chunk.length)>100*1024*1024)throw Error('Node download exceeded limit');
    chunks.push(chunk);
  }
  upstream=Buffer.concat(chunks);
}
if(sha(upstream)!==lock.node.sha256)throw Error('Node download digest mismatch');
if(!fs.existsSync(cache))fs.writeFileSync(cache,upstream,{flag:'wx'});
const upstreamFiles=readZip(upstream),prefix='node-v'+lock.node.version+'-win-x64/';
const runtimes=['node.exe','LICENSE'].map(name=>['runtime/node/'+name,upstreamFiles.get(prefix+name)()]);
const staging=path.join(work,'app-v'+v);
fs.mkdirSync(staging); // Do not reuse a staged payload.
function run(file,args){
  const result=spawnSync(file,args,{cwd:ROOT,windowsHide:true,stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)throw Error('Compiler failed: '+result.status);
}
run(process.execPath,[path.join(ROOT,'scripts/build-native.mjs')]);
const assembly=path.join(work,'AssemblyInfo.cs');
fs.writeFileSync(assembly,'using System.Reflection;\n[assembly: AssemblyTitle("Better-Codex")]\n[assembly: AssemblyVersion("'+v+'.0")]\n[assembly: AssemblyFileVersion("'+v+'.0")]\n');
const executable=path.join(staging,'BetterCodex.exe');
run(path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),[
  '/nologo','/codepage:65001','/target:winexe','/platform:x64','/optimize+','/reference:System.Windows.Forms.dll',
  '/reference:System.Web.Extensions.dll','/win32icon:'+path.join(ROOT,'src/native/codex.ico'),'/out:'+executable,
  path.join(ROOT,'src/app/PortableLauncher.cs'),path.join(ROOT,'src/platform/i18n/NativeI18n.cs'),assembly]);
const product=publicFiles(false).map(file=>[file,fs.readFileSync(path.join(ROOT,file))]);
const native=product.find(([file])=>file===NATIVE);
const exe=['BetterCodex.exe',fs.readFileSync(executable)];
const manifest={productVersion:v,architecture:'windows-x64',dependencies:lock,
  files:Object.fromEntries([...runtimes,native,exe].map(([file,bytes])=>[file,sha(bytes)]))};
const entries=[...product,...runtimes,exe,['runtime/manifest.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n')]];
for(const [file,bytes] of entries){
  if(file===exe[0])continue;
  const to=path.join(staging,file);fs.mkdirSync(path.dirname(to),{recursive:true});fs.writeFileSync(to,bytes,{flag:'wx'});
}
console.log(JSON.stringify({...archive(v,'windows-x64-portable',entries),staging}));
