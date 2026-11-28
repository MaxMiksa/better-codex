const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const {parseArgs}=require('node:util'),{setTimeout:sleep}=require('node:timers/promises');
const {read}=require('../../platform/paths.cjs'),{checked}=require('../../platform/windows/native.cjs');
const {parseToml}=require('../../features/workspace-tree/host/preview/config-parsers.cjs');
const codexHome=settings=>typeof settings.codexHome==='string'&&settings.codexHome||path.join(os.homedir(),'.codex');
const configFor=settings=>parseToml(fs.readFileSync(path.join(codexHome(settings),'config.toml'),'utf8').replace(/^\uFEFF/,''));
function endpoint(config){
  const provider=config.model_provider??'openai',providers=config.model_providers??{},active=providers[provider]??{};
  let url=active.base_url;
  const names=[provider,active.name,url];
  if(provider==='openai'){
    url ||= config.openai_base_url||config.chatgpt_base_url;
    names.push(config.model_catalog_json,...Object.keys(providers));
  }
  if(typeof url!=='string'||!/magpie/i.test(names.join(' ')))return null;
  try{
    const u=new URL(url),host=u.hostname.replace(/^\[|\]$/g,'');
    // Do not let WHATWG's alternate IPv4 spellings bypass the loopback contract.
    if(!/^https?:\/\/(?:[^/@]*@)?(?:127\.0\.0\.1|localhost|\[::1\])(?=[:/?#]|$)/i.test(url)||
       !['127.0.0.1','localhost','::1'].includes(host)||u.port==='0')return null;
    return {host,port:Number(u.port||(u.protocol==='https:'?443:80))};
  }catch{return null;}
}
function reachable({host,port},timeout=800){
  return new Promise(resolve=>{
    const socket=net.connect({host,port});
    const finish=ok=>{socket.destroy();resolve(ok);};
    socket.setTimeout(timeout,()=>finish(false));
    socket.once('connect',()=>finish(true));
    socket.once('error',()=>finish(false));
  });
}
async function probe(address,{connect=reachable,delay=sleep,interval=1000}={}){
  for(let i=0;i<3;i++){
    if(await connect(address))return true;
    if(i<2)await delay(interval);
  }
  return false;
}
async function owner(address,native=checked){
  const {listeners}=await native('port-listeners',['--port',String(address.port)]);
  const bindings=address.host==='localhost'?['127.0.0.1','::1','0.0.0.0','::']:
    address.host==='::1'?['::1','::']:['127.0.0.1','0.0.0.0'];
  const rows=[...new Map(listeners.filter(p=>bindings.includes(p.address)).map(p=>[p.pid+':'+p.created,p])).values()];
  if(rows.length!==1||!rows[0].executable||!rows[0].created)return null;
  const {pid,created,executable}=rows[0];
  return (await native('process-alive',['--pid',String(pid),'--created',created])).alive?path.win32.basename(executable).toLowerCase():null;
}
if(require.main===module)(async()=>{
  if(process.env.MAGPIE_SKIP_WAIT)return;
  const {values}=parseArgs({options:{settings:{type:'string'}}});
  const address=endpoint(configFor(read(values.settings)));
  if(address)await probe(address);
})().catch(()=>{}); // A failed probe must never prevent normal activation.
module.exports={endpoint,reachable,probe,owner,configFor,codexHome};
