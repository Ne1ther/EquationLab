import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import sharp from 'sharp';
import JSZip from 'jszip';

await import('../word-ribbon/command-registry.js');
const registry=globalThis.EquationLabCommands;
const execFileAsync=promisify(execFile);

test('native Word Ribbon registry contains complete, taskpane-free command metadata',async()=>{
 assert.equal(registry.groups.length,5);assert.equal(registry.commands.length,19);
 assert.equal(new Set(registry.commands.map(command=>command.id)).size,registry.commands.length);
 for(const group of registry.groups)for(const id of group.commands)assert.ok(registry.get(id),`${group.id}: ${id}`);
 for(const command of registry.commands){
  assert.deepEqual(Object.keys(command).sort(),['description','icon','id','label']);
  const image=join(fileURLToPath(new URL('../word-ribbon/icons/',import.meta.url)),`${command.icon}-32.png`);
  const metadata=await sharp(image).metadata();assert.equal(metadata.width,32,command.id);assert.equal(metadata.height,32,command.id);assert.equal(metadata.hasAlpha,true,command.id);
 }
 assert.match(await readFile(new URL('../word-ribbon/icons/lucide/LICENSE',import.meta.url),'utf8'),/ISC License/);
});

test('native Word template builder embeds the retained Ribbon ABI and icons without Office.js routes',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'equationlab-native-ribbon-'));
 const input=join(temp,'input.dotm'),output=join(temp,'output.dotm');
 try{
  const fixture=new JSZip();
  fixture.file('_rels/.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
  fixture.file('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
  await writeFile(input,await fixture.generateAsync({type:'nodebuffer'}));
  await execFileAsync(process.execPath,[fileURLToPath(new URL('../native-word-probe/automatic-loader/build-ribbon-template.mjs',import.meta.url)),input,output]);
  const built=await JSZip.loadAsync(await readFile(output)),xml=await built.file('customUI/customUI.xml').async('string');
  assert.equal((xml.match(/<group /g)||[]).length,5);assert.equal((xml.match(/<button /g)||[]).length,20);
  assert.match(xml,/tag="open-pane"/);assert.doesNotMatch(xml,/Taskpane|TaskPane|appsforoffice|localhost:37951/);
  const relationXml=await built.file('customUI/_rels/customUI.xml.rels').async('string');
  const iconNames=[...relationXml.matchAll(/Target="icons\/([^\"]+)"/g)].map(match=>match[1]);
  assert.equal(new Set(iconNames).size,iconNames.length);
  for(const name of iconNames){
   const bytes=await built.file(`customUI/icons/${name}`).async('nodebuffer');
   assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
   assert.equal(bytes.readUInt32BE(16),32);assert.equal(bytes.readUInt32BE(20),32);
  }
 }finally{await rm(temp,{recursive:true,force:true});}
});

test('requested document capture uses retained anchors without selection, activation or periodic XML',async()=>{
 const source=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabDocumentContext.bas',import.meta.url),'utf8');
 const procedure=name=>source.slice(source.indexOf(name),source.indexOf('End Sub',source.indexOf(name))).split('\n').map(line=>line.split("'")[0]).join('\n');
 const capture=procedure('Private Sub ApplyDocumentCaptureRequest');
 assert.match(capture,/mBoundDocuments\(CStr\(snapshot\)\)/);assert.match(capture,/KnownDocumentIdentity\(Doc\) <> identity/);
 assert.match(capture,/For Each candidate In Application.Documents/);assert.match(capture,/mBoundEquations\(CStr\(snapshot\)\)/);
 assert.match(capture,/shape.Range.Document Is Doc/);assert.match(capture,/ELCaptureEquation shape, True/);
 assert.doesNotMatch(capture,/\.Select\b|\.Activate\b|ScreenRefresh|ActiveDocument|\bSelection\b/i);
 const poll=procedure('Public Sub ELPollNavigation');
 assert.ok(poll.indexOf('MathTypeBridgeTakeDocumentCaptureRequest')<poll.indexOf('MathTypeBridgeTransportActive'));
 assert.doesNotMatch(poll,/WordOpenXML/);
 const watch=procedure('Public Sub ELWatchNativeSession');assert.match(watch,/MathTypeBridgeCaptureWatch/);assert.doesNotMatch(watch,/WordOpenXML|\.Range|\.InlineShapes/);
 const close=procedure('Public Sub ELCloseDocumentContext');assert.match(close,/mBoundDocuments.Remove i/);assert.match(close,/mBoundEquations.Remove i/);assert.match(close,/mKnownDocuments.Remove i/);assert.match(close,/ELClearDocumentContext/);
 const events=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabWordEvents.cls',import.meta.url),'utf8');
 assert.match(events,/Host_DocumentBeforeClose[\s\S]*?ELCloseDocumentContext Doc/);
});
