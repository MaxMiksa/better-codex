// Registered checks are isolated; never invoke a live launch or test real inference.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {parseArgs} from 'node:util';
import {ROOT,readJson,workDirectory} from './package.mjs';

const {values,positionals}=parseArgs({allowPositionals:true,options:{
  list:{type:'boolean'},all:{type:'boolean'},work:{type:'string',default:'.validation-runtime/checks'},dependencies:{type:'string'}
}});
const cases=Object.fromEntries(Object.entries(readJson(path.join(ROOT,'tests/cases.json')))
  .filter(([,spec])=>fs.existsSync(path.join(ROOT,spec.path))));
if(values.list||!values.all&&!positionals.length){
  console.log(JSON.stringify(cases,null,2));
}else{
  if(values.all&&positionals.length)throw Error('Use --all or named cases, not both');
  const selected=values.all?Object.keys(cases):[...new Set(positionals)];
  if(selected.some(id=>!Object.hasOwn(cases,id)))throw Error('Unknown check case; see --list');
  const work=workDirectory(values.work);
  const dependencies=values.dependencies?readJson(path.resolve(values.dependencies)):{};
  const validFile=file=>typeof file==='string'&&fs.statSync(file,{throwIfNoEntry:false})?.isFile();
  let node=process.execPath;
  if(validFile(dependencies.node)){
    const check=await run(dependencies.node,['-p','process.versions.node'],process.env,{timeout:3000});
    if(check.status===0&&/^24\.(?:11\.[1-9]\d*|(?:1[2-9]|[2-9]\d|\d{3,})\.\d+)$/.test(check.stdout.trim()))node=dependencies.node;
  }
  const playwright=[process.env.HUD_PLAYWRIGHT,path.join(ROOT,'scripts/node/node_modules/playwright'),
    path.join(ROOT,'node_modules/playwright'),dependencies.playwright]
    .find(dir=>typeof dir==='string'&&validFile(path.join(dir,'package.json')));
  const env={...process.env,PATH:path.dirname(node)+path.delimiter+process.env.PATH,BETTER_CODEX_TEST_NODE:node};
  if(playwright)env.HUD_PLAYWRIGHT=path.resolve(playwright);
  const fixture=path.join(work,'dependencies.json');
  if(selected.includes('multi-window')){
    if(!playwright)throw Error('Prepare Playwright with scripts/Install-NodeDependencies.ps1');
    fs.writeFileSync(fixture,JSON.stringify({node,playwright:path.resolve(playwright)}),{flag:'wx'});
  }
  const results=[];
  for(const id of selected){
    const spec=cases[id],folder=path.join(work,id),keys={work:folder,evidence:path.join(folder,'evidence'),browser:path.join(folder,'browser')};
    if(fs.existsSync(folder))throw Error('Case fixture already exists: '+id);
    const args=(spec.args??[]).map(arg=>arg.replace(/\{(\w+)\}/g,(_m,key)=>keys[key]));
    if(id==='multi-window')args.push(fixture);
    const script=path.join(ROOT,spec.path),legacy=path.join(process.env.WINDIR,'System32/WindowsPowerShell/v1.0/powershell.exe');
    const command=spec.kind==='node'?[node,'--no-warnings=ExperimentalWarning',script,...args]:
      [spec.kind==='pwsh'?'pwsh.exe':legacy,'-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',script,...args];
    console.log('\n['+id+']');
    const result=await run(command[0],command.slice(1),{...env,BETTER_CODEX_TEST_WORK:folder});
    for(const stream of [result.stdout,result.stderr])if(stream)process.stdout.write(stream);
    if(result.error)console.error(result.error.message);
    const tap=/^ℹ pass (\d+)$/m.exec(result.stdout)?.[1];
    const match=[...result.stdout.matchAll(/"passed"\s*:\s*(\d+)/g)].at(-1)?.[1];
    results.push({id,ok:result.status===0,assertions:Number(tap??match??0)});
  }
  const summary={passed:results.filter(r=>r.ok).length,total:results.length,
    reportedAssertions:results.filter(r=>r.ok).reduce((n,r)=>n+r.assertions,0),failed:results.filter(r=>!r.ok).map(r=>r.id)};
  fs.writeFileSync(path.join(work,'results.json'),JSON.stringify({...summary,results},null,2)+'\n');
  console.log(JSON.stringify(summary));
  if(summary.failed.length)process.exitCode=1;
}
function run(file,args,env,{timeout=240000}={}){
  return new Promise(resolve=>{
    const child=spawn(file,args,{cwd:ROOT,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',error;
    const timer=setTimeout(()=>{error=Error('Isolated check deadline exceeded');child.kill();},timeout);
    child.stdout.setEncoding('utf8').on('data',s=>{stdout+=s;});
    child.stderr.setEncoding('utf8').on('data',s=>{stderr+=s;});
    child.on('error',value=>{error=value;});
    child.on('close',status=>{clearTimeout(timer);resolve({status,stdout,stderr,error});});
  });
}
