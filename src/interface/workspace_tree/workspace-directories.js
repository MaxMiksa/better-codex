// Windows path components must stay literal when passed to the App Server.
const bcWorkspaceWindowsName=name=>typeof name==='string'&&name.length>0&&name.length<=255&&
  !/[\x00-\x1f\\/:<>"|?*]|[. ]$/.test(name)&&
  !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name);

const bcWorkspaceTransport = onChanged => {
  const pending=new Map();
  let closed=false;
  function send(method,params,timeout=3500){
    return new Promise((resolve,reject)=>{
      const id='better-codex-tree:'+crypto.randomUUID();
      const finish=(error,value)=>{
        if(!pending.delete(id))return;
        clearTimeout(timer);
        if(closed&&pending.size===0)window.removeEventListener('message',receive);
        if(error)reject(error);else resolve(value);
      };
      const timer=setTimeout(()=>finish('timeout'),timeout);
      pending.set(id,finish);
      window.addEventListener('message',receive);
      try{
        Promise.resolve(window.electronBridge.sendMessageFromView({type:'mcp-request',hostId:'local',
          request:{id,method,params},timeoutMs:timeout})).catch(()=>finish('transport'));
      }catch{finish('transport');}
    });
  }
  function receive(event){
    if(event.source!==window||event.origin!==location.origin)return;
    const d=event.data;
    if(d?.hostId!=='local')return;
    if(d.type==='mcp-response'){
      const result=d.message;
      pending.get(result?.id)?.(result?.error?'rejected':null,result?.result);
    }else if(!closed&&d.type==='mcp-notification'&&d.method==='fs/changed'){
      onChanged?.(d.params?.watchId);
    }
  }
  return {send,close(){
    closed=true;
    if(!pending.size)window.removeEventListener('message',receive);
  }};
};

// Read-only, per-panel App Server session. Request just the root and expanded
// directories. Project identity never changes which filesystem root is read.
const bcCreateWorkspaceDirectories = ({root,isCurrent,onUpdate,onError}) => {
  const dirs=new Map(),watches=new Map();
  const maxDirs=160,maxPerDir=10000,maxPaths=50000;
  let closed=false;
  const active=()=>!closed&&isCurrent();
  const child=(parent,name)=>parent?parent+'/'+name:name;
  const transport=bcWorkspaceTransport(watchId=>{
    const dir=watches.get(watchId);
    if(dir&&stillOpen(dir)){dir.dirty=true;queueRead(dir);}
  });
  const {send}=transport;
  const stillOpen=dir=>active()&&dir.open&&dirs.get(dir.key)===dir;
  const absolute=key=>key?root+'\\'+key.replaceAll('/','\\'):root;
  function disposeWatch(dir){
    const watchId=dir.watchId;
    if(!watchId)return;
    dir.watchId=null;watches.delete(watchId);
    void send('fs/unwatch',{watchId},1400).catch(()=>{});
  }
  function closeDir(dir){
    dir.open=false;clearTimeout(dir.timer);dir.timer=0;disposeWatch(dir);
  }
  function attachWatch(dir,path){
    if(dir.watchId)return;
    const watchId='better-codex-tree:'+crypto.randomUUID();
    dir.watchId=watchId;watches.set(watchId,dir);
    void send('fs/watch',{watchId,path}).then(()=>{
      if(!stillOpen(dir)||dir.watchId!==watchId){
        // A close can race registration; release the late acknowledgement too.
        void send('fs/unwatch',{watchId},1400).catch(()=>{});
      }
    },()=>{if(dir.watchId===watchId)disposeWatch(dir);});
  }
  function setEntries(dir,entries){
    dir.entries=entries;
    const direct=new Set(entries.filter(e=>e.folder).map(e=>child(dir.key,e.name)));
    for(const [key,record] of dirs){
      if(!key||key===dir.key)continue;
      const prefix=dir.key?dir.key+'/':'';
      if(!key.startsWith(prefix))continue;
      const first=prefix+key.slice(prefix.length).split('/')[0];
      if(!direct.has(first)){closeDir(record);dirs.delete(key);}
    }
  }
  function publish(){
    if(!active())return;
    const paths=[];
    for(const dir of dirs.values())for(const entry of dir.entries){
      if(paths.length>=maxPaths){onUpdate(paths);return;}
      paths.push(child(dir.key,entry.name)+(entry.folder?'/':''));
    }
    onUpdate(paths);
  }
  function queueRead(dir){
    if(dir.busy||dir.timer||!stillOpen(dir))return;
    dir.timer=setTimeout(()=>{dir.timer=0;void read(dir);},100);
  }
  async function read(dir){
    if(!stillOpen(dir)||dir.busy)return;
    dir.busy=true;dir.dirty=false;
    const path=absolute(dir.key);
    try{
      const meta=await send('fs/getMetadata',{path});
      if(!stillOpen(dir))return;
      if(meta?.isDirectory!==true||meta.isSymlink!==false)throw 'not-directory';
      attachWatch(dir,path);
      const result=await send('fs/readDirectory',{path});
      if(!stillOpen(dir))return;
      if(!Array.isArray(result?.entries))throw 'unavailable';
      const entries=new Map();
      for(const row of result.entries.slice(0,maxPerDir)){
        if(bcWorkspaceWindowsName(row?.fileName))entries.set(row.fileName,{name:row.fileName,folder:row.isDirectory===true});
      }
      const next=[...entries.values()].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
      if(!dir.loaded||next.length!==dir.entries.length||next.some((e,i)=>
        e.name!==dir.entries[i].name||e.folder!==dir.entries[i].folder)){
        setEntries(dir,next);dir.loaded=true;publish();
      }
    }catch{
      if(stillOpen(dir)){
        disposeWatch(dir);setEntries(dir,[]);dir.loaded=false;
        if(dir.key)publish();else onError();
      }
    }finally{
      dir.busy=false;
      if(dir.dirty)queueRead(dir);
    }
  }
  function openDir(key){
    let dir=dirs.get(key);
    if(!dir){
      if(dirs.size>=maxDirs)return null;
      dir={key,entries:[],open:false,loaded:false,busy:false,dirty:false,timer:0,watchId:null};
      dirs.set(key,dir);
    }
    if(!dir.open){dir.open=true;dir.dirty=true;if(!dir.busy)void read(dir);}
    return dir;
  }
  function start(){if(active())openDir('');}
  function expand(keys){
    if(!active())return;
    const wanted=new Set(['']);
    for(const key of keys){
      if(!key||wanted.size>=maxDirs)continue;
      const slash=key.lastIndexOf('/'),parent=slash<0?'':key.slice(0,slash),name=key.slice(slash+1);
      const source=dirs.get(parent);
      if(wanted.has(parent)&&source?.entries.some(e=>e.folder&&e.name===name)&&openDir(key))wanted.add(key);
    }
    for(const dir of dirs.values())if(dir.open&&!wanted.has(dir.key))closeDir(dir);
  }
  function close(){
    if(closed)return;
    closed=true;
    for(const dir of dirs.values())closeDir(dir);
    dirs.clear();
    transport.close();
  }
  return {start,expand,close};
};
