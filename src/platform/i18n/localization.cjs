const {normalize,translate}=require('./i18n.js');
const language=()=>normalize((process.env.BETTER_CODEX_LANGUAGE==='auto'?'':process.env.BETTER_CODEX_LANGUAGE)||
  Intl.DateTimeFormat().resolvedOptions().locale);
const text=(key,values)=>translate(language(),key,values);
module.exports={language,text};
