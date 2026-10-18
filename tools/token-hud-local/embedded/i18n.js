// Shared presentation strings for the controller and page modules.
(() => {
  const node=typeof module==='object' && module.exports;
  const messages=node ? require('../shared/messages.json') : window.__codexHudMessages;
  const normalize = value => /^zh(?:$|-(?:cn|sg|hans)(?:-|$))/i.test(String(value).trim().replaceAll('_','-')) ? 'zh-CN' : 'en';
  const locale = () => normalize(document.documentElement.lang.trim() || window.__codexHudLanguage);
  function translate(language,key,values={}) {
    const message=messages[normalize(language)][key] ?? messages.en[key] ?? key;
    return message.replace(/\{(\w+)\}/g,(match,name)=>Object.hasOwn(values,name)?String(values[name]):match);
  }
  if (node) module.exports={normalize,translate,pageSource:(language=process.env.BETTER_CODEX_LANGUAGE || 'en')=>`window.__codexHudLanguage=${JSON.stringify(normalize(language))};window.__codexHudMessages=${JSON.stringify(messages)};`+require('node:fs').readFileSync(__filename,'utf8')};
  else {
    if (!window.__codexHudI18n) window.__codexHudI18n={locale,t:(key,values)=>translate(locale(),key,values)};
    delete window.__codexHudMessages;
  }
})()
