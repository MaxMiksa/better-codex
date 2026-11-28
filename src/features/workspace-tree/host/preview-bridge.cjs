const {watch}=require('node:fs'),fs=require('node:fs/promises'),path=require('node:path');
const {createHmac,randomBytes,randomUUID}=require('node:crypto');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const {setTimeout:delay}=require('node:timers/promises');
const {windowsPath}=require('./windows-paths.cjs');
const {validConfig}=require('./preview/config-syntax.cjs');
const run=promisify(execFile);

const appId='dev.bettercodex.workspace-preview';
const dismissCapability='dismiss-v1';
const textLimit=160*1024,sourceByteLimit=32*1024*1024,assetByteLimit=12*1024*1024;
const assetSide=2048,assetPixels=3_000_000,imageProbe=128*1024;
const mediaModes=new Map(Object.entries({jpg:'jpeg',jpeg:'jpeg',png:'png',webp:'webp',bmp:'bmp',gif:'gif',
  ico:'ico',tif:'tiff',tiff:'tiff',pdf:'pdf',mp4:'poster'}));
const extension=file=>path.extname(file).toLowerCase().slice(1);
const exceeds=(w,h,side,pixels)=>w>side||h>side||w*h>pixels;
const exceedsSource=(mode,w,h)=>mode==='jpeg'||mode==='pdf'?
  exceeds(w,h,12000,50_000_000):exceeds(w,h,8192,12_000_000);
const mediaFailure=mode=>mode==='poster'?'media-failed':mode==='pdf'?'invalid-pdf':'invalid-image';
const autoExt=new Set('txt text md markdown rst adoc org log csv tsv json jsonc yaml yml toml ini'.split(' '));
const autoNames=new Set(['readme','license','.gitignore','.gitattributes','.env.example']);
const manualExt=new Set(['js','ts','py','sh','ps1']);
const manualNames=new Set(['dockerfile','makefile']);
const textExt=new Set(('txt text md markdown rst adoc org log csv tsv json jsonc yml yaml toml ini xml sql css scss less '+
  'c h cpp hpp cs java go rs swift kt vue svelte js mjs cjs ts tsx jsx py ps1 psm1 sh bash zsh bat cmd html htm svg reg vbs lua pl rb php').split(' '));
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const files=new Set(['request.bcpreview','image.jpg','image.png','presented','ready','ready.tmp','failed','open','closed','recycle','blocked',
  'preparing','cancelled','request.tmp','recycle.tmp','media.tmp','save.json','save.tmp','save-result.json','save-result.tmp','save-bytes.tmp']);
const imageName=/^image-[0-9a-f]{64}\.(?:jpg|png)$/;
const nonText=/[\x00-\x08\x0b\x0c\x0e-\x1f]/;
const notice=(base,kind,code)=>({data:{name:base.name,size:base.size,openable:base.openable,zh:base.zh,notice:{kind,code}}});

function needsExifWorker(tiff){
  if(tiff.length<8)return true;
  const order=tiff.readUInt16BE(0);
  if(order!==0x4949&&order!==0x4d4d)return true;
  const le=order===0x4949;
  const short=at=>le?tiff.readUInt16LE(at):tiff.readUInt16BE(at);
  const long=at=>le?tiff.readUInt32LE(at):tiff.readUInt32BE(at);
  if(short(2)!==42)return true;
  const ifd=long(4);
  if(ifd<8||ifd+2>tiff.length)return true;
  const end=ifd+2+short(ifd)*12;
  if(end+4>tiff.length)return true;
  // Only IFD0 is relevant. The next IFD (often a thumbnail) is never followed.
  let seen=false;
  for(let at=ifd+2;at<end;at+=12){
    if(short(at)!==274)continue;
    if(seen||short(at+2)!==3||long(at+4)!==1||short(at+8)!==1)return true;
    seen=true;
  }
  return false;
}

function dimensions(bytes,kind,metadata){
  if(kind==='png'&&bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))&&
      bytes.readUInt32BE(8)===13&&bytes.toString('ascii',12,16)==='IHDR'){
    return [bytes.readUInt32BE(16),bytes.readUInt32BE(20)];
  }
  if(kind!=='jpg'||bytes.length<4||bytes[0]!==0xff||bytes[1]!==0xd8)return null;
  let shape=null;
  for(let at=2;at<bytes.length;){
    if(bytes[at++]!==0xff)return null;
    while(bytes[at]===0xff)at++;
    if(at===bytes.length)return null;
    const marker=bytes[at++];
    if(marker===0xda||marker===0xd9){
      if(metadata)metadata.headerComplete=true;
      return shape;
    }
    if(at+2>bytes.length)return null;
    const length=bytes.readUInt16BE(at);
    if(length<2||at+length>bytes.length)return null;
    if(metadata&&!metadata.exif&&marker===0xe1&&length>=8&&bytes.toString('latin1',at+2,at+8)==='Exif\0\0')
      metadata.exif=needsExifWorker(bytes.subarray(at+8,at+length));
    if([0xc0,0xc1,0xc2].includes(marker)&&length>=8)
      shape=[bytes.readUInt16BE(at+5),bytes.readUInt16BE(at+3)];
    at+=length;
  }
  return shape;
}

