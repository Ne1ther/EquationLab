import {readFile, readdir, lstat, rm, realpath, readlink} from 'node:fs/promises';
import {join, relative, sep, dirname, resolve, isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

// Exact installed builds, not a general npm tree-shaker. Component source/lib
// wrappers are runtime code for MathJax's declared main; es5 is its duplicate
// browser distribution. Keep the complete js/TeX implementations unchanged.
const rules = [
  {name: 'mathjax-full', version: '3.2.2', paths: ['es5', 'ts', 'tsconfig.json', 'tslint.json']},
  {name: 'mathlive', version: '0.111.1', paths: ['mathlive.js', 'mathlive.mjs', 'types']},
  {name: 'sharp', version: '0.35.5', paths: ['src', 'install', 'lib']},
  {name: 'jszip', version: '3.10.1', paths: ['dist', '.github', 'vendor', 'graph.svg', '.jekyll-metadata', '.codeclimate.yml', '.editorconfig', '.eslintrc.js', '.travis.yml', 'tsconfig.json']},
  {name: 'cfb', version: '1.2.2', paths: ['dist', 'types', 'xlscfb.flow.js']},
  {name: 'pako', version: '1.0.11', paths: ['dist']}
];
const inside = (root, path) => path === root || path.startsWith(root + sep);
const declaration = path => /\.(?:d\.ts|d\.mts|d\.cts)$/.test(path);
const legal = path => /(?:^|[\/._-])(?:licen[cs]e|notice|copying|copyright|third[-_ ]party)(?:[\/._-]|$)/i.test(path);
function runtimeAsset(path) {
  // These are duplicate browser/build trees. Runtime SVG metrics live in js/,
  // SRE dictionaries in speech-rule-engine/lib/mathmaps, and UI fonts in
  // mathlive/fonts. A directory named "fonts" must not retain TS/map sources.
  if (/^mathjax-full\/(?:es5|ts)\//.test(path) || /\.(?:map|d\.ts|d\.mts|d\.cts)$/.test(path)) return false;
  return /\.(?:woff2?|ttf|otf|eot|wav|mp3|ogg|m4a|flac|node|dylib|so|dll|wasm)$/i.test(path) || /(?:^|\/)(?:fonts|sounds|mathmaps|dictionaries)(?:\/|$)/i.test(path);
}

async function inventory(directory, root = directory, result = {files: [], links: []}) {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const path = join(directory, entry.name), stat = await lstat(path);
    if (stat.isSymbolicLink()) {
      const link = await readlink(path);
      if (isAbsolute(link)) throw Error(`Absolute dependency symlink is not relocatable: ${path}`);
      let target; try { target = await realpath(path); } catch { throw Error(`Broken dependency symlink: ${path}`); }
      if (!inside(root, target)) throw Error(`External dependency symlink is not accepted during pruning: ${path}`);
      result.links.push({path, target, directory: (await lstat(target)).isDirectory()});
    } else if (stat.isDirectory()) await inventory(path, root, result);
    else if (stat.isFile()) result.files.push({path, bytes: stat.size});
    else throw Error(`Unsupported dependency file: ${path}`);
  }
  return result;
}

// Preserve production conditions, not declarations or explicit development
// branches. Bare dependency aliases are not local filenames.
function manifestEntries(metadata) {
  const entries = [];
  const add = (value, field, localOnly = false) => {
    if (typeof value !== 'string' || declaration(value) || localOnly && !value.startsWith('.')) return;
    entries.push({value, field});
  };
  for (const field of ['main', 'module', 'unpkg', 'jsdelivr']) add(metadata[field], field);
  if (typeof metadata.bin === 'string') add(metadata.bin, 'bin');
  else for (const value of Object.values(metadata.bin ?? {})) add(value, 'bin');
  if (typeof metadata.browser === 'string') add(metadata.browser, 'browser');
  else for (const value of Object.values(metadata.browser ?? {})) add(value, 'browser', true);
  function walk(value, field) {
    if (typeof value === 'string') add(value, field, true);
    else if (Array.isArray(value)) for (const child of value) walk(child, field);
    else if (value && typeof value === 'object') for (const [condition, child] of Object.entries(value)) if (!['types', 'typings', 'development'].includes(condition)) walk(child, field + ':' + condition);
  }
  walk(metadata.exports, 'exports'); walk(metadata.imports, 'imports');
  return entries;
}

export async function pruneDependencies(directory) {
  const root = await realpath(directory);
  const development = await realpath(fileURLToPath(new URL('../node_modules', import.meta.url))).catch(() => null);
  if (root === development) throw Error('Source development node_modules cannot be pruned; supply a private staged copy.');
  for (const rule of rules) {
    let metadata;
    try { metadata = JSON.parse(await readFile(join(root, rule.name, 'package.json'), 'utf8')); }
    catch (error) { if (rule.name === 'sharp' && error.code === 'ENOENT') continue; throw error; }
    if (metadata.name !== rule.name || metadata.version !== rule.version) throw Error(`Unaudited dependency version: ${rule.name} ${metadata.version}`);
  }
  const {files: before, links} = await inventory(root), retained = [];
  for (const link of links) retained.push({path: link.target, tree: link.directory, reason: 'internal-symlink'});
  for (const file of before.filter(file => file.path.endsWith(sep + 'package.json'))) {
    retained.push({path: file.path, reason: 'package-metadata'});
    const metadata = JSON.parse(await readFile(file.path, 'utf8')), packageRoot = dirname(file.path), require = createRequire(file.path);
    for (const {value, field} of manifestEntries(metadata)) {
      const local = resolve(packageRoot, value);
      if (!inside(root, local)) throw Error(`Runtime entry escapes dependency tree: ${metadata.name} ${field} ${value}`);
      if (value.includes('*')) {
        const prefix = local.slice(0, local.indexOf('*'));
        if (!before.some(file => file.path.startsWith(prefix))) throw Error(`Missing runtime export pattern: ${metadata.name} ${value}`);
        retained.push({path: prefix, prefix: true, reason: field}); continue;
      }
      let target, stat;
      try {
        target = await realpath(local).catch(() => require.resolve(local));
        stat = await lstat(target);
      } catch { throw Error(`Missing declared runtime entry: ${metadata.name} ${field} ${value}`); }
      if (!inside(root, target)) throw Error(`Runtime entry resolves outside dependency tree: ${metadata.name} ${value}`);
      retained.push({path: target, tree: stat.isDirectory(), reason: field});
    }
  }
  const removed = [];
  for (const file of before) {
    const path = relative(root, file.path).split(sep).join('/');
    if (legal(path) || runtimeAsset(path) || retained.some(entry => entry.prefix ? file.path.startsWith(entry.path) : file.path === entry.path || entry.tree && file.path.startsWith(entry.path + sep))) continue;
    const rule = rules.find(rule => path.startsWith(rule.name + '/'));
    const curated = rule?.paths.some(part => path === `${rule.name}/${part}` || path.startsWith(`${rule.name}/${part}/`));
    if (curated || /\.(?:map|d\.ts|d\.mts|d\.cts)$/.test(path)) removed.push({...file, path, sha256: createHash('sha256').update(await readFile(file.path)).digest('hex')});
  }
  // Validate every pin, metadata entry and link before the first removal.
  for (const file of removed) await rm(join(root, file.path));
  const ancestors = new Set();
  for (const file of removed) for (let parent = dirname(join(root, file.path)); parent !== root; parent = dirname(parent)) ancestors.add(parent);
  for (const path of [...ancestors].sort((a, b) => b.length - a.length)) if ((await readdir(path)).length === 0) await rm(path, {recursive: true});
  await inventory(root); // No internal link may become dangling.
  const beforeBytes = before.reduce((sum, file) => sum + file.bytes, 0), removedBytes = removed.reduce((sum, file) => sum + file.bytes, 0);
  return {schema: 'equationlab.dependency-pruning.v1', beforeBytes, afterBytes: beforeBytes - removedBytes, removedBytes, removedFiles: removed.length,
    auditedVersions: Object.fromEntries(rules.map(rule => [rule.name, rule.version])),
    protection: {productionEntries: retained.filter(entry => !['internal-symlink', 'package-metadata'].includes(entry.reason)).map(entry => ({path: relative(root, entry.path).split(sep).join('/'), field: entry.reason})), internalLinks: links.length, legalFilesRetained: before.filter(file => legal(relative(root, file.path))).length},
    removed: removed.map(({path, bytes, sha256}) => ({path, bytes, sha256}))};
}
