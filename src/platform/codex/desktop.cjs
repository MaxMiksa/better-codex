const path=require('node:path'),{checked}=require('../windows/native.cjs');
const FAMILY='OpenAI.Codex_2p2nqsd0c76g0';
const samePath=(a,b)=>typeof a==='string'&&typeof b==='string'&&path.win32.normalize(a).toLowerCase()===path.win32.normalize(b).toLowerCase();
function createDesktopPlatform(native=checked){
  async function discover({digest=false}={}){
    const {package:current}=await native('codex-package',digest?['--digest']:[],{timeout:8000});
    if(current?.packageFamily!==FAMILY||!current.packageFullName||!current.executable)throw Error('Package identity unavailable');
    if(digest&&!/^[a-f0-9]{64}$/.test(current.sha256))throw Error('Package digest unavailable');
    return current;
  }
  const belongs=(p,current)=>p.packageFamily===FAMILY&&p.packageFullName===current.packageFullName&&samePath(p.executable,current.executable);
  async function desktops(current){
    const {processes,identityConflict}=await native('codex-processes',[],{timeout:8000});
    if(identityConflict)throw Error('Desktop identity unavailable');
    // Command line is only inspected by native code; do not retain it in receipts.
    return processes.filter(p=>belongs(p,current)).map(({pid,created,started,main,visible,responding,windowHandle,debuggingRequested})=>
      ({pid,created,started,main,visible,responding,windowHandle,debuggingRequested}));
  }
  async function listeners(port){
    if(!Number.isInteger(port)||port<1024||port>65535)throw RangeError('Invalid display port');
    return (await native('port-listeners',['--port',String(port)])).listeners;
  }
  function verifiedListener(rows,current){
    const [p]=rows;
    return rows.length===1&&p.address==='127.0.0.1'&&p.currentSession===true&&belongs(p,current)&&
      Number.isInteger(p.pid)&&p.pid>0&&/^\d{16,20}$/.test(p.created)&&Number.isFinite(p.started)?
      {pid:p.pid,created:p.created,started:p.started}:null;
  }
  async function ownerAlive(owner){
    if(!owner)return false;
    return (await native('process-alive',['--pid',String(owner.pid),'--created',owner.created])).alive===true;
  }
  return {discover,desktops,listeners,verifiedListener,ownerAlive};
}
module.exports={createDesktopPlatform,FAMILY,samePath};
