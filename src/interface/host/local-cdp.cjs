// A bounded, local-only CDP client for the already verified Codex listener.
const http=require('node:http'),{EventEmitter}=require('node:events');
const {isMainPageUrl}=require('./page-contract.cjs');
const deadline=2500;
const closed=()=>new Error('CDP connection closed');
const contextUnavailable=()=>new Error('Codex main document unavailable');

function discover(port){
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid display port');
  const host='127.0.0.1:'+port;
  return new Promise((resolve,reject)=>{
    const request=http.get('http://'+host+'/json/version',{agent:false,signal:AbortSignal.timeout(deadline)},response=>{
      if(response.statusCode!==200){response.destroy();reject(new Error('CDP discovery failed'));return;}
      let body='';
      response.setEncoding('utf8');
      response.on('error',reject);
      response.on('data',chunk=>{
        body+=chunk;
        if(body.length>16384)request.destroy(new Error('CDP discovery response too large'));
      });
      response.on('end',()=>{
        try{
          const endpoint=JSON.parse(body).webSocketDebuggerUrl;
          const prefix='ws://'+host;
          if(typeof endpoint!=='string'||!endpoint.startsWith(prefix)||
              !/^\/devtools\/browser\/[a-z0-9-]+$/i.test(endpoint.slice(prefix.length)))throw new Error();
          resolve(endpoint);
        }catch{reject(new Error('Invalid local CDP endpoint'));}
      });
    });
    request.on('error',reject);
  });
}

class Connection{
  constructor(endpoint){
    this.socket=new WebSocket(endpoint);
    this.next=0;
    this.pending=new Map();
    this.pages=new Map();
    this.sessions=new Map();
    this.ended=false;
    this.socket.addEventListener('message',event=>this.receive(event.data));
    for(const event of ['close','error'])this.socket.addEventListener(event,()=>this.close());
  }
  async open(){
    const signal=AbortSignal.timeout(deadline);
    await new Promise((resolve,reject)=>{
      const fail=()=>reject(closed());
      this.socket.addEventListener('open',resolve,{once:true,signal});
      this.socket.addEventListener('close',fail,{once:true,signal});
      this.socket.addEventListener('error',fail,{once:true,signal});
      signal.addEventListener('abort',fail,{once:true});
    });
    // Discovery also supplies targetCreated for windows that are already open.
    await this.send('Target.setDiscoverTargets',{discover:true});
  }
  isConnected(){return !this.ended&&this.socket.readyState===WebSocket.OPEN;}
  send(method,params={},sessionId){
    if(!this.isConnected())return Promise.reject(closed());
    const id=++this.next;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        this.pending.delete(id);
        reject(new Error('CDP request timed out'));
        // An unacknowledged attach may still create an unknown session.
        if(method==='Target.attachToTarget'||method==='Target.detachFromTarget')this.close();
      },deadline);
      this.pending.set(id,{resolve,reject,timer,sessionId});
      try{this.socket.send(JSON.stringify({id,method,params,sessionId}));}
      catch{this.close();}
    });
  }
  receive(data){
    let message;
    try{message=JSON.parse(data);}catch{return;}
    if(!message||typeof message!=='object')return;
    const {id,result,error,method,params={},sessionId}=message;
    if(id!==undefined){
      const waiter=this.pending.get(id);
      if(!waiter||waiter.sessionId!==sessionId)return;
      this.pending.delete(id);
      clearTimeout(waiter.timer);
      if(error)waiter.reject(new Error('CDP command rejected'));
      else waiter.resolve(result);
      return;
    }
    if(sessionId){
      this.sessions.get(sessionId)?.receive(method,params);
      return;
    }
    if(method==='Target.targetCreated'||method==='Target.targetInfoChanged'){
      const info=params.targetInfo;
      if(info?.type!=='page'||typeof info.targetId!=='string')return;
      const page=this.pages.get(info.targetId);
      if(page)page.info=info;
      else this.pages.set(info.targetId,new Page(this,info));
    }else if(method==='Target.targetCrashed'){
      this.pages.get(params.targetId)?.session?.close();
    }else if(method==='Target.targetDestroyed'){
      const page=this.pages.get(params.targetId);
      page?.session?.close();
      this.pages.delete(params.targetId);
    }else if(method==='Target.detachedFromTarget'){
      this.sessions.get(params.sessionId)?.close();
    }
  }
  close(){
    if(this.ended)return;
    this.ended=true;
    for(const session of this.sessions.values())session.close();
    for(const waiter of this.pending.values()){clearTimeout(waiter.timer);waiter.reject(closed());}
    this.pending.clear();
    this.pages.clear();
    // Disconnect our socket only; never send a command that closes Codex.
    this.socket.close();
  }
}

