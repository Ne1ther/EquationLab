import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {deflateRawSync} from 'node:zlib';
import JSZip from 'jszip';
import {combineWordSnapshotParts} from '../src/word-snapshot-parts.mjs';
import {inspectDocx,flatOpc,NS} from '../src/document.mjs';
import {nativeSessionOperation as op} from '../src/word-native-session.mjs';
import {inspectOle} from '../src/native.mjs';
import {desktopRequest} from '../src/desktop-rpc.mjs';
const bytes=await readFile(new URL('../docs/examples/equation-lab-30-formulas.docx',import.meta.url)),original=await inspectDocx(bytes),source=await flatOpc(bytes);
function ranges(){
 const serializer=new XMLSerializer(),doc=new DOMParser().parseFromString(source,'application/xml'),main=Array.from(doc.getElementsByTagNameNS(NS.pkg,'part')).find(n=>n.getAttributeNS(NS.pkg,'name')==='/word/document.xml'),body=main.getElementsByTagNameNS(NS.w,'body')[0],children=Array.from(body.childNodes).filter(n=>n.nodeType===1&&n.localName!=='sectPr');
 return Array.from({length:4},(_,i)=>{const clone=doc.cloneNode(true),target=Array.from(clone.getElementsByTagNameNS(NS.pkg,'part')).find(n=>n.getAttributeNS(NS.pkg,'name')==='/word/document.xml').getElementsByTagNameNS(NS.w,'body')[0];while(target.firstChild)target.removeChild(target.firstChild);for(const node of children.slice(Math.floor(children.length*i/4),Math.floor(children.length*(i+1)/4)))target.appendChild(clone.importNode(node,true));return serializer.serializeToString(clone);});
}
const parts=ranges();
const settingsName='/word/settings.xml';
function editPart(range,name,edit){
 const xml=new DOMParser().parseFromString(range,'application/xml');
 const node=Array.from(xml.getElementsByTagNameNS(NS.pkg,'part')).find(item=>item.getAttributeNS(NS.pkg,'name')===name);
 assert.ok(node,`Fixture must contain ${name}`);
 edit(node);
 return new XMLSerializer().serializeToString(xml);
}
test('consecutive live ranges retain every native formula, order, number and reference with isolated relationships',async()=>{
 const document=await inspectDocx(await combineWordSnapshotParts(parts));
 assert.equal(document.objects.length,30);
 assert.deepEqual(document.objects.map(o=>o.nativeSha256),original.objects.map(o=>o.nativeSha256));
 assert.deepEqual(document.objects.map(o=>o.layout),original.objects.map(o=>o.layout));
 assert.equal(new Set(document.objects.map(o=>o.path)).size,30);
});
test('segments with unanimous settings retain their numbering default and exactly one related settings part',async()=>{
 const document=await inspectDocx(await combineWordSnapshotParts(parts));
 assert.equal(document.numberFormat,'(#C1.#E1)');
 const rels=new DOMParser().parseFromString(await document.zip.file('word/_rels/document.xml.rels').async('string'),'application/xml');
 const settingsLinks=Array.from(rels.getElementsByTagNameNS(NS.rels,'Relationship')).filter(node=>node.getAttribute('Type')===NS.r+'/settings');
 assert.deepEqual(settingsLinks.map(node=>node.getAttribute('Target')),['settings.xml']);
});
test('conflicting or missing settings across segments do not become a document default',async()=>{
 const conflicting=editPart(parts[1],settingsName,part=>{
  const format=Array.from(part.getElementsByTagNameNS(NS.w,'docVar')).find(node=>node.getAttributeNS(NS.w,'name')==='EquationLabNumberFormat');
  assert.ok(format);
  format.setAttributeNS(NS.w,'w:val','[#E1]');
 });
 const missing=editPart(editPart(parts[1],settingsName,part=>part.parentNode.removeChild(part)),
  '/word/_rels/document.xml.rels',part=>{
   const settings=Array.from(part.getElementsByTagNameNS(NS.rels,'Relationship')).find(node=>node.getAttribute('Type')===NS.r+'/settings');
   assert.ok(settings);
   settings.parentNode.removeChild(settings);
  });
 for(const variant of [conflicting,missing]){
  const document=await inspectDocx(await combineWordSnapshotParts([parts[0],variant,...parts.slice(2)]));
  assert.equal(document.numberFormat,null);
  assert.equal(document.zip.file('word/settings.xml'),null);
  assert.equal(document.objects.length,30);
 }
});
test('canonical related MathType properties survive when the Word numbering variable is absent',async()=>{
 const zip=await JSZip.loadAsync(bytes);
 const defaults=await zip.file('word/settings.xml').async('string');
 zip.file('word/settings.xml',defaults.replace(/<w:docVar w:name="EquationLabNumberFormat"[^>]*\/>/,''));
 const types=await zip.file('[Content_Types].xml').async('string');
 zip.file('[Content_Types].xml',types.replace('</Types>','<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/></Types>'));
 const root=await zip.file('_rels/.rels').async('string');
 zip.file('_rels/.rels',root.replace('</Relationships>',`<Relationship Id="rCustomProbe" Type="${NS.r}/custom-properties" Target="docProps/custom.xml"/></Relationships>`));
 zip.file('docProps/custom.xml','<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="MTEquationNumber2"><vt:lpwstr>[#E1]</vt:lpwstr></property></Properties>');
 const withLegacyProperties=await zip.generateAsync({type:'nodebuffer'});
 assert.equal((await inspectDocx(withLegacyProperties)).numberFormat,'[#E1]');
 const merged=await inspectDocx(await combineWordSnapshotParts([await flatOpc(withLegacyProperties)]));
 assert.equal(merged.numberFormat,'[#E1]');
 assert.ok(merged.zip.file('docProps/custom.xml'));
});
test('malformed or oversized range packages fail before granting document authority',async()=>{
 for(const value of [null,[],Array(257).fill(source),['<!DOCTYPE p><p/>'],['<pkg/>']])await assert.rejects(combineWordSnapshotParts(value));
 await assert.rejects(combineWordSnapshotParts([parts[0].replace('pkg:name="/word/document.xml"','pkg:name="/../document.xml"')]));
 for(const makeExtra of [doc=>doc.createTextNode('Unexpected XML content'),doc=>doc.createElementNS(NS.w,'w:extra'),doc=>doc.createCDATASection('Outside the root')]){
  const malformed=editPart(parts[0],'/word/styles.xml',part=>{
   const payload=part.getElementsByTagNameNS(NS.pkg,'xmlData')[0];
   payload.appendChild(makeExtra(part.ownerDocument));
  });
  await assert.rejects(combineWordSnapshotParts([malformed]),/Invalid Word snapshot XML payload/);
 }
});
test('range codec still checks original owner bytes and the global live count',async()=>{
 const native=inspectOle(original.objects[25].ole).native.toString('base64'),context={ooxml:deflateRawSync(JSON.stringify(parts)).toString('base64'),encoding:'parts-deflate-base64',index:25,count:30,name:'ranges.docx',identity:'range:1',snapshot:2};
 const opened=await op('native-open',{session:'99177801',native,document:context});try{const r=await op('native-read',{ticket:opened.ticket});assert.equal(r.document.index,25);assert.equal((await inspectDocx(await readFile(r.document.path))).objects.length,30);}finally{await op('native-cancel',{ticket:opened.ticket});await op('native-poll',{ticket:opened.ticket});}
 await assert.rejects(op('native-open',{session:'99177802',native,document:{...context,count:29}}),/count/);
 await assert.rejects(op('native-open',{session:'99177803',native,document:{...context,index:0}}),/activated equation/);
});
test('A segmented snapshot retains Word’s numbering revision when the package lacks that revision',async()=>{
 const native=inspectOle(original.objects[25].ole).native.toString('base64'),context={ooxml:deflateRawSync(JSON.stringify(parts)).toString('base64'),encoding:'parts-deflate-base64',index:25,count:30,name:'ranges.docx',identity:'range:1',snapshot:2,numberingRevision:7};
 for(const revision of [-1,'7',2147483647])await assert.rejects(op('native-open',{session:'99177804',native,document:{...context,numberingRevision:revision}}),/numbering revision/);
 const opened=await op('native-open',{session:'99177804',native,document:context}),{ticket}=opened;
 const oldFetch=globalThis.fetch;
 globalThis.fetch=async(url,options)=>({ok:true,json:()=>op(new URL(url).pathname,JSON.parse(options.body))});
 try{
  const staged=await op('native-read',{ticket});
  assert.equal((await inspectDocx(await readFile(staged.document.path))).numberingRevision,0);
  const read=await desktopRequest({action:'wordSessionRead',payload:{ticket}});
  assert.equal(read.documentNumberingRevision,7);
  assert.equal(read.objects.length,30);
 }finally{
  globalThis.fetch=oldFetch;
  await op('native-cancel',{ticket});
  await op('native-poll',{ticket});
 }
});
