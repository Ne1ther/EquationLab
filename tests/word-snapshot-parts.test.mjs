import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {deflateRawSync} from 'node:zlib';
import {combineWordSnapshotParts} from '../src/word-snapshot-parts.mjs';
import {inspectDocx,flatOpc,NS} from '../src/document.mjs';
import {nativeSessionOperation as op} from '../src/word-native-session.mjs';
import {inspectOle} from '../src/native.mjs';
const bytes=await readFile(new URL('../docs/examples/equation-lab-30-formulas.docx',import.meta.url)),original=await inspectDocx(bytes),source=await flatOpc(bytes);
function ranges(){
 const serializer=new XMLSerializer(),doc=new DOMParser().parseFromString(source,'application/xml'),main=Array.from(doc.getElementsByTagNameNS(NS.pkg,'part')).find(n=>n.getAttributeNS(NS.pkg,'name')==='/word/document.xml'),body=main.getElementsByTagNameNS(NS.w,'body')[0],children=Array.from(body.childNodes).filter(n=>n.nodeType===1&&n.localName!=='sectPr');
 return Array.from({length:4},(_,i)=>{const clone=doc.cloneNode(true),target=Array.from(clone.getElementsByTagNameNS(NS.pkg,'part')).find(n=>n.getAttributeNS(NS.pkg,'name')==='/word/document.xml').getElementsByTagNameNS(NS.w,'body')[0];while(target.firstChild)target.removeChild(target.firstChild);for(const node of children.slice(Math.floor(children.length*i/4),Math.floor(children.length*(i+1)/4)))target.appendChild(clone.importNode(node,true));return serializer.serializeToString(clone);});
}
const parts=ranges();
test('consecutive live ranges retain every native formula, order, number and reference with isolated relationships',async()=>{
 const document=await inspectDocx(await combineWordSnapshotParts(parts));
 assert.equal(document.objects.length,30);
 assert.deepEqual(document.objects.map(o=>o.nativeSha256),original.objects.map(o=>o.nativeSha256));
 assert.deepEqual(document.objects.map(o=>o.layout),original.objects.map(o=>o.layout));
 assert.equal(new Set(document.objects.map(o=>o.path)).size,30);
});
test('malformed or oversized range packages fail before granting document authority',async()=>{
 for(const value of [null,[],Array(257).fill(source),['<!DOCTYPE p><p/>'],['<pkg/>']])await assert.rejects(combineWordSnapshotParts(value));
 await assert.rejects(combineWordSnapshotParts([parts[0].replace('pkg:name="/word/document.xml"','pkg:name="/../document.xml"')]));
});
test('range codec still checks original owner bytes and the global live count',async()=>{
 const native=inspectOle(original.objects[25].ole).native.toString('base64'),context={ooxml:deflateRawSync(JSON.stringify(parts)).toString('base64'),encoding:'parts-deflate-base64',index:25,count:30,name:'ranges.docx',identity:'range:1',snapshot:2};
 const opened=await op('native-open',{session:'99177801',native,document:context});try{const r=await op('native-read',{ticket:opened.ticket});assert.equal(r.document.index,25);assert.equal((await inspectDocx(await readFile(r.document.path))).objects.length,30);}finally{await op('native-cancel',{ticket:opened.ticket});await op('native-poll',{ticket:opened.ticket});}
 await assert.rejects(op('native-open',{session:'99177802',native,document:{...context,count:29}}),/count/);
 await assert.rejects(op('native-open',{session:'99177803',native,document:{...context,index:0}}),/activated equation/);
});
