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
test('unanimous context-free shared parts are deduplicated once with clean relationships and content types',async()=>{
 const combined=await combineWordSnapshotParts(parts);
 const zip=await JSZip.loadAsync(combined);
 const names=Object.keys(zip.files).filter(name=>!zip.files[name].dir);
 const canonicalShared=['word/styles.xml','word/settings.xml','word/fontTable.xml','word/webSettings.xml','word/theme/theme1.xml','docProps/core.xml','docProps/app.xml'];
 for(const part of canonicalShared){
  assert.ok(zip.file(part),`Expected canonical shared part ${part}`);
  assert.deepEqual(names.filter(name=>name.endsWith('/'+part)),[],`Expected no per-range duplicate for ${part}`);
 }
 const mainRels=new DOMParser().parseFromString(await zip.file('word/_rels/document.xml.rels').async('string'),'application/xml');
 const mainLinks=Array.from(mainRels.getElementsByTagNameNS(NS.rels,'Relationship'));
 for(const [relType,target] of [
  [NS.r+'/styles','styles.xml'],
  [NS.r+'/settings','settings.xml'],
  [NS.r+'/fontTable','fontTable.xml'],
  [NS.r+'/webSettings','webSettings.xml'],
  [NS.r+'/theme','theme/theme1.xml']
 ]){
  assert.deepEqual(mainLinks.filter(node=>node.getAttribute('Type')===relType).map(node=>node.getAttribute('Target')),[target]);
 }
 const rootRels=new DOMParser().parseFromString(await zip.file('_rels/.rels').async('string'),'application/xml');
 const rootLinks=Array.from(rootRels.getElementsByTagNameNS(NS.rels,'Relationship'));
 assert.deepEqual(rootLinks.map(node=>[node.getAttribute('Id'),node.getAttribute('Target')]).sort(),[
  ['rApp','docProps/app.xml'],
  ['rCore','docProps/core.xml'],
  ['rDocument','word/document.xml']
 ]);
 const types=new DOMParser().parseFromString(await zip.file('[Content_Types].xml').async('string'),'application/xml');
 const overrides=Array.from(types.getElementsByTagName('Override')).map(node=>node.getAttribute('PartName').slice(1));
 assert.equal(new Set(overrides).size,overrides.length,'[Content_Types].xml must not contain duplicate overrides');
 assert.deepEqual([...overrides].sort(),names.filter(name=>name!=='[Content_Types].xml').sort());
});
test('conflicting or context-bound shared parts stay isolated per segment without breaking relationships',async()=>{
 const conflictingStyles=editPart(parts[1],'/word/styles.xml',part=>{
  const styles=part.getElementsByTagNameNS(NS.w,'styles')[0];
  const extra=part.ownerDocument.createElementNS(NS.w,'w:style');
  extra.setAttributeNS(NS.w,'w:type','paragraph');
  extra.setAttributeNS(NS.w,'w:styleId','SegmentOnlyStyle');
  styles.appendChild(extra);
 });
 const conflictDoc=await inspectDocx(await combineWordSnapshotParts([parts[0],conflictingStyles,...parts.slice(2)]));
 assert.equal(conflictDoc.zip.file('word/styles.xml'),null);
 assert.equal(conflictDoc.objects.length,30);
 for(let i=0;i<parts.length;i++)assert.ok(conflictDoc.zip.file(`ranges/${i}/word/styles.xml`));
 // Other unanimous shared parts (e.g. settings, theme) still deduplicate cleanly.
 assert.ok(conflictDoc.zip.file('word/settings.xml'));
 assert.ok(conflictDoc.zip.file('word/theme/theme1.xml'));
 const conflictRels=new DOMParser().parseFromString(await conflictDoc.zip.file('word/_rels/document.xml.rels').async('string'),'application/xml');
 const styleLinks=Array.from(conflictRels.getElementsByTagNameNS(NS.rels,'Relationship')).filter(node=>node.getAttribute('Type')===NS.r+'/styles');
 assert.equal(styleLinks.length,parts.length);
 // A shared part with its own .rels is context-bound and must not be deduplicated.
 const withStyleRels=parts[1].replace('</pkg:package>',`<pkg:part pkg:name="/word/_rels/styles.xml.rels" pkg:contentType="application/vnd.openxmlformats-package.relationships+xml"><pkg:xmlData><Relationships xmlns="${NS.rels}"/></pkg:xmlData></pkg:part></pkg:package>`);
 const styleRelsZip=await JSZip.loadAsync(await combineWordSnapshotParts([parts[0],withStyleRels,...parts.slice(2)]));
 assert.equal(styleRelsZip.file('word/styles.xml'),null);
 assert.ok(styleRelsZip.file('ranges/1/word/_rels/styles.xml.rels'));
 for(let i=0;i<parts.length;i++)assert.ok(styleRelsZip.file(`ranges/${i}/word/styles.xml`));
 // A shared part containing an r: relationship attribute is context-bound.
 const withRelAttr=editPart(parts[1],'/word/styles.xml',part=>{
  const styles=part.getElementsByTagNameNS(NS.w,'styles')[0];
  styles.setAttributeNS(NS.r,'r:id','rLocal');
 });
 const relAttrZip=await JSZip.loadAsync(await combineWordSnapshotParts([parts[0],withRelAttr,...parts.slice(2)]));
 assert.equal(relAttrZip.file('word/styles.xml'),null);
 for(let i=0;i<parts.length;i++)assert.ok(relAttrZip.file(`ranges/${i}/word/styles.xml`));
 // A shared part referenced by another part's .rels must remain per-segment.
 const withHeaderRef=parts[1].replace('</pkg:package>',`<pkg:part pkg:name="/word/header1.xml" pkg:contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"><pkg:xmlData><w:hdr xmlns:w="${NS.w}"/></pkg:xmlData></pkg:part><pkg:part pkg:name="/word/_rels/header1.xml.rels" pkg:contentType="application/vnd.openxmlformats-package.relationships+xml"><pkg:xmlData><Relationships xmlns="${NS.rels}"><Relationship Id="rHdrStyles" Type="${NS.r}/styles" Target="styles.xml"/></Relationships></pkg:xmlData></pkg:part></pkg:package>`);
 const headerRefZip=await JSZip.loadAsync(await combineWordSnapshotParts([parts[0],withHeaderRef,...parts.slice(2)]));
 assert.equal(headerRefZip.file('word/styles.xml'),null);
 assert.ok(headerRefZip.file('ranges/1/word/styles.xml'));
 const hdrRels=await headerRefZip.file('ranges/1/word/_rels/header1.xml.rels').async('string');
 assert.match(hdrRels,/Target="styles\.xml"/);
 // A shared part whose relationship Id is referenced directly in <w:body> must keep its prefixed relationship.
 const stylesRelId=(()=>{
  const doc=new DOMParser().parseFromString(parts[1],'application/xml');
  const relPart=Array.from(doc.getElementsByTagNameNS(NS.pkg,'part')).find(n=>n.getAttributeNS(NS.pkg,'name')==='/word/_rels/document.xml.rels');
  const rel=Array.from(relPart.getElementsByTagNameNS(NS.rels,'Relationship')).find(n=>n.getAttribute('Type')===NS.r+'/styles');
  assert.ok(rel);
  return rel.getAttribute('Id');
 })();
 const withBodyRef=editPart(parts[1],'/word/document.xml',part=>{
  const p=part.getElementsByTagNameNS(NS.w,'p')[0];
  p.setAttributeNS(NS.r,'r:id',stylesRelId);
 });
 const bodyRefZip=await JSZip.loadAsync(await combineWordSnapshotParts([parts[0],withBodyRef,...parts.slice(2)]));
 assert.equal(bodyRefZip.file('word/styles.xml'),null);
 assert.ok(bodyRefZip.file('ranges/1/word/styles.xml'));
 const bodyRefRels=await bodyRefZip.file('word/_rels/document.xml.rels').async('string');
 assert.match(bodyRefRels,new RegExp(`Id="p1_${stylesRelId}"`));
});
test('shared-part reuse fast path rejects later-segment malformed XML and package namespace mismatches',async()=>{
 const malformedLater=editPart(parts[1],'/word/styles.xml',part=>{
  const payload=part.getElementsByTagNameNS(NS.pkg,'xmlData')[0];
  payload.appendChild(part.ownerDocument.createTextNode('corrupted'));
 });
 await assert.rejects(combineWordSnapshotParts([parts[0],malformedLater,...parts.slice(2)]),/Invalid Word snapshot XML payload/);
 const differentPkgOpen=parts[1].replace(`<pkg:package xmlns:pkg="${NS.pkg}">`,`<pkg:package xmlns:pkg="${NS.pkg}" xml:space="preserve">`);
 const merged=await inspectDocx(await combineWordSnapshotParts([parts[0],differentPkgOpen,...parts.slice(2)]));
 assert.equal(merged.objects.length,30);
 assert.ok(merged.zip.file('word/styles.xml'));
});
test('adaptive chunking logic fits long documents within fixed budget and preserves paragraph boundaries',()=>{
 // Mirror ELNextDocumentChunkEnd to verify boundary invariants across sizes.
 const CHUNK_PART_BUDGET=64,CHUNK_MIN_CHARS=7500,CHUNK_BYTE_BUDGET=100663296;
 function simulateChunks(totalChars,paragraphSize,bytesPerChunk){
  let start=0,part=0,xmlBytes=0;const chunks=[];
  while(start<totalChars){
   const remaining=totalChars-start;
   let remainingParts=Math.max(1,CHUNK_PART_BUDGET-part);
   if(part>0&&xmlBytes>0){
    if(xmlBytes>=CHUNK_BYTE_BUDGET)remainingParts=1;
    else{
     const avgBytes=Math.max(1,Math.floor(xmlBytes/part));
     const byteRemaining=Math.max(1,Math.floor((CHUNK_BYTE_BUDGET-xmlBytes)/avgBytes));
     if(byteRemaining<remainingParts)remainingParts=byteRemaining;
    }
   }
   let last;
   if(remainingParts<=1)last=totalChars;
   else{
    const step=Math.max(CHUNK_MIN_CHARS,Math.floor((remaining+remainingParts-1)/remainingParts));
    last=Math.min(totalChars,start+step);
    if(last<totalChars){
     const paraStart=Math.floor((last-1)/paragraphSize)*paragraphSize;
     if(paraStart>start&&paraStart<last)last=paraStart;
    }
   }
   assert.ok(last>start,'each adaptive chunk must make strict forward progress');
   chunks.push([start,last]);
   xmlBytes=Math.min(134217728,xmlBytes+bytesPerChunk);
   start=last;part++;
  }
  return chunks;
 }
 for(const [len,para,bytes] of [[25_000,400,120_000],[200_000,500,250_000],[1_000_000,1_200,300_000],[2_000_000,20_000,300_000],[500_000,500,3_000_000]]){
  const result=simulateChunks(len,para,bytes);
  assert.ok(result.length<=CHUNK_PART_BUDGET,`expected <= ${CHUNK_PART_BUDGET} parts for len=${len}, got ${result.length}`);
  assert.equal(result[0][0],0);
  assert.equal(result.at(-1)[1],len);
  for(let i=1;i<result.length;i++)assert.equal(result[i][0],result[i-1][1]);
 }
 // Heavy boilerplate (~3 MiB/part) adapts to stay under the 128 MiB native limit.
 const heavy=simulateChunks(500_000,500,3_000_000);
 assert.ok(heavy.length<=35,`expected byte-budget adaptation, got ${heavy.length}`);
});
