const fs=require('node:fs'),{checked}=require('../windows/native.cjs');
function readSettings(file){
  const value=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
  if(!value||typeof value!=='object'||Array.isArray(value))throw TypeError('Invalid settings');
  return value;
}
async function appearance(file,systemDark,native=checked){
  if(systemDark===undefined)systemDark=(await native('system-theme').catch(()=>({dark:false}))).dark;
  let mode,surface;
  try{
    const config=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');
    const desktop=/^\s*\[desktop\]\s*(?:#.*)?$/m.exec(config);
    const body=desktop?config.slice(desktop.index+desktop[0].length).split(/^\s*\[/m)[0]:'';
    mode=/^\s*appearanceTheme\s*=\s*(['"])(light|dark|system)\1\s*(?:#.*)?$/m.exec(body)?.[2];
    const dark=mode==='dark'||mode!=='light'&&systemDark;
    const variant=dark?'Dark':'Light',key='appearance'+variant+'ChromeTheme';
    const section=new RegExp('^\\s*\\[desktop\\.'+key+'\\]\\s*(?:#.*)?$','m').exec(config);
    if(section){
      const fields=config.slice(section.index+section[0].length).split(/^\s*\[/m)[0];
      surface=/^\s*surface\s*=\s*(['"])(#[a-f0-9]{6})\1\s*(?:#.*)?$/im.exec(fields)?.[2];
    }else{
      const value=new RegExp('^\\s*'+key+'\\s*=\\s*(.+)$','m').exec(body)?.[1]?.trim();
      if(value?.startsWith("'"))surface=JSON.parse(value.slice(1,value.lastIndexOf("'"))).surface;
      else if(value?.startsWith('"'))surface=JSON.parse(JSON.parse(value)).surface;
      else if(value?.startsWith('{'))surface=/\bsurface\s*=\s*(['"])(#[a-f0-9]{6})\1/i.exec(value)?.[2];
    }
  }catch{}
  const dark=mode==='dark'||mode!=='light'&&Boolean(systemDark);
  return {dark,surface:typeof surface==='string'&&/^#[a-f0-9]{6}$/i.test(surface)?surface:dark?'#111111':'#ffffff'};
}
module.exports={readSettings,appearance};
