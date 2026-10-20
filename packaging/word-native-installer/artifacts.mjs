// Developer-side freezing only. It does not install, invoke Word, or create VBA.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import JSZip from '../../node_modules/jszip/lib/index.js';
import CFB from '../../node_modules/cfb/cfb.js';
import {DOMParser} from '../../node_modules/@xmldom/xmldom/lib/index.js';
import {FIXED_LIBRARIES, treeInventory,isMainModule} from './installer.mjs';
const sha = b => createHash('sha256').update(b).digest('hex');
const PACKAGE_REL_NS='http://schemas.openxmlformats.org/package/2006/relationships';
const CUSTOM_UI_NS='http://schemas.microsoft.com/office/2009/07/customui';
const CUSTOM_UI_REL='http://schemas.microsoft.com/office/2007/relationships/ui/extensibility';
const IMAGE_REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
function xmlDocument(xml,label){
  const errors=[],doc=new DOMParser({onError:(level,message)=>{if(level==='error'||level==='fatalError')errors.push(message);}}).parseFromString(xml,'application/xml');
  if(errors.length||!doc.documentElement)throw Error(`Invalid ${label} XML: ${errors[0]??'missing document element'}`);
  return doc;
}
function rejectRibbon(message){throw Error(`Invalid Equation Lab Word Ribbon: ${message}`);}
export async function validateRibbonTemplateZip(zip){
  const rootPart=zip.file('_rels/.rels'),customPart=zip.file('customUI/customUI.xml'),imageRelsPart=zip.file('customUI/_rels/customUI.xml.rels');
  if(!rootPart||!customPart||!imageRelsPart)rejectRibbon('missing customUI part, root relationship, or icon relationships.');
  const rootDoc=xmlDocument(await rootPart.async('string'),'package relationships');
  const rootRelationships=Array.from(rootDoc.getElementsByTagNameNS(PACKAGE_REL_NS,'Relationship'));
  const customRelationship=rootRelationships.find(node=>node.getAttribute('Type')===CUSTOM_UI_REL&&node.getAttribute('TargetMode')!=='External');
  if(!customRelationship)rejectRibbon('missing internal Office customUI root relationship.');
  const rootTarget=customRelationship.getAttribute('Target');
  const rootPath=rootTarget.startsWith('/')?rootTarget.slice(1):path.posix.normalize(rootTarget);
  if(rootPath!=='customUI/customUI.xml')rejectRibbon('customUI root relationship targets an unexpected part.');

  const uiDoc=xmlDocument(await customPart.async('string'),'customUI');
  const ui=uiDoc.documentElement;
  if(ui.localName!=='customUI'||ui.namespaceURI!==CUSTOM_UI_NS)rejectRibbon('customUI has the wrong root or namespace.');
  const tabs=Array.from(ui.getElementsByTagNameNS(CUSTOM_UI_NS,'tab')).filter(node=>node.getAttribute('id')==='EquationLab.Native.Tab'&&node.getAttribute('label')==='Equation Lab');
  if(tabs.length!==1)rejectRibbon('Equation Lab tab is missing or duplicated.');
  const groups=Array.from(tabs[0].getElementsByTagNameNS(CUSTOM_UI_NS,'group'));
  const buttons=Array.from(tabs[0].getElementsByTagNameNS(CUSTOM_UI_NS,'button'));
  if(groups.length!==5||buttons.length!==20)rejectRibbon('the native ribbon is missing one or more expected groups or buttons.');
  const openPane=buttons.filter(node=>node.getAttribute('tag')==='open-pane');
  if(openPane.length!==1||openPane[0].getAttribute('id')!=='EL.open-pane'||openPane[0].getAttribute('onAction')!=='EquationLabRibbon.ELRibbonAction')rejectRibbon('the permanent open-pane callback is missing or invalid.');
  for(const button of buttons)if(button.getAttribute('onAction')!=='EquationLabRibbon.ELRibbonAction')rejectRibbon('a button has a missing or unexpected VBA callback.');

  const imageRelsDoc=xmlDocument(await imageRelsPart.async('string'),'customUI image relationships');
  const relationships=Array.from(imageRelsDoc.getElementsByTagNameNS(PACKAGE_REL_NS,'Relationship')).filter(node=>node.getAttribute('Type')===IMAGE_REL);
  const byId=new Map();
  for(const relationship of relationships){
    const id=relationship.getAttribute('Id'),target=relationship.getAttribute('Target');
    if(!id||byId.has(id)||!target||relationship.getAttribute('TargetMode')==='External')rejectRibbon('an icon relationship has a duplicate id or invalid target.');
    const assetPath=path.posix.normalize(path.posix.join('customUI',target));
    if(!assetPath.startsWith('customUI/icons/')||assetPath.includes('../')||!assetPath.endsWith('.png'))rejectRibbon('an icon relationship escapes the Ribbon icon folder.');
    const asset=zip.file(assetPath);
    if(!asset)rejectRibbon(`missing icon asset ${assetPath}.`);
    const png=await asset.async('nodebuffer');
    if(png.length<24||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||png.readUInt32BE(16)!==32||png.readUInt32BE(20)!==32)rejectRibbon(`invalid 32 by 32 PNG asset ${assetPath}.`);
    byId.set(id,assetPath);
  }
  if(byId.size===0)rejectRibbon('no icon relationships were found.');
  const usedImages=new Set(buttons.map(node=>node.getAttribute('image')).filter(Boolean));
  for(const image of usedImages)if(!byId.has(image))rejectRibbon(`Ribbon button image ${image} has no relationship.`);
  if(usedImages.size!==byId.size||[...byId.keys()].some(id=>!usedImages.has(id)))rejectRibbon('icon relationships do not match the Ribbon buttons.');
  return {groups:groups.length,buttons:buttons.length,iconRelationships:byId.size};
}
export function validateRibbonAcceptance(oracle){
  if(oracle?.ribbonVerified!==true)throw Error('Require real Word confirmation that the Equation Lab Ribbon tab and permanent open-pane button are visible.');
}

