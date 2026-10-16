// Developer-side freezing only. It does not install, invoke Word, or create VBA.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import JSZip from '../../node_modules/jszip/lib/index.js';
import CFB from '../../node_modules/cfb/cfb.js';
import {FIXED_LIBRARIES, treeInventory} from './installer.mjs';
const sha = b => createHash('sha256').update(b).digest('hex');

export async function inspectCompiledTemplate(file) {
  const bytes = await fs.readFile(file), zip = await JSZip.loadAsync(bytes, {checkCRC32: true});
  const types = await zip.file('[Content_Types].xml')?.async('string');
  if (!types?.includes('application/vnd.ms-word.template.macroEnabledTemplate.main+xml')) throw Error('The artifact must be a real macro-enabled Word template, not a renamed DOCX/DOCM.');
  const vba = await zip.file('word/vbaProject.bin')?.async('nodebuffer');
  if (!vba || vba.subarray(0, 8).toString('hex') !== 'd0cf11e0a1b11ae1') throw Error('Missing VBA project compound file.');
  const project = CFB.read(vba, {type: 'buffer'}), files = project.FullPaths;
  for (const suffix of ['PROJECT', 'VBA/dir', 'VBA/_VBA_PROJECT']) {
    const index = files.findIndex(name => name.endsWith('/' + suffix));
    if (index < 0 || !project.FileIndex[index].content?.length) throw Error('Missing VBA project/compiled cache stream: ' + suffix);
  }
  return {sha256: sha(bytes), vbaProjectSha256: sha(vba), size: bytes.length, structuralCheckOnly: true};
}
export async function prepareArtifacts({template, bundle, source, acceptance, output}) {
  const observed = await inspectCompiledTemplate(template), originalSource = await fs.readFile(source, 'utf8'), oracle = JSON.parse(await fs.readFile(acceptance, 'utf8'));
  const binding = oracle.binding ?? 'system-fixed';
  if (oracle.schema !== 'equationlab.word-native-loader-acceptance.v1' || oracle.templateSha256 !== observed.sha256 || oracle.sourceSha256 !== sha(originalSource) || !oracle.autoExecColdStartPassed || oracle.architecture !== 'arm64' || !['system-fixed', 'startup-adjacent'].includes(binding) || !(binding === 'system-fixed' ? oracle.fixedPathBound && FIXED_LIBRARIES.includes(oracle.fixedLibraryPath) : oracle.dynamicPathBound)) throw Error('Require matching real Word compilation, path binding and cold AutoExec acceptance, rather than structural ZIP/CFB checks alone.');
  if (!/^Public Sub AutoExec\(\)/m.test(originalSource) || /\/Users\/|VBProject|VBComponents|EnableEvents|AutomationSecurity|MacScript|AppleScriptTask/.test(originalSource)) throw Error('Unexpected or nonportable automatic loader source.');
  const declarations = [...originalSource.matchAll(/Declare PtrSafe (?:Function|Sub) \w+ Lib "([^"]+)"/g)];
  const allowedLibraries = binding === 'system-fixed' ? [oracle.fixedLibraryPath] : ['/usr/lib/libSystem.B.dylib', '/usr/lib/libffi.dylib'];
  if (!declarations.length || declarations.some(m => !allowedLibraries.includes(m[1]))) throw Error('The compiled source must consistently use the host-accepted loader contract.');
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], {stdio: 'pipe'});
  const inventory = await treeInventory(bundle), binary = path.join(bundle, 'Contents/MacOS/MathTypeBridgeProbe'), binarySha256 = sha(await fs.readFile(binary));
  if (oracle.binarySha256 !== binarySha256) throw Error('Native binary differs from the host-accepted build. Freeze after native signing; do not silently replace it.');
  const plist = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(bundle, 'Contents/Info.plist')], {encoding: 'utf8'}));
  const outputPath = path.resolve(output);
  await fs.mkdir(outputPath, {recursive: true});
  if ((await fs.readdir(outputPath)).length) throw Error('Use a new, empty artifact directory; no previous release is overwritten.');
  await fs.cp(bundle, path.join(outputPath, 'MathTypeBridgeProbe.bundle'), {recursive: true, preserveTimestamps: true});
  await fs.copyFile(template, path.join(outputPath, 'EquationLabStartup.dotm'));
  const legacyOwnedFiles = oracle.legacyOwnedFiles ?? [];
  if (legacyOwnedFiles.some(x => x.owner !== 'Equation Lab' || x.role !== 'native-bundle' || !/^[a-f0-9]{64}$/.test(x.sha256))) throw Error('Legacy migration requires an explicitly frozen own native-bundle tree hash.');
  const manifest = {schema: 'equationlab.word-native-artifacts.v1', compiledTemplate: true, binding, nativeVersion: plist.CFBundleShortVersionString, architecture: 'arm64', fixedLibraryPath: binding === 'system-fixed' ? oracle.fixedLibraryPath : null, bundle: {path: 'MathTypeBridgeProbe.bundle', treeSha256: inventory.sha256, files: inventory.files, binarySha256}, template: {path: 'EquationLabStartup.dotm', ...observed, sourceSha256: sha(originalSource), buildId: oracle.templateBuildId}, legacyOwnedFiles, hostValidation: {wordVersion: oracle.wordVersion, architecture: oracle.architecture, fixedPathBound: binding === 'system-fixed', dynamicPathBound: binding === 'startup-adjacent', autoExecColdStartPassed: true, acceptanceSha256: sha(await fs.readFile(acceptance))}};
  await fs.writeFile(path.join(outputPath, 'artifact-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return {manifest, output: outputPath};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let text = ''; for await (const chunk of process.stdin) text += chunk;
  process.stdout.write(JSON.stringify(await prepareArtifacts(JSON.parse(text))) + '\n');
}
