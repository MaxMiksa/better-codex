const {watch}=require('node:fs'),fs=require('node:fs/promises'),path=require('node:path');
const {createHmac,randomBytes,randomUUID}=require('node:crypto');
const {windowsPath}=require('./windows-paths.cjs');

const appId='dev.bettercodex.workspace-preview';
const textLimit=160*1024,imageLimit=12*1024*1024,pixelLimit=12_000_000;
const textExt=new Set(('txt md markdown rst log csv tsv json jsonc yml yaml toml ini xml sql css scss less '+
  'c h cpp hpp cs java go rs swift kt vue svelte js mjs cjs ts tsx jsx py ps1 psm1 sh bash zsh bat cmd html htm svg reg vbs lua pl rb php').split(' '));
const textNames=new Set(['.gitignore','.gitattributes','dockerfile','makefile','readme','license']);
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const files=['request.bcpreview','image.jpg','image.png','ready','failed','open','closed','recycle'];
const imageName=/^image-[0-9a-f]{64}\.(?:jpg|png)$/;

function dimensions(bytes,kind){
  if(kind==='png'&&bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))&&
      bytes.readUInt32BE(8)===13&&bytes.toString('ascii',12,16)==='IHDR'){
    return [bytes.readUInt32BE(16),bytes.readUInt32BE(20)];
  }
  if(kind!=='jpg'||bytes.length<4||bytes[0]!==0xff||bytes[1]!==0xd8)return null;
  for(let at=2;at+3<bytes.length;){
    if(bytes[at++]!==0xff)return null;
    while(bytes[at]===0xff)at++;
    const marker=bytes[at++];
    if(marker===0xda||marker===0xd9||at+2>bytes.length)return null;
    const length=bytes.readUInt16BE(at);
    if(length<2||at+length>bytes.length)return null;
    if([0xc0,0xc1,0xc2].includes(marker)&&length>=8){
      return [bytes.readUInt16BE(at+5),bytes.readUInt16BE(at+3)];
    }
    at+=length;
  }
  return null;
}

async function readPart(file,bytes,n,start=0){
  let read=start;
  while(read<n){
    const {bytesRead}=await file.read(bytes,read,n-read,read);
    if(!bytesRead)break;
    read+=bytesRead;
  }
  return read;
}
async function prepare(file,openable,zh){
  const name=path.basename(file),ext=path.extname(name).toLowerCase().slice(1);
  const kind=ext==='png'?'png':ext==='jpg'||ext==='jpeg'?'jpg':'text';
  if(kind==='text'&&!textExt.has(ext)&&!textNames.has(name.toLowerCase()))return null;
  const handle=await fs.open(file,'r');
  try{
    const info=await handle.stat(),size=info.size;
    if(!info.isFile())return null;
    const base={name,size,openable,zh};
    if(kind==='text'){
      const limit=Math.min(size,textLimit),bytes=Buffer.alloc(limit);
      const n=await readPart(handle,bytes,limit);
      let body;
      try{body=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,n),{stream:size>n});}
      catch{return null;}
      if(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(body))return null;
      body=body.replace(/\r\n?/g,'\n');
      // Bound pathological minified lines without taking away the original Open action.
      let truncated=size>n;
      const lines=body.split('\n',4001);
      if(lines.length>4000){lines.length=4000;truncated=true;}
      body=lines.map(line=>{
        if(line.length<=8192)return line;
        truncated=true;
        return line.slice(0,8192);
      }).join('\n');
      return {data:{...base,body,ext,truncated}};
    }
    if(!size||size>imageLimit)return null;
    const first=Buffer.alloc(Math.min(size,128*1024));
    const n=await readPart(handle,first,first.length);
    const shape=dimensions(first.subarray(0,n),kind);
    if(!shape||shape.some(n=>n<1||n>8192)||shape[0]*shape[1]>pixelLimit)return null;
    const image=Buffer.alloc(size);
    first.copy(image,0,0,n);
    if(await readPart(handle,image,size,n)!==size)return null;
    // The native renderer animates APNG; keep memory bounded to one decoded frame.
    if(kind==='png'){
      for(let at=8;at+12<=size;){
        const length=image.readUInt32BE(at),type=image.toString('ascii',at+4,at+8);
        if(type==='acTL'||type==='fcTL'||type==='fdAT'||at+12+length>size)return null;
        if(type==='IEND')break;
        at+=12+length;
      }
    }
    return {data:{...base,image:'image.'+kind,width:shape[0],height:shape[1]},image};
  }finally{await handle.close();}
}

async function clear(dir){
  await Promise.allSettled(files.map(name=>fs.unlink(path.join(dir,name))));
  await fs.rmdir(dir).catch(()=>{});
}

