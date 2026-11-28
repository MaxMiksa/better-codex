import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {writeZip} from './release-zip.mjs';

export const ROOT=fs.realpathSync.native(fileURLToPath(new URL('../',import.meta.url)));
export const DIST=path.join(ROOT,'dist'),NATIVE='src/generated/native/BetterCodexNative.exe';
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
export const main=url=>process.argv[1]&&url===pathToFileURL(path.resolve(process.argv[1])).href;
const base=['.gitignore','Finish-Rename.cmd','Install.ps1','LICENSE','README.md','README-zh.md','Start.cmd','Stop.cmd',
  'THIRD_PARTY_NOTICES.md','package.json','docs/DEVELOPMENT.md','docs/PRIVACY.md','docs/UPGRADE-v1.md','Presentation/overview.png',
  'Presentation/table-sorting.png','Presentation/file-changes.png',NATIVE];
const source=['.gitattributes','CHANGELOG.md','pnpm-lock.yaml','pnpm-workspace.yaml','release/README.md','tsconfig.json'];
const hiddenDirs=new Set(['prompts','evidence','files','private','archive','dist','runtime','node_modules','__pycache__','bin','obj','showcase']);
const hiddenFiles=new Set(['agents.md','project.md','chat_logs.md','checklist.md','settings.json','package-lock.json','npm-shrinkwrap.json','yarn.lock','bun.lock','bun.lockb']);
const extensions=new Set('.ps1 .cs .js .cjs .mjs .vbs .cmd .bat .ts .cts .mts .css .html .json .yaml .yml .md .txt .ico .svg .png .jpg .webp'.split(' '));
const allowed=(name,directory)=>!name.startsWith('.')&&!((directory?hiddenDirs:hiddenFiles).has(name.toLowerCase()))&&
  !/^(?:plan_|changelog|release_notes)/i.test(name);
function safe(file){
  const stat=fs.lstatSync(file);
  return !stat.isSymbolicLink()&&fs.realpathSync.native(file).toLowerCase()===file.toLowerCase();
}
function walk(dir){
  if(!safe(path.join(ROOT,dir)))throw Error('Redirected public directory: '+dir);
  const entries=[];
  for(const d of fs.readdirSync(path.join(ROOT,dir),{withFileTypes:true})){
    const name=d.name,file=dir+'/'+name;
    if(d.isSymbolicLink()||file!=='src/runtime'&&!allowed(name,d.isDirectory())||!safe(path.join(ROOT,file)))continue;
    if(d.isDirectory())entries.push(...walk(file));
    else if(d.isFile()&&(extensions.has(path.extname(name).toLowerCase())||['LICENSE','LUCIDE-LICENSE','VERSION'].includes(name)))entries.push(file);
  }
  return entries;
}
const sourceOnly=file=>/\.(?:[cm]?ts|css)$/.test(file)||
  /^src\/native\/.*\.cs$/.test(file)||['src/app/PortableLauncher.cs','src/platform/i18n/NativeI18n.cs'].includes(file)||
  /^src\/features\/[^/]+\/ui\//.test(file)&&!['src/features/workspace-tree/ui/tree-renderer.js',
    'src/features/workspace-tree/ui/TREE-RENDERER-LICENSES.txt'].includes(file);
export function productVersion(){
  const {version}=readJson(path.join(ROOT,'package.json'));
  if(typeof version!=='string'||!/^\d+\.\d+\.\d+$/.test(version))throw Error('Invalid product version');
  return version;
}
export function publicFiles(includeSource=true){
  return [...new Set([...base,...walk('src').filter(file=>includeSource||!sourceOnly(file)),
    ...(includeSource?[...source,...walk('scripts'),...walk('tests')]:[])])].sort().map(file=>{
    const full=path.join(ROOT,file);
    if(!safe(full)||!fs.statSync(full).isFile())throw Error('Invalid public file: '+file);
    return file;
  });
}
export function workDirectory(value,{fresh=false}={}){
  const work=path.resolve(ROOT,value),base=path.join(ROOT,'.validation-runtime'),relative=path.relative(base,work);
  if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Work must stay inside this copy’s .validation-runtime');
  for(let dir=work;;dir=path.dirname(dir)){
    if(fs.existsSync(dir)&&!safe(dir))throw Error('Redirected work directory');
    if(dir===base)break;
  }
  if(fresh&&fs.existsSync(work))throw Error('Expected a fresh work directory');
  fs.mkdirSync(work,{recursive:true});
  return work;
}
export function checksums(version){
  const names=fs.readdirSync(DIST).filter(name=>['source','windows-x64-portable'].some(kind=>name==='better-codex-v'+version+'-'+kind+'.zip')).sort();
  fs.writeFileSync(path.join(DIST,'SHA256SUMS.txt'),names.map(name=>sha(fs.readFileSync(path.join(DIST,name)))+'  '+name).join('\n')+'\n');
}
export function archive(version,kind,entries){
  const name='better-codex-v'+version+'-'+kind;
  fs.mkdirSync(DIST,{recursive:true});
  if(!safe(DIST))throw Error('Redirected dist directory');
  const output=path.join(DIST,name+'.zip'),bytes=writeZip(entries.map(([file,data])=>[name+'/'+file,data]));
  const next=output+'.'+process.pid+'.next';
  try{fs.writeFileSync(next,bytes,{flag:'wx'});fs.renameSync(next,output);}
  catch(error){try{fs.unlinkSync(next);}catch{}throw error;}
  checksums(version);
  return {archive:output,files:entries.length,bytes:bytes.length,sha256:sha(bytes)};
}
if(main(import.meta.url))console.log(JSON.stringify(archive(productVersion(),'source',publicFiles().map(file=>[file,fs.readFileSync(path.join(ROOT,file))]))));
