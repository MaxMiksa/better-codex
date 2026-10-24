// Isolated browser contracts; live desktop acceptance is recorded separately.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {parseChromeThemes,createThemeReader}=require('../../src/interface/appearance/chrome-theme.cjs');
const {chromium}=require(process.env.HUD_PLAYWRIGHT||path.resolve(__dirname,'../../.runtime/token-hud/node/node_modules/playwright'));
const source=fs.readFileSync(path.join(__dirname,'../../src/interface/appearance/custom-accent.js'),'utf8');
const results=[];
const check=(name,ok)=>{assert.ok(ok,name);results.push(name);};
const section='[desktop.appearanceDarkChromeTheme]\naccent = "#3a83f7"\naccentSource = "custom"\nsurface = "#111111"\n';
check('read-only-scalar-theme-parser',parseChromeThemes(section).dark.accent==='#3a83f7');
check('duplicate-theme-rejected',parseChromeThemes(section+section)===null);
check('duplicate-color-rejected',parseChromeThemes(section+'accent = "#ffffff"\n')===null);
check('incomplete-config-rejected',parseChromeThemes(section.replace('surface = "#111111"',''))===null);
check('missing-config-stays-unpatched',createThemeReader(path.join(process.argv[2],'missing.toml'))()===null);
const html=`<!doctype html><html data-theme="dark"><head><style>
:root{--codex-base-accent:#3a83f7;--color-background-user-message:#222222;--color-text-user-message:#ffffff;--color-background-composer-primary:#ffffff;--color-text-composer-primary:#000000}
.bubble{background:var(--color-background-user-message);color:var(--color-text-user-message)}
.button{background:var(--color-background-composer-primary);color:var(--color-text-composer-primary)}
</style></head><body><div class="bubble">Fixture</div><button class="button">Send</button></body></html>`;
(async()=>{
 const browser=await chromium.launchPersistentContext(path.resolve(process.argv[2]),{headless:true,executablePath:process.env.HUD_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const page=await browser.newPage();await page.setContent(html);await page.evaluate(source);
  for(const variant of ['light','dark'])for(const accent of ['#3a83f7','#4eb7fa','#ffff00','#000000','#ffffff']){
   const state=await page.evaluate(({variant,accent})=>{
    document.documentElement.dataset.theme=variant;document.documentElement.style.setProperty('--codex-base-accent',accent);
    const result=window.__codexCustomAccent.update({[variant]:{accentSource:'custom',accent,surface:variant==='dark'?'#111111':'#ffffff'}});
    const bubble=getComputedStyle(document.querySelector('.bubble')),button=getComputedStyle(document.querySelector('.button'));
    const rgb=value=>value.match(/\d+/g).slice(0,3).map(Number);
    const light=value=>rgb(value).map(v=>{v/=255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[0.2126,0.7152,0.0722][i],0);
    const ratio=(bg,fg)=>(Math.max(light(bg),light(fg))+0.05)/(Math.min(light(bg),light(fg))+0.05);
    return {applied:result.applied,button:rgb(button.backgroundColor),bubbleContrast:ratio(bubble.backgroundColor,bubble.color),buttonContrast:ratio(button.backgroundColor,button.color)};
   },{variant,accent});
   check(`${variant}-${accent}-actual-colors-and-contrast`,state.applied&&state.bubbleContrast>=4.5&&state.buttonContrast>=4.5&&state.button.join(',')===accent.slice(1).match(/../g).map(v=>parseInt(v,16)).join(','));
  }
  await page.evaluate(()=>window.__codexCustomAccent.update({dark:{accentSource:'chatgpt',accent:'#ffffff',surface:'#111111'}}));
  check('preset-bypasses-correction',await page.locator('.bubble').evaluate(e=>getComputedStyle(e).backgroundColor)==='rgb(34, 34, 34)');
  await page.evaluate(()=>window.__codexCustomAccent.update({dark:{accentSource:'custom',accent:'#3a83f7',surface:'#111111'}}));
  check('runtime-color-mismatch-stays-native',!(await page.evaluate(()=>window.__codexCustomAccent.snapshot())).applied);
  await page.evaluate(()=>{document.documentElement.style.setProperty('--codex-base-accent','#3a83f7');window.__codexCustomAccent.update({dark:{accentSource:'custom',accent:'#3a83f7',surface:'#111111'}});});
  check('snapshot-probes-native-and-restores-patch',await page.evaluate(()=>{const s=window.__codexCustomAccent.snapshot();return s.native['--color-background-composer-primary']==='#ffffff'&&s.current['--color-background-composer-primary']==='#3a83f7';}));
  check('repeated-install-is-idempotent',await page.evaluate(source)===false&&await page.locator('#codex-hud-custom-accent').count()===1);
  await page.evaluate(()=>window.__codexCustomAccent.update(null));
  check('invalid-config-removes-override',await page.locator('#codex-hud-custom-accent').count()===0);
  await page.evaluate(()=>window.__codexCustomAccent.remove());
  check('remove-cleans-api-and-restores-native',await page.evaluate(()=>!window.__codexCustomAccent&&!document.getElementById('codex-hud-custom-accent')&&getComputedStyle(document.querySelector('.bubble')).backgroundColor==='rgb(34, 34, 34)'));
  console.log(JSON.stringify({scope:'synthetic Edge accent rendering',passed:results.length,results}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
