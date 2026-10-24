const fs=require('node:fs'),path=require('node:path');

function createWriter(){
  let failures=0,lastFailure=null;
  function write(file,value){
    const content=JSON.stringify(value);
    try{
      fs.writeFileSync(file+'.next',content);fs.renameSync(file+'.next',file);
      return true;
    }catch(error){
      if(!error.code)throw error;
      failures++;lastFailure={file:path.basename(file),code:error.code};
      return false;
    }
  }
  return {write,diagnostics:()=>({failures,lastFailure})};
}

module.exports={createWriter};
