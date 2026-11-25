const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const maxDirectories=48,maxEntries=2400,scanBatch=4;
const threadId=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const nameOrder=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
const within=(base,target)=>{
  const relative=path.relative(base,target);
  return relative===''||!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep);
};
const safeName=name=>typeof name==='string'&&name!=='.'&&name!=='..'&&name.length>0&&!/[\\/\0]/.test(name);
const parentKey=key=>key.slice(0,Math.max(0,key.lastIndexOf('/')));

// Each window owns its own scope and watchers. The page can select only directories
// returned by this scope: it never supplies a path to read or watch.
function createWorkspaceTree({readWorkspace,codexHome,home=os.homedir()}){
  let scope=null,lastScope=null,sent=-1;
  const forbidden=root=>path.parse(root).root===root||Boolean(home&&path.relative(home,root)==='')||
    Boolean(codexHome&&path.isAbsolute(codexHome)&&within(codexHome,root)&&
      !(within(path.join(codexHome,'worktrees'),root)&&path.relative(path.join(codexHome,'worktrees'),root)!==''));
  const removeRecord=record=>{record.watch?.close();record.watch=null;};
  function close(){
    if(scope){
      for(const record of scope.dirs.values())removeRecord(record);
      scope=null;
    }
    lastScope=null;sent=-1;
  }
  function initialize(intent){
    const current={token:intent.token,id:intent.threadId,status:'loading',root:null,label:'',dirs:new Map(),revision:0,scans:0};
    scope=current;
    (async()=>{
      try{
        const cwd=await readWorkspace({token:current.token,threadId:current.id});
        if(scope!==current)return;
        if(typeof cwd!=='string'||cwd.length>1024||!path.isAbsolute(cwd)||cwd.startsWith('\\\\'))throw Error('not-local');
        const root=await fs.promises.realpath(cwd);
        if(scope!==current)return;
        if(forbidden(path.resolve(cwd))||forbidden(root)||!(await fs.promises.stat(root)).isDirectory())throw Error('workspace-unavailable');
        if(scope!==current)return;
        current.root=root;current.label=path.basename(root);current.status='ready';
      }catch{if(scope===current)current.status='unavailable';}
      if(scope===current)current.revision++;
    })().catch(()=>{});
  }
  function ensureRecord(current,key,absolute){
    let record=current.dirs.get(key);
    if(!record){
      record={key,absolute,entries:[],status:'loading',dirty:true,watch:null,busy:false,retryAt:0};
      current.dirs.set(key,record);current.revision++;
    }
    return record;
  }
  function sameRecord(current,record){return scope===current&&current.dirs.get(record.key)===record;}
  async function scan(current,record){
    record.busy=true;record.dirty=false;current.scans++;
    try{
      const canonical=await fs.promises.realpath(record.absolute);
      if(!sameRecord(current,record))return;
      if(!within(current.root,canonical)||path.relative(record.absolute,canonical)!=='')throw Error('directory-link');
      if(!record.watch){
        try{
          const watcher=fs.watch(canonical,{persistent:false},event=>{
            if(event==='rename'&&sameRecord(current,record))record.dirty=true;
          });
          record.watch=watcher;
          watcher.on('error',()=>{
            if(record.watch===watcher){removeRecord(record);record.dirty=true;}
          });
        }catch{/* bounded reread while open if watching is unavailable */}
      }
      const list=await fs.promises.readdir(canonical,{withFileTypes:true});
      if(!sameRecord(current,record))return;
      const entries=list.filter(entry=>safeName(entry.name));
      if(entries.length>maxEntries){record.entries=[];record.status='large';}
      else{
        record.entries=entries.map(entry=>({name:entry.name,folder:entry.isDirectory()&&!entry.isSymbolicLink()}))
          .sort((a,b)=>Number(b.folder)-Number(a.folder)||nameOrder.compare(a.name,b.name)||a.name.localeCompare(b.name));
        record.status='ready';
      }
    }catch{
      if(!sameRecord(current,record))return;
      removeRecord(record);record.entries=[];record.status='unavailable';
    }finally{
      record.retryAt=Date.now()+1800;record.busy=false;current.scans--;
      if(sameRecord(current,record))current.revision++;
    }
  }
  function tick(intent){
    if(!intent?.open||!threadId.test(intent.threadId??'')||typeof intent.token!=='string'||intent.token.length>64){
      close();return null;
    }
    if(scope?.token!==intent.token||scope.id!==intent.threadId){close();initialize(intent);}
    const current=scope;
    if(current.root){
      const keep=new Set(['']);
      ensureRecord(current,'',current.root);
      // Parent first; a collapsed parent also releases all descendants.
      const requested=(Array.isArray(intent.expanded)?intent.expanded:[]).filter(key=>typeof key==='string'&&key&&key.length<=1024)
        .slice(0,maxDirectories-1).sort((a,b)=>a.length-b.length);
      for(const key of requested){
        const parent=parentKey(key),name=key.slice(parent.length?parent.length+1:0),owner=current.dirs.get(parent);
        if(keep.has(parent)&&safeName(name)&&owner?.entries.some(item=>item.folder&&item.name===name)){
          ensureRecord(current,key,path.join(owner.absolute,name));keep.add(key);
        }
      }
      for(const [key,record] of current.dirs)if(!keep.has(key)){
        removeRecord(record);current.dirs.delete(key);current.revision++;
      }
      for(const record of current.dirs.values()){
        if(current.scans>=scanBatch)break;
        if(!record.busy&&(record.dirty||!record.watch&&Date.now()>=record.retryAt))void scan(current,record);
      }
    }
    if(lastScope===current&&sent===current.revision)return null;
    lastScope=current;sent=current.revision;
    return {token:current.token,status:current.status,label:current.label,dirs:[...current.dirs.values()]
      .map(record=>({key:record.key,status:record.status,entries:record.entries}))};
  }
  return {tick,close};
}
module.exports={createWorkspaceTree};
