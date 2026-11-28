const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const {setTimeout:delay}=require('node:timers/promises');
const {pageSource}=require('../../src/platform/i18n/i18n.js');
const {workspaceTreeSource:composeWorkspaceTree}=require('../../src/features/workspace-tree/host/page-source.cjs');
const {readUi}=require('../../src/runtime/feature-registry.cjs');
const workspaceTreeSource=options=>composeWorkspaceTree(options,readUi('workspace-tree'));
const {createWorkspaceActions}=require('../../src/features/workspace-tree/host/native-actions.cjs');
const {createNativePreview,prepare}=require('../../src/features/workspace-tree/host/preview-bridge.cjs');
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const [a,b,c,d,e,f,g,h,j,p,q]=[1,2,3,4,5,6,7,8,9,100,101].map(uuid);
let passed=0;
function check(name,value=true){assert.ok(value,name);passed++;console.log('PASS '+name);}

async function waitFor(probe,timeout=1200){
  const end=performance.now()+timeout;
  do{const value=await probe();if(value)return value;await delay(10);}while(performance.now()<end);
  throw Error('Preview fixture did not report the expected state');
}

async function checkPreviewProtocol(dir,exe){
  const appData=path.join(dir,'protocol'),events=[];
  const options={openable:true,open:async()=>{},stillCurrent:()=>true};
  const fixture=async(name,bytes)=>{const file=path.join(dir,name);await fs.writeFile(file,bytes);return file;};
  const marker=(request,name,value='')=>fs.writeFile(path.join(path.dirname(request),name),value);
  const has=(request,name)=>fs.stat(path.join(path.dirname(request),name)).then(()=>true,()=>false);
  const read=async request=>{
    const bytes=await fs.readFile(request,'utf8');
    return bytes?JSON.parse(bytes):null;
  };
  const card=(data,kind,code)=>{
    assert.deepEqual(data.notice,{kind,code});
    assert.ok(!('body' in data)&&!('image' in data)&&!data.editable&&!data.saveMode);
  };
  let data,request;
  const show=createNativePreview({appData,onDiagnostic:event=>events.push(event),start:async(_,[file])=>{
    request=file;data=await read(file);await marker(file,'ready');
  }});
  const doc=await fixture('valid.txt','bounded text');
  const video=await fixture('input.mp4','0000ftypnot-decodable');
  const invalidImage=await fixture('corrupt.png','not a png');
  const png=Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000000000000000000049454e4400000000','hex');
  const pixels=Buffer.from(png);pixels.writeUInt32BE(5000,16);pixels.writeUInt32BE(5000,20);
  const huge=await fixture('too-big.jpg','x');
  await fs.truncate(huge,32*1024*1024+1);
  const animated=Buffer.concat([png.subarray(0,33),Buffer.from('000000006163544c00000000','hex'),png.subarray(33)]);
  for(const [file,kind,code,extra] of [
    [await fixture('unsupported.bin','unsupported'),'unsupported','unsupported-type'],
    [await fixture('no-worker.pdf','%PDF-'),'failed','invalid-pdf'],
    [video,'failed','media-failed'],
    [await fixture('animated.png',animated),'unsupported','unsupported-type'],
    [huge,'limit','too-large'],[await fixture('pixels.png',pixels),'limit','too-many-pixels'],
    [path.join(dir,'absent-cloud.txt'),'limit','cloud-only',{cloudSize:321,openable:false}],
    [await fixture('bad.text',Buffer.from([0xc0,0xaf])),'failed','invalid-text'],
    [invalidImage,'failed','invalid-image']
  ]){
    assert.equal(await show(exe,file,{...options,...extra}),true);
    card(data,kind,code);
    assert.equal(data.name,path.basename(file));
    assert.equal(data.size,extra?.cloudSize??(await fs.stat(file)).size);
    assert.equal(data.openable,extra?.openable??true);
    assert.deepEqual(events.at(-1),{outcome:kind,stage:'prepare',reason:code,recycled:false});
  }
  check('Unsupported, animated, bounded, offline and unreadable selections publish self-contained notices');
  for(const ext of ['text','adoc','org']){
    const file=await fixture('valid.'+ext,'plain text');
    assert.equal(await show(exe,file,options),true);
    assert.equal(data.body,'plain text');assert.equal(data.ext,ext);
    assert.equal(events.at(-1).outcome,'ready');
  }
  await marker(request,'closed');
  check('Explorer text extensions render normally and are diagnosed as ready');

  const staticImage=await fixture('static.png',png);
  const rejected=[];
  const rejectImage=createNativePreview({appData,onDiagnostic:event=>events.push(event),start:async(_,[file])=>{
    request=file;data=await read(file);rejected.push(file);
    await marker(file,data.image?'failed':'ready');
  }});
  assert.equal(await rejectImage(exe,staticImage,options),true);
  card(data,'failed','invalid-image');
  check('Viewer image failure is retried once as a notice in a fresh request',
    rejected.length===2&&rejected[0]!==rejected[1]&&events.at(-1).stage==='viewer');
  await marker(request,'closed');

  await fixture('PreviewMedia.exe','mock worker');
  const jpeg=Buffer.from('ffd8ffc00008080001000101ffd9','hex');
  let mediaBytes=jpeg,posterRuns=0;
  const poster=createNativePreview({appData,onDiagnostic:event=>events.push(event),runMedia:async(_,[mode,input,output])=>{
    assert.deepEqual([mode,input],['poster',video]);posterRuns++;
    await fs.writeFile(output,mediaBytes);
    return {stdout:JSON.stringify({width:2,height:2,imageWidth:1,imageHeight:1})};
  },start:async(_,[file])=>{
    request=file;data=await read(file);
    assert.ok(data);assert.equal(await has(file,'preparing'),false);
    assert.deepEqual(await fs.readFile(path.join(path.dirname(path.dirname(file)),data.image)),mediaBytes);
    await marker(file,'ready');
  }});
  for(const [ext,bytes] of [['jpg',jpeg],['png',png]]){
    mediaBytes=bytes;
    assert.equal(await poster(exe,video,options),true);
    assert.match(data.image,new RegExp('^image-[0-9a-f]{64}\\.'+ext+'$'));
    assert.deepEqual([data.poster,data.width,data.height,data.imageWidth,data.imageHeight],[true,2,2,1,1]);
    assert.equal(events.at(-1).outcome,'degraded');assert.equal(events.at(-1).reason,'poster');
  }
  await marker(request,'closed');
  check('Incomplete packages launch after publication; static JPEG and legacy PNG posters keep correct dimensions',posterRuns===2);

  await fixture('PreviewRequestHost.exe','mock request host');
  // Exercise the same staging and hidden launch as a real worker, independently of installed codecs.
  const withShape=(image,w,h)=>{
    const bytes=Buffer.from(image);
    if(image===jpeg){bytes.writeUInt16BE(h,7);bytes.writeUInt16BE(w,9);}
    else{bytes.writeUInt32BE(w,16);bytes.writeUInt32BE(h,20);}
    return bytes;
  };
  const largeJpeg=await fixture('24mp.JPEG',withShape(jpeg,6000,4000));
  const largePng=await fixture('large.png',withShape(png,4000,3000));
  const byBytes=await fixture('32m.jpg',jpeg);
  await fs.truncate(byBytes,32*1024*1024);
  const withExif=tiff=>{
    const app=Buffer.from('ffe10000457869660000','hex');
    app.writeUInt16BE(app.length-2+tiff.length,2);
    return Buffer.concat([jpeg.subarray(0,2),app,tiff,jpeg.subarray(2)]);
  };
  const rotated=await fixture('rotated.jpg',withExif(Buffer.from('4d4d002a00000008000101120003000000010006000000000000','hex')));
  const exif=await fixture('bad-exif.jpg',withExif(Buffer.from('49492a00ffffffff','hex')));
  const pdf=await fixture('pages.PDF','%PDF-synthetic');
  const extendedRasters=[];
  for(const [suffix,mode] of [['webp','webp'],['bmp','bmp'],['gif','gif'],['ico','ico'],['tif','tiff'],['tiff','tiff']])
    extendedRasters.push([await fixture('source.'+suffix,'mock original'),mode,png,{width:8192,height:1400}]);
  let launchWasHidden,workerCalls=0,workerCase,expectedSource,viewer,tempInode;
  const stagedInodes=new Map();
  const extended=createNativePreview({appData,runMedia:async(_,[mode,input,output])=>{
    workerCalls++;
    assert.equal(input,expectedSource);
    assert.equal(mode,workerCase.mode);
    await waitFor(()=>launchWasHidden);
    if(workerCase.error)throw Object.assign(Error('mock worker failure'),{code:workerCase.error});
    await fs.writeFile(output,workerCase.bytes);
    if(workerCase.outputSize)await fs.truncate(output,workerCase.outputSize);
    tempInode=(await fs.stat(output,{bigint:true})).ino;
    return {stdout:JSON.stringify({width:2,height:2,imageWidth:1,imageHeight:1,...workerCase.metadata})};
  },start:async(_,[file])=>{
    request=file;
    launchWasHidden=(await read(file))===null;
    if(launchWasHidden)assert.equal(await has(file,'preparing'),true);
    viewer=waitFor(()=>read(file)).then(async payload=>{
      if(payload.image){
        const staged=path.join(path.dirname(path.dirname(file)),payload.image);
        assert.deepEqual(await fs.readFile(staged),workerCase?.bytes??(await fs.readFile(expectedSource)));
        if(workerCase){
          const inode=(await fs.stat(staged,{bigint:true})).ino;
          assert.notEqual(inode,0n);
          assert.equal(inode,stagedInodes.get(payload.image)??tempInode);
          assert.equal(await has(file,'media.tmp'),false);
          stagedInodes.set(payload.image,inode);
        }
      }
      await marker(file,'ready');return payload;
    });
  }});
  const publish=async(file,worker=null)=>{
    expectedSource=file;workerCase=worker;launchWasHidden=false;
    const before=workerCalls;
    assert.equal(await extended(exe,file,options),true);
    assert.equal(launchWasHidden,Boolean(worker));
    assert.equal(workerCalls-before,worker?1:0);
    const payload=await viewer;
    await marker(request,'closed');
    return payload;
  };
  for(const [file,mode,bytes,metadata] of [
    [largeJpeg,'jpeg',jpeg,{width:6000,height:4000}],
    [byBytes,'jpeg',jpeg,{width:1,height:1}],
    [rotated,'jpeg',jpeg,{width:1,height:1}],
    [exif,'jpeg',jpeg,{width:1,height:1}],
    [largePng,'png',png,{width:4000,height:3000}],
    ...extendedRasters,
    [pdf,'pdf',png,{width:10000,height:5000,pageCount:9}]
  ]){
    const payload=await publish(file,{mode,bytes,metadata:{pageCount:17,...metadata}});
    assert.match(payload.image,mode==='jpeg'?/^image-[0-9a-f]{64}\.jpg$/:/^image-[0-9a-f]{64}\.png$/);
    assert.deepEqual([payload.width,payload.height,payload.imageWidth,payload.imageHeight],
      [metadata.width,metadata.height,1,1]);
    assert.equal(payload.pageCount,metadata.pageCount);
    assert.ok(!('body' in payload)&&!('poster' in payload));
  }
  const small=await publish(await fixture('small.jpg',jpeg));
  assert.ok(small.image.endsWith('.jpg')&&!('imageWidth' in small));
  check('24MP JPEG, 32 MiB JPEG, PNG and all added raster/PDF routes use the bounded worker and prelaunch');
  for(const [name,tiff] of [
    ['normal-le','49492a0008000000010012010300010000000100000000000000'],
    ['normal-be','4d4d002a00000008000101120003000000010001000000000000'],
    ['thumbnail-only','4d4d002a0000000800000000000e000101120003000000010006000000000000']
  ]){
    const direct=await publish(await fixture(name+'.jpg',withExif(Buffer.from(tiff,'hex'))));
    assert.ok(direct.image.endsWith('.jpg')&&!('imageWidth' in direct));
  }
  check('EXIF Orientation 1 in both byte orders and absent IFD0 tags bypass the worker; 6 or malformed EXIF uses it');
  const alternateJpeg=Buffer.concat([jpeg.subarray(0,2),Buffer.from('ffe0000301','hex'),jpeg.subarray(2)]);
  for(const [suffix,mode,bytes,format] of [['webp','webp',alternateJpeg,'jpg'],['tif','tiff',png,'png'],['pdf','pdf',alternateJpeg,'jpg']]){
    const file=await fixture('dynamic.'+suffix,'different source');
    const payload=await publish(file,{mode,bytes,metadata:{format,pageCount:3}});
    assert.ok(payload.image.endsWith('.'+format));
    assert.equal(payload.pageCount,mode==='pdf'?3:undefined);
  }
  check('Dynamic JPEG and PNG are validated and renamed in place, or deduplicated against the existing inode');

  const webp=extendedRasters[0][0];
  const jpegWithoutScan=jpeg.subarray(0,-2);
  const bigWebp=await fixture('over-limit.webp','x');await fs.truncate(bigWebp,32*1024*1024+1);
  card(await publish(bigWebp),'limit','too-large');
  card(await publish(await fixture('over-side.jpg',withShape(jpeg,12001,100))),'limit','too-many-pixels');
  card(await publish(await fixture('over-area.jpg',withShape(jpeg,10000,5001))),'limit','too-many-pixels');
  card(await publish(await fixture('large-animated.png',withShape(animated,4000,3000))),'unsupported','unsupported-type');
  for(const [i,[file,mode,metadata,overrides,kind,code]] of [
    [webp,'webp',{width:8193},null,'limit','too-many-pixels'],
    [webp,'webp',{width:4000,height:3001},null,'limit','too-many-pixels'],
    [webp,'webp',{width:3000,height:1000,imageWidth:2049},null,'limit','too-many-pixels'],
    [webp,'webp',{width:3000,height:3000,imageWidth:2000,imageHeight:1600},null,'limit','too-many-pixels'],
    [webp,'webp',null,{bytes:withShape(png,2049,1)},'limit','too-many-pixels'],
    [webp,'webp',null,{outputSize:12*1024*1024+1},'limit','too-large'],
    [webp,'webp',null,{bytes:jpeg},'failed','invalid-image'],
    [webp,'webp',{format:'jpg'},null,'failed','invalid-image'],
    [webp,'webp',{format:'png'},{bytes:jpeg},'failed','invalid-image'],
    [webp,'webp',{format:'jpeg'},{bytes:jpeg},'failed','invalid-image'],
    [webp,'webp',{format:'jpg'},{bytes:withShape(jpeg,2,1)},'failed','invalid-image'],
    [webp,'webp',{format:'jpg'},{bytes:jpegWithoutScan},'failed','invalid-image'],
    [webp,'webp',{format:'png'},{bytes:animated},'failed','invalid-image'],
    [webp,'webp',null,{bytes:withShape(png,2,1)},'failed','invalid-image'],
    [webp,'webp',null,{error:3},'limit','too-many-pixels'],
    [webp,'webp',null,{error:4},'limit','too-large'],
    [webp,'webp',null,{error:5},'unsupported','unsupported-type'],
    [pdf,'pdf',null,{error:1460},'failed','timeout'],
    [pdf,'pdf',{width:10000,height:5001,pageCount:2},null,'limit','too-many-pixels'],
    ...[undefined,0,-1,1.5,'3',0x80000000].map(pageCount=>[pdf,'pdf',{pageCount},null,'failed','invalid-pdf'])
  ].entries()){
    const fresh=await fixture('failure-'+i+path.extname(file),'mock original');
    card(await publish(fresh,{mode,bytes:png,metadata,...overrides}),kind,code);
  }
  check('Source limits, derivative byte/side/area limits, raster type and PDF pageCount fail closed as notices');

  const cacheSources=await Promise.all(Array.from({length:9},(_,i)=>fixture('cache-'+i+'.jpg',withShape(jpeg,6000,4000))));
  const byteSources=await Promise.all(Array.from({length:3},(_,i)=>fixture('cache-bytes-'+i+'.png',withShape(png,4000,3000))));
  let cacheRuns=0;
  const cache=createNativePreview({appData,runMedia:async(_,[mode,,output])=>{
    const serial=++cacheRuns;
    if(mode==='jpeg'){
      const bytes=Buffer.concat([jpeg.subarray(0,2),Buffer.from([0xff,0xe0,0,3,serial]),jpeg.subarray(2)]);
      await fs.writeFile(output,bytes);
    }else{
      // A large ancillary chunk puts IEND outside the probe and exercises bounded hashing.
      const length=11*1024*1024,chunk=Buffer.from('0000000074455874','hex');
      chunk.writeUInt32BE(length,0);
      const handle=await fs.open(output,'wx');
      try{
        await handle.write(Buffer.concat([png.subarray(0,33),chunk,Buffer.from([serial])]),0,42,0);
        await handle.write(png.subarray(33),0,12,45+length);
      }finally{await handle.close();}
    }
    return {stdout:JSON.stringify({width:6000,height:2000,imageWidth:1,imageHeight:1})};
  },start:async(_, [file])=>{
    request=file;
    if(await read(file)){await marker(file,'ready');return;}
    void waitFor(()=>read(file)).then(()=>marker(file,'ready'));
  }});
  const cachedPublish=async(file,extra)=>{
    assert.equal(await cache(exe,file,{...options,...extra}),true);
    return read(request);
  };
  const assetPath=name=>path.join(path.dirname(path.dirname(request)),name);
  const [first,second]=cacheSources;
  const firstImage=(await cachedPublish(first)).image;
  const secondImage=(await cachedPublish(second)).image;
  const openOriginal=fs.open;
  fs.open=(file,...args)=>{
    assert.notEqual(file,first,'a derivative hit must not open its source');
    return openOriginal(file,...args);
  };
  try{assert.equal((await cachedPublish(first)).image,firstImage);}
  finally{fs.open=openOriginal;}
  card(await cachedPublish(first,{cloudSize:321}),'limit','cloud-only');
  assert.equal(cacheRuns,2);
  for(const file of cacheSources.slice(2))await cachedPublish(file);
  await waitFor(()=>fs.lstat(assetPath(secondImage)).then(()=>false,()=>true));
  assert.equal((await cachedPublish(first)).image,firstImage);
  assert.equal(cacheRuns,9);
  const now=Date.now()/1000;
  await fs.utimes(first,now,now-60);
  assert.notEqual((await cachedPublish(first)).image,firstImage);
  assert.equal(cacheRuns,10);
  check('A→B→A uses only metadata, cache hits refresh the eight-entry LRU, and source changes or cloud status prevent stale hits');

  const oldest=(await cachedPublish(byteSources[0])).image;
  const retained=(await cachedPublish(byteSources[1])).image;
  await cachedPublish(byteSources[2]);
  await waitFor(()=>fs.lstat(assetPath(oldest)).then(()=>false,()=>true));
  assert.equal((await cachedPublish(byteSources[1])).image,retained);
  assert.equal(cacheRuns,13);
  await marker(request,'closed');
  check('The 32 MiB LRU evicts staged derivatives by byte weight while keeping more recent output reusable');

  const burstFiles=await Promise.all(Array.from({length:6},(_,i)=>fixture('burst-'+i+'.webp','mock original')));
  const decoded=[];
  const burst=createNativePreview({appData,runMedia:async(_,[mode,input,output])=>{
    decoded.push([input,performance.now()]);
    await fs.writeFile(output,jpeg);
    return {stdout:JSON.stringify({width:2,height:2,imageWidth:1,imageHeight:1,format:'jpg'})};
  },start:async(_,[file])=>{
    request=file;
    if(await read(file)){await marker(file,'ready');return;}
    void waitFor(async()=>await has(file,'cancelled')?'cancelled':await read(file))
      .then(payload=>payload==='cancelled'?undefined:marker(file,'ready'));
  }});
  const firstOpen=burst(exe,burstFiles[0],options);
  await waitFor(()=>decoded.length===1);
  const superseded=burstFiles.slice(1,-1).map(file=>burst(exe,file,options));
  const lastAt=performance.now();
  await Promise.all([firstOpen,...superseded,burst(exe,burstFiles.at(-1),options)].map(async result=>assert.equal(await result,true)));
  assert.deepEqual(decoded.map(([file])=>file),[burstFiles[0],burstFiles.at(-1)]);
  assert.ok(decoded.at(-1)[1]-lastAt>=35);
  assert.equal(await burst(exe,doc,options),true);
  assert.equal((await read(request)).body,'bounded text');
  assert.equal(decoded.length,2);
  await marker(request,'closed');
  check('Six rapid worker selections decode only the first and final item, with normal text delivery between worker requests');

  for(const [code,timedOut] of [['media-failed',false],['timeout',true]]){
    let launched,resolveLaunch,viewer;
    const started=new Promise(resolve=>{resolveLaunch=resolve;});
    const prelaunch=createNativePreview({appData,onDiagnostic:event=>events.push(event),runMedia:async()=>{
      await started;
      throw Object.assign(Error('mock decode failure'),{killed:timedOut});
    },start:async(_,[file])=>{
      launched=file;
      assert.equal(await read(file),null);assert.ok(await has(file,'preparing'));
      viewer=waitFor(()=>read(file)).then(async payload=>{await marker(file,'ready');return payload;});
      resolveLaunch();
    }});
    assert.equal(await prelaunch(exe,video,options),true);
    card(await viewer,'failed',code);
    assert.equal(await has(launched,'request.tmp'),false);
    assert.deepEqual(events.at(-1),{outcome:timedOut?'timeout':'failed',stage:'prepare',reason:code,recycled:false});
    await marker(launched,'closed');
  }
  check('A failed or timed-out hidden decoder publishes a complete failure card to the original request');

  const cancelledDirs=[];
  for(const mode of ['focus loss','superseded']){
    let current=true,hidden,resolveLaunch;
    const started=new Promise(resolve=>{resolveLaunch=resolve;});
    const pending=createNativePreview({appData,onDiagnostic:event=>events.push(event),runMedia:async(_,_args,{signal})=>{
      await delay(10_000,undefined,{signal});assert.fail('worker was not cancelled');
    }, start:async(_,[file])=>{
      if(await read(file)){request=file;await marker(file,'ready');}
      else{hidden=file;resolveLaunch();}
    }});
    const old=pending(exe,video,{...options,stillCurrent:()=>current});
    await started;
    const replacement=mode==='superseded'?pending(exe,doc,options):null;
    if(!replacement)current=false;
    assert.equal(await old,true);
    assert.ok(await has(hidden,'cancelled'));assert.equal(await read(hidden),null);
    assert.equal(events.at(-1).outcome,'cancelled');
    cancelledDirs.push(path.dirname(hidden));
    if(replacement){assert.equal(await replacement,true);await marker(request,'closed');}
  }
  check('Both supersession and focus loss signal cancelled before cleaning hidden requests without publishing a stale card');

  async function runner(test){
    const child=spawn(process.execPath,['-e','process.stdin.resume()'],{windowsHide:true,stdio:['pipe','ignore','ignore']});
    const exit=once(child,'exit');
    await once(child,'spawn');
    try{await test(child.pid,async()=>{child.stdin.end();await exit;});}
    finally{child.stdin.end();await exit;}
  }
  for(const mode of ['exit','cancel','timeout','legacy']){
    const exercise=async(pid,exit)=>{
      let current=true,firstAt,launches=0;
      const recycle=createNativePreview({appData,timeout:700,onDiagnostic:event=>events.push(event),start:async(_,[file])=>{
        request=file;
        if(++launches===1){
          firstAt=performance.now();
          const dir=path.dirname(file);
          await marker(file,'recycle.tmp',pid?String(pid):'');
          await fs.rename(path.join(dir,'recycle.tmp'),path.join(dir,'recycle'));
        }
        else await marker(file,'ready');
      }});
      const result=recycle(exe,doc,{...options,stillCurrent:()=>current});
      await waitFor(()=>launches===1);
      if(mode==='exit'||mode==='cancel'){
        await delay(mode==='exit'?230:60);assert.equal(launches,1);
        if(mode==='exit')await exit();else current=false;
      }
      assert.equal(await result,mode!=='timeout');
      assert.equal(launches,mode==='exit'||mode==='legacy'?2:1);
      if(launches===2)await marker(request,'closed');
      if(mode==='legacy')assert.ok(performance.now()-firstAt>=145);
      if(mode==='timeout')assert.ok(performance.now()-firstAt>=1480);
      assert.equal(events.at(-1).recycled,true);
      assert.equal(events.at(-1).outcome,{exit:'ready',legacy:'ready',cancel:'cancelled',timeout:'timeout'}[mode]);
    };
    if(mode==='legacy')await exercise(null);else await runner(exercise);
  }
  check('Recycle waits for actual PID exit, responds to cancellation, times out without relaunch, and supports empty legacy markers');
  await waitFor(async()=>!(await Promise.all(cancelledDirs.map(dir=>fs.stat(dir).catch(()=>null)))).some(Boolean),4000);
  check('Abandoned prelaunch directories are reclaimed after the cancellation marker can be observed');
}

