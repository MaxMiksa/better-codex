import {readFile, writeFile} from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const {version} = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected a numeric product version');

const oldVersion = String.raw`\d+\.\d+\.\d+`;
const badges = new RegExp(`(img\\.shields\\.io/badge/version-v)${oldVersion}(?=-)`, 'g');
const releasePath = String.raw`github\.com/MaxMiksa/better-codex/releases/(?:tag|download)/v`;
const releases = new RegExp(`(${releasePath})${oldVersion}(?=[/"\\s)])`, 'gi');
const labels = new RegExp(`\\[v${oldVersion}( Releases\\])(?=\\(https://${releasePath})`, 'gi');
const assets = new RegExp(`(better-codex-v)${oldVersion}(?=-(?:source|windows-x64-portable)\\.zip)`, 'g');

for (const name of ['README.md', 'README-zh.md']) {
  const path = new URL(name, root);
  const current = await readFile(path, 'utf8');
  const next = current
    .replace(badges, (_, prefix) => prefix + version)
    .replace(releases, (_, prefix) => prefix + version)
    .replace(assets, (_, prefix) => prefix + version)
    .replace(labels, (_, suffix) => `[v${version}${suffix}`);
  if (next !== current) await writeFile(path, next, 'utf8');
}
