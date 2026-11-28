const structured=new Set(['jsonc','yaml','yml','toml']);

function validIni(body){
  return body.split('\n').every(line=>{
    line=line.trim();
    if(!line||line[0]===';'||line[0]==='#')return true;
    if(line[0]==='[')return /^\[[^\[\]]+\]\s*(?:[;#].*)?$/.test(line);
    return line.search(/[=:]/)>0;
  });
}

function validConfig(ext,body){
  if(ext==='ini')return validIni(body);
  if(ext==='json'){
    try{JSON.parse(body);return true;}catch{return false;}
  }
  if(!structured.has(ext))return true;
  const {parseJsonc,parseYaml,parseToml}=require('./config-parsers.cjs');
  try{
    if(ext==='jsonc'){
      const errors=[];
      parseJsonc(body,errors,{allowTrailingComma:true});
      return errors.length===0;
    }
    // Inspect YAML documents without resolving aliases or materializing values.
    if(ext==='yaml'||ext==='yml')return parseYaml(body).every(doc=>!doc.errors.length);
    parseToml(body);
    return true;
  }catch{return false;}
}

module.exports={validConfig};
