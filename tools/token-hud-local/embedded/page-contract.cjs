// Main Electron documents can carry initialRoute in additional windows.
function isMainPageUrl(value){
  try{
    const url=new URL(value);
    return url.protocol==='app:'&&url.host==='-'&&url.pathname==='/index.html';
  }catch{return false;}
}
const pageGuard="location.protocol==='app:'&&location.host==='-'&&location.pathname==='/index.html'";
module.exports={isMainPageUrl,pageGuard};
