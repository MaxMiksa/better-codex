const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{test}=require('node:test');
const {spawnSync}=require('node:child_process'),{ROOT,powerShell}=require('../../src/platform/paths.cjs');
const i18n=require('../../src/platform/i18n/localization.cjs'),catalog=require('../../src/platform/i18n/messages.json');
const work=process.argv[2];fs.mkdirSync(work,{recursive:true});
function run(file,args,env){
  const result=spawnSync(file,args,{env:{...process.env,...env},cwd:work,windowsHide:true,encoding:'utf8',timeout:12000});
  if(result.error)throw result.error;assert.equal(result.status,0,result.stdout+result.stderr);
  return result.stdout.replace(/^\uFEFF/,'').trim();
}
test('catalog parity, text and substitutions',()=>{
  assert.deepEqual(Object.keys(catalog.en).sort(),Object.keys(catalog['zh-CN']).sort());
  for(const [key,en] of Object.entries(catalog.en)){
    const zh=catalog['zh-CN'][key],tokens=text=>[...text.matchAll(/\{\w+\}/g)].map(m=>m[0]).sort();
    assert.ok(en.trim()&&zh.trim(),key);assert.deepEqual(tokens(en),tokens(zh),key);
  }
});
test('PowerShell, Node, and native launcher agree on English and Simplified Chinese overrides',()=>{
  const script=path.join(work,'loc.ps1'),native=path.join(work,'loc.exe'),cs=path.join(work,'loc.cs');
  fs.writeFileSync(script,". $env:BC_I18N\n@{locale=$script:BetterCodexLanguage;message=(Get-BetterCodexText 'install.complete')} | ConvertTo-Json -Compress\n");
  fs.writeFileSync(cs,'using System; class Fixture { static void Main(string[] a) { Console.OutputEncoding = new System.Text.UTF8Encoding(false); Console.WriteLine(BetterCodexI18n.Language()); Console.WriteLine(BetterCodexI18n.Text(a[0], "install.complete")); } }');
  const csc=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  run(csc,['/nologo','/r:System.Web.Extensions.dll','/out:'+native,cs,path.join(ROOT,'src/platform/i18n/NativeI18n.cs')]);
  const old=process.env.BETTER_CODEX_LANGUAGE;
  try{for(const locale of ['en','zh-CN','auto']){
    process.env.BETTER_CODEX_LANGUAGE=locale;
    const expected=i18n.language(),message=catalog[expected]['install.complete'];
    const actual=JSON.parse(run(powerShell(),['-NoProfile','-ExecutionPolicy','Bypass','-File',script],{BC_I18N:path.join(ROOT,'src/platform/i18n/i18n.ps1')}));
    assert.equal(actual.locale,expected);assert.equal(actual.message,message);
    assert.deepEqual(run(native,[ROOT]).split(/\r?\n/),[expected,message]);
    assert.equal(i18n.text('install.complete'),message);
    assert.equal(run(process.execPath,['--no-warnings=ExperimentalWarning',path.join(ROOT,'src/app/portable-bootstrap.cjs'),'--help']),catalog[expected]['portable.help']);
  }}finally{if(old===undefined)delete process.env.BETTER_CODEX_LANGUAGE;else process.env.BETTER_CODEX_LANGUAGE=old;}
});