function createNativePreview({appData=process.env.APPDATA,language,start,timeout=2200}={}){
  const roaming=windowsPath(appData),root=roaming&&path.join(roaming,appId,'requests');
  const key=randomBytes(32),assets=new Map();
  let active,initialized,sequence=0;
  async function retainImage(ext,bytes){
    // NSH caches by canonical path. A fresh request ID must not mean a fresh decode
    // for identical bytes. The keyed name also avoids exposing a known file digest.
    const name='image-'+createHmac('sha256',key).update(bytes).digest('hex')+ext;
    const file=path.join(root,name);
    let entry=assets.get(name);
    if(!entry?.refs){
      const previous=entry?.done;
      entry={refs:0,ready:Promise.resolve(previous).then(()=>fs.writeFile(file,bytes,{flag:'wx'}))};
      assets.set(name,entry);
    }
    entry.refs++;
    const release=()=>{
      if(--entry.refs)return;
      entry.done=entry.ready.then(()=>fs.unlink(file)).catch(()=>{}).finally(()=>{
        if(assets.get(name)===entry)assets.delete(name);
      });
    };
    try{await entry.ready;return {name,release};}
    catch(error){release();throw error;}
  }
  async function initialize(){
    await fs.mkdir(root,{recursive:true});
    if((await fs.realpath(root)).toLowerCase()!==root.toLowerCase())throw Error('Redirected preview data.');
    const now=Date.now();
    for(const item of await fs.readdir(root,{withFileTypes:true})){
      if((!UUID.test(item.name)&&!/^stage-[a-z0-9]{6}$/i.test(item.name))||!item.isDirectory())continue;
      const dir=path.join(root,item.name);
      const stat=await fs.lstat(dir).catch(()=>null);
      if(stat?.isDirectory()&&now-stat.mtimeMs>60*60*1000)void clear(dir);
    }
    for(const item of await fs.readdir(root,{withFileTypes:true})){
      if(!item.isFile()||!imageName.test(item.name))continue;
      const file=path.join(root,item.name);
      const stat=await fs.lstat(file).catch(()=>null);
      if(stat?.isFile()&&now-stat.mtimeMs>60*60*1000)void fs.unlink(file).catch(()=>{});
    }
  }
  return async (exe,file,{openable,open,stillCurrent})=>{
    if(!root)return false;
    const generation=++sequence;
    const current=async()=>generation===sequence&&await stillCurrent()&&generation===sequence;
    let prepared;
    try{prepared=await prepare(file,openable,/^zh\b/i.test(language??''));}catch{return false;}
    if(!prepared)return false;
    if(!await current())return true; // Superseded, not a reason to launch a second provider.
    let dir,dispose,image;
    try{
      await (initialized??=initialize().catch(error=>{initialized=null;throw error;}));
      dir=await fs.mkdtemp(path.join(root,'stage-'));
      // Publish a complete request under an unguessable name, before invoking NSH.
      const finalDir=path.join(root,randomUUID());
      if(prepared.image){
        image=await retainImage(path.extname(prepared.data.image),prepared.image);
        prepared.data.image=image.name;
      }
      await fs.writeFile(path.join(dir,'request.bcpreview'),JSON.stringify(prepared.data),{flag:'wx'});
      await fs.rename(dir,finalDir);
      dir=finalDir;
      prepared=null;
      if(!await current()){image?.release();await clear(dir);return true;}
      active?.();
      let finished=false,ready=false,closing=false,polling=false,pollAgain=false,watcher,timer,expiry;
      let recycled=false;
      const launch=()=>start(exe,[path.join(dir,'request.bcpreview')]);
      let complete;
      const result=new Promise(resolve=>{complete=resolve;});
      const has=name=>fs.lstat(path.join(dir,name)).then(s=>s.isFile(),()=>false);
      dispose=(value=false)=>{
        if(finished)return;
        finished=true;
        if(active===dispose)active=null;
        clearTimeout(timer);clearTimeout(expiry);
        watcher?.close();
        image?.release();
        void clear(dir);
        complete(value);
      };
      const check=async()=>{
        if(finished)return;
        if(polling){pollAgain=true;return;}
        polling=true;
        try{
          do{
            pollAgain=false;
            if(!ready&&!recycled&&(await has('recycle'))){
              recycled=true;
              // The old process writes this only as it exits. Do not kill it
              // or leave a second preview process running alongside it.
              await new Promise(resolve=>setTimeout(resolve,160));
              if(finished)return;
              if(generation!==sequence){dispose(true);return;}
              await launch();
            }
            if(!ready&&(await has('failed'))){dispose(false);return;}
            if(!ready&&(await has('ready'))){ready=true;clearTimeout(timer);complete(true);}
            const opening=!closing&&await has('open');
            if(finished)return;
            if(opening){
              closing=true;
              // A click can only reopen the exact selection already authorized by the tree.
              if(ready&&generation===sequence)await open();
              dispose(true);return;
            }
            if(await has('closed')){dispose(true);return;}
          }while(pollAgain&&!finished);
        }catch{dispose(ready);}
        finally{polling=false;}
      };
      active=dispose;
      watcher=watch(dir,{persistent:false},()=>void check());
      watcher.on('error',()=>dispose(ready));
      timer=setTimeout(()=>dispose(false),timeout);timer.unref();
      // Backstop for an abnormal window exit. Request files are never a preview history.
      expiry=setTimeout(()=>dispose(ready),60*60*1000);expiry.unref();
      await launch();
      await check();
      return (await result)||!await current();
    }catch{
      if(dispose)dispose(false);
      else {image?.release();if(dir)await clear(dir);}
      return !await current();
    }
  };
}
module.exports={appId,createNativePreview,dimensions,prepare};