async function readPart(file,bytes,n,start=0,signal,offset=0){
  let read=start;
  while(read<n){
    signal?.throwIfAborted();
    const {bytesRead}=await file.read(bytes,read,n-read,offset+read);
    if(!bytesRead)break;
    read+=bytesRead;
  }
  return read;
}
// Scan chunk headers only. Large PNGs skip their payload in the host and let
// the worker decode, while APNG keeps the same disposition on both routes.
function* pngChunks(size){
  for(let at=8,chunks=0;at+12<=size&&chunks<16384;chunks++){
    const header=yield at;
    if(!header)break;
    const length=header.readUInt32BE(0),type=header.toString('ascii',4,8);
    if(at+12+length>size)break;
    if(type==='acTL'||type==='fcTL'||type==='fdAT')return 'animated';
    if(type==='IEND')return length===0&&at+12===size?null:'invalid-image';
    at+=12+length;
  }
  return 'invalid-image';
}
function pngIssue(image){
  const scan=pngChunks(image.length);
  let next=scan.next();
  while(!next.done)next=scan.next(image.subarray(next.value,next.value+8));
  return next.value;
}
async function sourcePngIssue(handle,size,prefix,signal){
  const scan=pngChunks(size),header=Buffer.alloc(8);
  let next=scan.next();
  while(!next.done){
    const at=next.value;
    const bytes=at+8<=prefix.length?prefix.subarray(at,at+8):
      await readPart(handle,header,8,0,signal,at)===8?header:null;
    next=scan.next(bytes);
  }
  return next.value;
}
const versionKey=(info,mode)=>`${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${mode}`;
const sameFileVersion=(a,b)=>b?.isFile()&&a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&
  a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs&&a.mode===b.mode;

