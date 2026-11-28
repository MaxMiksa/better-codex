const {spawn,execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {checked}=require('./windows/native.cjs');
const run=(file,args,options)=>promisify(execFile)(file,args,{windowsHide:true,timeout:8000,maxBuffer:65536,...options});
function detached(file,args){
  const child=spawn(file,args,{detached:true,windowsHide:true,stdio:'ignore'});
  return new Promise((resolve,reject)=>{
    child.once('error',reject);
    child.once('spawn',()=>{child.unref();resolve(child);});
  });
}
function info(pid,{executable,argument,native=checked,timeout}={}){
  return native('process-info',['--input-stdin'],{timeout,input:{pid:String(pid),executable,argument}});
}
function nodeVersion(version){
  const [major,minor,patch]=version.replace(/^v/,'').split('.').map(Number);
  return major===24&&(minor>11||minor===11&&patch>=1);
}
async function nodeReady(file){
  const {stdout}=await run(file,['--no-warnings=ExperimentalWarning','-p',
    'typeof WebSocket === "function" && typeof require("node:sqlite").DatabaseSync === "function" && process.version'],{timeout:4000});
  return nodeVersion(stdout.trim());
}
module.exports={run,detached,info,nodeVersion,nodeReady};
