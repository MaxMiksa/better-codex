// Page-only view. Receives whitelisted metadata; never reads the editor or messages.
(() => {
  if (window.__codexComposerHud) return false;
  const i18n=window.__codexHudI18n;
  const t=(key,values)=>i18n.t(key,values);
  const METRIC_KEYS=['ttft','speed','cache','age'];
  const commandMenu=()=>window.__codexCommandMenu;
  const commandCatalog=commandMenu()?.catalog;
  const normalizeCommands=value=>commandCatalog?.normalize(value)||{};
  const normalizeCommandGroups=value=>commandCatalog?.normalizeGroupOrder(value)||[];
  const normalizeCommandItems=value=>commandCatalog?.normalizeItemOrder(value)||{};
  const normalizeSkills=value=>commandCatalog?.normalizeSkillVisible?.(value)||{};
  const normalizeCommandSections=value=>commandCatalog?.normalizeSectionOrder?.(value)||['commands','skills'];
  const COMPOSER_FOLD_MODES=['off','minimize','hide'];
  const TABLE_SORT_MODES=['smart','ascending','descending'];
  const DEFAULT_METRIC_ORDER=[...METRIC_KEYS];
  const DEFAULT_METRIC_VISIBLE=Object.fromEntries(METRIC_KEYS.map(key=>[key,true]));
  const DEFAULT_PREFERENCES={readingWidth:1152,assistantFontSize:null,chatTitleCentered:true,composerAutoHide:'off',composerHideAfterSend:false,fileChangesDefaultCollapsed:true,customAccent:true,tableEnabled:true,tableCentered:true,tableSortMode:'smart',commandMenuEnabled:true,commandVisible:normalizeCommands(),skillVisible:normalizeSkills(),commandSectionOrder:normalizeCommandSections(),commandGroupOrder:normalizeCommandGroups(),commandItemOrder:normalizeCommandItems(),metricOrder:[...DEFAULT_METRIC_ORDER],metricVisible:{...DEFAULT_METRIC_VISIBLE}};
  const host=document.createElement('div');
  host.id='codex-composer-hud';
  host.style.cssText='position:fixed;width:max-content;pointer-events:none;z-index:20;transform:translateX(-50%);color:var(--color-text-tertiary,#a8a8a8);';
  const shadow=host.attachShadow({mode:'open'});
  shadow.innerHTML=`<style>
    :host{--ui-accent:var(--codex-base-accent,var(--color-background-composer-primary,#8ab4f8));--ui-accent-contrast:#101114;--ui-border:var(--color-border,#3f3f46);--ui-surface:var(--color-surface,#1c1c1f);--ui-raised:var(--color-background-secondary,#27272a);--ui-text:var(--color-text,#f4f4f5);--ui-track:color-mix(in srgb,var(--ui-text) 18%,transparent);--ui-line:2px;--font-title:1.5em;--font-heading:1.25em;--font-body:1em;--font-compact:.9em;--panel-inline:18px}
    *{box-sizing:border-box}section{display:flex;align-items:center;justify-content:center;white-space:nowrap}
    #metrics{display:flex;align-items:center;gap:6px;padding:0;margin:0;border:0;background:none;color:inherit;font:inherit;letter-spacing:inherit;cursor:pointer;pointer-events:auto}
    #metrics .metric{display:inline-flex;align-items:center;min-width:0}#metrics .metric[hidden]{display:none}
    #metrics .metric:not(.first)::before{content:'·';margin-right:6px}
    #metrics:focus-visible{outline:2px solid currentColor;outline-offset:4px;border-radius:3px}
    #settings-panel{position:absolute;bottom:calc(100% + 12px);left:50%;transform:translateX(-50%);width:min(360px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;overscroll-behavior:contain;padding:0;border:var(--ui-line) solid var(--ui-border);border-radius:20px;background:var(--ui-surface);color:var(--ui-text);box-shadow:0 18px 60px #0007;pointer-events:auto;font-size:inherit;line-height:1.35;scrollbar-width:thin;scrollbar-color:var(--ui-border) transparent}
    #settings-panel[hidden]{display:none}
    .panel-header{position:sticky;top:0;z-index:2;background:var(--ui-surface);display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;padding:18px var(--panel-inline) 14px;border-bottom:var(--ui-line) solid var(--ui-border)}
    .panel-title{margin:0;font-size:var(--font-title);font-weight:650;letter-spacing:-.02em;line-height:1.15}
    .panel-toolbar{display:flex;align-items:center;gap:4px;min-width:0}.save-state{display:inline-flex;align-items:center;gap:4px;height:30px;padding:0 2px;font-size:var(--font-compact);font-weight:550;white-space:nowrap}
    .icon{width:16px;height:16px;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.save-spinner{display:none}.save-state[data-state="pending"] .save-check{display:none}.save-state[data-state="pending"] .save-spinner{display:block;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
    .toolbar-button{display:grid;place-items:center;width:30px;height:30px;padding:0;border:0;border-radius:7px;background:transparent;color:var(--ui-text);cursor:pointer}.toolbar-button:hover{background:color-mix(in srgb,var(--ui-text) 9%,transparent)}.toolbar-button:disabled{opacity:.35;cursor:default}.toolbar-button:focus-visible{outline:2px solid var(--ui-accent);outline-offset:2px}.toolbar-button[data-variant="restore"]{color:#f5b942}
    .panel-content{display:grid;grid-template-columns:minmax(0,1fr);padding:16px var(--panel-inline) 18px;row-gap:16px}.width-block{display:grid;row-gap:8px}
    .setting-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:14px;min-height:30px}.setting-label{font-size:var(--font-body);font-weight:550;line-height:1.25;min-width:0}
    .fold-setting{display:flex;flex-wrap:wrap;column-gap:8px;row-gap:6px;white-space:nowrap}
    .fold-segments{position:relative;display:grid;grid-auto-flow:column;grid-auto-columns:max-content;isolation:isolate;padding:3px;margin-inline-start:auto;border:1px solid var(--ui-border);border-radius:10px;background:var(--ui-raised)}
    .fold-segments::before{content:'';position:absolute;z-index:-1;inset:3px auto 3px 0;width:var(--fold-width,0px);border-radius:7px;background:var(--ui-accent);transform:translateX(var(--fold-offset,0px));transition:width .16s ease,transform .16s ease}
    .fold-segments label{position:relative;cursor:pointer;min-width:0}.fold-segments input{position:absolute;opacity:0;width:1px;height:1px}
    .fold-segments span{display:grid;place-items:center;min-height:26px;padding:0 5px;text-align:center;border-radius:7px;font-size:var(--font-compact);font-weight:600;line-height:1.15}
    .fold-segments input:checked+span{color:var(--ui-accent-contrast)}.fold-segments input:focus-visible+span{outline:2px solid var(--ui-text);outline-offset:-2px}
    @media(prefers-reduced-motion:reduce){.fold-segments::before{transition:none}}
    .width-field{display:flex;align-items:center;gap:5px;height:32px;padding:0 8px;border:var(--ui-line) solid var(--ui-border);border-radius:8px;background:transparent}
    .width-field input{width:4.1em;border:0;outline:0;background:transparent;color:var(--ui-text);font:inherit;font-size:var(--font-body);font-weight:550;text-align:right;font-variant-numeric:tabular-nums;appearance:textfield}.width-field input::-webkit-inner-spin-button,.width-field input::-webkit-outer-spin-button{appearance:none;margin:0}.width-field .unit{font-size:var(--font-compact);font-weight:550}
    .font-field input{width:5.25em}.font-field input:placeholder-shown + .unit{display:none}.font-field:focus-within{outline:2px solid var(--ui-accent);outline-offset:2px}
    .ui-slider{--range-progress:50%;display:block;width:100%;height:24px;margin:0;background:transparent;color:var(--ui-accent);cursor:ew-resize;appearance:none}
    .ui-slider::-webkit-slider-runnable-track{height:5px;border-radius:999px;background:linear-gradient(to right,var(--ui-accent) 0 var(--range-progress),var(--ui-track) var(--range-progress) 100%)}
    .ui-slider::-webkit-slider-thumb{appearance:none;width:17px;height:17px;margin-top:-6px;border:0;border-radius:50%;background:var(--ui-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--ui-surface) 82%,transparent)}
    .ui-slider:focus-visible{outline:2px solid var(--ui-accent);outline-offset:4px;border-radius:8px}.range-scale{display:flex;justify-content:space-between;font-size:var(--font-compact);font-weight:550;font-variant-numeric:tabular-nums}
    .separator{height:var(--ui-line);background:var(--ui-border)}.toggle-list{display:grid;row-gap:12px}.switch-copy{display:flex;align-items:center;gap:8px;font-size:var(--font-body);font-weight:550;white-space:nowrap}#files-default-copy{color:var(--color-text-tertiary,#a8a8a8)}
    .table-group{display:grid;row-gap:0}.table-group:has(>.table-panel[data-open="true"]),[data-slash-section]:has(>.table-panel[data-open="true"]){row-gap:12px}.table-toggle{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-width:0;min-height:30px;padding:0;border:0;background:transparent;color:var(--ui-text);font:inherit;text-align:start;cursor:pointer}.table-toggle .icon{transition:transform .16s ease}.table-toggle[aria-expanded="true"] .icon{transform:rotate(180deg)}.table-toggle:focus-visible{outline:2px solid var(--ui-accent);outline-offset:4px;border-radius:4px}
    .table-panel{display:grid;grid-template-rows:0fr;opacity:0;visibility:hidden;overflow:hidden;transition:grid-template-rows .16s ease,opacity .12s ease,visibility 0s linear .16s}.table-panel[data-open="true"]{grid-template-rows:1fr;opacity:1;visibility:visible;transition:grid-template-rows .16s ease,opacity .12s ease,visibility 0s}.table-panel-body{display:grid;min-height:0;row-gap:12px;padding-inline-start:14px;overflow:hidden;transition:opacity .14s ease}.table-panel-body[data-disabled="true"]{opacity:.5}
    .command-groups{display:grid;row-gap:14px;padding-inline-start:0}.command-group{display:grid;row-gap:8px}#slash-settings{display:grid;row-gap:12px}.slash-header{display:flex;align-items:center;gap:8px;min-width:0}[data-slash-section]{display:grid;min-width:0}.command-group[data-command-group]{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;column-gap:6px}.command-grip{display:inline-grid;place-items:center;width:16px;height:22px;flex:none;color:var(--color-text-tertiary,#a8a8a8);cursor:grab;border-radius:3px}.command-grip:active{cursor:grabbing}.command-grip:focus-visible{outline:2px solid var(--ui-accent);outline-offset:2px}.command-buttons{overflow-x:auto;scrollbar-width:thin}.command-buttons .command-segment{flex:1 0 auto;gap:4px;padding:0 8px;font-size:var(--font-compact);white-space:nowrap}.command-segment .icon{width:14px;height:14px}.command-segment[data-command-drop]{box-shadow:inset 2px 0 var(--ui-text)}.command-segment[data-command-drop="after"]{box-shadow:inset -2px 0 var(--ui-text)}[data-command-group][data-command-drop],.slash-header[data-command-drop]{box-shadow:0 -2px var(--ui-accent)}[data-command-group][data-command-drop="after"],.slash-header[data-command-drop="after"]{box-shadow:0 2px var(--ui-accent)}.command-dragging{opacity:.5}
    #skill-buttons{display:flex;flex-wrap:wrap;gap:4px}#skill-buttons .ui-toggle-group-item{flex:0 1 auto;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;border:var(--ui-line) solid var(--ui-border);border-radius:8px;padding:0 8px;font-size:var(--font-compact);cursor:pointer}
    .table-sort-row{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:14px}.table-sort-group{min-width:0}.table-sort-group .ui-toggle-group-item{height:32px;padding:0 3px;font-size:var(--font-compact);white-space:nowrap;cursor:pointer}.table-sort-group .ui-toggle-group-item:active{cursor:pointer}
    .ui-switch{position:relative;flex:none;width:44px;height:24px;padding:0;border:var(--ui-line) solid color-mix(in srgb,var(--ui-text) 20%,transparent);border-radius:999px;background:var(--ui-track);cursor:pointer;transition:background-color .16s ease,border-color .16s ease}.ui-switch:disabled,.ui-toggle-group-item:disabled{opacity:.45;cursor:default}
    .ui-switch[data-state="checked"]{border-color:var(--ui-accent);background:var(--ui-accent)}.ui-switch-thumb{position:absolute;top:50%;left:2px;display:block;width:16px;height:16px;transform:translateY(-50%);border-radius:50%;background:var(--ui-text);transition:transform .16s ease,background-color .16s ease}.ui-switch[data-state="checked"] .ui-switch-thumb{transform:translate(20px,-50%);background:var(--ui-accent-contrast)}.ui-switch:focus-visible{outline:2px solid var(--ui-accent);outline-offset:3px}
    .stats-section{display:grid;grid-template-columns:minmax(0,1fr);width:100%;min-width:0}.ui-toggle-group{display:flex;width:100%;min-width:0;overflow:hidden;border:var(--ui-line) solid var(--ui-border);border-radius:10px;background:var(--ui-raised)}
    .ui-toggle-group-item{position:relative;display:flex;align-items:center;justify-content:center;flex:1 1 0;min-width:0;height:35px;padding:0 6px;border:0;border-left:var(--ui-line) solid var(--ui-border);background:transparent;color:var(--ui-text);font:inherit;font-size:var(--font-body);font-weight:600;cursor:grab;user-select:none;transition:background-color .14s ease,color .14s ease,opacity .14s ease}.ui-toggle-group-item:first-child{border-left-color:transparent}.ui-toggle-group-item[data-state="on"]{background:var(--ui-accent);color:var(--ui-accent-contrast)}.ui-toggle-group-item:active{cursor:grabbing}.ui-toggle-group-item.dragging{opacity:.5}.ui-toggle-group-item[data-drag-over="true"]{box-shadow:inset 0 0 0 2px var(--ui-accent)}.ui-toggle-group-item:focus-visible{outline:2px solid var(--ui-accent);outline-offset:-3px}
    .metric-label{min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center}
    #accent-probe,#surface-probe{position:fixed;width:1px;height:1px;visibility:hidden;pointer-events:none}#accent-probe{background:var(--ui-accent)}#surface-probe{background:var(--ui-surface)}
    @media (max-width:460px){#settings-panel{width:calc(100vw - 16px);border-radius:16px}.panel-header{padding:16px 14px 12px}.panel-content{padding:14px 14px 16px}.ui-toggle-group-item{padding:0 1px}}
  </style>
  <section><button id="metrics" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="settings-panel"></button></section>
  <div id="settings-panel" role="dialog" aria-labelledby="settings-title" aria-modal="false" data-slot="dialog-content" hidden>
    <header class="panel-header"><h2 id="settings-title" class="panel-title"></h2><div class="panel-toolbar">
      <div id="save-state" class="save-state" data-state="saved" aria-live="polite"><svg class="icon save-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg><svg class="icon save-spinner" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg><span id="save-state-text"></span></div>
      <button id="undo" class="toolbar-button" type="button"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/></svg></button>
      <button id="redo" class="toolbar-button" type="button"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13"/></svg></button>
      <button id="restore-defaults" class="toolbar-button" data-variant="restore" type="button"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg></button>
    </div></header>
    <div class="panel-content">
      <div class="width-block"><div class="setting-row"><label id="width-label" class="setting-label" for="width-range"></label><label class="width-field" for="width-number"><input id="width-number" type="number" min="768" max="1600" step="1" value="1152" inputmode="numeric" aria-labelledby="width-label"><span class="unit">px</span></label></div><input id="width-range" class="ui-slider" data-slot="slider" type="range" min="768" max="1600" step="16" value="1152"><div class="range-scale" aria-hidden="true"><span>768</span><span>1600</span></div></div>
      <div class="setting-row"><label id="assistant-font-label" class="setting-label" for="assistant-font-size"></label><div class="width-field font-field"><input id="assistant-font-size" type="text" inputmode="numeric" autocomplete="off"><span class="unit" aria-hidden="true">px</span></div></div>
      <div class="setting-row fold-setting"><span id="composer-fold-label" class="setting-label"></span><div id="composer-fold-mode" class="fold-segments" role="radiogroup" aria-labelledby="composer-fold-label">${COMPOSER_FOLD_MODES.map(mode=>'<label><input type="radio" name="composer-fold" value="'+mode+'"><span></span></label>').join('')}</div></div>
      <div class="setting-row"><span id="fold-after-send-label" class="setting-label"></span><button id="fold-after-send" class="ui-switch" data-slot="switch" type="button" role="switch" aria-checked="false" aria-labelledby="fold-after-send-label"><span class="ui-switch-thumb"></span></button></div>
      <div class="separator" role="separator"></div>
      <div class="toggle-list">
        <div class="setting-row"><span id="chat-title-centered-label" class="setting-label"></span><button id="chat-title-centered" class="ui-switch" data-slot="switch" type="button" role="switch" aria-checked="true" aria-labelledby="chat-title-centered-label"><span class="ui-switch-thumb"></span></button></div>
        <div class="table-group"><div class="setting-row"><button id="table-toggle" class="table-toggle" type="button" aria-expanded="false" aria-controls="table-options"><span id="table-label" class="setting-label"></span><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button><button id="table-enabled" class="ui-switch" data-slot="switch" type="button" role="switch" aria-checked="true" aria-labelledby="table-label"><span class="ui-switch-thumb"></span></button></div><div id="table-options" class="table-panel" data-open="false" aria-hidden="true" inert><div class="table-panel-body"><div class="setting-row"><span id="table-centered-label" class="setting-label"></span><button id="table-centered" class="ui-switch" data-slot="switch" type="button" role="switch" aria-checked="true" aria-labelledby="table-centered-label"><span class="ui-switch-thumb"></span></button></div><div class="table-sort-row"><span id="table-sort-label" class="setting-label"></span><div id="table-sort-group" class="ui-toggle-group table-sort-group" data-slot="segmented-control" role="radiogroup"><button class="ui-toggle-group-item" data-slot="segmented-control-item" type="button" role="radio" aria-checked="true" data-table-sort-mode="smart"></button><button class="ui-toggle-group-item" data-slot="segmented-control-item" type="button" role="radio" aria-checked="false" data-table-sort-mode="ascending"></button><button class="ui-toggle-group-item" data-slot="segmented-control-item" type="button" role="radio" aria-checked="false" data-table-sort-mode="descending"></button></div></div></div></div></div><div id="slash-group" class="table-group"><div class="setting-row"><button id="slash-toggle" class="table-toggle" type="button" aria-expanded="false" aria-controls="slash-options"><span id="slash-label" class="setting-label"></span><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button><button id="command-enabled" class="ui-switch" data-slot="switch" type="button" role="switch" aria-checked="true" aria-label=""><span class="ui-switch-thumb"></span></button></div><div id="slash-options" class="table-panel" data-open="false" aria-hidden="true" inert><div id="slash-settings" class="table-panel-body"><div id="command-settings" data-slash-section="commands"><div class="slash-header"><button id="command-toggle" class="table-toggle" type="button" aria-expanded="false" aria-controls="command-options"><span id="command-label" class="setting-label"></span><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button></div><div id="command-options" class="table-panel" data-open="false" aria-hidden="true" inert><div id="command-options-body" class="table-panel-body command-groups"></div></div></div><div data-slash-section="skills"><div class="slash-header"><button id="skill-toggle" class="table-toggle" type="button" aria-expanded="false" aria-controls="skill-options"><span id="skill-label" class="setting-label"></span><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button></div><div id="skill-options" class="table-panel" data-open="false" aria-hidden="true" inert><div class="table-panel-body"><div id="skill-buttons" role="group" aria-labelledby="skill-label"></div></div></div></div></div></div></div><div class="setting-row"><span id="files-default-label" class="setting-label"></span><div class="switch-copy"><span id="files-default-copy"></span><button id="files-default" class="ui-switch" data-slot="switch" type="button" role="switch" aria-checked="true" aria-labelledby="files-default-label files-default-copy"><span class="ui-switch-thumb"></span></button></div></div><div class="setting-row"><span id="accent-label" class="setting-label"></span><button id="accent-toggle" class="ui-switch" data-slot="switch" type="button" role="switch" aria-checked="true" aria-labelledby="accent-label"><span class="ui-switch-thumb"></span></button></div></div>
      <div class="separator" role="separator"></div>
      <section class="stats-section"><div id="metric-group" class="ui-toggle-group" data-slot="toggle-group" role="group"></div></section>
    </div>
  </div><span id="accent-probe" aria-hidden="true"></span><span id="surface-probe" aria-hidden="true"></span>`;
  const metrics=shadow.querySelector('#metrics'),panel=shadow.querySelector('#settings-panel'),title=shadow.querySelector('#settings-title'),saveState=shadow.querySelector('#save-state'),saveStateText=shadow.querySelector('#save-state-text');
  const undoButton=shadow.querySelector('#undo'),redoButton=shadow.querySelector('#redo'),restoreButton=shadow.querySelector('#restore-defaults');
  const widthLabel=shadow.querySelector('#width-label'),widthRange=shadow.querySelector('#width-range'),widthNumber=shadow.querySelector('#width-number');
  const assistantFontLabel=shadow.querySelector('#assistant-font-label'),assistantFontInput=shadow.querySelector('#assistant-font-size');
  const foldLabel=shadow.querySelector('#composer-fold-label'),foldControl=shadow.querySelector('#composer-fold-mode'),foldOptions=[...foldControl.querySelectorAll('input')];
  const foldAfterSendLabel=shadow.querySelector('#fold-after-send-label'),foldAfterSend=shadow.querySelector('#fold-after-send');
  const filesDefaultLabel=shadow.querySelector('#files-default-label'),filesDefaultCopy=shadow.querySelector('#files-default-copy'),filesDefault=shadow.querySelector('#files-default');
  const accentLabel=shadow.querySelector('#accent-label'),accentToggle=shadow.querySelector('#accent-toggle');
  const tableLabel=shadow.querySelector('#table-label'),tableToggle=shadow.querySelector('#table-toggle'),tableOptions=shadow.querySelector('#table-options'),tableEnabled=shadow.querySelector('#table-enabled'),tableOptionsBody=tableOptions.querySelector('.table-panel-body');
  const chatTitleCenteredLabel=shadow.querySelector('#chat-title-centered-label'),chatTitleCentered=shadow.querySelector('#chat-title-centered');
  const tableCenteredLabel=shadow.querySelector('#table-centered-label'),tableCentered=shadow.querySelector('#table-centered');
  const tableSortLabel=shadow.querySelector('#table-sort-label'),tableSortGroup=shadow.querySelector('#table-sort-group'),tableSortButtons=[...tableSortGroup.querySelectorAll('[data-table-sort-mode]')];
  const commandEnabled=shadow.querySelector('#command-enabled'),commandToggle=shadow.querySelector('#command-toggle'),commandOptions=shadow.querySelector('#command-options'),commandBody=shadow.querySelector('#command-options-body');
  const skillButtons=shadow.querySelector('#skill-buttons'),skillToggle=shadow.querySelector('#skill-toggle'),skillOptions=shadow.querySelector('#skill-options'),slashSettings=shadow.querySelector('#slash-settings');
  const slashSections=Object.fromEntries([...slashSettings.children].map(section=>[section.dataset.slashSection,section]));
  const slashToggle=shadow.querySelector('#slash-toggle'),slashOptions=shadow.querySelector('#slash-options');
  let slashExpanded=false,skillExpanded=false;
  let skillSignature='',commandExpanded=false,commandSignature='',commandDrag=null,commandSuppressClickUntil=0;
  const commandIcons={new:'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z',rename:'m16 3 5 5-13 13H3v-5Z M14 5l5 5',archive:'M3 3h18v4H3z M5 7v14h14V7 M10 11h4',side:'M3 3h18v18H3z M9 3v18',fork:'M6 3v12a6 6 0 0 0 12 0V9 M3 3h6 M15 9h6',compact:'M8 3H3v5 M3 3l6 6 M16 21h5v-5 M21 21l-6-6',init:'m12 3 9 5v8l-9 5-9-5V8Z M3 8l9 5 9-5 M12 13v8','review-mode':'m8 6-6 6 6 6 M16 6l6 6-6 6'};
  const metricGroup=shadow.querySelector('#metric-group');
  const metricNodes=Object.fromEntries(METRIC_KEYS.map(key=>{const node=document.createElement('span');node.className='metric';node.dataset.metricKey=key;return [key,node];}));
  metrics.append(...DEFAULT_METRIC_ORDER.map(key=>metricNodes[key]));
  let settings={...DEFAULT_PREFERENCES,metricOrder:[...DEFAULT_METRIC_ORDER],metricVisible:{...DEFAULT_METRIC_VISIBLE}};
  let metricOrder=[...DEFAULT_METRIC_ORDER],metricVisible={...DEFAULT_METRIC_VISIBLE},metricValues={ttft:'-s',speed:'- tok/s',cache:'-%',age:''};
  let pendingSettings=null,settingsRevision=0,groupSignature='',dragSource='',suppressClickUntil=0,compactMetrics=false,widthEditing=false,widthCancel=false,assistantFontEditing=false,tableExpanded=false;
  let historyReady=false,past=[],future=[];
  const clampWidth=value=>Math.max(768,Math.min(1600,Math.round(Number(value))));
  const isAssistantFontSize=value=>value===null||(Number.isInteger(value)&&value>=10&&value<=40);
  const normalizeOrder=value=>{const seen=new Set(),order=[];for(const key of Array.isArray(value)?value:[]){if(METRIC_KEYS.includes(key)&&!seen.has(key)){seen.add(key);order.push(key);}}for(const key of DEFAULT_METRIC_ORDER)if(!seen.has(key))order.push(key);return order;};
  const normalizeVisible=value=>{const visible=Object.fromEntries(METRIC_KEYS.map(key=>[key,value?.[key]!==false]));if(!METRIC_KEYS.some(key=>visible[key]))visible.ttft=true;return visible;};
  const normalizePreferences=value=>{const next={...settings,...value};next.readingWidth=Number.isInteger(value?.readingWidth)&&value.readingWidth>=768&&value.readingWidth<=1600?clampWidth(value.readingWidth):settings.readingWidth;next.assistantFontSize=isAssistantFontSize(value?.assistantFontSize)?value.assistantFontSize:settings.assistantFontSize;next.chatTitleCentered=typeof value?.chatTitleCentered==='boolean'?value.chatTitleCentered:settings.chatTitleCentered;next.composerAutoHide=COMPOSER_FOLD_MODES.includes(value?.composerAutoHide)?value.composerAutoHide:settings.composerAutoHide;next.composerHideAfterSend=typeof value?.composerHideAfterSend==='boolean'?value.composerHideAfterSend:settings.composerHideAfterSend;next.fileChangesDefaultCollapsed=typeof value?.fileChangesDefaultCollapsed==='boolean'?value.fileChangesDefaultCollapsed:settings.fileChangesDefaultCollapsed;next.customAccent=typeof value?.customAccent==='boolean'?value.customAccent:settings.customAccent;next.tableEnabled=typeof value?.tableEnabled==='boolean'?value.tableEnabled:typeof value?.tableOptimization==='boolean'?value.tableOptimization:settings.tableEnabled;next.tableCentered=typeof value?.tableCentered==='boolean'?value.tableCentered:settings.tableCentered;next.tableSortMode=TABLE_SORT_MODES.includes(value?.tableSortMode)?value.tableSortMode:settings.tableSortMode;next.commandMenuEnabled=typeof value?.commandMenuEnabled==='boolean'?value.commandMenuEnabled:settings.commandMenuEnabled;next.commandVisible=normalizeCommands(value?.commandVisible??settings.commandVisible);next.skillVisible=normalizeSkills(value?.skillVisible??settings.skillVisible);next.commandSectionOrder=normalizeCommandSections(value?.commandSectionOrder??settings.commandSectionOrder);next.commandGroupOrder=normalizeCommandGroups(value?.commandGroupOrder??settings.commandGroupOrder);next.commandItemOrder=normalizeCommandItems(value?.commandItemOrder??settings.commandItemOrder);next.metricOrder=normalizeOrder(value?.metricOrder??settings.metricOrder);next.metricVisible=normalizeVisible(value?.metricVisible??settings.metricVisible);return next;};
  const preferenceSnapshot=()=>({readingWidth:settings.readingWidth,assistantFontSize:settings.assistantFontSize,chatTitleCentered:settings.chatTitleCentered,composerAutoHide:settings.composerAutoHide,composerHideAfterSend:settings.composerHideAfterSend,fileChangesDefaultCollapsed:settings.fileChangesDefaultCollapsed,customAccent:settings.customAccent,tableEnabled:settings.tableEnabled,tableCentered:settings.tableCentered,tableSortMode:settings.tableSortMode,commandMenuEnabled:settings.commandMenuEnabled,commandVisible:{...settings.commandVisible},skillVisible:{...settings.skillVisible},commandSectionOrder:[...settings.commandSectionOrder],commandGroupOrder:[...settings.commandGroupOrder],commandItemOrder:normalizeCommandItems(settings.commandItemOrder),metricOrder:[...metricOrder],metricVisible:{...metricVisible}});
  const samePreferences=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
  function updateRangeProgress(value){widthRange.style.setProperty('--range-progress',String((clampWidth(value)-768)/(1600-768)*100)+'%');}
  function showWidth(value){const next=clampWidth(value);widthRange.value=String(next);if(!widthEditing)widthNumber.value=String(next);widthRange.setAttribute('aria-valuetext',t('pixels',{count:next}));updateRangeProgress(next);}
  function showAssistantFontSize(){if(!assistantFontEditing)assistantFontInput.value=settings.assistantFontSize??'';}
  function colorLuminance(value){const color=String(value).match(/[\d.]+/g)?.slice(0,3).map(Number);if(!color||color.length!==3)return null;return color.map(channel=>{channel/=255;return channel<=.04045?channel/12.92:((channel+.055)/1.055)**2.4;}).reduce((sum,channel,index)=>sum+channel*[.2126,.7152,.0722][index],0);}
  function accentContrast(){const surface=getComputedStyle(shadow.querySelector('#surface-probe')).backgroundColor,luminance=colorLuminance(surface);return luminance!==null&&luminance>.45?'#ffffff':'#000000';}
  function updateAccentContrast(){host.style.setProperty('--ui-accent-contrast',accentContrast());}
  function setSwitch(node,checked){const state=checked?'checked':'unchecked';node.dataset.state=state;node.setAttribute('aria-checked',String(checked));}
  function renderTableSort(){for(const button of tableSortButtons){const active=button.dataset.tableSortMode===settings.tableSortMode;button.dataset.state=active?'on':'off';button.setAttribute('aria-checked',String(active));button.disabled=!settings.tableEnabled;button.tabIndex=active&&settings.tableEnabled?0:-1;}tableSortGroup.setAttribute('aria-disabled',String(!settings.tableEnabled));tableOptionsBody.dataset.disabled=String(!settings.tableEnabled);}
  function renderTableDisclosure(){tableOptions.dataset.open=tableExpanded?'true':'false';tableOptions.setAttribute('aria-hidden',String(!tableExpanded));tableOptions.inert=!tableExpanded;tableToggle.setAttribute('aria-expanded',String(tableExpanded));}
  function commandGrip(kind,id,group,label){
    const grip=document.createElement('span');grip.className='command-grip';grip.draggable=true;grip.tabIndex=0;grip.setAttribute('role','button');grip.dataset.commandDrag=kind;grip.dataset.commandDragId=id;grip.dataset.commandDragGroup=group;grip.setAttribute('aria-label',t('commandReorder',{name:label}));grip.title=t('commandReorder',{name:label});
    grip.innerHTML='<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h.01 M9 12h.01 M9 19h.01 M15 5h.01 M15 12h.01 M15 19h.01" stroke-width="3"/></svg>';return grip;
  }
  function syncCommands(){commandMenu()?.update(settings.commandVisible,{enabled:settings.commandMenuEnabled,groupOrder:settings.commandGroupOrder,itemOrder:settings.commandItemOrder,skillVisible:settings.skillVisible});}
  function renderCommandControls(){
    const extra=commandMenu()?.entries()||[],signature=i18n.locale()+'|'+JSON.stringify(extra.map(item=>[item.id,item.title]))+'|'+JSON.stringify([settings.commandGroupOrder,settings.commandItemOrder]);
    const commandsLabel=t('commandButtons'),skillsLabel=t('commandSkills');
    shadow.querySelector('#command-label').textContent=commandsLabel;
    shadow.querySelector('#skill-label').textContent=skillsLabel;
    shadow.querySelector('#slash-label').textContent=t('commandMenu');
    commandEnabled.setAttribute('aria-label',t('commandMenu'));
    commandEnabled.title=t('commandMenu');
    for(const [id,section] of Object.entries(slashSections)){
      const header=section.firstElementChild,label=id==='commands'?commandsLabel:skillsLabel;
      let grip=header.querySelector('[data-command-drag]');
      if(!grip){grip=commandGrip('section',id,'',label);header.prepend(grip);}
      grip.setAttribute('aria-label',t('commandReorder',{name:label}));grip.title=t('commandReorder',{name:label});
    }
    const first=slashSections[settings.commandSectionOrder[0]];
    if(slashSettings.firstElementChild!==first){
      const focus=shadow.activeElement;
      slashSettings.prepend(first);
      if(first.contains(focus))focus.focus({preventScroll:true});
    }
    if(signature!==commandSignature){
      commandSignature=signature;commandBody.replaceChildren();
      for(const {id:group,items} of commandCatalog?.orderedGroups(settings.commandGroupOrder,settings.commandItemOrder,extra)||[]){
        if(!items.length)continue;
        const section=document.createElement('div');section.className='command-group';section.dataset.commandGroup=group;
        const groupLabel=t(`commandGroup.${group}`);section.append(commandGrip('group',group,group,groupLabel));
        const buttons=document.createElement('div');buttons.className='ui-toggle-group command-buttons';buttons.setAttribute('role','group');buttons.setAttribute('aria-label',groupLabel);section.append(buttons);
        for(const item of items){
          const fullLabel=item.label?t(item.label):item.title,button=document.createElement('button');button.type='button';button.className='ui-toggle-group-item command-segment';button.dataset.commandId=item.id;button.dataset.commandRow=item.id;button.dataset.commandDrag='item';button.dataset.commandDragId=item.id;button.dataset.commandDragGroup=group;button.draggable=true;button.setAttribute('data-slot','toggle-group-item');button.setAttribute('aria-label',fullLabel);button.title=fullLabel;
          if(commandIcons[item.id]){const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('class','icon');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');const path=document.createElementNS(icon.namespaceURI,'path');path.setAttribute('d',commandIcons[item.id]);icon.append(path);button.append(icon);}
          const text=document.createElement('span');text.textContent=item.shortLabel?t(item.shortLabel):fullLabel;button.append(text);buttons.append(button);
        }
        commandBody.append(section);
      }
    }
    for(const button of commandBody.querySelectorAll('[data-command-id]')){const on=settings.commandVisible[button.dataset.commandId]===true;button.dataset.state=on?'on':'off';button.setAttribute('aria-pressed',String(on));}
    renderSkillControls();
    setSwitch(commandEnabled,settings.commandMenuEnabled);
    setDisclosure(slashToggle,slashOptions,slashExpanded);
    setDisclosure(commandToggle,commandOptions,commandExpanded);
    setDisclosure(skillToggle,skillOptions,skillExpanded);
  }
  function setDisclosure(toggle,options,expanded){
    toggle.setAttribute('aria-expanded',String(expanded));options.dataset.open=String(expanded);options.setAttribute('aria-hidden',String(!expanded));options.inert=!expanded;
  }
  function renderSkillControls(){
    if(!slashExpanded||!skillExpanded||panel.hidden)return;
    const entries=commandMenu()?.skillEntries?.(composer())||[],signature=JSON.stringify(entries);
    if(signature!==skillSignature){
      skillSignature=signature;skillButtons.replaceChildren(...entries.map(({id,title})=>{
        const button=document.createElement('button');button.type='button';button.className='ui-toggle-group-item';button.dataset.skillId=id;button.textContent=title;button.title=title;return button;
      }));
    }
    for(const button of skillButtons.children){const on=settings.skillVisible[button.dataset.skillId]!==false;button.dataset.state=on?'on':'off';button.setAttribute('aria-pressed',String(on));}
  }
  function commandCatalogChanged(){renderCommandControls();}
  window.addEventListener('better-codex-command-catalog',commandCatalogChanged);
  function positionFoldHighlight(){
    const segment=foldOptions.find(option=>option.checked)?.parentElement;
    if(!segment?.offsetWidth)return;
    foldControl.style.setProperty('--fold-width',segment.offsetWidth+'px');
    foldControl.style.setProperty('--fold-offset',segment.offsetLeft+'px');
  }
  const foldSize=new ResizeObserver(positionFoldHighlight);
  for(const option of foldOptions)foldSize.observe(option.parentElement);
  let renderedFoldMode;
  function renderFoldControl(){
    if(renderedFoldMode!==settings.composerAutoHide){
      renderedFoldMode=settings.composerAutoHide;
      for(const option of foldOptions)option.checked=option.value===renderedFoldMode;
      positionFoldHighlight();
    }
    foldAfterSend.disabled=settings.composerAutoHide==='off';
    setSwitch(foldAfterSend,settings.composerHideAfterSend);
    window.__codexComposerFold?.update(settings.composerAutoHide,settings.composerHideAfterSend);
  }
  function renderControls(){renderFoldControl();renderCommandControls();showWidth(settings.readingWidth);showAssistantFontSize();setSwitch(chatTitleCentered,settings.chatTitleCentered);setSwitch(filesDefault,settings.fileChangesDefaultCollapsed);setSwitch(accentToggle,settings.customAccent);setSwitch(tableEnabled,settings.tableEnabled);setSwitch(tableCentered,settings.tableCentered);tableCentered.disabled=!settings.tableEnabled;renderTableSort();renderTableDisclosure();}
  function renderSaveState(){const state=saveState.dataset.state==='pending'?'pending':'saved';saveState.dataset.state=state;saveStateText.textContent=t(state==='pending'?'saving':'saved');}
  function renderToolbarState(){undoButton.disabled=!past.length;redoButton.disabled=!future.length;undoButton.setAttribute('aria-label',t('undo'));undoButton.title=t('undo');redoButton.setAttribute('aria-label',t('redo'));redoButton.title=t('redo');restoreButton.setAttribute('aria-label',t('restoreDefaults'));restoreButton.title=t('restoreDefaults');}
  function renderToolbar(){renderSaveState();renderToolbarState();}
  function recordHistory(){if(!historyReady)return;past.push(preferenceSnapshot());if(past.length>50)past.shift();future=[];renderToolbarState();}
  function metricLabel(key){return t({ttft:'metricTtft',speed:'metricTps',cache:'metricCache',age:'metricAge'}[key]);}
  function metricTooltip(key){return t({ttft:'responseTtft',speed:speedMode==='local'?'responseLocalAverage':'responseAverage',cache:'responseCache',age:'responseAge'}[key]);}
  function renderMetricGroup(force=false){const signature=i18n.locale()+'|'+metricOrder.join(',');if(force||signature!==groupSignature){groupSignature=signature;const style=getComputedStyle(metricGroup),canvas=document.createElement('canvas'),context=canvas.getContext('2d');context.font='600 '+style.fontSize+' '+getComputedStyle(host).fontFamily;metricGroup.replaceChildren(...metricOrder.map(key=>{const button=document.createElement('button');button.type='button';button.className='ui-toggle-group-item';button.dataset.slot='toggle-group-item';button.dataset.metricKey=key;button.draggable=true;const label=document.createElement('span');label.className='metric-label';label.textContent=metricLabel(key);const measured=context.measureText(label.textContent).width||label.textContent.length*parseFloat(style.fontSize||'14')*.65;button.style.flexGrow=String(Math.ceil(measured)+20);button.dataset.labelWidth=String(Math.ceil(measured));button.append(label);button.title=metricLabel(key);return button;}));}for(const button of metricGroup.querySelectorAll('[data-metric-key]')){const key=button.dataset.metricKey,on=metricVisible[key];button.dataset.state=on?'on':'off';button.setAttribute('aria-pressed',String(on));button.setAttribute('aria-label',metricLabel(key)+': '+(on?t('metricShown'):t('metricHidden')));}metricGroup.setAttribute('aria-label',t('statsDisplay'));}
  function renderMetrics(){metrics.append(...metricOrder.map(key=>metricNodes[key]));const shown=metricOrder.filter(key=>metricVisible[key]),displayed=compactMetrics?shown.slice(0,2):shown;for(const key of METRIC_KEYS){const node=metricNodes[key],visible=displayed.includes(key);node.hidden=!visible;node.classList.toggle('first',visible&&key===displayed[0]);node.textContent=metricValues[key]||'';node.title=metricTooltip(key);node.dataset.metricKey=key;}metrics.dataset.visibleCount=String(displayed.length);metrics.title=t('openInterfaceSettings');}
  function setCompactMetrics(value){compactMetrics=Boolean(value);renderMetrics();}
  function applyPreferences(value){const previousOrder=metricOrder.join(','),previousVisible=JSON.stringify(metricVisible);settings=normalizePreferences(value);syncCommands();metricOrder=[...settings.metricOrder];metricVisible={...settings.metricVisible};renderControls();renderMetricGroup();if(previousOrder!==metricOrder.join(',')||previousVisible!==JSON.stringify(metricVisible))renderMetrics();window.__codexFileChanges?.setDefaultCollapsed?.(settings.fileChangesDefaultCollapsed);window.__codexReadingWidth?.setTablesEnabled?.(settings.tableEnabled);window.__codexReadingWidth?.setTableCentered?.(settings.tableCentered);window.__codexReadingWidth?.setAssistantFontSize?.(settings.assistantFontSize);window.__codexReadingWidth?.setChatTitleCentered?.(settings.chatTitleCentered);window.__codexTableSort?.setEnabled?.(settings.tableEnabled);window.__codexTableSort?.setDefaultMode?.(settings.tableSortMode);if(!historyReady)historyReady=true;}
  function queueSettings(patch){pendingSettings={value:{...(pendingSettings?.value||{}),...patch},revision:++settingsRevision};saveState.dataset.state='pending';renderSaveState();}
  function changeWidth(value,save){const next=clampWidth(value);if(next===settings.readingWidth)return;if(save)recordHistory();settings.readingWidth=next;showWidth(next);window.__codexReadingWidth?.preview(next);if(save)queueSettings({readingWidth:next});}
  function commitWidthInput(){const raw=widthNumber.value.trim(),value=Number(raw);widthEditing=false;if(!raw||!Number.isInteger(value)||value<768||value>1600){showWidth(settings.readingWidth);return false;}changeWidth(value,true);showWidth(settings.readingWidth);return true;}
  function commitAssistantFontSize(){
    if(!assistantFontEditing)return;
    assistantFontEditing=false;
    const raw=assistantFontInput.value.trim(),value=raw===''?null:/^\d+$/.test(raw)?Number(raw):NaN;
    if(isAssistantFontSize(value)&&value!==settings.assistantFontSize){
      recordHistory();settings.assistantFontSize=value;
      window.__codexReadingWidth?.setAssistantFontSize?.(value);
      queueSettings({assistantFontSize:value});
    }
    showAssistantFontSize();
  }
  function toggleMetric(key){if(Date.now()<suppressClickUntil)return;if(metricVisible[key]&&metricOrder.filter(candidate=>metricVisible[candidate]).length===1){const button=metricGroup.querySelector('[data-metric-key="'+key+'"]');button?.animate([{transform:'translateX(-2px)'},{transform:'translateX(2px)'},{transform:'translateX(0)'}],{duration:160});return;}recordHistory();metricVisible[key]=!metricVisible[key];settings.metricVisible={...metricVisible};renderMetricGroup();renderMetrics();queueSettings({metricVisible:{...metricVisible}});}
  function moveMetric(source,target){if(!source||!target||source===target)return;const next=metricOrder.filter(key=>key!==source),index=next.indexOf(target);if(index<0)return;recordHistory();next.splice(index,0,source);metricOrder=next;settings.metricOrder=[...next];renderMetricGroup(true);renderMetrics();queueSettings({metricOrder:[...next]});}
  function applySnapshot(value){applyPreferences(value);window.__codexReadingWidth?.preview(settings.readingWidth);window.__codexFileChanges?.setDefaultCollapsed?.(settings.fileChangesDefaultCollapsed);queueSettings({...preferenceSnapshot(),metricOrder:[...metricOrder],metricVisible:{...metricVisible}});renderToolbarState();}
  function restoreDefaults(){const defaults={...DEFAULT_PREFERENCES,metricOrder:[...DEFAULT_METRIC_ORDER],metricVisible:{...DEFAULT_METRIC_VISIBLE}};if(samePreferences(preferenceSnapshot(),defaults))return;recordHistory();applySnapshot(defaults);}
  function undo(){if(!past.length)return;future.push(preferenceSnapshot());applySnapshot(past.pop());}
  function redo(){if(!future.length)return;past.push(preferenceSnapshot());applySnapshot(future.pop());}
  function openPanel(){panel.hidden=false;renderSkillControls();metrics.setAttribute('aria-expanded','true');updateAccentContrast();layout();if(!panel.hidden)widthRange.focus({preventScroll:true});}
  function closePanel(focus=false){panel.hidden=true;metrics.setAttribute('aria-expanded','false');if(focus)metrics.focus({preventScroll:true});}
  function togglePanel(){panel.hidden?openPanel():closePanel(true);}
  metrics.addEventListener('pointerdown',event=>{if(event.button!==0||!event.isPrimary)return;event.preventDefault();togglePanel();});
  metrics.addEventListener('click',event=>{if(event.detail===0)togglePanel();});
  widthRange.addEventListener('input',()=>changeWidth(widthRange.value,true));
  widthNumber.addEventListener('focus',()=>{widthEditing=true;widthCancel=false;});
  widthNumber.addEventListener('input',()=>{widthEditing=true;});
  widthNumber.addEventListener('blur',()=>{if(widthCancel){widthCancel=false;widthEditing=false;showWidth(settings.readingWidth);return;}commitWidthInput();});
  widthNumber.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();commitWidthInput();widthNumber.blur();}else if(event.key==='Escape'){event.preventDefault();widthCancel=true;widthEditing=false;showWidth(settings.readingWidth);widthNumber.blur();}});
  assistantFontInput.addEventListener('input',()=>{assistantFontEditing=true;});
  assistantFontInput.addEventListener('blur',commitAssistantFontSize);
  assistantFontInput.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();commitAssistantFontSize();assistantFontInput.blur();}});
  foldControl.addEventListener('change',event=>{
    const mode=event.target.value;
    if(!COMPOSER_FOLD_MODES.includes(mode)||mode===settings.composerAutoHide)return;
    recordHistory();settings.composerAutoHide=mode;renderFoldControl();queueSettings({composerAutoHide:mode});
  });
  foldAfterSend.addEventListener('click',()=>{
    if(settings.composerAutoHide==='off')return;
    recordHistory();settings.composerHideAfterSend=!settings.composerHideAfterSend;
    renderFoldControl();queueSettings({composerHideAfterSend:settings.composerHideAfterSend});
  });
  filesDefault.addEventListener('click',()=>{recordHistory();settings.fileChangesDefaultCollapsed=!settings.fileChangesDefaultCollapsed;setSwitch(filesDefault,settings.fileChangesDefaultCollapsed);window.__codexFileChanges?.setDefaultCollapsed?.(settings.fileChangesDefaultCollapsed);queueSettings({fileChangesDefaultCollapsed:settings.fileChangesDefaultCollapsed});});
  accentToggle.addEventListener('click',()=>{recordHistory();settings.customAccent=!settings.customAccent;setSwitch(accentToggle,settings.customAccent);queueSettings({customAccent:settings.customAccent});});
  tableEnabled.addEventListener('click',()=>{recordHistory();settings.tableEnabled=!settings.tableEnabled;renderControls();window.__codexReadingWidth?.setTablesEnabled?.(settings.tableEnabled);window.__codexReadingWidth?.setTableCentered?.(settings.tableCentered);window.__codexTableSort?.setEnabled?.(settings.tableEnabled);window.__codexTableSort?.setDefaultMode?.(settings.tableSortMode);queueSettings({tableEnabled:settings.tableEnabled});});
  tableToggle.addEventListener('click',()=>{tableExpanded=!tableExpanded;renderTableDisclosure();layout();});
  chatTitleCentered.addEventListener('click',()=>{recordHistory();settings.chatTitleCentered=!settings.chatTitleCentered;setSwitch(chatTitleCentered,settings.chatTitleCentered);window.__codexReadingWidth?.setChatTitleCentered?.(settings.chatTitleCentered);queueSettings({chatTitleCentered:settings.chatTitleCentered});});
  tableCentered.addEventListener('click',()=>{if(!settings.tableEnabled)return;recordHistory();settings.tableCentered=!settings.tableCentered;setSwitch(tableCentered,settings.tableCentered);window.__codexReadingWidth?.setTableCentered?.(settings.tableCentered);queueSettings({tableCentered:settings.tableCentered});});
  tableSortGroup.addEventListener('click',event=>{if(!settings.tableEnabled)return;const button=event.target.closest('[data-table-sort-mode]'),mode=button?.dataset.tableSortMode;if(!TABLE_SORT_MODES.includes(mode)||mode===settings.tableSortMode)return;recordHistory();settings.tableSortMode=mode;renderTableSort();window.__codexTableSort?.setDefaultMode?.(mode);queueSettings({tableSortMode:mode});});
  tableSortGroup.addEventListener('keydown',event=>{if(!settings.tableEnabled||!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const index=tableSortButtons.indexOf(event.target.closest('[data-table-sort-mode]'));if(index<0)return;const direction=event.key==='ArrowRight'?1:-1,next=(index+direction+tableSortButtons.length)%tableSortButtons.length;tableSortButtons[next].focus();tableSortButtons[next].click();});
  commandEnabled.addEventListener('click',()=>{recordHistory();settings.commandMenuEnabled=!settings.commandMenuEnabled;syncCommands();renderCommandControls();queueSettings({commandMenuEnabled:settings.commandMenuEnabled});});
  slashToggle.addEventListener('click',()=>{slashExpanded=!slashExpanded;renderCommandControls();layout();});
  commandToggle.addEventListener('click',()=>{commandExpanded=!commandExpanded;renderCommandControls();layout();});
  skillToggle.addEventListener('click',()=>{skillExpanded=!skillExpanded;renderCommandControls();layout();});
  commandBody.addEventListener('click',event=>{if(Date.now()<commandSuppressClickUntil)return;const button=event.target.closest('[data-command-id]');if(!button)return;recordHistory();settings.commandVisible={...settings.commandVisible,[button.dataset.commandId]:settings.commandVisible[button.dataset.commandId]!==true};syncCommands();renderCommandControls();queueSettings({commandVisible:{...settings.commandVisible}});});
  skillButtons.addEventListener('click',event=>{
    const button=event.target.closest('[data-skill-id]');if(!button)return;
    const id=button.dataset.skillId;recordHistory();
    settings.skillVisible={...settings.skillVisible,[id]:settings.skillVisible[id]===false};
    syncCommands();renderSkillControls();queueSettings({skillVisible:{...settings.skillVisible}});
  });
  function commandSequence(kind,group){return kind==='section'?[...settings.commandSectionOrder]:kind==='group'?[...settings.commandGroupOrder]:(commandCatalog?.orderedGroups(settings.commandGroupOrder,settings.commandItemOrder,commandMenu()?.entries()||[]).find(item=>item.id===group)?.items.map(item=>item.id)||[]);}
  function moveCommand(kind,group,source,target){
    const order=commandSequence(kind,group),from=order.indexOf(source),to=order.indexOf(target);if(from<0||to<0||from===to)return;
    recordHistory();order.splice(from,1);order.splice(to,0,source);
    const patch=kind==='section'?{commandSectionOrder:order}:kind==='group'?{commandGroupOrder:order}:{commandItemOrder:{...settings.commandItemOrder,[group]:order}};
    Object.assign(settings,patch);if(kind!=='section')syncCommands();renderCommandControls();queueSettings(patch);
  }
  function commandDropTarget(event){
    if(!commandDrag)return null;
    if(commandDrag.kind==='section'){
      const target=event.target.closest('[data-slash-section]');
      return target?{node:target.firstElementChild,id:target.dataset.slashSection}:null;
    }
    const section=event.target.closest('[data-command-group]');if(!section)return null;
    if(commandDrag.kind==='group')return {node:section,id:section.dataset.commandGroup};
    const row=event.target.closest('[data-command-row]');return row&&section.dataset.commandGroup===commandDrag.group?{node:row,id:row.dataset.commandRow}:null;
  }
  function clearCommandDrag(){commandDrag=null;for(const node of slashSettings.querySelectorAll('[data-command-drop],.command-dragging')){node.removeAttribute('data-command-drop');node.classList.remove('command-dragging');}}
  slashSettings.addEventListener('dragstart',event=>{const grip=event.target.closest('[data-command-drag]');if(!grip){event.preventDefault();return;}commandDrag={kind:grip.dataset.commandDrag,id:grip.dataset.commandDragId,group:grip.dataset.commandDragGroup};grip.classList.add('command-dragging');event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain','better-codex-command-order');if(commandDrag.kind!=='section')commandSuppressClickUntil=Date.now()+350;});
  slashSettings.addEventListener('dragover',event=>{const target=commandDropTarget(event);if(!target||target.id===commandDrag.id)return;event.preventDefault();event.dataTransfer.dropEffect='move';for(const node of slashSettings.querySelectorAll('[data-command-drop]'))node.removeAttribute('data-command-drop');const order=commandSequence(commandDrag.kind,commandDrag.group);target.node.dataset.commandDrop=order.indexOf(commandDrag.id)<order.indexOf(target.id)?'after':'before';const bounds=panel.getBoundingClientRect();if(event.clientY<bounds.top+36)panel.scrollTop-=12;else if(event.clientY>bounds.bottom-36)panel.scrollTop+=12;});
  slashSettings.addEventListener('drop',event=>{const target=commandDropTarget(event);if(!target)return;event.preventDefault();const source=commandDrag;clearCommandDrag();moveCommand(source.kind,source.group,source.id,target.id);if(source.kind!=='section')commandSuppressClickUntil=Date.now()+350;});
  slashSettings.addEventListener('dragend',clearCommandDrag);
  commandBody.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key)||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;const button=event.target.closest('[data-command-id]');if(!button)return;event.preventDefault();const buttons=[...button.parentElement.children],index=buttons.indexOf(button),next=(index+(event.key==='ArrowLeft'?-1:1)+buttons.length)%buttons.length;buttons[next].focus({preventScroll:true});});
  slashSettings.addEventListener('keydown',event=>{const grip=event.target.closest('[data-command-drag]');if(!grip||!['ArrowUp','ArrowDown'].includes(event.key)||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;event.preventDefault();event.stopPropagation();const kind=grip.dataset.commandDrag,group=grip.dataset.commandDragGroup,id=grip.dataset.commandDragId,order=commandSequence(kind,group),index=order.indexOf(id),target=order[index+(event.key==='ArrowUp'?-1:1)];if(!target)return;moveCommand(kind,group,id,target);[...slashSettings.querySelectorAll('[data-command-drag]')].find(node=>node.dataset.commandDrag===kind&&node.dataset.commandDragId===id)?.focus({preventScroll:true});});
  restoreButton.addEventListener('click',restoreDefaults);undoButton.addEventListener('click',undo);redoButton.addEventListener('click',redo);
  metricGroup.addEventListener('click',event=>{const button=event.target.closest('[data-metric-key]');if(button)toggleMetric(button.dataset.metricKey);});
  metricGroup.addEventListener('dragstart',event=>{const button=event.target.closest('[data-metric-key]');if(!button){event.preventDefault();return;}dragSource=button.dataset.metricKey;button.classList.add('dragging');event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',dragSource);suppressClickUntil=Date.now()+350;});
  metricGroup.addEventListener('dragover',event=>{const button=event.target.closest('[data-metric-key]');if(!button||button.dataset.metricKey===dragSource)return;event.preventDefault();event.dataTransfer.dropEffect='move';for(const node of metricGroup.querySelectorAll('[data-drag-over="true"]'))node.removeAttribute('data-drag-over');button.setAttribute('data-drag-over','true');});
  metricGroup.addEventListener('dragleave',event=>{const button=event.target.closest('[data-metric-key]');if(button&&!button.contains(event.relatedTarget))button.removeAttribute('data-drag-over');});
  metricGroup.addEventListener('drop',event=>{const button=event.target.closest('[data-metric-key]');if(!button)return;event.preventDefault();const source=dragSource||event.dataTransfer.getData('text/plain');moveMetric(source,button.dataset.metricKey);suppressClickUntil=Date.now()+350;});
  metricGroup.addEventListener('dragend',()=>{dragSource='';suppressClickUntil=Date.now()+350;for(const node of metricGroup.querySelectorAll('.dragging,[data-drag-over="true"]')){node.classList.remove('dragging');node.removeAttribute('data-drag-over');}});
  const outside=event=>{if(event.composedPath().includes(host))return;commitWidthInput();commitAssistantFontSize();closePanel();};
  const escape=event=>{if(event.key==='Escape'&&!panel.hidden){event.preventDefault();event.stopPropagation();if(widthEditing){widthCancel=true;widthEditing=false;showWidth(settings.readingWidth);}assistantFontEditing=false;showAssistantFontSize();closePanel(true);}};
  document.addEventListener('pointerdown',outside,true);window.addEventListener('keydown',escape,true);window.addEventListener('keyup',escape,true);window.addEventListener('blur',closeOnBlur);
  function closeOnBlur(){closePanel();}
  let key='',generation=0,updated=0,disposed=false,language='',speedMode='magpie',localizedSpeedMode='';
  function localize(){const next=i18n.locale();if(language===next&&localizedSpeedMode===speedMode)return;language=next;localizedSpeedMode=speedMode;host.lang=next;renderCommandControls();title.textContent=t('interfaceSettings');widthLabel.textContent=t('readingWidth');assistantFontLabel.textContent=t('assistantFontSize');chatTitleCenteredLabel.textContent=t('chatTitleCentered');assistantFontInput.placeholder=t('assistantFontNative');assistantFontInput.title=t('assistantFontSizeHint');assistantFontInput.setAttribute('aria-description',assistantFontInput.title);foldLabel.textContent=t('composerAutoHide');foldAfterSendLabel.textContent=t('composerHideAfterSend');for(const option of foldOptions)option.nextElementSibling.textContent=t(`composerFold.${option.value}`);filesDefaultLabel.textContent=t('fileChangesList');filesDefaultCopy.textContent=t('defaultCollapsed');accentLabel.textContent=t('customAccentFix');tableLabel.textContent=t('table');tableCenteredLabel.textContent=t('tableCentered');tableSortLabel.textContent=t('tableSort');tableSortGroup.setAttribute('aria-label',t('tableSort'));for(const button of tableSortButtons)button.textContent=t({smart:'tableSortSmart',ascending:'tableSortAscendingDefault',descending:'tableSortDescendingDefault'}[button.dataset.tableSortMode]);renderToolbar();showWidth(settings.readingWidth);renderMetricGroup(true);if(!updated)metricValues.age=t('waiting');renderMetrics();}
  let resolved=null,compatibility={status:'pending',reason:'awaiting-chat'},geometryNodes=[];
  const geometryObserver=new ResizeObserver(()=>layout());
  function watchGeometry(root,body,content=[]){const next=[...new Set([root,body,root.closest('[data-app-shell-focus-area]'),...content].filter(Boolean))];if(next.length===geometryNodes.length&&next.every((node,index)=>node===geometryNodes[index]))return;geometryObserver.disconnect();geometryNodes=next;for(const node of geometryNodes)geometryObserver.observe(node);}
  const visible=element=>{const rect=element.getBoundingClientRect();return rect.width>0&&rect.height>0&&getComputedStyle(element).visibility!=='hidden';};
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function refuse(reason){compatibility={status:'pending',reason};return null;}
  function footerContent(body,editor,y,height){
    const rects=[],nodes=[],intersects=rect=>rect.width>0&&rect.height>0&&rect.top<y+height+4&&rect.bottom>y-4;
    function visit(element){
      if(element===editor||element===host||element.matches('textarea,[contenteditable],script,style,template'))return;
      const style=getComputedStyle(element);
      if(style.display==='none'||Number(style.opacity)===0)return;
      const rect=element.getBoundingClientRect(),shown=style.visibility!=='hidden'&&style.visibility!=='collapse';
      // Controls and graphics are atomic; layout wrappers contribute only their contents.
      if(element.matches('button,[role="button"],select,input,svg,img,canvas,video,progress,meter,[role="img"],[role="progressbar"],[role="meter"]')){
        nodes.push(element);if(shown&&intersects(rect))rects.push(rect);return;
      }
      let hasContent=false;
      for(const child of element.childNodes){
        if(child.nodeType===Node.ELEMENT_NODE){hasContent=true;visit(child);}
        else if(child.nodeType===Node.TEXT_NODE){
          hasContent=true;if(!shown)continue;
          const range=document.createRange();range.selectNodeContents(child);
          for(const textRect of range.getClientRects())if(intersects(textRect)){rects.push(textRect);nodes.push(element);}
        }
      }
      if(!hasContent&&shown&&intersects(rect)){
        const painted=style.backgroundImage!=='none'||!['transparent','rgba(0, 0, 0, 0)'].includes(style.backgroundColor)||style.boxShadow!=='none'||['Top','Right','Bottom','Left'].some(side=>parseFloat(style['border'+side+'Width'])>0&&style['border'+side+'Style']!=='none');
        if(painted){rects.push(rect);nodes.push(element);}
      }
    }
    visit(body);return {rects,nodes};
  }
  function composer(){const roots=[...document.querySelectorAll('[data-codex-composer-root]')].filter(element=>visible(element)||window.__codexComposerFold?.hides(element)),main=roots.filter(element=>element.closest('[data-app-shell-focus-area]')?.getAttribute('data-app-shell-focus-area')==='main');if(main.length===1)return main[0];if(!main.length&&roots.length===1&&!roots[0].closest('[data-app-shell-focus-area]'))return roots[0];return refuse('ambiguous-or-missing-composer');}
  function chat(){const root=composer();if(!root)return null;const markers=[...root.querySelectorAll('[data-above-composer-conversation-id]')];if(markers.length){const ids=[...new Set(markers.map(element=>element.getAttribute('data-above-composer-conversation-id')))];if(ids.length!==1)return refuse('ambiguous-composer-chat');const id=ids[0];if(!uuid.test(id||''))return refuse('invalid-composer-chat-id');return {raw:'local:'+id,title:''};}const rows=[...document.querySelectorAll('[data-app-action-sidebar-thread-active="true"]')].filter(visible);if(rows.length!==1)return refuse('ambiguous-or-missing-chat');const row=rows[0],raw=row.getAttribute('data-app-action-sidebar-thread-id')||'';if(row.getAttribute('data-app-action-sidebar-thread-kind')!=='local'||row.getAttribute('data-app-action-sidebar-thread-host-id')!=='local')return refuse('unsupported-chat');return {raw,title:row.getAttribute('data-app-action-sidebar-thread-title')||''};}
  function context(){const selected=chat();if(!selected)return null;const {raw,title}=selected;let id=/^local:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)?raw.slice(6):null;if(!id&&resolved?.raw===raw&&resolved.title===title&&Date.now()-resolved.at<1500)id=resolved.id;if(!id)return refuse('awaiting-persistent-chat-id');const root=composer();if(!root)return null;if(window.__codexComposerFold?.hides(root)){compatibility={status:'compatible',reason:'composer-folded'};return {id,visible:false};}const bodies=[...root.querySelectorAll('[data-composer-body]')].filter(visible);if(bodies.length>1)return refuse('ambiguous-composer-body');const body=bodies[0]||root,bounds=body.getBoundingClientRect();if(root.closest('[data-right-panel-composer-overlay-content="true"]'))return refuse('floating-composer-hidden');const questions=[...root.querySelectorAll('[data-codex-composer-request-navigation]')];if(questions.some(element=>visible(element)&&!element.closest('[aria-hidden="true"],[inert],[data-app-shell-active-page="false"]')))return refuse('question-card-hidden');let editors=[...body.querySelectorAll('[contenteditable="true"],textarea')].filter(visible);const primary=editors.filter(element=>element.getAttribute('data-codex-composer')==='true');if(primary.length)editors=primary;if(editors.length!==1)return refuse('unknown-editor-contract');const buttons=[...body.querySelectorAll('button,[role="button"],select')].filter(visible),controls=buttons.map(element=>element.getBoundingClientRect());if(controls.length<2)return refuse('missing-composer-controls');const bottom=Math.max(...controls.map(rect=>(rect.top+rect.bottom)/2)),rowControls=controls.filter(rect=>Math.abs((rect.top+rect.bottom)/2-bottom)<12),compact=bottom<editors[0].getBoundingClientRect().bottom-3;if(rowControls.length<2||compact&&!editors[0].closest('[data-composer-footer-responsive]'))return refuse('unknown-footer-contract');const x=(bounds.left+bounds.right)/2;const labels=buttons.filter(element=>{const rect=element.getBoundingClientRect();return rect.right>x&&Math.abs((rect.top+rect.bottom)/2-bottom)<12;}).sort((a,b)=>a.getBoundingClientRect().left-b.getBoundingClientRect().left);let reference;for(const button of labels){const walker=document.createTreeWalker(button,NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode())){if(node.textContent.trim().length>1&&/[\p{L}\p{N}]/u.test(node.textContent)&&!node.parentElement.closest('svg')&&visible(node.parentElement)){reference=node.parentElement;break;}}if(reference)break;}if(!reference)return refuse('missing-footer-label-style');const style=getComputedStyle(reference);for(const property of ['fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing'])host.style[property]=style[property];if(!host.isConnected)document.body.append(host);host.style.visibility='hidden';host.hidden=false;setCompactMetrics(false);let size=host.getBoundingClientRect();const edge=Math.max(bounds.bottom,root.getBoundingClientRect().bottom),gap=Math.min(4,Math.max(1,innerHeight-edge-size.height-2)),y=compact?edge+gap:bottom-size.height/2;const hidden=reason=>{refuse(reason);return {id,x,y,visible:false};};if(y<bounds.top||!compact&&y+size.height>bounds.bottom||y+size.height>innerHeight-(compact?1:4)||y<0)return hidden('insufficient-space');const content=footerContent(body,editors[0],y,size.height);watchGeometry(root,body,content.nodes);let spaces=[{left:bounds.left+12,right:bounds.right-12}];for(const rect of content.rects){spaces=spaces.flatMap(space=>{if(rect.left-12>=space.right||rect.right+12<=space.left)return [space];return [{left:space.left,right:Math.min(space.right,rect.left-12)},{left:Math.max(space.left,rect.right+12),right:space.right}].filter(candidate=>candidate.right>candidate.left);});}const fit=()=>spaces.filter(space=>space.right-space.left>=size.width).map(space=>Math.max(space.left+size.width/2,Math.min(x,space.right-size.width/2))).sort((a,b)=>Math.abs(a-x)-Math.abs(b-x));let centers=fit();if(!centers.length){setCompactMetrics(true);size=host.getBoundingClientRect();centers=fit();}if(!centers.length)return hidden('controls-overlap');compatibility={status:'compatible',reason:'composer-contract-passed',placement:compact?'below-composer':'footer'};return {id,x:centers[0],y,visible:true};}
  function clear(){metricValues={ttft:'-s',speed:'- tok/s',cache:'-%',age:t('waiting')};updated=0;speedMode='magpie';renderMetrics();}
  function layout(){if(disposed)return null;localize();const current=context(),next=current?.id||'';if(key!==next){key=next;generation++;clear();closePanel();}if(!current?.visible){host.hidden=true;closePanel();return current;}if(!host.isConnected)document.body.append(host);host.style.left=current.x+'px';host.style.top=current.y+'px';host.style.visibility='visible';host.hidden=false;if(!panel.hidden){const top=host.getBoundingClientRect().top;panel.style.maxHeight=Math.max(120,top-24)+'px';panel.style.marginLeft='0px';const bounds=panel.getBoundingClientRect();panel.style.marginLeft=(bounds.left<12?12-bounds.left:bounds.right>innerWidth-12?innerWidth-12-bounds.right:0)+'px';if(bounds.top<8)closePanel();}return current;}
  const timer=setInterval(()=>{layout();if(updated&&Date.now()-updated>3000)clear();},250);
  const observer=new MutationObserver(records=>{if(records.some(record=>record.target!==host&&!host.contains(record.target)&&(record.type!=='attributes'||!['class','style','hidden'].includes(record.attributeName)||geometryNodes.some(node=>record.target.contains(node)||node.contains(record.target)))))layout();});
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['data-above-composer-conversation-id','data-app-action-sidebar-thread-active','data-app-action-sidebar-thread-id','aria-hidden','inert','class','style','hidden','data-app-shell-active-page','data-app-shell-focus-area','data-codex-composer-request-navigation','data-right-panel-composer-overlay-content']});
  observer.observe(document.documentElement,{attributes:true,attributeFilter:['lang','data-theme']});window.addEventListener('resize',layout);window.addEventListener('languagechange',layout);
  renderControls();renderMetricGroup(true);renderMetrics();renderToolbar();
  window.__codexComposerHud={
    settingsOpen(){return !panel.hidden;},
    settingsRequest(){return pendingSettings;},settingsAck(value){if(value&&pendingSettings?.revision===value.revision){pendingSettings=null;saveState.dataset.state='saved';renderSaveState();}},settingsState(value){applyPreferences({...value,...(pendingSettings?.value||{})});updateAccentContrast();},
    readingRequest(){return Number.isInteger(pendingSettings?.value?.readingWidth)?{value:pendingSettings.value.readingWidth,revision:pendingSettings.revision}:null;},readingAck(value){if(value&&pendingSettings?.revision===value.revision&&pendingSettings.value.readingWidth===value.value){pendingSettings=null;saveState.dataset.state='saved';renderSaveState();window.__codexReadingWidth?.settle(value.value);}},readingState(value){if(!pendingSettings&&Number.isInteger(value?.maxWidth)){settings.readingWidth=clampWidth(value.maxWidth);showWidth(settings.readingWidth);}},
    bindingRequest(){layout();const selected=chat();return selected&&selected.raw.startsWith('local:client-new-thread:')?{...selected,generation}:null;},bind(value){const selected=chat();if(!selected||value.raw!==selected.raw||value.title!==selected.title||value.generation!==generation)return false;resolved={...value,at:Date.now()};layout();return true;},
    snapshot(){const current=layout();return {id:current?.id||null,generation,locale:i18n.locale(),visible:host.isConnected&&!host.hidden,compatibility,metricOrder:[...metricOrder],metricVisible:{...metricVisible},preferences:{...settings,metricOrder:[...metricOrder],metricVisible:{...metricVisible}}};},
    render(value){const current=layout();if(!current||value.id!==current.id||value.generation!==generation||value.locale&&value.locale!==i18n.locale())return false;speedMode=value.speedMode==='local'?'local':'magpie';metricValues={ttft:String(value.ttft??'-s'),speed:String(value.speed??'- tok/s'),cache:String(value.cache??'-%'),age:String(value.age??t('waiting'))};updated=Date.now();localize();renderMetrics();return Boolean(layout()?.visible);},
    remove(){window.removeEventListener('better-codex-command-catalog',commandCatalogChanged);disposed=true;clearInterval(timer);observer.disconnect();geometryObserver.disconnect();foldSize.disconnect();window.removeEventListener('resize',layout);window.removeEventListener('languagechange',layout);window.removeEventListener('blur',closeOnBlur);document.removeEventListener('pointerdown',outside,true);window.removeEventListener('keydown',escape,true);window.removeEventListener('keyup',escape,true);host.remove();delete window.__codexComposerHud;}
  };
  layout();return true;
})()
