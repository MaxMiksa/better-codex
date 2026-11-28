// Only the controller child is ours to stop. Never signal the desktop.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {createDesktopPlatform}=require('../platform/codex/desktop.cjs');
const wait=(child,ms)=>{
  if(child.done)return Promise.resolve(true);
  return new Promise(resolve=>{
    const onExit=()=>{clearTimeout(timer);resolve(true);};
    const timer=setTimeout(()=>{child.process.removeListener('close',onExit);resolve(false);},ms);
    child.process.once('close',onExit);
  });
};
class DisplayConnection{
  constructor(settings,settingsPath,runtime,{platform=createDesktopPlatform(),launch=spawn}={}){
    Object.assign(this,{settings,settingsPath,runtime,platform,launch,child:null,owner:null,package:null,
      childExits:0,lastChildExit:null});
  }
  async tick(){
    const gone=this.owner&&!await this.platform.ownerAlive(this.owner)?this.owner:null;
    if(this.child&&!this.child.done&&gone){
      this.child.process.kill();
      if(!await wait(this.child,5000))throw Error('Controller exit unavailable');
    }
    if(this.child?.done){
      this.childExits++;this.lastChildExit=this.child.code;
      this.child=this.owner=null;
    }
    const stopped=()=>fs.existsSync(path.join(this.runtime,'stop'));
    if(!this.child&&!stopped()){
      this.owner=null;
      const rows=await this.platform.listeners(this.settings.port);
      if(rows.length){
        this.package=await this.platform.discover();
        const candidate=this.platform.verifiedListener(rows,this.package);
        // Registration can change during a Store upgrade. Recheck the listener
        // snapshot and exact process identity before connecting to the port.
        if(candidate){
          const current=this.platform.verifiedListener(await this.platform.listeners(this.settings.port),this.package);
          if(current?.pid===candidate.pid&&current.created===candidate.created&&await this.platform.ownerAlive(current)&&!stopped()){
            const child=this.launch(process.execPath,['--no-warnings=ExperimentalWarning',path.join(__dirname,'controller.cjs'),
              this.settingsPath,this.runtime],{windowsHide:true,stdio:'ignore',cwd:path.resolve(__dirname,'../..')});
            const state={process:child,done:false,code:null};
            child.on('error',()=>{state.done=true;state.code=1;});
            child.on('close',code=>{if(!state.done){state.done=true;state.code=code;}});
            this.child=state;this.owner=current;
          }
        }
      }
    }
    return {phase:this.child?'controller-running':'waiting-desktop-connection',desktopPid:this.owner?.pid??null,
      controllerPid:this.child?.process.pid??null,packageVersion:this.package?.packageVersion??null,
      desktopGone:gone?[gone.pid,gone.started]:null,childExits:this.childExits,lastChildExit:this.lastChildExit};
  }
  async stop(){
    if(this.child&&!await wait(this.child,6000)){
      this.child.process.kill();
      await wait(this.child,5000);
    }
  }
}
module.exports={DisplayConnection};