export async function inspectCompiledTemplate(file) {
  const bytes = await fs.readFile(file), zip = await JSZip.loadAsync(bytes, {checkCRC32: true});
  const types = await zip.file('[Content_Types].xml')?.async('string');
  if (!types?.includes('application/vnd.ms-word.template.macroEnabledTemplate.main+xml')) throw Error('The artifact must be a real macro-enabled Word template, not a renamed DOCX/DOCM.');
  const ribbon=await validateRibbonTemplateZip(zip);
  const vba = await zip.file('word/vbaProject.bin')?.async('nodebuffer');
  if (!vba || vba.subarray(0, 8).toString('hex') !== 'd0cf11e0a1b11ae1') throw Error('Missing VBA project compound file.');
  const project = CFB.read(vba, {type: 'buffer'}), files = project.FullPaths;
  for (const suffix of ['PROJECT', 'VBA/dir', 'VBA/_VBA_PROJECT']) {
    const index = files.findIndex(name => name.endsWith('/' + suffix));
    if (index < 0 || !project.FileIndex[index].content?.length) throw Error('Missing VBA project/compiled cache stream: ' + suffix);
  }
  return {sha256: sha(bytes), vbaProjectSha256: sha(vba), size: bytes.length, ribbon, structuralCheckOnly: true};
}
export async function prepareArtifacts({template, bundle, source, acceptance, output}) {
  const originalSource = await fs.readFile(source, 'utf8'), oracle = JSON.parse(await fs.readFile(acceptance, 'utf8'));
  validateRibbonAcceptance(oracle);
  const observed = await inspectCompiledTemplate(template);
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
  const manifest = {schema: 'equationlab.word-native-artifacts.v1', compiledTemplate: true, binding, nativeVersion: plist.CFBundleShortVersionString, architecture: 'arm64', fixedLibraryPath: binding === 'system-fixed' ? oracle.fixedLibraryPath : null, bundle: {path: 'MathTypeBridgeProbe.bundle', treeSha256: inventory.sha256, files: inventory.files, binarySha256}, template: {path: 'EquationLabStartup.dotm', ...observed, sourceSha256: sha(originalSource), buildId: oracle.templateBuildId}, legacyOwnedFiles, hostValidation: {wordVersion: oracle.wordVersion, architecture: oracle.architecture, fixedPathBound: binding === 'system-fixed', dynamicPathBound: binding === 'startup-adjacent', autoExecColdStartPassed: true, ribbonVerified: true, acceptanceSha256: sha(await fs.readFile(acceptance))}};
  await fs.writeFile(path.join(outputPath, 'artifact-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return {manifest, output: outputPath};
}
if (isMainModule(import.meta.url)) {
  let text = ''; for await (const chunk of process.stdin) text += chunk;
  process.stdout.write(JSON.stringify(await prepareArtifacts(JSON.parse(text))) + '\n');
}