async function prepare(file,openable,zh,allowEdit=false,{signal,prepareMedia,findMedia,cloudSize}={}){
  const name=path.basename(file),ext=extension(name),mode=mediaModes.get(ext);
  signal?.throwIfAborted();
  if(cloudSize!==undefined)return notice({name,size:cloudSize,openable,zh},'limit','cloud-only');
  const source=await fs.lstat(file,{bigint:true});
  if(!source.isFile())return null;
  let base={name,size:Number(source.size),openable,zh};
  const format=mode==='jpeg'?'jpg':mode==='png'?'png':null;
  const unsupported=()=>notice(base,'unsupported','unsupported-type');
  const cacheKey=mode&&mode!=='poster'?versionKey(source,mode):null;
  const derivative=async()=>prepareMedia?await prepareMedia(mode,base,source,cacheKey):notice(base,'failed',mediaFailure(mode));
  const basename=name.toLowerCase();
  const env=basename==='.env'||(basename.startsWith('.env.')&&basename!=='.env.example');
  const autosave=!env&&(autoExt.has(ext)||autoNames.has(basename));
  const manual=!env&&(manualExt.has(ext)||manualNames.has(basename));
  if(!mode&&!textExt.has(ext)&&!autosave&&!manual)return unsupported();
  if(mode&&mode!=='poster'&&base.size>sourceByteLimit)return notice(base,'limit','too-large');
  signal?.throwIfAborted();
  let handle;
  try{
    const cached=cacheKey&&findMedia?await findMedia(cacheKey,base,source):null;
    if(cached)return cached;
    if(mode&&!format){
      // Worker-only formats never open the original in Node or stage original bytes.
      if(mode==='poster'&&base.size<12)return notice(base,'failed','media-failed');
      return await derivative();
    }
    handle=await fs.open(file,'r');
    const info=await handle.stat({bigint:true}),size=Number(info.size);
    signal?.throwIfAborted();
    if(!info.isFile()||info.dev!==source.dev||info.ino!==source.ino)return null;
    base={name,size,openable,zh};
    if(!mode){
      const limit=Math.min(size,textLimit),bytes=Buffer.alloc(limit);
      const n=await readPart(handle,bytes,limit,0,signal);
      signal?.throwIfAborted();
      let body;
      try{body=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,n),{stream:size>n});}
      catch{return notice(base,'failed','invalid-text');}
      if(n!==limit||nonText.test(body))return notice(base,'failed','invalid-text');
      // Only round-trip encodings and line endings that the editor can preserve.
      const crlf=body.includes('\r\n'),rest=body.replaceAll('\r\n','');
      const uniform=!rest.includes('\r')&&(!crlf||!rest.includes('\n'));
      body=body.replace(/\r\n?/g,'\n');
      // Bound pathological minified lines without taking away the original Open action.
      let truncated=size>n;
      const lines=body.split('\n',4001);
      if(lines.length>4000){lines.length=4000;truncated=true;}
      body=lines.map(line=>{
        if(line.length<=8192)return line;
        truncated=true;
        const end=line.charCodeAt(8191);
        return line.slice(0,end>=0xd800&&end<=0xdbff?8191:8192);
      }).join('\n');
      const data={...base,body,ext,truncated};
      if(allowEdit&&!truncated&&uniform&&(autosave||manual)){
        const version=await handle.stat({bigint:true});
        if(version.nlink===1n&&(version.mode&0o200n)&&version.size===BigInt(n)){
          // Older viewers would autosave anything marked editable.
          if(manual)data.saveMode='manual';
          else data.editable=true;
          return {data,edit:{version,bytes,ext,bom:n>=3&&bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf,crlf}};
        }
      }
      return {data};
    }
    if(size>sourceByteLimit)return notice(base,'limit','too-large');
    const first=Buffer.alloc(Math.min(size,imageProbe));
    const n=await readPart(handle,first,first.length,0,signal);
    signal?.throwIfAborted();
    const metadata={};
    const shape=dimensions(first.subarray(0,n),format,metadata);
    // The bounded JPEG probe cannot prove safety when the header extends past it.
    // Let the worker validate the complete image rather than publishing raw bytes.
    if(!shape&&format==='jpg'&&n===first.length&&n<size)return await derivative();
    if(!shape||shape.some(n=>n<1))return notice(base,'failed','invalid-image');
    const [width,height]=shape;
    if(exceedsSource(mode,width,height))return notice(base,'limit','too-many-pixels');
    const needsWorker=size>assetByteLimit||exceeds(width,height,assetSide,assetPixels)||
      (format==='jpg'&&(metadata.exif||!metadata.headerComplete));
    if(needsWorker){
      if(format==='png'){
        const issue=await sourcePngIssue(handle,size,first.subarray(0,n),signal);
        if(issue==='animated')return unsupported();
        if(issue)return notice(base,'failed',issue);
      }
      return await derivative();
    }
    const image=n===size?first:Buffer.alloc(size);
    if(n!==size){
      first.copy(image,0,0,n);
      if(await readPart(handle,image,size,n,signal)!==size)return notice(base,'failed','invalid-image');
    }
    signal?.throwIfAborted();
    // The native renderer animates APNG; keep memory bounded to one decoded frame.
    if(format==='png'){
      const issue=pngIssue(image);
      if(issue==='animated')return notice(base,'unsupported','unsupported-type');
      if(issue)return notice(base,'failed',issue);
    }
    return {data:{...base,image:'image.'+format,width,height},image};
  }catch{
    signal?.throwIfAborted();
    return notice(base,'failed',mode?mediaFailure(mode):'invalid-text');
  }finally{await handle?.close().catch(()=>{});}
}

async function clear(dir){
  const entries=await fs.readdir(dir).catch(()=>[]);
  await Promise.allSettled(entries.filter(name=>files.has(name)).map(name=>fs.unlink(path.join(dir,name))));
  await fs.rmdir(dir).catch(()=>{});
}

async function mediaExecutable(exe){
  const file=path.join(path.dirname(exe),'PreviewMedia.exe');
  try{
    if(!(await fs.lstat(file)).isFile()||(await fs.realpath(file)).toLowerCase()!==file.toLowerCase())return null;
    return file;
  }catch{return null;}
}

