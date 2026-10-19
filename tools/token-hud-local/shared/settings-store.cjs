const fs=require('node:fs'),path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const execute=promisify(execFile);

function createSettingsStore(file,initial){
  let current=initial;
  function read(){
    try{
      const value=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
      if(value && typeof value==='object' && !Array.isArray(value))current=value;
    }catch{} // A failed read must never change the last valid preferences.
    return current;
  }
  async function patch(value){
    await execute(initial.python,['-I','-X','utf8',path.join(__dirname,'settings_store.py'),
      '--file',file,'--patch-base64',Buffer.from(JSON.stringify(value),'utf8').toString('base64')],{windowsHide:true,timeout:5000});
    current={...current,...value};
    return read();
  }
  return {read,patch};
}
module.exports={createSettingsStore};
