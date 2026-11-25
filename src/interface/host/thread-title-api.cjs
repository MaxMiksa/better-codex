const {spawn}=require('node:child_process');
const os=require('node:os'),readline=require('node:readline');
const {validThreadId}=require('./session-transcript.cjs');

// The desktop transport speaks the same App Server protocol and delivers native
// thread/name/updated notifications. It never dispatches a UI action.
async function setDesktopThreadTitle(page,{threadId,title,signal}){
  if(!validThreadId(threadId))throw new Error('invalid-thread');
  if(signal?.aborted)throw new Error('cancelled');
  let result;
  try{
    result=await page.evaluate(async({threadId,title})=>{
      if(location.protocol!=='app:'||location.host!=='-'||location.pathname!=='/index.html'||
        typeof window.electronBridge?.sendMessageFromView!=='function')return 'unavailable';
      function request(method,params,timeout=3500){
        return new Promise((resolve,reject)=>{
          const id='better-codex-title:'+crypto.randomUUID();
          const finish=(error,value)=>{
            clearTimeout(timer);window.removeEventListener('message',receive);
            if(error)reject(error);else resolve(value);
          };
          function receive(event){
            if(event.source!==window||event.origin!==location.origin)return;
            const data=event.data;
            if(data?.type!=='mcp-response'||data.hostId!=='local'||data.message?.id!==id)return;
            if(data.message.error)finish('rejected');
            else finish(null,data.message.result);
          }
          const timer=setTimeout(()=>finish('timeout'),timeout);
          window.addEventListener('message',receive);
          Promise.resolve().then(()=>window.electronBridge.sendMessageFromView({type:'mcp-request',hostId:'local',
            request:{id,method,params},timeoutMs:timeout})).catch(()=>finish('transport'));
        });
      }
      const read={threadId,includeTurns:false};
      try{
        if((await request('thread/read',read,750))?.thread?.id!==threadId)return 'unavailable';
      }catch{return 'unavailable';}
      try{await request('thread/name/set',{threadId,name:title});}
      catch(error){return error==='rejected'?'title-api-rejected':'title-not-confirmed';}
      try{
        const {thread}=(await request('thread/read',read))??{};
        if(thread?.id===threadId&&thread?.name===title)return 'ok';
      }catch{}
      return 'title-not-confirmed';
    },{threadId,title});
  }catch{
    // A lost renderer can mean the write reached the host. Do not replay it.
    throw new Error('title-not-confirmed');
  }
  if(result==='unavailable')return false;
  if(result==='ok')return true;
  throw new Error(result==='title-api-rejected'?result:'title-not-confirmed');
}

async function setThreadTitle({executable,codexHome,threadId,title,signal,timeoutMs=10000,
  launch=spawn}){
  if(!validThreadId(threadId))throw new Error('invalid-thread');
  if(signal?.aborted)throw new Error('cancelled');
  const child=launch(executable,['app-server','--listen','stdio://'],{
    cwd:os.tmpdir(),env:{...process.env,CODEX_HOME:codexHome},windowsHide:true,stdio:['pipe','pipe','ignore']
  });
  let failure,pending,sequence=0;
  const stop=reason=>{
    failure??=reason;
    pending?.reject(new Error(failure));
  };
  const unavailable=()=>stop('title-api-unavailable');
  const cancel=()=>stop('cancelled');
  child.on('error',unavailable);
  child.stdin.on('error',unavailable);
  child.stdout.on('error',unavailable);
  child.once('close',unavailable);
  signal?.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(()=>stop('title-api-timeout'),timeoutMs);
  const lines=readline.createInterface({input:child.stdout,crlfDelay:Infinity});
  lines.on('line',line=>{
    let value;
    try{value=JSON.parse(line);}catch{return;}
    if(!pending||value?.id!==pending.id)return;
    const {resolve,reject}=pending;
    pending=null;
    if(Object.hasOwn(value,'result'))resolve(value.result);
    else reject(new Error('title-api-rejected'));
  });
  const send=value=>child.stdin.write(JSON.stringify(value)+'\n');
  const rpc=(method,params)=>new Promise((resolve,reject)=>{
    if(failure){reject(new Error(failure));return;}
    const id=++sequence;
    pending={id,resolve,reject};
    send({id,method,params});
  });
  let phase='initializing';
  try{
    await rpc('initialize',{clientInfo:{name:'better_codex',title:'Better-Codex',version:'1.0'}});
    if(failure)throw new Error(failure);
    send({method:'initialized'});
    phase='writing';
    await rpc('thread/name/set',{threadId,name:title});
    phase='verifying';
    const {thread}=(await rpc('thread/read',{threadId,includeTurns:false}))??{};
    if(thread?.id!==threadId||thread?.name!==title)throw new Error('title-not-confirmed');
  }catch(error){
    if(error.message!=='cancelled'&&(phase==='verifying'||
      (phase==='writing'&&error.message!=='title-api-rejected')))throw new Error('title-not-confirmed');
    throw error;
  }finally{
    clearTimeout(timer);
    signal?.removeEventListener('abort',cancel);
    lines.close();
    child.stdin.end();
    // EOF lets our short-lived app-server exit normally; only its own PID is ever killed.
    if(child.exitCode===null&&child.signalCode===null){
      const reap=setTimeout(()=>child.kill(),1000);
      reap.unref();
      child.once('close',()=>clearTimeout(reap));
    }
  }
}

module.exports={setDesktopThreadTitle,setThreadTitle};
