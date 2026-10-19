// Presentation only: no Codex configuration, chat content or model traffic changes.
(() => {
  if (window.__codexCustomAccent) return false;
  let themes={},removed=false,queued=false;
  const style=document.createElement('style');
  style.id='codex-hud-custom-accent';
  const valid=value=>/^#[a-f\d]{6}$/i.test(value||'');
  const rgb=hex=>hex.match(/[a-f\d]{2}/gi).map(value=>parseInt(value,16));
  const hex=channels=>'#'+channels.map(value=>Math.round(value).toString(16).padStart(2,'0')).join('');
  const luminance=color=>rgb(color).map(value=>{
    value/=255;
    return value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4;
  }).reduce((sum,value,index)=>sum+value*[0.2126,0.7152,0.0722][index],0);
  const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+0.05)/(Math.min(luminance(a),luminance(b))+0.05);
  const textOn=background=>contrast(background,'#ffffff')>=contrast(background,'#000000')?'#ffffff':'#000000';
  const mix=(a,b,weight)=>hex(rgb(a).map((value,index)=>value*weight+rgb(b)[index]*(1-weight)));
  function colors(){
    const computed=getComputedStyle(document.documentElement);
    return Object.fromEntries(['--codex-base-accent','--color-background-user-message','--color-text-user-message',
      '--color-background-composer-primary','--color-text-composer-primary'].map(key=>[key,computed.getPropertyValue(key).trim()]));
  }
  function nativeColors(){
    const disabled=style.disabled;
    style.disabled=true;
    try{return colors();}finally{style.disabled=disabled;}
  }
  function apply(){
    if(removed||!document.head)return {applied:false,reason:'document-unavailable'};
    const variant=document.documentElement.dataset.theme,palettes={},rules=[];
    const baseAccent=getComputedStyle(document.documentElement).getPropertyValue('--codex-base-accent').trim().toLowerCase();
    for(const mode of ['light','dark']){
      const theme=themes?.[mode];
      if(theme?.accentSource!=='custom'||!valid(theme.accent)||!valid(theme.surface))continue;
      if(mode===variant&&baseAccent!==theme.accent.toLowerCase())continue;
      const accent=theme.accent.toLowerCase(),bubble=mix(accent,theme.surface,mode==='dark'?0.52:0.14);
      const bubbleText=textOn(bubble),buttonText=textOn(accent);
      palettes[mode]={accent,bubble,bubbleText,buttonText,bubbleContrast:contrast(bubble,bubbleText),buttonContrast:contrast(accent,buttonText)};
      rules.push(`:root[data-theme="${mode}"]:not([data-codex-window-type="extension"]){
        --color-background-user-message:${bubble};--color-text-user-message:${bubbleText};
        --color-background-composer-primary:${accent};--color-text-composer-primary:${buttonText};
      }`);
    }
    const css=rules.join('\n');
    if(style.textContent!==css)style.textContent=css;
    if(css&&!style.isConnected)document.head.append(style);
    if(!css&&style.isConnected)style.remove();
    return {applied:Boolean(palettes[variant]),variant,palettes};
  }
  const observer=new MutationObserver(()=>{
    if(queued||removed)return;
    queued=true;
    queueMicrotask(()=>{queued=false;apply();});
  });
  observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  if(document.head)observer.observe(document.head,{childList:true,subtree:true,characterData:true});
  window.__codexCustomAccent={
    update(value){themes=value;return apply();},
    snapshot(){return {...apply(),native:nativeColors(),current:colors()};},
    remove(){removed=true;observer.disconnect();style.remove();delete window.__codexCustomAccent;}
  };
  return true;
})();
