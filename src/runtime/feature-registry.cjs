const fs=require('node:fs'),path=require('node:path');
const generated=path.join(__dirname,'../generated');

// Entries use source stems; the artifact and page API names are stable contracts.
const features=[
  {key:'workspaceTree',entry:'workspace-tree/workspace-tree',file:'workspace-tree',global:'__codexWorkspaceTree',
    load(context,source){
      const {createWorkspaceActions}=require('../features/workspace-tree/host/native-actions.cjs');
      const {workspaceTreeSource}=require('../features/workspace-tree/host/page-source.cjs');
      const {settings,desktopPid}=context;
      return {source:workspaceTreeSource({codexHome:settings.codexHome},source),host:createWorkspaceActions(settings,{desktopPid})};
    }},
  {key:'sorting',entry:'reading/table-sort',file:'table-sort',global:'__codexTableSort'},
  {key:'accent',entry:'appearance/custom-accent',file:'custom-accent',global:'__codexCustomAccent',
    load({settings},source){
      const {createThemeReader}=require('../features/appearance/host/chrome-theme.cjs');
      return {source,host:createThemeReader(path.join(settings.codexHome,'config.toml'))};
    }},
  {key:'files',entry:'file-changes/file-changes',file:'file-changes',global:'__codexFileChanges'},
  {key:'reading',entry:'reading/reading-width',file:'reading-width',global:'__codexReadingWidth'},
  {key:'hud',entry:'statistics/composer-strip',file:'statistics',global:'__codexComposerHud',
    load(context,source){
      const {formatMetrics}=require('../features/statistics/host/metrics-view.cjs');
      const {readBinding}=require('../features/statistics/host/chat-binding.cjs');
      return {source,host:{formatMetrics,readBinding}};
    }},
  {key:'fold',entry:'composer-fold/composer-fold',file:'composer-fold',global:'__codexComposerFold'},
  {key:'aiRename',entry:'ai-rename/ai-rename',file:'ai-rename',global:'__codexAiRename',
    load({settings,mainPage},source){
      const {createAiRenameManager}=require('../features/ai-rename/host/ai-rename.cjs');
      const {listDesktopRenameTargets,setDesktopThreadTitle,setThreadTitle}=require('../features/ai-rename/host/thread-title-api.cjs');
      const manager=createAiRenameManager({settings,applyTitle:async options=>{
        const page=mainPage();
        if(!page||!await setDesktopThreadTitle(page,options))await setThreadTitle(options);
      }});
      return {source,host:{manager,listDesktopRenameTargets,setDesktopThreadTitle}};
    }},
  {key:'commands',entry:'command-menu/command-menu',file:'commands',global:'__codexCommandMenu',hostFile:'command-catalog.cjs',
    load({settings},source){
      const {createPromptReader}=require('../features/command-menu/host/prompt-directory.cjs');
      const catalog=require('../generated/host/command-catalog.cjs');
      for(const name of ['normalize','normalizeSkillVisible','normalizeSectionOrder','normalizeGroupOrder','normalizeItemOrder']){
        if(typeof catalog[name]!=='function')throw TypeError('Invalid command catalog');
      }
      return {source,host:{readPrompts:createPromptReader(settings.codexHome),catalog}};
    }},
];
const pageModules=features.map(feature=>feature.global);
const pageGlobals=Object.fromEntries(features.map(feature=>[feature.key,feature.global]));
const readUi=file=>fs.readFileSync(path.join(generated,'ui',file+'.js'),'utf8');

function loadFeatures(context){
  const sources={},hosts={};
  for(const feature of features){
    try{
      const source=readUi(feature.file);
      if(feature.load){
        const loaded=feature.load(context,source);
        sources[feature.key]=loaded.source;
        hosts[feature.key]=loaded.host;
      }else sources[feature.key]=source;
    }catch{/* Do not start a partially loaded feature or block its peers. */}
  }
  return {sources,hosts};
}

module.exports={features,pageModules,pageGlobals,readUi,loadFeatures};
