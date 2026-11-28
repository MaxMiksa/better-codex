import {createHash} from 'node:crypto';
import {mkdir,readFile,readdir,rename,rm,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const directory=path.join(root,'src','native');
const output=path.join(root,'src','generated','native','BetterCodexNative.exe');
const sources=(await readdir(directory)).filter(name=>name.endsWith('.cs')).sort().map(name=>path.join(directory,name));
// Framework csc emits a fresh MVID at each invocation. Keep the checked-in artifact
// when its embedded build identity already describes these inputs.
const digest=createHash('sha256');
digest.update(await readFile(fileURLToPath(import.meta.url)));
for(const source of sources)digest.update(path.basename(source)).update('\0').update(await readFile(source));
const stamp='BetterCodexNative build '+digest.digest('hex');
const marker=Buffer.from(stamp,'utf8'); // AssemblyMetadata string is serialized in the metadata blob.
const previous=await readFile(output).catch(()=>null);
if(!previous?.includes(marker)){
  const csc=path.join(process.env.WINDIR??'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
  await mkdir(path.dirname(output),{recursive:true});
  const staged=path.join(path.dirname(output),'.build-'+process.pid),target=path.join(staged,path.basename(output));
  await mkdir(staged);
  try{
    const version=path.join(staged,'BuildIdentity.cs');
    await writeFile(version,'[assembly: System.Reflection.AssemblyMetadata("BuildIdentity", "'+stamp+'")]\n');
    const result=spawnSync(csc,['/nologo','/target:exe','/platform:x64','/optimize+','/warnaserror+',
      '/codepage:65001','/r:System.Web.Extensions.dll','/r:Microsoft.CSharp.dll','/r:System.ServiceProcess.dll','/out:'+target,...sources,version],
      {cwd:root,stdio:'inherit',windowsHide:true});
    if(result.error)throw result.error;
    if(result.status!==0)throw Error('Windows Framework csc failed ('+result.status+')');
    await rename(target,output);
  }finally{
    await rm(path.join(staged,'BuildIdentity.cs'),{force:true});
    await rm(target,{force:true});
    await (await import('node:fs/promises')).rmdir(staged);
  }
}
console.log(path.relative(root,output));
