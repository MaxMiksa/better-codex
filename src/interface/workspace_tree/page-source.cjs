const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const paths=require('./windows-paths.cjs');

function workspaceTreeSource({home=os.homedir(),codexHome}={}){
  const roots=JSON.stringify({home,codexHome});
  const sources=['tree-renderer.js','workspace-directories.js','workspace-actions.js','workspace-tree.js']
    .map(file=>fs.readFileSync(path.join(__dirname,file),'utf8'));
  return '(()=>{if(window.__codexWorkspaceTree)return;\nconst bcTreeRoots='+roots+';\n'+
    Object.values(paths).join('\n')+'\n'+sources.join('\n;\n')+'\n})();';
}

module.exports={workspaceTreeSource};
