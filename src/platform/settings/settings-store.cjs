const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),{randomUUID}=require('node:crypto');
const {setTimeout:sleep}=require('node:timers/promises');
const {withSettingsLock}=require('../windows/native.cjs');
const {layout}=require('../paths.cjs');
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)&&!JSON.isRawJSON(value);
const parse=(value,reviver)=>JSON.parse(value.replace(/^\uFEFF/,''),reviver);
function createSettingsStore(file,initial){
  let current=initial;
  function read(){
    try{
      const value=parse(fs.readFileSync(file,'utf8'));
      if(object(value))current=value;
    }catch{} // Keep the last valid preferences, but never repair an unreadable settings file.
    return current;
  }
  async function patch(value,{create=false}={}){
    if(!object(value))throw TypeError('Invalid settings patch');
    await withSettingsLock(path.resolve(file),async()=>{
      // Keep untouched numbers verbatim, including integers outside Number's exact range.
      const source=await fsp.readFile(file,'utf8').catch(error=>{if(create&&error.code==='ENOENT')return '{}';throw error;});
      const existing=parse(source,(_key,item,context)=>
        typeof item==='number'?JSON.rawJSON(context.source):item);
      if(!object(existing))throw TypeError('Invalid settings');
      const next=path.join(path.dirname(file),path.basename(file)+'.'+randomUUID()+'.next');
      try{
        await fsp.writeFile(next,JSON.stringify({...existing,...value},null,2),{flag:'wx'});
        for(let attempt=1;;attempt++){
          try{await fsp.rename(next,file);return;}
          catch(error){if(attempt===4||!['EACCES','EPERM','EBUSY'].includes(error.code))throw error;await sleep(25*attempt);}
        }
      }finally{await fsp.unlink(next).catch(()=>{});}
    });
    return read();
  }
  return {read,patch};
}
async function migrate(root){
  const p=layout(root);
  // Publish preferences last: interrupted attempts can safely resume without
  // overwriting newly written state or changing any of the legacy bytes.
  if(fs.existsSync(p.settings)||!fs.existsSync(p.legacySettings))return false;
  return withSettingsLock(p.settings,async()=>{
    if(fs.existsSync(p.settings))return false;
    const copy=()=>{
      const bytes=fs.readFileSync(p.legacySettings);
      if(!object(parse(bytes.toString('utf8'))))throw TypeError('Invalid legacy settings');
      const {atomic}=require('../paths.cjs');
      for(const name of ['update-recovery.json','startup-relaunch.json']){
        const to=path.join(p.state,name);
        const sources=[path.join(p.legacyState,name),path.join(p.legacy,name)];
        const source=sources.find(file=>fs.existsSync(file));
        if(source&&!fs.existsSync(to))atomic(to,fs.readFileSync(source));
      }
      atomic(p.settings,bytes);
      return true;
    };
    // Do not create or initialize a file in the legacy backup. When the old
    // writer has already initialized its lock, share that lock for the snapshot.
    const lock=fsp.stat(p.legacySettings+'.lock').catch(error=>{if(error.code!=='ENOENT')throw error;});
    return (await lock)?.size?withSettingsLock(p.legacySettings,copy):copy();
  });
}
if(require.main===module)(async()=>{
  const {values}=require('node:util').parseArgs({options:{migrate:{type:'boolean'},root:{type:'string'},file:{type:'string'},'patch-base64':{type:'string'}}});
  if(values.migrate)await migrate(values.root);
  else if(values.file&&values['patch-base64']){
    await createSettingsStore(values.file).patch(parse(Buffer.from(values['patch-base64'],'base64').toString('utf8')));
  }else throw Error();
})().catch(()=>{process.exitCode=1;});
module.exports={createSettingsStore,migrate};
