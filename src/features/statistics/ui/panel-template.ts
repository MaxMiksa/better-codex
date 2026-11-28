import panelStyles from './composer-strip.css';

export const COMPOSER_FOLD_STYLES = ['minimize', 'hide'] as const;

export const COMMAND_ICON_PATHS: Record<string, string> = {
  new: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z',
  rename: 'm16 3 5 5-13 13H3v-5Z M14 5l5 5',
  archive: 'M3 3h18v4H3z M5 7v14h14V7 M10 11h4',
  side: 'M3 3h18v18H3z M9 3v18',
  fork: 'M6 3v12a6 6 0 0 0 12 0V9 M3 3h6 M15 9h6',
  compact: 'M8 3H3v5 M3 3l6 6 M16 21h5v-5 M21 21l-6-6',
  init: 'm12 3 9 5v8l-9 5-9-5V8Z M3 8l9 5 9-5 M12 13v8',
  'review-mode': 'm8 6-6 6 6 6 M16 6l6 6-6 6',
};

const CHEVRON_SVG =
  '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

export function createPanelMarkup(): string {
  const foldRadios = COMPOSER_FOLD_STYLES.map(
    (mode) => `<label><input type="radio" name="composer-fold" value="${mode}"><span></span></label>`,
  ).join('');

  return `<style>${panelStyles}</style>
<section>
  <button id="metrics" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="settings-panel"></button>
</section>
<div id="settings-panel" role="dialog" aria-labelledby="settings-title" aria-modal="false" data-slot="dialog-content" hidden>
  <header class="panel-header">
    <h2 id="settings-title" class="panel-title"></h2>
    <div class="panel-toolbar">
      <div id="save-state" class="save-state" data-state="saved" aria-live="polite">
        <svg class="icon save-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
        <svg class="icon save-spinner" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg>
        <span id="save-state-text"></span>
      </div>
      <button id="undo" class="toolbar-button" type="button">
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>
      </button>
      <button id="redo" class="toolbar-button" type="button">
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13"/></svg>
      </button>
      <button id="restore-defaults" class="toolbar-button" data-variant="restore" type="button">
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
      </button>
    </div>
  </header>
  <div class="panel-content">
    <div class="setting-row">
      <label id="assistant-font-label" class="setting-label" for="assistant-font-size"></label>
      <div class="width-field font-field">
        <input id="assistant-font-size" type="text" inputmode="numeric" autocomplete="off">
        <span class="unit" aria-hidden="true">px</span>
      </div>
    </div>
    <div class="width-block">
      <div class="setting-row">
        <label id="width-label" class="setting-label" for="width-range"></label>
        <label class="width-field" for="width-number">
          <input id="width-number" type="number" min="768" max="1600" step="1" value="1152" inputmode="numeric" aria-labelledby="width-label">
          <span class="unit">px</span>
        </label>
      </div>
      <input id="width-range" class="ui-slider" data-slot="slider" type="range" min="768" max="1600" step="16" value="1152">
      <div class="range-scale" aria-hidden="true"><span>768</span><span>1600</span></div>
    </div>
    <div class="separator" role="separator"></div>
    <div class="toggle-list">
      <div class="setting-row">
        <span id="chat-title-centered-label" class="setting-label"></span>
        <button id="chat-title-centered" class="ui-switch" data-slot="switch" type="button" role="switch" aria-checked="true" aria-labelledby="chat-title-centered-label"><span class="ui-switch-thumb"></span></button>
      </div>
      <div class="table-group">
        <div class="setting-row">
          <button id="fold-toggle" class="table-toggle" type="button" aria-expanded="false" aria-controls="fold-options"><span id="fold-group-label" class="setting-label"></span>${CHEVRON_SVG}</button>
          <button id="fold-enabled" class="ui-switch" data-slot="switch" type="button" role="switch" aria-checked="false" aria-labelledby="fold-group-label"><span class="ui-switch-thumb"></span></button>
        </div>
        <div id="fold-options" class="table-panel" data-open="false" aria-hidden="true" inert>
          <div class="table-panel-body" data-disabled="true">
            <div class="setting-row fold-setting">
              <span id="composer-fold-label" class="setting-label"></span>
              <div id="composer-fold-mode" class="fold-segments" role="radiogroup" aria-labelledby="composer-fold-label">${foldRadios}</div>
            </div>
            <div class="setting-row">
              <span id="fold-after-send-label" class="setting-label"></span>
              <button id="fold-after-send" class="ui-switch" data-slot="switch" type="button" role="switch" aria-checked="false" aria-labelledby="fold-after-send-label"><span class="ui-switch-thumb"></span></button>
            </div>
          </div>
        </div>
      </div>
      <div class="setting-row">
        <span id="workspace-tree-label" class="setting-label"></span>
        <button id="workspace-tree-enabled" class="ui-switch" data-slot="switch" type="button" role="switch" aria-checked="true" aria-labelledby="workspace-tree-label"><span class="ui-switch-thumb"></span></button>
      </div>
      <div class="table-group">
        <div class="setting-row">
          <button id="table-toggle" class="table-toggle" type="button" aria-expanded="false" aria-controls="table-options"><span id="table-label" class="setting-label"></span>${CHEVRON_SVG}</button>
          <button id="table-enabled" class="ui-switch" data-slot="switch" type="button" role="switch" aria-checked="true" aria-labelledby="table-label"><span class="ui-switch-thumb"></span></button>
        </div>
        <div id="table-options" class="table-panel" data-open="false" aria-hidden="true" inert>
          <div class="table-panel-body">
            <div class="setting-row">
              <span id="table-centered-label" class="setting-label"></span>
              <button id="table-centered" class="ui-switch" data-slot="switch" type="button" role="switch" aria-checked="true" aria-labelledby="table-centered-label"><span class="ui-switch-thumb"></span></button>
            </div>
            <div class="table-sort-row">
              <span id="table-sort-label" class="setting-label"></span>
              <div id="table-sort-group" class="ui-toggle-group table-sort-group" data-slot="segmented-control" role="radiogroup">
                <button class="ui-toggle-group-item" data-slot="segmented-control-item" type="button" role="radio" aria-checked="true" data-table-sort-mode="smart"></button>
                <button class="ui-toggle-group-item" data-slot="segmented-control-item" type="button" role="radio" aria-checked="false" data-table-sort-mode="ascending"></button>
                <button class="ui-toggle-group-item" data-slot="segmented-control-item" type="button" role="radio" aria-checked="false" data-table-sort-mode="descending"></button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div id="slash-group" class="table-group">
        <div class="setting-row">
          <button id="slash-toggle" class="table-toggle" type="button" aria-expanded="false" aria-controls="slash-options"><span id="slash-label" class="setting-label"></span>${CHEVRON_SVG}</button>
          <button id="command-enabled" class="ui-switch" data-slot="switch" type="button" role="switch" aria-checked="true" aria-label=""><span class="ui-switch-thumb"></span></button>
        </div>
        <div id="slash-options" class="table-panel" data-open="false" aria-hidden="true" inert>
          <div id="slash-settings" class="table-panel-body">
            <div id="command-settings" data-slash-section="commands">
              <div class="slash-header">
                <button id="command-toggle" class="table-toggle" type="button" aria-expanded="false" aria-controls="command-options"><span id="command-label" class="setting-label"></span>${CHEVRON_SVG}</button>
              </div>
              <div id="command-options" class="table-panel" data-open="false" aria-hidden="true" inert>
                <div id="command-options-body" class="table-panel-body command-groups"></div>
              </div>
            </div>
            <div data-slash-section="skills">
              <div class="slash-header">
                <button id="skill-toggle" class="table-toggle" type="button" aria-expanded="false" aria-controls="skill-options"><span id="skill-label" class="setting-label"></span>${CHEVRON_SVG}</button>
              </div>
              <div id="skill-options" class="table-panel" data-open="false" aria-hidden="true" inert>
                <div class="table-panel-body"><div id="skill-buttons" role="group" aria-labelledby="skill-label"></div></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="setting-row">
        <span id="files-default-label" class="setting-label"></span>
        <div class="switch-copy">
          <span id="files-default-copy"></span>
          <button id="files-default" class="ui-switch" data-slot="switch" type="button" role="switch" aria-checked="true" aria-labelledby="files-default-label files-default-copy"><span class="ui-switch-thumb"></span></button>
        </div>
      </div>
      <div class="setting-row">
        <span id="accent-label" class="setting-label"></span>
        <button id="accent-toggle" class="ui-switch" data-slot="switch" type="button" role="switch" aria-checked="true" aria-labelledby="accent-label"><span class="ui-switch-thumb"></span></button>
      </div>
    </div>
    <div class="separator" role="separator"></div>
    <section class="stats-section"><div id="metric-group" class="ui-toggle-group" data-slot="toggle-group" role="group"></div></section>
  </div>
</div>
<span id="accent-probe" aria-hidden="true"></span>
<span id="surface-probe" aria-hidden="true"></span>`;
}