async function makeDerivative(exe,file,dir,mode,base,signal,runMedia,key){
  const output=path.join(dir,'media.tmp');
  const failure=code=>notice(base,'failed',code??mediaFailure(mode));
  let handle,validated=false;
  try{
    const {stdout}=await runMedia(exe,[mode,file,output],
      {cwd:path.dirname(exe),windowsHide:true,timeout:1800,maxBuffer:4096,signal});
    const {width,height,imageWidth,imageHeight,pageCount,format:reportedFormat}=JSON.parse(stdout);
    if(![width,height,imageWidth,imageHeight].every(n=>Number.isSafeInteger(n)&&n>0))return failure();
    if(exceedsSource(mode,width,height)||exceeds(imageWidth,imageHeight,assetSide,assetPixels))
      return notice(base,'limit','too-many-pixels');
    if(imageWidth>width||imageHeight>height)return failure();
    if(mode==='pdf'&&(!Number.isInteger(pageCount)||pageCount<1||pageCount>0x7fffffff))return failure();
    if(reportedFormat!==undefined&&reportedFormat!=='jpg'&&reportedFormat!=='png')return failure();
    const info=await fs.lstat(output,{bigint:true});
    if(!info.isFile()||info.size<1n)return failure();
    if(info.size>assetByteLimit)return notice(base,'limit','too-large');
    handle=await fs.open(output,'r');
    if(!sameFileVersion(info,await handle.stat({bigint:true})))return failure();
    const size=Number(info.size),bytes=Buffer.alloc(Math.min(size,imageProbe));
    if(await readPart(handle,bytes,bytes.length,0,signal)!==bytes.length)return failure();
    // Older workers wrote fixed formats (including early PNG posters).
    const format=reportedFormat??(mode==='jpeg'||(mode==='poster'&&bytes[0]!==0x89)?'jpg':'png');
    const metadata={};
    const shape=dimensions(bytes,format,metadata);
    // A worker JPEG is re-encoded, so it must reach SOS/EOI in the bounded probe.
    if(!shape||(format==='jpg'&&!metadata.headerComplete))return failure();
    if(exceeds(...shape,assetSide,assetPixels))return notice(base,'limit','too-many-pixels');
    if(shape[0]!==imageWidth||shape[1]!==imageHeight||
        (format==='png'&&await sourcePngIssue(handle,size,bytes,signal)))return failure();
    const hash=createHmac('sha256',key).update(bytes);
    for(let at=bytes.length;at<size;at+=bytes.length){
      const length=Math.min(bytes.length,size-at);
      if(await readPart(handle,bytes,length,0,signal,at)!==length)return failure();
      hash.update(bytes.subarray(0,length));
    }
    if(!sameFileVersion(info,await handle.stat({bigint:true})))return failure();
    signal.throwIfAborted();
    validated=true;
    return {data:{...base,image:'image.'+format,width,height,imageWidth,imageHeight,
      ...(mode==='poster'?{poster:true}:mode==='pdf'?{pageCount}:{})},
      derivative:{output,version:info,digest:hash.digest('hex')}};
  }catch(error){
    signal.throwIfAborted();
    if(error.code===3)return notice(base,'limit','too-many-pixels');
    if(error.code===4)return notice(base,'limit','too-large');
    if(error.code===5)return notice(base,'unsupported','unsupported-type');
    return failure(error.killed||error.code===1460?'timeout':undefined);
  }
  finally{
    await handle?.close().catch(()=>{});
    if(!validated)await fs.unlink(output).catch(()=>{});
  }
}

function matchingVersion(a,b){
  return a.dev===b.dev&&a.ino===b.ino&&a.nlink===b.nlink&&a.size===b.size&&
    a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs&&(a.mode&0o200n)!==0n;
}

async function saveDocument(file,dir,edit,body,authorize,replace){
  if(typeof body!=='string'||body.length>textLimit||nonText.test(body)||body.includes('\r')||
      !body.isWellFormed())return 'limit';
  const lines=body.split('\n',4001);
  if(lines.length>4000||lines.some(line=>line.length>8192))return 'limit';
  const bytes=Buffer.from((edit.bom?'\ufeff':'')+(edit.crlf?body.replaceAll('\n','\r\n'):body),'utf8');
  if(bytes.length>textLimit)return 'limit';
  const temp=path.join(dir,'save-bytes.tmp');
  let handle;
  try{
    if(!await authorize())return 'conflict';
    handle=await fs.open(file,'r');
    const version=await handle.stat({bigint:true});
    if(!version.isFile()||!matchingVersion(version,edit.version))return 'conflict';
    const current=Buffer.alloc(edit.bytes.length);
    if(await readPart(handle,current,current.length)!==current.length||!current.equals(edit.bytes))return 'conflict';
    await handle.close();
    handle=null;
    if(bytes.equals(current))return 'saved';
    if(!validConfig(edit.ext,body))return 'invalid';
    await fs.writeFile(temp,bytes,{flag:'wx'});
    try{
      if(!await authorize()||!matchingVersion(await fs.lstat(file,{bigint:true}),version))return 'conflict';
      if(!await replace(file,temp,version))return 'conflict';
      edit.bytes=bytes;
      edit.version=await fs.lstat(file,{bigint:true}).catch(()=>version);
      return 'saved';
    }finally{await fs.unlink(temp).catch(()=>{});}
  }catch(error){return error.code==='ENOENT'?'conflict':'error';}
  finally{await handle?.close().catch(()=>{});}
}

async function recyclePid(dir){
  const marker=path.join(dir,'recycle');
  const info=await fs.lstat(marker).catch(()=>null);
  if(!info?.isFile()||info.size<1||info.size>16)return null;
  const value=(await fs.readFile(marker,'utf8').catch(()=>'')).trim();
  return /^[1-9][0-9]{0,9}$/.test(value)&&Number(value)<=0x7fffffff?Number(value):null;
}
function processExited(pid){
  try{process.kill(pid,0);return false;}
  catch(error){return error.code==='ESRCH';}
}

