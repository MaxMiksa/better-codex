import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {ROOT,DIST,productVersion,workDirectory} from './package.mjs';
const {values}=parseArgs({options:{work:{type:'string',default:'.validation-runtime/release-prepare'}}});
const work=workDirectory(values.work,{fresh:true}),version=productVersion();
const safePnpm=()=>spawnSync(process.env.ComSpec,['/d','/s','/c','pnpm run '+phase],{cwd:ROOT,stdio:'inherit',windowsHide:true});
let phase;
function check(result){
  if(result.error)throw result.error;
  if(result.status!==0)throw Error('Release step failed ('+result.status+')');
}
for(phase of ['sync:version','typecheck','build','package'])check(safePnpm());
function node(script,args){check(spawnSync(process.execPath,[path.join(ROOT,'scripts',script),...args],{cwd:ROOT,stdio:'inherit',windowsHide:true}));}
node('build-portable.mjs',['--work',path.join(work,'build')]);
node('verify-package.mjs',['--work',path.join(work,'verify'),'--source',path.join(DIST,'better-codex-v'+version+'-source.zip'),
  '--portable',path.join(DIST,'better-codex-v'+version+'-windows-x64-portable.zip')]);
