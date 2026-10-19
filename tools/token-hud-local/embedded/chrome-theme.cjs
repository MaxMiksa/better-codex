const fs=require('node:fs');

// Read only known scalar fields. Unsupported or incomplete TOML stays unpatched.
function parseChromeThemes(text){
  const themes={};
  for(const variant of ['light','dark']){
    const section=`desktop.appearance${variant==='light'?'Light':'Dark'}ChromeTheme`;
    const headers=[...text.matchAll(new RegExp(`^\\s*\\[${section.replaceAll('.','\\.')}\\]\\s*(?:#.*)?$`,'gm'))];
    if(!headers.length)continue;
    if(headers.length!==1)return null;
    const rest=text.slice(headers[0].index+headers[0][0].length);
    const body=rest.split(/^\s*\[/m)[0],theme={};
    for(const key of ['accentSource','accent','surface']){
      const fields=[...body.matchAll(new RegExp(`^\\s*${key}\\s*=\\s*(["'])([^"'\\r\\n]+)\\1\\s*(?:#.*)?$`,'gm'))];
      if(fields.length!==1)return null;
      theme[key]=fields[0][2];
    }
    themes[variant]=theme;
  }
  return themes;
}

function createThemeReader(file){
  let checked=0,previous,themes=null;
  return ()=>{
    if(Date.now()-checked<1000)return themes;
    checked=Date.now();
    try{
      const text=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');
      if(text!==previous){themes=parseChromeThemes(text);previous=text;}
    }catch{themes=null;previous=undefined;}
    return themes;
  };
}
module.exports={parseChromeThemes,createThemeReader};