function createNativePreview({appData=process.env.APPDATA,language,start,replace,timeout=2200,onDiagnostic,runMedia=run}={}){
  const roaming=windowsPath(appData),root=roaming&&path.join(roaming,appId,'requests');
  // The LRU owns disk leases separately from the viewer's active request.
  const key=randomBytes(32),assets=new Map(),derivatives=new Map();
  let active,activeDismiss,pending,initialized,preparing,sequence=0,handoff,lastRequest=-Infinity,cachedBytes=0;
  function lease(name,entry){
    entry.refs++;
    return {name,bytes:entry.bytes,retain:()=>lease(name,entry),release:()=>{
      if(--entry.refs)return;
      entry.done=entry.ready.then(()=>fs.unlink(path.join(root,name))).catch(()=>{}).finally(()=>{
        if(assets.get(name)===entry)assets.delete(name);
      });
    }};
  }
  async function retainImage(ext,bytes,derivative){
    // NSH caches by canonical path. A fresh request ID must not mean a fresh decode
    // for identical bytes. The keyed name also avoids exposing a known file digest.
    const digest=derivative?.digest??createHmac('sha256',key).update(bytes).digest('hex');
    const name='image-'+digest+ext;
    const file=path.join(root,name);
    let entry=assets.get(name);
    const reuse=Boolean(entry?.refs);
    if(!reuse){
      const previous=entry?.done;
      const staging=entry={refs:0,bytes:derivative?Number(derivative.version.size):bytes.length};
      entry.ready=Promise.resolve(previous).then(async()=>{
        if(derivative){
          if(!sameFileVersion(derivative.version,await fs.lstat(derivative.output,{bigint:true})))
            throw Error('Worker output changed before staging.');
          await fs.rename(derivative.output,file);
        }else await fs.writeFile(file,bytes,{flag:'wx'});
        staging.version=await fs.lstat(file,{bigint:true});
        if(!staging.version.isFile())throw Error('Staged image is not a regular file.');
      });
      assets.set(name,entry);
    }
    const asset=lease(name,entry);
    try{
      await entry.ready;
      if(reuse){
        if(!sameFileVersion(entry.version,await fs.lstat(file,{bigint:true})))throw Error('Staged image changed.');
        if(derivative)await fs.unlink(derivative.output);
      }
      return asset;
    }catch(error){asset.release();throw error;}
  }
  function forget(cacheKey){
    const item=derivatives.get(cacheKey);
    if(!item)return;
    derivatives.delete(cacheKey);
    cachedBytes-=item.asset.bytes;
    item.asset.release();
  }
  async function findMedia(cacheKey,base,source){
    const item=derivatives.get(cacheKey);
    if(!item)return null;
    const version=await fs.lstat(path.join(root,item.asset.name),{bigint:true}).catch(()=>null);
    if(derivatives.get(cacheKey)!==item)return null;
    if(!sameFileVersion(item.version,version)||!sameFileVersion(item.source,source)){forget(cacheKey);return null;}
    derivatives.delete(cacheKey);derivatives.set(cacheKey,item);
    return {data:{...base,...item.shape,image:item.asset.name},asset:item.asset.retain(),cacheKey};
  }
  function remember(cacheKey,asset,source,{width,height,imageWidth,imageHeight,pageCount}){
    const {version}=assets.get(asset.name);
    const cached=asset.retain();
    forget(cacheKey);
    derivatives.set(cacheKey,{asset:cached,version,source,shape:{width,height,imageWidth,imageHeight,pageCount}});
    cachedBytes+=cached.bytes;
    while(derivatives.size>8||cachedBytes>32*1024*1024)forget(derivatives.keys().next().value);
  }
  async function initialize(){
    await fs.mkdir(root,{recursive:true});
    if((await fs.realpath(root)).toLowerCase()!==root.toLowerCase())throw Error('Redirected preview data.');
    void prune().catch(()=>{});
  }
  async function prune(){
    const now=Date.now();
    for(const item of await fs.readdir(root,{withFileTypes:true})){
      const request=item.isDirectory()&&(UUID.test(item.name)||/^stage-[a-z0-9]{6}$/i.test(item.name));
      if(!request&&!(item.isFile()&&imageName.test(item.name)))continue;
      const entry=path.join(root,item.name),stat=await fs.lstat(entry).catch(()=>null);
      if(!stat||now-stat.mtimeMs<=60*60*1000)continue;
      if(request&&stat.isDirectory())void clear(entry);
      if(!request&&stat.isFile())void fs.unlink(entry).catch(()=>{});
    }
  }
  async function waitForRecycle(current,signal){
    const gate=handoff;
    if(!gate)return await current()?'exit':'cancelled';
    const pid=await gate.pid;
    const end=gate.since+(pid?1500:160);
    while(await current()){
      const remaining=end-performance.now();
      if(pid?processExited(pid):remaining<=0){
        if(handoff===gate)handoff=null;
        return 'exit';
      }
      if(remaining<=0)return 'timeout';
      await delay(Math.min(25,remaining),undefined,{signal});
    }
    return 'cancelled';
  }

  const show=async (exe,file,{openable,open,stillCurrent,authorizeSave,session,cloudSize})=>{
    let recycled=false,stage='prepare',reported=false;
    const finish=(value,outcome,reason)=>{
      if(!reported){
        reported=true;
        try{onDiagnostic?.({outcome,stage,reason,recycled});}catch{/* Diagnostics cannot affect preview. */}
      }
      return value;
    };
    if(!root)return finish(false,'failed','data-root-unavailable');
    const requestedAt=performance.now(),coalesce=requestedAt-lastRequest<150;
    lastRequest=requestedAt;
    const generation=++sequence;
    preparing?.abort();
    const job=new AbortController(),signal=job.signal;
    preparing=job;
    const current=async()=>{
      if(signal.aborted||generation!==sequence)return false;
      try{return Boolean(await stillCurrent())&&!signal.aborted&&generation===sequence;}
      catch{return false;}
    };
    let dir,image,reserved=false,prelaunch=false,published=false,cancelMarker,monitor;
    const launch=request=>start(exe,[request]);
    const ensureRoot=()=>initialized??=initialize().catch(error=>{initialized=null;throw error;});
    const cancelPreparing=()=>{
      if(reserved&&!published&&!cancelMarker)
        cancelMarker=fs.writeFile(path.join(dir,'cancelled'),'',{flag:'wx'}).then(()=>true,()=>false);
      return cancelMarker;
    };
    signal.addEventListener('abort',cancelPreparing,{once:true});
    const cleanup=async()=>{
      image?.release();image=null;
      if(!dir)return;
      if(await cancelPreparing()&&prelaunch){
        // Keep the tombstone and empty request long enough for a cold viewer to see them.
        const abandoned=dir;
        setTimeout(()=>void clear(abandoned),3500).unref();
      }else await clear(dir);
      dir=null;
    };
    const cancel=async()=>{await cleanup();return finish(true,'cancelled','selection-changed');};
    const gateResult=async()=>{
      if(!handoff)return await current()?'exit':'cancelled';
      stage='recycle';
      return waitForRecycle(current,signal);
    };
    const reserve=async()=>{
      await ensureRoot();
      signal.throwIfAborted();
      dir=path.join(root,randomUUID());
      await fs.mkdir(dir);
      await fs.writeFile(path.join(dir,'preparing'),'',{flag:'wx'});
      await fs.writeFile(path.join(dir,'request.bcpreview'),'',{flag:'wx'});
      reserved=true;
    };
    const trackHiddenSelection=()=>{
      monitor=new AbortController();
      const checking=AbortSignal.any([signal,monitor.signal]);
      void (async()=>{
        while(!checking.aborted){
          await delay(40,undefined,{signal:checking});
          if(!published&&!await current()&&!checking.aborted&&!published)job.abort();
        }
      })().catch(()=>{});
    };

    // Keep the active request (and any draft) until the replacement is ready.
    const watchRequest=(request,prepared,started)=>{
      const directory=path.dirname(request),asset=image,{data,edit}=prepared;
      let finished=false,ready=false,dismissible=false,closing=false,polling=false,pollAgain=false;
      let watcher,timer,expiry,lastSave=0,didRecycle=false;
      let complete;
      const result=new Promise(resolve=>{complete=resolve;});
      const has=name=>fs.lstat(path.join(directory,name)).then(s=>s.isFile(),()=>false);
      const dispose=(value,reason)=>{
        if(finished)return;
        finished=true;
        if(active===dispose){active=null;activeDismiss=null;}
        if(pending===dispose)pending=null;
        clearTimeout(timer);clearTimeout(expiry);
        watcher?.close();
        asset?.release();
        const cleared=clear(directory);
        if(value==='retry')void cleared.then(()=>complete({value,reason}));
        else complete({value,reason});
        if(dismissible)session.onClose?.();
      };
      const arm=()=>{
        clearTimeout(timer);
        timer=setTimeout(()=>dispose(false,'ready-timeout'),timeout);
        timer.unref();
      };
      const save=async()=>{
        const input=path.join(directory,'save.json'),reply=path.join(directory,'save-result.json'),tmp=path.join(directory,'save-result.tmp');
        const stat=await fs.lstat(input).catch(()=>null);
        if(!stat)return;
        let message;
        try{
          if(stat.isFile()&&stat.size<=1024*1024)message=JSON.parse(await fs.readFile(input,'utf8'));
        }catch{/* Ignore invalid messages. */}
        finally{await fs.unlink(input).catch(()=>{});}
        if(!Number.isSafeInteger(message?.revision)||message.revision<=lastSave)return;
        lastSave=message.revision;
        const authorized=async()=>!finished&&active===dispose&&await authorizeSave()&&!finished&&active===dispose;
        const status=await saveDocument(file,directory,edit,message.body,authorized,replace);
        if(finished)return;
        await fs.writeFile(tmp,JSON.stringify({revision:lastSave,status}),{flag:'wx'});
        try{await fs.rename(tmp,reply);}finally{await fs.unlink(tmp).catch(()=>{});}
      };
      const check=async()=>{
        if(finished)return;
        if(polling){pollAgain=true;return;}
        polling=true;
        try{
          do{
            pollAgain=false;
            if(!ready&&!didRecycle&&(await has('recycle'))){
              if(finished)return;
              recycled=didRecycle=true;
              handoff={pid:recyclePid(directory),since:performance.now()};
              clearTimeout(timer);
              const gate=await gateResult();
              if(finished)return;
              if(gate!=='exit'){dispose(gate==='cancelled',gate==='cancelled'?'selection-changed':'recycle-timeout');return;}
              stage='launch';
              arm();
              await launch(request);
              stage='viewer';
            }
            if(!ready&&(await has('blocked'))){dispose('blocked','unsaved-draft');return;}
            if(!ready&&(await has('failed'))){
              if(prepared.cacheKey&&derivatives.get(prepared.cacheKey)?.asset.name===asset?.name)forget(prepared.cacheKey);
              dispose(data.image?'retry':false,'viewer-rejected');return;
            }
            if(!ready&&(await has('ready'))){
              const readyFile=path.join(directory,'ready');
              const info=await fs.lstat(readyFile).catch(()=>null);
              const supportsDismiss=Boolean(session?.id&&session.scope&&info?.isFile()&&info.size===dismissCapability.length&&
                await fs.readFile(readyFile,'utf8').catch(()=>null)===dismissCapability);
              if(finished)return;
              if(prepared.derivative&&prepared.cacheKey)remember(prepared.cacheKey,asset,prepared.source,data);
              active?.(true);
              active=dispose;
              if(pending===dispose)pending=null;
              ready=true;dismissible=supportsDismiss;
              if(dismissible)activeDismiss={id:session.id,scope:session.scope,exe,file,send:async space=>{
                if(closing||finished||await has('closed')||await has('open')||active!==dispose)return false;
                const args=['--dismiss-preview='+request];
                if(space)args.push('--space');
                await start(exe,args);
                return true;
              }};
              clearTimeout(timer);complete({value:dismissible?'dismissible':true});
            }
            const opening=!closing&&await has('open');
            if(finished)return;
            if(opening){
              closing=true;
              // A click can only reopen the exact selection already authorized by the tree.
              if(ready&&active===dispose)await open();
              dispose(true,'closed');return;
            }
            if(await has('closed')){dispose(true,'closed');return;}
            if(ready&&edit&&active===dispose)await save().catch(()=>{});
          }while(pollAgain&&!finished);
        }catch{dispose(ready,signal.aborted?'selection-changed':'viewer-error');}
        finally{polling=false;}
      };
      pending?.(true,'selection-changed');
      pending=dispose;
      try{
        watcher=watch(directory,{persistent:false},()=>void check());
        watcher.on('error',()=>dispose(ready,'watch-error'));
        arm();
        // Request files are not a preview history. Backstop abnormal exits.
        expiry=setTimeout(()=>dispose(ready,'expired'),60*60*1000);expiry.unref();
        if(!started){
          stage='launch';
          Promise.resolve(launch(request)).then(()=>{
            if(stage==='launch')stage='viewer';
            void check();
          },()=>dispose(false,'launch-failed'));
        }else void check();
      }catch{dispose(false,stage==='launch'?'launch-failed':'watch-error');}
      return result;
    };

    try{
      if(!await current())return await cancel();
      const mode=mediaModes.get(extension(file));
      let started=false,noticeStage='prepare';
      let prepared=await prepare(file,openable,/^zh\b/i.test(language??''),Boolean(replace&&authorizeSave),{
        signal,cloudSize,findMedia,prepareMedia:async(mode,base,source,cacheKey)=>{
          const media=await mediaExecutable(exe);
          if(!media)return notice(base,'failed',mediaFailure(mode));
          // Only a worker miss reached from a fast switch gets a settling window.
          if(coalesce)await delay(42,undefined,{signal});
          if(!await current())throw Error('selection changed');
          const companion=path.join(path.dirname(exe),'PreviewRequestHost.exe');
          if((await fs.lstat(companion).catch(()=>null))?.isFile()){
            await reserve();
          }else{
            await ensureRoot();
            signal.throwIfAborted();
            dir=await fs.mkdtemp(path.join(root,'stage-'));
          }
          const gate=reserved?await gateResult():'exit';
          if(gate==='cancelled'){job.abort();signal.throwIfAborted();}
          if(gate==='timeout')return notice(base,'failed','timeout');
          stage='prepare';
          const unchanged=async()=>sameFileVersion(source,await fs.lstat(file,{bigint:true}).catch(()=>null));
          if(!await unchanged())return notice(base,'failed',mediaFailure(mode));
          if(!await current()){job.abort();signal.throwIfAborted();}
          // Run the decoder and hidden launch in parallel. Attach a rejection handler
          // immediately so cancellation cannot leave a rejected worker unobserved.
          const derivative=makeDerivative(media,file,dir,mode,base,signal,runMedia,key).then(async decoded=>{
            if(!decoded.derivative)return decoded;
            if(await unchanged())return {...decoded,cacheKey,source};
            await fs.unlink(decoded.derivative.output).catch(()=>{});
            return notice(base,'failed',mediaFailure(mode));
          });
          if(!reserved)return derivative;
          prelaunch=true;
          trackHiddenSelection();
          const startHidden=Promise.resolve().then(()=>{
            signal.throwIfAborted();
            return launch(path.join(dir,'request.bcpreview'));
          })
            .then(()=>{started=true;},()=>{/* Retry with the complete payload. */});
          const [decoded]=await Promise.allSettled([derivative,startHidden]);
          if(decoded.status==='rejected')throw decoded.reason;
          return decoded.value;
        }
      });
      image=prepared?.asset;
      if(!await current())return await cancel();
      if(!prepared){await cleanup();return finish(false,'failed','source-unavailable');}

      for(;;){
        stage='publish';
        await ensureRoot();
        signal.throwIfAborted();
        if(prepared.image||prepared.derivative){
          image=await retainImage(path.extname(prepared.data.image),prepared.image,prepared.derivative);
          prepared.data.image=image.name;
        }
        if(!dir)dir=await fs.mkdtemp(path.join(root,'stage-'));
        const payload=JSON.stringify(prepared.data);
        if(reserved){
          const temp=path.join(dir,'request.tmp');
          await fs.writeFile(temp,payload,{flag:'wx'});
          if(!await current())return await cancel();
          await fs.rename(temp,path.join(dir,'request.bcpreview'));
          published=true;
          monitor?.abort();
        }else{
          const finalDir=path.join(root,randomUUID());
          await fs.writeFile(path.join(dir,'request.bcpreview'),payload,{flag:'wx'});
          await fs.rename(dir,finalDir);
          dir=finalDir;
        }

        // Prelaunch already authorized the gesture. Once published, the viewer
        // may take focus before the first marker is processed here.
        if(!started){
          const gate=await gateResult();
          if(gate==='cancelled')return await cancel();
          if(gate==='timeout'){await cleanup();return finish(false,'timeout','recycle-timeout');}
        }
        const request=path.join(dir,'request.bcpreview');
        stage='viewer';
        const delivery=watchRequest(request,prepared,started);
        dir=image=null; // ownership transferred to the watcher
        const {value,reason}=await delivery;
        if(value==='retry'&&await current()){
          // A header-valid image may still fail in the viewer. Retry once with
          // no image and a fresh request, not the rejected path or another app.
          prepared=notice(prepared.data,'failed',mediaFailure(mode));
          noticeStage='viewer';
          reserved=prelaunch=started=published=false;
          continue;
        }
        if(value==='blocked')return finish(value,'blocked',reason);
        if(reason==='selection-changed'||reason==='closed'||(value!=='dismissible'&&value!==true&&!await current()))
          return finish(true,'cancelled',reason??'selection-changed');
        if(reason==='ready-timeout'||reason==='recycle-timeout')return finish(false,'timeout',reason);
        if(!value)return finish(false,'failed',reason);
        const {notice:card,poster,imageWidth,truncated}=prepared.data;
        if(card){stage=noticeStage;return finish(value,card.code==='timeout'?'timeout':card.kind,card.code);}
        const degraded=poster?'poster':imageWidth?'downscaled':truncated?'truncated':undefined;
        stage='viewer';
        return finish(value,degraded?'degraded':'ready',degraded);
      }
    }catch{
      if(!await current())return await cancel();
      await cleanup();
      return finish(false,'failed',stage+'-error');
    }finally{
      monitor?.abort();
      if(preparing===job)preparing=null;
    }
  };
  show.dismiss=async(exe,file,id,scope,space)=>{
    const target=activeDismiss;
    return Boolean(target&&target.id===id&&target.scope===scope&&target.exe===exe&&target.file===file&&await target.send(space));
  };
  return show;
}
module.exports={appId,createNativePreview,dimensions,prepare};
