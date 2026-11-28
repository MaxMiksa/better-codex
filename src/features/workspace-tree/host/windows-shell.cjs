const {checked}=require('../../../platform/windows/native.cjs');
function action(verb,file,fields={},timeout){
  return checked('shell-action',['--input-stdin'],{input:{verb,path:file,...fields},timeout});
}
const inspectPreview=file=>action('preview-file-info',file,{},1500);
async function replacePreview(file,staged,version){
  try{
    await action('replace-preview',file,{staged,mtimeNs:String(version.mtimeNs),size:String(version.size)},3000);
    return true;
  }catch(error){if(error.code===5)return false;throw error;}
}
function shellAction(verb,file,pid){
  const fields=verb==='folder'&&Number.isInteger(pid)&&pid>0&&pid<=0xffffffff?{desktopPid:String(pid)}:{};
  return action(verb,file,fields);
}
module.exports={shellAction,inspectPreview,replacePreview,peek:file=>action('peek',file),
  quickLook:(file,executable)=>action('quicklook',file,{executable})};
