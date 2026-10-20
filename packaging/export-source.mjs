// Never export the working Git database or copy the workspace wholesale.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import JSZip from 'jszip';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
let review=false, outputArgument;
for(let i=0;i<args.length;i++){
  if(args[i]==='--review')review=true;
  else if(args[i]==='--output'&&args[i+1]&&!args[i+1].startsWith('--'))outputArgument=args[++i];
  else throw Error('Usage: node packaging/export-source.mjs [--review] [--output NEW_DIRECTORY]');
}
const output = path.resolve(root, outputArgument ?? 'dist/source-review');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const roots = [
  '.gitignore', 'AGENTS.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'Package.swift', 'package.json', 'package-lock.json',
  'macos', 'updater', 'desktop', 'src', 'word-ribbon', 'assets/fonts', 'assets/licenses', 'font-metrics', 'tests',
  'scripts/build_and_run.sh', 'scripts/package_release.sh',
  'packaging', 'native-word-probe/src', 'native-word-probe/include', 'native-word-probe/Info.plist',
  'native-word-probe/script', 'native-word-probe/automatic-loader',
  'native-word-probe/transport-contract.md', 'native-word-probe/startup-receipt-contract.md',
  'scripts/build/build-template-previews.mjs',
  'scripts/build/word-test.mjs',
  'scripts/build/build-rendering-resources.mjs', 'scripts/build/build-word-demo.mjs',
  'scripts/build/check-catalog-library.mjs', 'scripts/build/check-catalog-library.swift',
  'docs/install.md', 'docs/features.md', 'docs/development.md', 'docs/releases.md', 'docs/updates.md', 'docs/ocr.md', 'docs/file-guide.md', 'docs/examples', 'docs/preview',
  'design/office-product-icons',
  'design/workbench-concepts/assets/equationlab-header-mark.svg',
  'design/equation-lab-icons/v5/svg/e2-lab-orange-paper.svg',
  'design/equation-lab-icons/v6/manifest.json', 'design/equation-lab-icons/v6/EquationLab.icns',
  'design/equation-lab-icons/v6/EquationLab.iconset',
  'design/equation-lab-icons/v6/svg', 'design/equation-lab-icons/v6/png/e2-lab-cream-optical-1024.png'
];
const withheld = [];
const localTests = new Set([
  'typography-native', 'mtef-extended', 'font-renderer', 'native', 'desktop',
  'nine-formula-local', 'full-roundtrip-audit', 'native-feature-parity', 'new-formula', 'eqp'
].map(name => 'tests/' + name + '.test.mjs'));
const publicDemo = 'docs/examples/equation-lab-30-formulas.docx';
const skip = rel => withheld.some(item => item.path === rel) || localTests.has(rel) ||
  /(?:^|\/)\.DS_Store$/.test(rel) || (rel !== publicDemo && /\.(?:dotm|docm|docx|pkg|dmg|app|key|pem|p12|pfx)$/.test(rel)) ||
  rel.startsWith('packaging/native-word/') ||
  /^packaging\/verify-(?:release|slim-bundle|candidate-engine)\.mjs$/.test(rel) ||
  /^native-word-probe\/automatic-loader\/(?:dynamic_|run_dynamic_)/.test(rel) ||
  rel === 'native-word-probe/script/run_transport_tests.mjs';
const files = new Map();
async function collect(rel) {
  if (skip(rel)) return;
  const absolute = path.join(root, rel), stat = await fs.lstat(absolute);
  if (stat.isSymbolicLink()) throw Error('Source export refuses symlinks: ' + rel);
  if (stat.isDirectory()) {
    for (const name of (await fs.readdir(absolute)).sort()) await collect(rel + '/' + name);
  } else if (stat.isFile()) files.set(rel, {bytes:await fs.readFile(absolute), mode:stat.mode & 0o777});
}
for (const rel of roots) await collect(rel);
const readme = await fs.readFile(path.join(root,'packaging/source-README.md.in'),'utf8');
files.set('README.md', {bytes:Buffer.from(readme), mode:0o644});
files.set('README.en.md', {bytes:await fs.readFile(path.join(root,'packaging/source-README.en.md.in')), mode:0o644});
for (const [rel, file] of files) {
  if (file.bytes.length > 15_000_000) throw Error('Unexpected large source file: ' + rel);
  if (rel.includes('..') || /(?:^|\/)(?:\.git|\.local|\.codex|node_modules|research|evidence|output|dist)(?:\/|$)/.test(rel)) throw Error('Local-only path in source export: ' + rel);
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}/.test(file.bytes.toString('utf8'))) throw Error('Credential-like content; inspect locally: ' + rel);
}
const inventory = [...files].sort(([a], [b]) => a.localeCompare(b)).map(([name, file]) => ({path:name, bytes:file.bytes.length, sha256:hash(file.bytes)}));
const report = {schema:'equationlab.source-review.v1', project:'EquationLab', status:'source-complete-review-pending', uploadReady:false, sourceResourcesComplete:true,
  files:inventory.length, bytes:inventory.reduce((n, item) => n + item.bytes, 0),
  blockers:withheld, otherReview:['Microsoft product icon terms','Provenance and redistribution review of src/resources/ole-template.json'],
  omittedLocalTests:[...localTests].sort(), excludedRoots:['.git','.local','.codex','node_modules','.build','research','evidence','output','dist'], inventory};
if (!review) {
  console.log(JSON.stringify({status:report.status, uploadReady:false, sourceResourcesComplete:true, files:report.files, bytes:report.bytes, blockers:withheld, otherReview:report.otherReview, next:'Use --review to export complete source inputs. See otherReview for the remaining provenance questions.'}, null, 2));
  process.exitCode = 2;
} else {
  if (output === root || root.startsWith(output + path.sep)) throw Error('Unsafe output directory');
  if (await fs.access(output).then(() => true, () => false)) throw Error('Use a new output directory; exports never overwrite');
  const zip = new JSZip();
  for (const [rel, file] of files) zip.file('EquationLab/' + rel, file.bytes, {unixPermissions:file.mode, date:new Date('2026-10-16T00:00:00Z')});
  const bytes = await zip.generateAsync({type:'nodebuffer', platform:'UNIX', compression:'DEFLATE', compressionOptions:{level:9}});
  await fs.mkdir(output, {recursive:true});
  const filename='EquationLab-source-review.zip';
  await fs.writeFile(path.join(output, filename), bytes);
  await fs.writeFile(path.join(output, 'source-review-report.json'), JSON.stringify({...report, zip:{filename, bytes:bytes.length, sha256:hash(bytes)}}, null, 2)+'\n');
  console.log(JSON.stringify({output, status:report.status, uploadReady:false, files:report.files, sourceBytes:report.bytes, zipBytes:bytes.length, sha256:hash(bytes)}, null, 2));
}
