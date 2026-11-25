// Shared by the App Server reader and the native action host.
function windowsName(name){
  return typeof name==='string'&&name.length>0&&name.length<=255&&
    !/[\x00-\x1f\\/:<>"|?*]|[. ]$/.test(name)&&
    !/^(?:con|conin\$|conout\$|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]) *(?:\.|$)/i.test(name);
}
function windowsPath(value){
  if(typeof value!=='string'||!/^[a-z]:[\\/]/i.test(value)||value.length>32767)return null;
  const path=value.replaceAll('/','\\').replace(/\\+$/,'');
  if(path.length>2&&!path.slice(3).split('\\').every(windowsName))return null;
  return path;
}
function allowedRoot(value,{home,codexHome}){
  const path=windowsPath(value),personalPath=windowsPath(home),statePath=windowsPath(codexHome);
  if(!path||path.length<4||!personalPath||!statePath)return null;
  const key=path.toLowerCase(),personal=personalPath.toLowerCase(),state=statePath.toLowerCase();
  const within=(candidate,base)=>candidate===base||candidate.startsWith(base+'\\');
  if(within(personal,key)||within(state,key))return null;
  for(const base of [state,personal+'\\.codex']){
    if(within(key,base)&&!key.startsWith(base+'\\worktrees\\'))return null;
  }
  return path;
}

module.exports={windowsName,windowsPath,allowedRoot};
