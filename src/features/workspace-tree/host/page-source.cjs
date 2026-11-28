const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const paths=require('./windows-paths.cjs');

function workspaceTreeSource({home=os.homedir(),codexHome}={},source){
  const roots=JSON.stringify({home,codexHome});
  const renderer=fs.readFileSync(path.join(__dirname,'../ui/tree-renderer.js'),'utf8');
  return '(()=>{if(window.__codexWorkspaceTree)return;\nconst bcTreeRoots='+roots+';\n'+
    Object.values(paths).join('\n')+'\n'+renderer+'\n;\n'+source+'\n})();';
}

module.exports={workspaceTreeSource};