class Page{
  constructor(connection,info){this.connection=connection;this.info=info;this.session=null;}
  url(){return this.info.url;}
  isClosed(){return this.connection.pages.get(this.info.targetId)!==this;}
  evaluate(fn,arg){return this.session?.evaluate(fn,arg)??Promise.reject(contextUnavailable());}
  async attach(){
    const {sessionId}=await this.connection.send('Target.attachToTarget',{targetId:this.info.targetId,flatten:true});
    if(!this.connection.isConnected())throw closed();
    const session=new Session(this,sessionId);
    this.session=session;
    this.connection.sessions.set(sessionId,session);
    try{
      await session.send('Page.enable');
      const {frameTree}=await session.send('Page.getFrameTree');
      // If a newer frame event has already arrived, don't replace it with a snapshot.
      session.frame??=frameTree.frame;
      await session.send('Runtime.enable');
      return session;
    }catch(error){
      await session.detach().catch(()=>{});
      throw error;
    }
  }
}

class Session extends EventEmitter{
  constructor(page,id){
    super();
    this.page=page;
    this.id=id;
    this.frame=null;
    this.contexts=new Map();
    this.ended=false;
  }
  mainContext(){
    if(this.page.isClosed()||!isMainPageUrl(this.page.url())||!isMainPageUrl(this.frame?.url))return;
    return this.contexts.get(this.frame.id);
  }
  receive(method,params){
    if(method==='Page.frameNavigated'&&!params.frame?.parentId)this.frame=params.frame;
    else if(method==='Page.navigatedWithinDocument'&&params.frameId===this.frame?.id)this.frame={...this.frame,url:params.url};
    else if(method==='Page.frameDetached')this.contexts.delete(params.frameId);
    else if(method==='Runtime.executionContextCreated'){
      const context=params.context;
      if(context?.auxData?.isDefault&&context.auxData.frameId&&context.uniqueId)this.contexts.set(context.auxData.frameId,context);
    }else if(method==='Runtime.executionContextDestroyed'){
      for(const [frame,context] of this.contexts){
        if(params.executionContextUniqueId ? params.executionContextUniqueId===context.uniqueId
          : params.executionContextId===context.id)this.contexts.delete(frame);
      }
    }else if(method==='Runtime.executionContextsCleared')this.contexts.clear();
    else if(method==='Runtime.bindingCalled'&&params.executionContextId===this.mainContext()?.id)this.emit(method,params);
  }
  isConnected(){return !this.ended&&this.page.connection.isConnected();}
  send(method,params={}){
    if(this.ended)return Promise.reject(closed());
    if(method==='Runtime.evaluate'){
      const context=this.mainContext();
      if(!context)return Promise.reject(contextUnavailable());
      params={...params,uniqueContextId:context.uniqueId};
    }
    return this.page.connection.send(method,params,this.id);
  }
  async evaluate(fn,arg){
    const argument=JSON.stringify(arg);
    const {result,exceptionDetails}=await this.send('Runtime.evaluate',{
      expression:'('+fn.toString()+')('+ (argument??'') +')',
      returnByValue:true,awaitPromise:true
    });
    if(exceptionDetails)throw new Error('Codex page evaluation failed');
    return result?.value;
  }
  close(){
    if(this.ended)return;
    this.ended=true;
    const connection=this.page.connection;
    connection.sessions.delete(this.id);
    if(this.page.session===this)this.page.session=null;
    for(const [id,waiter] of connection.pending){
      if(waiter.sessionId===this.id){
        connection.pending.delete(id);clearTimeout(waiter.timer);waiter.reject(closed());
      }
    }
    this.contexts.clear();
    this.removeAllListeners();
  }
  async detach(){
    if(this.ended)return;
    this.close();
    await this.page.connection.send('Target.detachFromTarget',{sessionId:this.id});
  }
}

async function connectToBrowser(port){
  const connection=new Connection(await discover(port));
  try{await connection.open();return connection;}
  catch(error){connection.close();throw error;}
}
module.exports={connectToBrowser};