async function checkNativeActions(){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bc-tree-actions-'));
  try{
    const root=path.join(dir,'folder, with (punctuation)'),other=path.join(dir,'other');
    const home=path.join(dir,'home'),codexHome=path.join(home,'.codex');
    await fs.mkdir(root);await fs.mkdir(other);await fs.mkdir(codexHome,{recursive:true});
    const native=path.join(dir,'BetterCodexPreview.exe'),doc=path.join(root,'文件 & notes.md');
    const script=path.join(root,'script.js'),shortcut=path.join(root,'test.lnk');
    const peek=path.join(dir,'PowerToys.Peek.UI.exe'),quick=path.join(dir,'QuickLook.exe');
    for(const file of [native,peek,quick,doc,script,shortcut,path.join(other,'outside.md')])await fs.writeFile(file,'fixture');
    await fs.symlink(other,path.join(root,'redirect'),'junction');
    const calls=[];
    const settings={home,codexHome,python:process.env.HUD_PYTHON??'python',workspaceTreeQuickLookPath:quick};
    const shell=async(...args)=>{calls.push(args);};
    const legacy=async(...args)=>{calls.push(['legacy-provider',...args]);};
    const optionsForActions={shell,candidates:[peek],peek:legacy,quickLook:legacy,sendQuickLook:legacy};
    const perform=createWorkspaceActions(settings,optionsForActions);
    const yes=()=>true,run=(kind,relative,still=yes)=>perform({kind,root,relative},still);
    const previewRequest={kind:'preview',root,relative:path.basename(doc)};
    const nativeSettings={...settings,workspaceTreePreviewPath:native};
    const runNative=(nativePreview,options={})=>createWorkspaceActions(nativeSettings,{...optionsForActions,nativePreview,...options});
    check('Missing Preview never starts a legacy provider or opens or locates the file',
      await perform(previewRequest,yes)==='previewUnavailable'&&
      await createWorkspaceActions({...nativeSettings,workspaceTreePreviewPath:path.join(other,path.basename(native))},
        optionsForActions)(previewRequest,yes)==='previewUnavailable'&&calls.length===0);
    let authorizeOpen;
    check('Native preview receives the validated path but cannot execute scripts',
      await runNative(async(exe,file,options)=>{
        assert.deepEqual([exe,file,options.openable],[native,script,false]);
        authorizeOpen=options.open;
        return true;
      })({...previewRequest,relative:'script.js'},yes,yes)==='nativePreviewReady'&&calls.length===0&&
      await authorizeOpen()===null&&calls.pop()?.[0]==='locate');
    check('Native preview opening rechecks the existing selection authorization',
      await runNative(async(exe,file,options)=>{authorizeOpen=options.open;return true;})(
        previewRequest,yes,()=>false)==='nativePreviewReady'&&await authorizeOpen()===null&&calls.length===0);
    check('A failed native preview does not call QuickLook, Peek or the Windows shell',
      await runNative(async()=>false)(previewRequest,yes)==='actionFailed'&&calls.length===0);
    check('Native preview gets unknown extensions but only offers Locate for them',
      await runNative(async(exe,file,options)=>{
        assert.deepEqual([exe,file,options.openable],[native,shortcut,false]);
        authorizeOpen=options.open;
        return 'dismissible';
      })({...previewRequest,relative:'test.lnk'},yes)==='nativePreviewDismissible'&&calls.length===0&&
      await authorizeOpen()===null&&calls.pop()?.[0]==='locate');
    check('A draft-blocked replacement is reported unchanged',
      await runNative(async()=>'blocked')(previewRequest,yes)==='nativePreviewBlocked'&&calls.length===0);
    const cloudInfo=async()=>({cloudOnly:true,size:123456});
    const cloudPerform=runNative(async(exe,file,options)=>{
      assert.deepEqual([exe,file,options.cloudSize],[native,path.join(root,'cloud.txt'),123456]);
      assert.equal(await options.authorizeSave(),false);
      return true;
    },{inspectPreview:cloudInfo});
    check('Cloud placeholder metadata avoids opening the leaf and never authorizes saving',
      await cloudPerform({...previewRequest,relative:'cloud.txt'},yes)==='nativePreviewReady'&&
      await cloudPerform({...previewRequest,relative:'redirect/outside.md'},yes)==='actionFailed'&&calls.length===0);
    check('Preview rejects redirected and missing paths before dispatch',
      await runNative(async()=>assert.fail('invalid file dispatched'))({...previewRequest,relative:'redirect/outside.md'},yes)==='actionFailed'&&
      await runNative(async()=>assert.fail('invalid file dispatched'))({...previewRequest,relative:'missing.md'},yes)==='actionFailed');
    const fixtureData=path.join(dir,'preview-data');
    let requestDir,staged;
    const dispatch=createNativePreview({appData:fixtureData,language:'zh-CN',start:async(exe,[file])=>{
      requestDir=path.dirname(file);
      staged=JSON.parse(await fs.readFile(file,'utf8'));
      await fs.writeFile(path.join(requestDir,'ready'),'');
    }});
    check('Preview passes only bounded document data to the app and no original path',
      await dispatch(native,doc,{openable:true,open:async()=>{},stillCurrent:yes})&&
      staged.name===path.basename(doc)&&staged.body==='fixture'&&staged.zh===true&&
      !JSON.stringify(staged).includes(root));
    await fs.writeFile(path.join(requestDir,'closed'),'');
    for(let i=0;i<30&&await fs.stat(requestDir).catch(()=>null);i++)await new Promise(resolve=>setTimeout(resolve,10));
    check('Native preview removes its staging folder on close',!await fs.stat(requestDir).catch(()=>null));
    const picks=[];
    let pickedDir;
    const switching=createNativePreview({appData:fixtureData,start:async(exe,[file])=>{
      picks.push(JSON.parse(await fs.readFile(file,'utf8')).name);
      pickedDir=path.dirname(file);
      await fs.writeFile(path.join(pickedDir,'ready'),'');
    }});
    const latest=path.join(root,'latest.txt');
    await fs.writeFile(latest,'latest');
    const options={openable:true,open:async()=>{},stillCurrent:yes};
    await Promise.all([switching(native,doc,options),switching(native,script,options),switching(native,latest,options)]);
    check('A burst publishes only the newest pending preview',picks.length===1&&picks[0]==='latest.txt');
    await fs.writeFile(path.join(pickedDir,'closed'),'');
    for(let i=0;i<30&&await fs.stat(pickedDir).catch(()=>null);i++)await new Promise(resolve=>setTimeout(resolve,10));
    const dismissCommands=[],dismissPrefix='--dismiss-preview=';
    let didClose;
    const closed=new Promise(resolve=>{didClose=resolve;});
    const dismissible=createNativePreview({appData:fixtureData,start:async(exe,[arg,reason])=>{
      if(arg.startsWith(dismissPrefix)){
        dismissCommands.push([arg,reason]);
        await fs.writeFile(path.join(path.dirname(arg.slice(dismissPrefix.length)),'closed'),'');
      }else{
        requestDir=path.dirname(arg);
        await fs.writeFile(path.join(requestDir,'ready'),'dismiss-v1');
      }
    }});
    const toggle=runNative(dismissible),owner={id:p,scope:a,onClose:didClose};
    check('The host recognizes a viewer that supports targeted dismissal',
      await toggle(previewRequest,yes,yes,owner)==='nativePreviewDismissible');
    const dismissRequest={...previewRequest,kind:'dismissPreview',dismiss:p};
    check('Only a current gesture in the original window can dismiss the matching preview',
      await toggle(dismissRequest,()=>false,yes,owner)===null&&
      await toggle(dismissRequest,yes,yes,{...owner,scope:b})===null&&
      await toggle({...dismissRequest,dismiss:q},yes,yes,owner)===null&&
      await toggle({...dismissRequest,relative:'script.js'},yes,yes,owner)===null&&dismissCommands.length===0&&
      await toggle({...dismissRequest,kind:'preview'},yes,yes,owner)==='nativePreviewDismissed'&&
      dismissCommands[0][0]===dismissPrefix+path.join(requestDir,'request.bcpreview')&&dismissCommands[0][1]==='--space');
    let closeDeadline;
    try{
      await Promise.race([closed,new Promise((_,reject)=>{closeDeadline=setTimeout(()=>reject(Error('close not reported')),1000);})]);
    }finally{clearTimeout(closeDeadline);}
    check('After closing, the same file can open again',
      await toggle(previewRequest,yes,yes,owner)==='nativePreviewDismissible'&&
      await toggle(dismissRequest,yes,yes,owner)==='nativePreviewDismissed'&&dismissCommands[1][1]===undefined);
    const extra=path.join(root,'second.txt'),editOptions={openable:true,open:async()=>{},stillCurrent:yes,authorizeSave:yes};
    await fs.writeFile(doc,'\ufeffone\r\ntwo\r\n');
    await fs.writeFile(extra,'x'.repeat(160*1024+1));
    let editDir,editData;
    const editPreview=createNativePreview({appData:fixtureData,start:async(exe,[file])=>{
      const stage=JSON.parse(await fs.readFile(file,'utf8')),dir=path.dirname(file);
      if(stage.name===path.basename(extra)){await fs.writeFile(path.join(dir,'blocked'),'');return;}
      editDir=dir;editData=stage;
      await fs.writeFile(path.join(dir,'ready'),'');
    },replace:async(file,staged)=>{await fs.copyFile(staged,file);return true;}});
    const save=async(revision,body)=>{
      await fs.writeFile(path.join(editDir,'save.tmp'),JSON.stringify({revision,body}));
      await fs.rename(path.join(editDir,'save.tmp'),path.join(editDir,'save.json'));
      for(let i=0;i<50;i++){
        const reply=await fs.readFile(path.join(editDir,'save-result.json'),'utf8').then(JSON.parse,()=>null);
        if(reply?.revision===revision)return reply.status;
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      throw Error('Missing save reply');
    };
    check('Manual source never requests legacy autosave and large or unapproved files remain read-only',
      (await prepare(script,false,false,true)).data.editable===undefined&&
      (await prepare(script,false,false,true)).data.saveMode==='manual'&&
      (await prepare(doc,true,false)).data.editable===undefined&&
      (await prepare(extra,true,false,true)).data.editable===undefined&&
      await editPreview(native,doc,editOptions)&&editData.editable&&editData.body==='one\ntwo\n');
    check('A blocked second preview leaves the visible editor authorized to save',
      await editPreview(native,extra,editOptions)==='blocked'&&await save(1,'one\nchanged\n')==='saved'&&
      await fs.readFile(doc,'utf8')==='\ufeffone\r\nchanged\r\n');
    check('Oversized edits are not written',
      await save(2,'x'.repeat(8193))==='limit'&&await fs.readFile(doc,'utf8')==='\ufeffone\r\nchanged\r\n');
    await fs.writeFile(doc,'external');
    check('Autosave refuses to overwrite an external edit',
      await save(3,'do not overwrite')==='conflict'&&await fs.readFile(doc,'utf8')==='external');
    await fs.writeFile(path.join(editDir,'closed'),'');
    for(let i=0;i<30&&await fs.stat(editDir).catch(()=>null);i++)await new Promise(resolve=>setTimeout(resolve,10));
    check('Editable preview removes save requests and acknowledgements on close',!await fs.stat(editDir).catch(()=>null));
    const configs=[
      ['settings.json','{"value":5}','{"value":'],
      ['settings.jsonc','// note\n{"value":5,}', '{"value": /*'],
      ['settings.yaml','---\nvalue: 5\n---\nvalue: 6\n','value: [5,\n'],
      ['settings.yml','value: 5\n','value: [5,\n'],
      ['settings.toml','value = 5\n','value = [5,\n'],
      ['settings.ini','[test]\nvalue=5\n','[test\nvalue=5\n'],
    ];
    for(const [name,valid,invalid] of configs){
      const file=path.join(root,name);
      await fs.writeFile(file,valid);
      assert.ok(await editPreview(native,file,editOptions)&&editData.editable===true);
      assert.equal(await save(1,invalid),'invalid',name);
      assert.equal(await fs.readFile(file,'utf8'),valid);
      assert.equal(await save(2,valid.replace('5','7')),'saved',name);
      assert.equal(await fs.readFile(file,'utf8'),valid.replace('5','7'));
    }
    check('Structured config errors keep the original and corrected drafts can save');
    for(const name of ['.gitignore','.gitattributes','.env.example','Dockerfile','Makefile','example.ts',
      'example.py','example.sh','example.ps1','.env','.env.local','.env.secret.json','example.rs']){
      const file=path.join(root,name);
      await fs.writeFile(file,'fixture');
      const item=(await prepare(file,true,false,true))?.data;
      if(['.gitignore','.gitattributes','.env.example'].includes(name))assert.equal(item?.editable,true);
      else if(name.startsWith('.env')||name.endsWith('.rs'))assert.ok(!item?.editable&&!item?.saveMode);
      else assert.ok(item?.saveMode==='manual'&&!item.editable);
    }
    check('Rules and the env example autosave, named build files and scripts need a manual save, actual env files and other code do not edit');
    check('Environment example goes to the native preview without asking the Windows shell to open it',
      await runNative(async(exe,file,options)=>exe===native&&file===path.join(root,'.env.example')&&!options.openable)
        ({...previewRequest,relative:'.env.example'},yes,yes)==='nativePreviewReady');
    assert.ok(await editPreview(native,script,editOptions));
    check('Manual edits can write through the same checked host path',
      editData.saveMode==='manual'&&!editData.editable&&await save(1,'// saved explicitly\n')==='saved'&&
      await fs.readFile(script,'utf8')==='// saved explicitly\n');
    await fs.writeFile(path.join(editDir,'closed'),'');
    for(let i=0;i<30&&await fs.stat(editDir).catch(()=>null);i++)await new Promise(resolve=>setTimeout(resolve,10));
    check('Open uses the default app for ordinary documents',await run('open',path.basename(doc))===null&&calls.pop()?.[0]==='open');
    check('Folder and locate use separate Explorer verbs',await run('folder','')===null&&
      JSON.stringify(calls.pop())===JSON.stringify(['folder',root])&&await run('locate',path.basename(doc))===null&&calls.pop()?.[0]==='locate');
    check('Folder launch distinguishes foreground denial from a failed open',await createWorkspaceActions(settings,{
      shell:async()=>{throw Object.assign(Error(),{code:3});}
    })({kind:'folder',root,relative:''},yes)==='folderBackground');
    const nativeFolder={kind:'folder',root,relative:'',nativeFolder:true};
    check('Host authorizes the native handoff only after path and scope validation without launching Windows',
      await perform(nativeFolder,yes)==='openNativeFolder'&&await perform(nativeFolder,()=>false)===null&&
      await perform({...nativeFolder,root:codexHome},yes)==='actionFailed'&&calls.length===0);
    check('Scripts and shortcuts still cannot open through the shell',
      await run('open','script.js')==='locateOnly'&&calls.pop()?.[0]==='locate'&&
      await run('open','test.lnk')==='locateOnly'&&calls.pop()?.[0]==='locate');
    check('Missing Windows file association falls back to locating',await createWorkspaceActions(settings,{
      shell:async(verb,file)=>{if(verb==='open')throw Object.assign(Error(),{code:2});await shell(verb,file);}
    })({kind:'open',root,relative:path.basename(doc)},yes)==='locateOnly'&&calls.pop()?.[0]==='locate');
    for(const relative of ['../other/outside.md','redirect/outside.md','test.lnk:alt','COM1 .md','no-longer-exists.md']){
      assert.equal(await run('open',relative),'actionFailed',relative);
    }
    check('Host rejects traversal, redirects, devices, ADS, deleted files and private roots without launching',
      await perform({kind:'folder',root:codexHome,relative:''},yes)==='actionFailed'&&calls.length===0);
    check('Host rechecks the current chat just before launching',await run('preview',path.basename(doc),()=>false)===null&&calls.length===0);
    await checkPreviewProtocol(dir,native);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
}

(async()=>{
  await checkNativeActions();
  if(process.argv.includes('--native-only')){console.log('workspace-tree native: '+passed+' passed');return;}
  const {chromium}=require(process.env.HUD_PLAYWRIGHT||'playwright');
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1060,height:640}});
    const page=await context.newPage();
    const exceptions=[];page.on('pageerror',error=>exceptions.push(error.message));
    const url='https://workspace-tree.invalid/index.html';
    await page.route(url,route=>route.fulfill({contentType:'text/html',body:
      '<!doctype html><html lang="zh-CN"><body><button id="sidebar">Sidebar chat</button>'+
      '<section data-app-shell-active-page="true">'+
      '<div data-app-shell-main-titlebar><div data-app-shell-header-toolbar style="display:flex">'+
      '<div>Chat</div><div id="actions" style="display:flex"><button id="native">Native files</button></div></div></div>'+
      '<main data-app-shell-main-surface><div id="dock" style="display:flex;height:520px">'+
      '<div data-app-shell-main-content-layout="thread-edge-scroll" style="display:flex;flex:1;flex-direction:column;min-width:0;overflow:hidden">'+
      '<div id="native-frame" style="align-self:flex-end;min-width:100%;width:var(--native-frame-width,100%)">'+
      '<div data-app-shell-focus-area="main"><div class="thread-scroll-container">'+
      '<div id="thread" data-above-composer-conversation-id="'+a+'">Chat composer</div>'+
      '</div></div></div></div></div></main></section></body></html>'}));
    await page.goto(url);
    await page.evaluate(({a,b,c,d,e,f,g,h,j,p,q})=>{
      const worktree='C:\\Users\\FixtureUser\\.codex\\worktrees\\one\\app';
      const app=window.fixture={requests:[],nativeCalls:0,nativeOpens:[],actions:[],delay:0,watches:new Map(),
        projectIds:{[c]:p,[b]:q},projects:[
          {id:p,name:'Registered project',roots:[{path:'d:/WORK/app/'}]},
          {id:q,name:'Other project',roots:[{path:'D:\\work\\other'},{path:worktree}]}
        ],
        roots:{
          [a]:'D:\\work\\app',[b]:'D:\\work\\other',[c]:worktree,[j]:worktree,
          [d]:'d:\\WORK\\app\\sub',[e]:'D:/work/unregistered/',[f]:'d:\\WORK\\unregistered',
          [g]:'D:\\work\\app',[h]:'D:\\work\\app'
        },files:{
          'D:\\work\\app':[['src',true],['empty',true],['.gitignore'],['.gitattributes'],['package.json'],['Zebra.cmd'],['Alpha.md'],['beta.CMD'],['LICENSE'],['name..'],['..\\unsafe']],
          'D:\\work\\app\\src':[['index.ts'],['index.js'],['Zulu.JS']],
          'D:\\work\\app\\empty':[],
          'D:\\work\\other':[['other.md']],
          [worktree]:[['worktree.md']],
          'd:\\WORK\\app\\sub':[['child-root.md']],
          'D:\\work\\unregistered':[['fallback.md']],
          'd:\\WORK\\unregistered':[['fallback.md']]
        }};
      const emit=(data,origin=location.origin)=>window.dispatchEvent(new MessageEvent('message',{source:window,origin,data}));
      app.notify=(watchId,hostId='local',origin=location.origin)=>emit({
        type:'mcp-notification',hostId,method:'fs/changed',params:{watchId,changedPaths:['ignored']}
      },origin);
      app.change=id=>document.querySelector('#thread').setAttribute('data-above-composer-conversation-id',id);
      app.showComposer=({id,root,projectId,placement='thread',mode='local'})=>{
        const thread=document.querySelector('#thread'),parent=thread.parentElement;
        const composer=document.createElement('div');
        composer.dataset.codexComposerRoot='';composer.dataset.composerPlacement=placement;
        if(id)app.change(id);else thread.removeAttribute('data-above-composer-conversation-id');
        if(parent.hasAttribute('data-codex-composer-root'))parent.replaceWith(composer);
        else thread.before(composer);
        composer.append(thread);
        const top={stateNode:{}};top.stateNode.current=top;
        const owner={return:top,memoizedProps:{selectedProject:{type:'local',projectId}}};
        composer.__reactFiber$fixture={return:owner,child:{memoizedProps:{conversationId:id,hostId:'local',roots:[root],composerMode:mode},
          sibling:{memoizedProps:{currentLocalExecutionCwd:root,currentLocalExecutionHostId:'local',composerMode:mode}}}};
      };
      app.hideComposer=id=>{
        const thread=document.querySelector('#thread'),composer=thread.parentElement;
        if(composer.hasAttribute('data-codex-composer-root'))composer.replaceWith(thread);
        app.change(id);
      };
      document.querySelector('#sidebar').addEventListener('contextmenu',event=>{
        event.preventDefault();
        const background=document.querySelector('[data-app-shell-active-page="true"]');
        background.setAttribute('aria-hidden','true');background.setAttribute('data-aria-hidden','true');
        const menu=document.createElement('div');menu.setAttribute('role','menu');menu.setAttribute('aria-label','Sidebar menu');
        const item=document.createElement('button');item.setAttribute('role','menuitem');item.textContent='Rename';
        menu.append(item);
        document.body.append(menu);item.focus();
        menu.addEventListener('keydown',event=>{
          if(event.key!=='Escape')return;
          menu.remove();
          background.removeAttribute('aria-hidden');background.removeAttribute('data-aria-hidden');
        });
      });
      window.__betterCodexWorkspaceAction=id=>{
        const tree=window.__codexWorkspaceTree,request=tree.pullAction(id);
        if(!request||tree.pullAction(id)!==null)throw Error('Invalid action');
        app.actions.push({id,...request});
        if(!app.holdActions)tree.actionResult(id,tree.confirmAction(id)?
          request.nativeFolder?'openNativeFolder':app.actionResult??null:null);
      };
      customElements.define('file-tree-container',class extends HTMLElement{});
      app.nativeTag=customElements.get('file-tree-container');
      document.querySelector('#native').addEventListener('click',()=>{
        app.nativeCalls++;
        const tab=document.createElement('div');tab.dataset.tabId='file:local:';tab.setAttribute('role','tabpanel');
        document.querySelector('#dock').append(tab);
      });
      window.addEventListener('message',e=>{if(e.data?.type==='toggle-file-tree-panel')app.nativeCalls++;});
      window.electronBridge={sendMessageFromView({type,hostId,request:{id,method,params}}){
        if(type!=='mcp-request'||hostId!=='local')throw Error('Wrong transport');
        app.requests.push({method,params});
        const wait=method==='thread/read'?app.delay:method==='fs/watch'?app.watchDelay||0:0;
        setTimeout(()=>{
          const path=params.path;
          let result,error;
          if(method==='thread/read')result={thread:{id:params.threadId,cwd:app.roots[params.threadId],projectId:app.projectIds[params.threadId]}};
          else if(method==='project/list')result={data:app.projects,nextCursor:null};
          else if(method==='project/read')result={project:app.projects.find(p=>p.id===params.projectId)};
          else if(method==='fs/getMetadata')result={isDirectory:!!app.files[path],isFile:false,isSymlink:path===app.link};
          else if(method==='fs/watch'){app.watches.set(params.watchId,path);result={};}
          else if(method==='fs/unwatch'){app.watches.delete(params.watchId);result={};}
          else if(method==='fs/readDirectory'){
            if(!app.files[path])error={message:'Not a directory'};
            else result={entries:app.files[path].map(([fileName,isDirectory=false])=>({fileName,isDirectory,isFile:!isDirectory}))};
          }else throw Error('Unexpected RPC');
          emit({type:'mcp-response',hostId:'local',message:{id,result,error}});
        },wait);
      }};
    },{a,b,c,d,e,f,g,h,j,p,q});
    await page.addScriptTag({content:pageSource('zh-CN')});
    await page.addScriptTag({content:workspaceTreeSource({home:'C:\\Users\\FixtureUser',codexHome:'C:\\Users\\FixtureUser\\.codex'})});
    const pane=page.locator('[data-bc-workspace-files]'),trigger=page.locator('[data-bc-workspace-tree-trigger] button[aria-controls]');
    const projectName=page.locator('[data-bc-workspace-project-name]');
    const splitter=pane.getByRole('separator',{name:'调整文件树宽度'});
    const widthKey='better-codex:workspace-tree-width';
    const width=async()=>Math.round((await pane.boundingBox()).width);
    const row=name=>pane.getByRole('treeitem',{name,exact:true});
    const ready=()=>pane.getByRole('searchbox').isEnabled();
    async function waitRow(name){await row(name).waitFor();}
    const evalPage=fn=>page.evaluate(fn);
    const waits=condition=>page.waitForFunction(condition);
    const setEnabled=value=>page.evaluate(value=>window.__codexWorkspaceTree.setEnabled(value),value);
    const click=()=>trigger.click();
    const noPane=()=>pane.waitFor({state:'detached'});
    const change=id=>page.evaluate(id=>fixture.change(id),id);
    const roots=()=>evalPage(()=>window.fixture.requests.filter(r=>r.method==='fs/readDirectory').map(r=>r.params.path));
    await setEnabled(true);
    await trigger.waitFor();
    check('a closed tree resolves identity without any filesystem access',await pane.count()===0&&
      await evalPage(()=>fixture.requests.every(r=>!r.method.startsWith('fs/'))));
    await projectName.getByText('Registered project',{exact:true}).waitFor();
    check('the registered project name appears beside the button even when closed',await pane.count()===0&&
      await evalPage(()=>document.querySelector('[data-bc-workspace-tree-trigger]').shadowRoot
        .querySelector('button').nextElementSibling.hasAttribute('data-bc-workspace-project-name')));
    await evalPage(()=>{fixture.actionResult='folderBackground';});
    await projectName.click();
    check('the project name opens the actual folder without opening the dock',await pane.count()===0&&
      await evalPage(()=>fixture.actions.at(-1)?.kind==='folder'&&fixture.actions.at(-1)?.root==='D:\\work\\app'));
    check('a background Explorer window is reported even when the tree is closed',await page
      .locator('[data-bc-workspace-tree-trigger]').getByText('目录已打开，可从任务栏切换到资源管理器。').isVisible());
    await evalPage(()=>{fixture.actionResult=null;});
    await click();await waitRow('package.json');
    check('button and dock sit to the left without moving native controls',await ready()&&await evalPage(()=>{
      const own=document.querySelector('[data-bc-workspace-files]');
      const content=own.nextElementSibling;
      const toolbar=document.querySelector('[data-app-shell-header-toolbar]');
      return own.parentElement.id==='dock'&&content.hasAttribute('data-app-shell-main-content-layout')&&
        own.clientHeight>400&&content.clientWidth>500&&own.clientWidth>=260&&
        own.getBoundingClientRect().right<=content.getBoundingClientRect().left&&
        toolbar.firstElementChild.hasAttribute('data-bc-workspace-tree-trigger')&&toolbar.lastElementChild.id==='actions';
    }));
    check('keeps official file page and tag untouched',await evalPage(()=>fixture.nativeCalls===0&&
      !document.querySelector('[data-tab-id],file-tree-container')&&customElements.get('file-tree-container')===fixture.nativeTag));
    check('only current thread and root are fetched',JSON.stringify(await roots())===JSON.stringify(['D:\\work\\app'])&&
      await evalPage(()=>fixture.requests[0].method==='thread/read'&&fixture.requests[0].params.includeTurns===false));
    check('workspace folders and files are first-level rows without a synthetic root',
      await row('所有文件').count()===0&&await row('src').getAttribute('aria-level')==='1'&&
      await row('package.json').getAttribute('aria-level')==='1'&&await row('src').getAttribute('aria-expanded')==='false');
    const order=level=>pane.locator('[role="treeitem"][aria-level="'+level+'"]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label')));
    const ordered=(actual,expected)=>expected.every((name,i)=>actual.indexOf(name)>=0&&(i===0||actual.indexOf(name)>actual.indexOf(expected[i-1])));
    check('folders first, then type groups, then alphabetical without regard to case',ordered(await order(1),
      ['empty','src','beta.CMD','Zebra.cmd','.gitattributes','.gitignore','package.json','Alpha.md','LICENSE']));
    check('splitter starts at the established default width',await width()===300&&await splitter.getAttribute('aria-valuenow')==='300');
    const edge=await splitter.boundingBox();
    const x=edge.x+edge.width/2,y=edge.y+edge.height/2;
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+116,y,{steps:4});
    check('dragging the edge previews the width without saving or reloading files',await width()===416&&
      await page.evaluate(key=>localStorage.getItem(key),widthKey)===null&&(await roots()).length===1);
    await page.mouse.up();
    check('releasing the splitter saves the whole pane width',await page.evaluate(key=>localStorage.getItem(key),widthKey)==='416');
    await splitter.press('ArrowLeft');
    check('the focused splitter adjusts width with the keyboard',await width()===400&&await splitter.getAttribute('aria-valuenow')==='400');
    const cancelEdge=await splitter.boundingBox();
    const cx=cancelEdge.x+cancelEdge.width/2;
    await page.mouse.move(cx,y);await page.mouse.down();await page.mouse.move(cx+42,y,{steps:2});
    await page.keyboard.press('Escape');await page.mouse.up();
    check('Escape cancels an in-progress drag without closing the pane',await width()===400&&
      await page.evaluate(key=>localStorage.getItem(key),widthKey)==='400');
    await page.setViewportSize({width:460,height:640});
    await waits(()=>document.querySelector('[data-bc-workspace-files]').getBoundingClientRect().width<180);
    check('narrow windows retain chat space without overwriting the saved width',
      await evalPage(()=>document.querySelector('[data-app-shell-main-content-layout]').clientWidth>=300)&&
      await page.evaluate(key=>localStorage.getItem(key),widthKey)==='400');
    await page.setViewportSize({width:1060,height:640});
    await waits(()=>document.querySelector('[data-bc-workspace-files]').getBoundingClientRect().width===400);
    check('enlarging the window restores the preferred width',await width()===400);
    const sideGeometry=()=>evalPage(()=>{
      const content=document.querySelector('[data-app-shell-main-content-layout]');
      const tree=content.previousElementSibling;
      const right=document.querySelector('[data-app-shell-focus-area="right-panel"]');
      const rect=node=>node?.getBoundingClientRect();
      return {left:rect(content).left,right:rect(content).right,treeRight:rect(tree)?.right,
        frameLeft:rect(content.firstElementChild).left,frameRight:rect(content.firstElementChild).right,
        panelLeft:rect(right)?.left,panelWidth:rect(right)?.width};
    });
    await evalPage(()=>{
      const dock=document.querySelector('#dock');
      dock.style.position='relative';
      fixture.splitTree=document.querySelector('[data-bc-workspace-files]');
      fixture.splitRequests=fixture.requests.length;
      const width=dock.clientWidth;
      // The side panel owns its width; the native end-aligned frame uses the
      // same calculation as without a tree, so its width is too large.
      const rail=document.createElement('div');rail.id='right-spacer';rail.style.flex='0 0 440px';
      const right=document.createElement('aside');
      right.dataset.appShellFocusArea='right-panel';right.style.cssText='position:absolute;right:0;width:440px;height:100%';
      dock.append(rail,right);dock.style.setProperty('--native-frame-width',(width-440)+'px');
    });
    const side=await sideGeometry();
    check('three columns keep the left edge of the main transcript clear of the tree',
      side.treeRight===side.left&&side.frameLeft===side.left&&side.frameRight===side.right&&side.panelLeft===side.right&&side.panelWidth===440);
    await evalPage(()=>{
      const dock=document.querySelector('#dock');
      dock.querySelector('#right-spacer').remove();
      dock.querySelector('[data-app-shell-focus-area="right-panel"]').remove();
      dock.style.removeProperty('--native-frame-width');
    });
    const normal=await sideGeometry();
    check('closing the native panel restores available chat space without rebuilding the tree',
      normal.frameLeft===normal.left&&normal.frameRight===normal.right&&normal.right>side.right&&await width()===400&&
      await evalPage(()=>fixture.splitTree===document.querySelector('[data-bc-workspace-files]')&&
        fixture.requests.length===fixture.splitRequests));
    check('does not turn malformed path components into rows',await row('name..').count()===0&&await row('..\\unsafe').count()===0);
    check('uses Pierre colored file type icons',await evalPage(()=>{
      const shadow=document.querySelector('[data-bc-workspace-files]').shadowRoot.querySelector('bc-workspace-file-tree').shadowRoot;
      const icons=['.gitignore','package.json'].map(name=>shadow.querySelector('[aria-label="'+name+'"] use')?.getAttribute('href'));
      return !!shadow.querySelector('[data-file-tree-colored-icons="true"]')&&icons.every(Boolean)&&icons[0]!==icons[1];
    }));
    await row('src').locator('[data-item-section="icon"]').click();
    await waitRow('index.ts');
    check('expanding reads only the chosen directory and shows its children on level two',
      JSON.stringify(await roots())===JSON.stringify(['D:\\work\\app','D:\\work\\app\\src'])&&
      await row('index.ts').getAttribute('aria-level')==='2');
    check('type grouping is repeated inside folders',ordered(await order(2),['index.js','Zulu.JS','index.ts']));
    await row('index.ts').click();
    check('selecting a file does not open a page',await page.locator('[role="tabpanel"]').count()===0&&
      await row('index.ts').getAttribute('aria-selected')==='true'&&await evalPage(()=>fixture.actions.length===1));
    await evalPage(()=>{fixture.actionResult='previewUnavailable';});
    await page.keyboard.press('Space');
    await pane.getByText('未安装或配置 Preview。').waitFor();
    check('Space previews the focused file, not a page',await evalPage(()=>fixture.actions.at(-1)?.kind==='preview'&&
      fixture.actions.at(-1)?.relative==='src/index.ts'));
    await evalPage(()=>{fixture.actionResult=null;});
    await row('index.ts').dblclick();
    check('double-click opens without also previewing',await evalPage(()=>fixture.actions.length===3&&fixture.actions.at(-1)?.kind==='open'));
    await row('index.ts').click({button:'right'});
    await pane.getByRole('menuitem',{name:'在资源管理器中定位'}).click();
    check('right-click menu locates the selected file',await evalPage(()=>fixture.actions.at(-1)?.kind==='locate'&&
      fixture.actions.at(-1)?.relative==='src/index.ts'));
    const search=pane.getByRole('searchbox');
    await search.press('Space');
    check('Space in the filter is not intercepted',await search.inputValue()===' '&&await evalPage(()=>fixture.actions.length===4));
    await search.fill('index.ts');
    await row('index.js').waitFor({state:'detached'});
    check('filters loaded files without another read',await row('index.ts').count()===1&&(await roots()).length===2);
    await evalPage(()=>{
      fixture.menuPane=document.querySelector('[data-bc-workspace-files]');
      fixture.menuTree=fixture.menuPane.shadowRoot.querySelector('bc-workspace-file-tree');
      fixture.menuRequests=fixture.requests.length;
    });
    await page.locator('#sidebar').click({button:'right'});
    const sidebarMenu=page.getByRole('menu',{name:'Sidebar menu'});
    await sidebarMenu.waitFor();
    const afterReconcile=()=>evalPage(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    await afterReconcile();
    check('a native sidebar menu keeps the mounted tree visible and directory watches intact',await evalPage(()=>{
      const dock=document.querySelector('[data-bc-workspace-files]');
      return dock===fixture.menuPane&&dock.checkVisibility()&&dock.closest('[data-aria-hidden]')&&
        dock.shadowRoot.querySelector('bc-workspace-file-tree')===fixture.menuTree&&
        fixture.requests.length===fixture.menuRequests&&fixture.watches.size===2;
    }));
    await page.keyboard.press('Escape');await afterReconcile();
    check('dismissing the sidebar menu does not reset the filter or reopen the tree',await search.inputValue()==='index.ts'&&
      await row('index.ts').getAttribute('aria-selected')==='true'&&await evalPage(()=>fixture.requests.length===fixture.menuRequests));
    await evalPage(()=>{
      fixture.fastWatches=[...fixture.watches.keys()].join();
      fixture.delay=900;
    });
    const switchComposer=(id,placement)=>page.evaluate(({id,placement,p})=>
      fixture.showComposer({id,root:'D:\\work\\app',projectId:p,placement}),{id,placement,p});
    const keptTree=()=>evalPage(()=>{
      const dock=document.querySelector('[data-bc-workspace-files]');
      const input=dock?.shadowRoot.querySelector('input');
      return dock===fixture.menuPane&&dock.shadowRoot.querySelector('bc-workspace-file-tree')===fixture.menuTree&&
        !input.disabled&&input.value==='index.ts'&&fixture.fastWatches===[...fixture.watches.keys()].join();
    });
    await switchComposer(g,'thread');await afterReconcile();
    check('same root and project switch before delayed App Server lookups without remount or requests',
      await keptTree()&&await evalPage(()=>fixture.requests.length===fixture.menuRequests));
    await evalPage(()=>document.querySelector('#thread').removeAttribute('data-above-composer-conversation-id'));
    await afterReconcile();
    check('a temporary gap between native composers masks the old tree instead of destroying it',
      !await pane.isVisible()&&await evalPage(()=>fixture.menuPane.isConnected&&
        fixture.fastWatches===[...fixture.watches.keys()].join()));
    await switchComposer(null,'home');await afterReconcile();
    check('an unsent local project chat keeps the same tree, filter, selection and watches',
      await keptTree()&&await row('index.ts').getAttribute('aria-selected')==='true'&&
        await evalPage(()=>fixture.requests.length===fixture.menuRequests));
    await switchComposer(g,'thread');await afterReconcile();
    check('when a draft becomes a saved chat it still does not read the filesystem again',
      await keptTree()&&await evalPage(()=>fixture.requests.length===fixture.menuRequests));
    await evalPage(()=>{fixture.delay=210;});
    await page.evaluate(id=>fixture.hideComposer(id),h);
    await pane.getByText('正在加载…').waitFor();
    check('without a native match, old files are hidden during identity lookup',
      !await row('index.ts').isVisible()&&await evalPage(()=>fixture.fastWatches===[...fixture.watches.keys()].join()));
    await waitRow('index.ts');
    check('a same-root App Server result adopts the existing tree without rereading directories',await keptTree()&&
      await evalPage(()=>fixture.requests.slice(fixture.menuRequests).map(r=>r.method).join()==='thread/read'));
    await evalPage(()=>{fixture.delay=0;});
    await search.fill('asdjkl-nonexistent');
    await pane.getByText('没有匹配的文件').waitFor();
    await search.fill('');
    await waitRow('index.js');
    check('clearing filter restores the expanded branch');
    await evalPage(()=>{
      const root=[...fixture.watches].find(([,p])=>p.endsWith('\\app'))[0];
      fixture.files['D:\\work\\app'].push(['README.md']);
      fixture.notify(root,'remote');fixture.notify(root,'local','https://other.invalid');
    });
    await page.waitForTimeout(135);
    check('ignores wrong origin and host notifications',await row('README.md').count()===0&&(await roots()).length===2);
    await evalPage(()=>{
      for(const [id,path] of fixture.watches){
        if(path.endsWith('\\src'))fixture.files[path]=[['index.ts'],['new.css']];
        fixture.notify(id);
      }
    });
    await waitRow('README.md');await waitRow('new.css');
    check('watch updates root and expanded child without collapsing',await row('index.js').count()===0&&
      (await row('src').getAttribute('aria-expanded'))==='true');
    check('live file additions keep their type group order',ordered(await order(1),['Alpha.md','README.md','LICENSE'])&&
      ordered(await order(2),['new.css','index.ts']));
    await row('src').locator('[data-item-section="icon"]').click();
    await waits(()=>fixture.watches.size===1);
    check('collapsing releases child watch');
    await search.fill('new.css');
    await pane.getByText('没有匹配的文件').waitFor();
    check('collapsing also evicts descendant entries from the searchable model',await row('new.css').count()===0);
    await search.fill('');
    const reopenedReads=(await roots()).length;
    await row('src').locator('[data-item-section="icon"]').click();
    await waitRow('new.css');
    check('reopening an evicted directory rereads only that directory',JSON.stringify((await roots()).slice(reopenedReads))===
      JSON.stringify(['D:\\work\\app\\src']));
    await row('src').locator('[data-item-section="icon"]').click();await waits(()=>fixture.watches.size===1);
    await row('package.json').click();
    await page.keyboard.press('Escape');await afterReconcile();
    check('Escape after clicking a file keeps the tree visible',await pane.isVisible());
    await search.press('Escape');await afterReconcile();
    check('Escape in the filter keeps the tree and its directory watch',await pane.isVisible()&&
      await evalPage(()=>fixture.watches.size===1));
    await click();await noPane();
    await waits(()=>fixture.watches.size===0);
    check('closing with the tree button releases all watches');
    await evalPage(()=>{fixture.watchDelay=250;});
    await click();await waitRow('package.json');
    await click();await noPane();
    await page.waitForTimeout(375);
    check('late watch acknowledgement is released after close',await evalPage(()=>fixture.watches.size===0));
    await evalPage(()=>{fixture.watchDelay=0;});
    await click();await waitRow('package.json');
    await evalPage(()=>{fixture.holdActions=true;});
    await row('package.json').click();
    await page.keyboard.press('Space');
    check('current scope can confirm a pending launch',await evalPage(()=>window.__codexWorkspaceTree.confirmAction(fixture.actions.at(-1).id)));
    await row('Alpha.md').click();
    check('moving the focused file cancels launch authorization for a still-listed selection',await evalPage(()=>
      !window.__codexWorkspaceTree.confirmAction(fixture.actions.at(-1).id)));
    await row('package.json').click();
    await page.keyboard.press('Space');
    await evalPage(()=>window.__codexWorkspaceTree.actionResult(fixture.actions.at(-1).id,'nativePreviewReady'));
    check('A rendered preview can reopen the original after ordinary gesture authorization ends',await evalPage(()=>{
      const tree=window.__codexWorkspaceTree,id=fixture.actions.at(-1).id;
      return !tree.confirmAction(id)&&tree.confirmPreview(id);
    }));
    const blocked=await evalPage(()=>fixture.actions.at(-1).id);
    await page.keyboard.press('Space');
    check('Declining a replacement keeps the old preview authorization, not the declined selection',await page.evaluate(previous=>{
      const tree=window.__codexWorkspaceTree,current=fixture.actions.at(-1).id;
      tree.actionResult(current,'nativePreviewBlocked');
      return current!==previous&&tree.confirmPreview(previous)&&!tree.confirmPreview(current);
    },blocked));
    await page.keyboard.press('Space');
    await page.locator('#sidebar').click({button:'right'});
    await afterReconcile();
    check('preserving the dock during a sidebar menu does not authorize pending shell actions',await evalPage(()=>
      !window.__codexWorkspaceTree.confirmAction(fixture.actions.at(-1).id)));
    await page.keyboard.press('Escape');await afterReconcile();
    await evalPage(()=>{fixture.pane=document.querySelector('[data-bc-workspace-files]');fixture.delay=160;});
    await change(c);await pane.getByText('正在加载…').waitFor();await waitRow('worktree.md');
    check('a previous chat can no longer confirm its pending action',await evalPage(()=>
      !window.__codexWorkspaceTree.confirmAction(fixture.actions.at(-1).id)&&
      !window.__codexWorkspaceTree.confirmPreview(fixture.actions.at(-1).id)));
    await evalPage(()=>{fixture.holdActions=false;});
    check('same registered project retains the open dock across sessions and switches to the current worktree',await evalPage(()=>
      fixture.pane===document.querySelector('[data-bc-workspace-files]'))&&await row('package.json').count()===0);
    await projectName.getByText('Registered project',{exact:true}).waitFor();
    check('a worktree uses its registered project name rather than its folder name');
    const worktreeReads=(await roots()).length;
    await page.evaluate(({j,p})=>{
      const project=document.createElement('div');
      project.dataset.appActionSidebarProjectId=p;
      project.dataset.appActionSidebarProjectLabel='Registered project';
      document.body.append(project);
      // The local UI groups this chat under p; thread/read supplies no
      // project ID and its actual path matches q's registered roots.
      fixture.splitProjectAt=fixture.requests.length;
      fixture.showComposer({id:j,projectId:p,root:fixture.roots.a,mode:'worktree'});
    },{j,p});
    await waits(()=>fixture.requests.slice(fixture.splitProjectAt).some(r=>r.method==='thread/read'));
    await projectName.getByText('Registered project',{exact:true}).waitFor();
    await waitRow('worktree.md');
    assert.deepEqual(await page.evaluate(j=>({
      methods:fixture.requests.slice(fixture.splitProjectAt).map(r=>r.method),
      exactRoot:[...fixture.watches.values()].join()===fixture.roots[j]
    }),j),{methods:['thread/read'],exactRoot:true});
    check('native project grouping wins over directory ancestry without replacing the actual worktree or rereading files',
      await projectName.getByText('Registered project',{exact:true}).isVisible()&&(await roots()).length===worktreeReads);
    check('the worktree opens using the assigned project toggle, not the project registered for its directory',
      await row('package.json').count()===0&&await page.evaluate(({p,q})=>{
        const prefix='better-codex:workspace-tree-open:project:';
        return localStorage.getItem(prefix+p)==='1'&&!localStorage.getItem(prefix+q);
      },{p,q}));
    await page.route('**/assets/fixture-runtime.js',route=>route.fulfill({contentType:'application/javascript',body:`
      export const __webpack_require__=()=>{throw Error('Never instantiate a module')};
      __webpack_require__.c={'arbitrary-build-id':{exports:{setAppServices(){},setAppHost(){},appServices:{
        openIn:{open(input){fixture.nativeOpens.push(input);return Promise.resolve({success:!fixture.failNative});}}
      }}}};
    `}));
    await page.addScriptTag({url:'https://workspace-tree.invalid/assets/fixture-runtime.js',type:'module'});
    await projectName.click();
    await waits(()=>fixture.nativeOpens.length===1);
    check('clicking a worktree title uses its actual root via the initialized Codex File Explorer service',
      await evalPage(()=>fixture.actions.at(-1).nativeFolder&&
        JSON.stringify(fixture.nativeOpens[0])===JSON.stringify({cwd:null,hostId:'local',path:'C:\\Users\\FixtureUser\\.codex\\worktrees\\one\\app',target:'fileManager'})));
    await evalPage(()=>{fixture.failNative=true;fixture.actionCount=fixture.actions.length;});
    await projectName.click();
    await pane.getByText('无法打开此项。').waitFor();
    check('a native failure does not launch a second fallback window',
      await evalPage(()=>fixture.nativeOpens.length===2&&fixture.actions.length===fixture.actionCount+1));
    await evalPage(()=>{fixture.holdActions=true;});
    await projectName.click();
    await waits(()=>fixture.actions.length===fixture.actionCount+2);
    await page.evaluate(id=>fixture.hideComposer(id),d);await waitRow('child-root.md');
    await evalPage(()=>{
      window.__codexWorkspaceTree.actionResult(fixture.actions.at(-1).id,'openNativeFolder');
      fixture.holdActions=false;
    });
    check('a late native handoff cannot open the previous chat folder',await evalPage(()=>fixture.nativeOpens.length===2));
    check('an unassigned session below the registered root shares the same open state',await row('worktree.md').count()===0);
    await change(b);await noPane();
    check('a different project starts closed and releases the old directory watch',await waits(()=>fixture.watches.size===0));
    await click();await waitRow('other.md');
    check('different projects share the panel width',await width()===400);
    await change(a);await waitRow('package.json');
    await click();await noPane();
    await change(c);await page.waitForTimeout(240);
    check('closing in one project session closes other sessions of that project',await pane.count()===0);
    await change(b);await waitRow('other.md');
    check('the other project keeps its own remembered open state');
    await setEnabled(false);await noPane();await waits(()=>fixture.watches.size===0);
    check('settings off removes only our button/dock',await trigger.count()===0&&await page.locator('#native').isVisible());
    await evalPage(()=>{window.__codexWorkspaceTree.remove();});
    await page.addScriptTag({content:workspaceTreeSource({home:'C:\\Users\\FixtureUser',codexHome:'C:\\Users\\FixtureUser\\.codex'})});
    await setEnabled(true);await waitRow('other.md');
    check('a new tree module restores the local project state');
    check('a new tree module restores the saved panel width',await width()===400);
    const peer=await context.newPage();
    await peer.route(url,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Peer</title>'}));
    await peer.goto(url);
    await peer.evaluate(id=>localStorage.removeItem('better-codex:workspace-tree-open:project:'+id),q);
    await noPane();
    await peer.evaluate(id=>localStorage.setItem('better-codex:workspace-tree-open:project:'+id,'1'),q);
    await waitRow('other.md');
    await peer.evaluate(key=>localStorage.setItem(key,'352'),widthKey);
    await waits(()=>document.querySelector('[data-bc-workspace-files]').getBoundingClientRect().width===352);
    await peer.close();
    check('project open state and width synchronize between windows');
    await splitter.dblclick();
    check('double-clicking the splitter restores the default width',await width()===300&&
      await page.evaluate(key=>localStorage.getItem(key),widthKey)==='300');
    await click();await noPane();
    await evalPage(()=>{fixture.watchDelay=0;fixture.delay=175;});
    await change(a);
    await click();
    await change(b);
    await noPane();
    const reads=await roots();
    await page.waitForTimeout(225);
    check('a late chat lookup cannot read old scope',(await roots()).length===reads.length);
    await click();await waitRow('other.md');
    check('new chat opens its own workspace',await row('package.json').count()===0);
    await click();await noPane();
    await evalPage(()=>fixture.link='D:\\work\\other');
    await click();await pane.getByText('当前无法读取工作区文件').waitFor();
    check('directory symlink is not listed or watched',(await roots()).at(-1)==='D:\\work\\other'&&
      (await roots()).length===reads.length+1&&await evalPage(()=>fixture.watches.size===0));
    await click();await noPane();
    const metadata=await evalPage(()=>fixture.requests.filter(r=>r.method==='fs/getMetadata').length);
    for(const blocked of ['C:\\','C:\\Users\\FixtureUser','C:\\Users\\FixtureUser\\.codex\\sessions','D:\\work\\..\\private','\\\\remote\\share']){
      await setEnabled(false);
      await page.evaluate(({b,blocked})=>fixture.roots[b]=blocked,{b,blocked});
      await setEnabled(true);
      await click();await pane.getByText('当前无法读取工作区文件').waitFor();await click();
    }
    check('unsafe roots are rejected before filesystem RPC',await evalPage(()=>fixture.requests.filter(r=>r.method==='fs/getMetadata').length)===metadata);
    await change(e);await click();await waitRow('fallback.md');
    await projectName.getByText('unregistered',{exact:true}).waitFor();
    check('an unregistered project uses the workspace folder name');
    const fallbackReads=(await roots()).length;
    await change(f);
    await waitRow('fallback.md');
    check('unregistered sessions at the same normalized workspace share the loaded tree', (await roots()).length===fallbackReads&&
      await evalPage(()=>[...fixture.watches.values()].join()==='D:\\work\\unregistered'));
    await click();await noPane();
    await change(b);
    await page.evaluate(b=>{
      const remote=document.createElement('div');
      remote.dataset.appActionSidebarThreadId=b;
      remote.dataset.appActionSidebarThreadHostId='remote';
      document.body.append(remote);
    },b);
    await trigger.waitFor({state:'detached'});
    check('remote chat does not get a local tree button');
    await evalPage(()=>window.__codexWorkspaceTree.remove());
    check('no native action, browser errors or residual pane',!exceptions.length&&await pane.count()===0&&await evalPage(()=>fixture.nativeCalls===0));
    console.log('workspace-tree: '+passed+' passed');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
