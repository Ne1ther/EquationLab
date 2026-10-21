import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {createDocx,inspectDocx,editDocx,arrangeDocx,flatOpc,fromFlatOpc} from '../src/document.mjs';

async function alternateDocument(){
 const zip=await JSZip.loadAsync(await createDocx([{latex:'x^{2}'},{latex:'\\sqrt{a+b}'}]));
 const text=await zip.file('word/document.xml').async('string'),rels=await zip.file('word/_rels/document.xml.rels').async('string');
 zip.remove('word/document.xml');zip.remove('word/_rels/document.xml.rels');
 zip.file('word/document2.xml','\uFEFF'+text);zip.file('word/_rels/document2.xml.rels','\uFEFF'+rels);
 zip.file('_rels/.rels','\uFEFF'+(await zip.file('_rels/.rels').async('string')).replace('Target="word/document.xml"','Target="/word/document2.xml"'));
 zip.file('[Content_Types].xml','\uFEFF'+(await zip.file('[Content_Types].xml').async('string')).replace('/word/document.xml','/word/document2.xml'));
 return zip.generateAsync({type:'nodebuffer'});
}
test('Word package relationships identify a differently named, BOM-prefixed main part',async()=>{
 const bytes=await alternateDocument(),original=await inspectDocx(bytes),roundtrip=await inspectDocx(await fromFlatOpc(await flatOpc(bytes)));
 for(const doc of [original,roundtrip]){
  assert.equal(doc.mainPart,'word/document2.xml');assert.equal(doc.objects.length,2);
  assert.ok(doc.objects.every(o=>o.mainDocument&&o.part===doc.mainPart));
  assert.equal(doc.objects[0].latex,'x^{2}');assert.equal(doc.objects[1].latex,'\\sqrt{a+b}');
 }
});
test('editing and numbering preserve the alternate body part and other formula Native bytes',async()=>{
 const original=await alternateDocument(),before=await inspectDocx(original),object=before.objects[0];
 const power=object.characters.find(c=>c.char==='2');
 const edited=await inspectDocx(await editDocx(original,0,{[power.offset]:'3'}));
 assert.equal(edited.objects[0].latex,'x^{3}');assert.equal(edited.objects[1].nativeSha256,before.objects[1].nativeSha256);
 assert.equal(edited.mainPart,before.mainPart);assert.equal(edited.zip.file('word/document.xml'),null);
 const numbered=await inspectDocx(await arrangeDocx(original,{indices:[0,1],layout:{mode:'numbered-right',numberFormat:'(#E1)'}}));
 assert.equal(numbered.mainPart,before.mainPart);assert.deepEqual(numbered.objects.map(o=>o.nativeSha256),before.objects.map(o=>o.nativeSha256));
 assert.ok(numbered.objects.every(o=>o.layout.mode==='numbered-right'));
});
test('missing or external main-document relationships fail explicitly',async()=>{
 const zip=await JSZip.loadAsync(await alternateDocument());
 const rels=await zip.file('_rels/.rels').async('string');
 zip.file('_rels/.rels',rels.replace('Target="/word/document2.xml"','Target="https://example.com/word/document2.xml"'));
 await assert.rejects(inspectDocx(await zip.generateAsync({type:'nodebuffer'})),/internal package path/);
 zip.file('_rels/.rels',rels.replace('Target="/word/document2.xml"','Target="/word/missing.xml"'));
 await assert.rejects(inspectDocx(await zip.generateAsync({type:'nodebuffer'})),/main part is missing/);
});
