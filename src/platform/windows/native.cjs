const path=require('node:path'),{spawn}=require('node:child_process');
const executable=path.join(__dirname,'../../generated/native/BetterCodexNative.exe');
function invoke(command,args=[],{input,timeout=6000}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,[command,...args],{cwd:path.dirname(executable),windowsHide:true,stdio:['pipe','pipe','ignore']});
    const fail=()=>{const error=Error('Native helper unavailable');error.code='native-unavailable';reject(error);};
    const timer=setTimeout(()=>{child.kill();fail();},timeout);
    let size=0;
    const chunks=[];
    child.stdout.on('data',chunk=>{
      if((size+=chunk.length)>4*1024*1024){child.kill();fail();}
      else chunks.push(chunk);
    });
    child.stdout.on('error',fail);
    child.on('error',fail);
    child.on('close',()=>{
      clearTimeout(timer);
      try{
        const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if(typeof value?.ok!=='boolean')throw Error();
        resolve(value);
      }catch{fail();}
    });
    child.stdin.on('error',()=>{}); // A rejected command can close stdin early.
    child.stdin.end(input===undefined?undefined:JSON.stringify(input),'utf8');
  });
}
async function checked(...args){
  const value=await invoke(...args);
  if(!value.ok){const error=Error(value.status);error.code=value.code;throw error;}
  return value;
}
async function withSettingsLock(file,operation){
  const child=spawn(executable,['settings-lock','--path',file],
    {cwd:path.dirname(executable),windowsHide:true,stdio:['pipe','pipe','ignore']});
  const done=new Promise(resolve=>child.once('close',resolve));
  child.stdin.on('error',()=>{});
  try{
    await new Promise((resolve,reject)=>{
      let line='';
      const timer=setTimeout(()=>{child.kill();failed();},4500);
      const failed=()=>{clearTimeout(timer);reject(Error('Settings lock unavailable'));};
      child.once('error',failed);
      child.once('close',failed);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data',chunk=>{
        line+=chunk;
        if(line.length>1024){failed();return;}
        if(!line.includes('\n'))return;
        try{if(JSON.parse(line).ok===true){clearTimeout(timer);resolve();}else failed();}
        catch{failed();}
      });
    });
    return await operation();
  }finally{
    child.stdin.end();
    await done;
  }
}
module.exports={executable,invoke,checked,withSettingsLock};
