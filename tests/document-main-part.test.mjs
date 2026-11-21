import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {createDocx,inspectDocx,editDocx,arrangeDocx,flatOpc,fromFlatOpc} from '../src/document.mjs';
import {preflightNumbering,applyNumbering} from '../src/document-numbering-plan.mjs';

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
test('Numbering defaults and revision follow the main part’s internal settings relationship',async()=>{
 const zip=await JSZip.loadAsync(await alternateDocument());
 const withNumbering=(format,revision)=>`<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docVars><w:docVar w:name="EquationLabNumberFormat" w:val="${format}"/><w:docVar w:name="EquationLabNumberingRevision" w:val="${revision}"/></w:docVars></w:settings>`;
 zip.file('word/settings.xml',withNumbering('(#E1)',2));
 zip.file('word/preferences/main-settings.xml',withNumbering('[#C1-#E1]',27));
 const rels=await zip.file('word/_rels/document2.xml.rels').async('string');
 zip.file('word/_rels/document2.xml.rels',rels.replace('Target="settings.xml"','Target="preferences/main-settings.xml"'));
 const types=await zip.file('[Content_Types].xml').async('string');
 zip.file('[Content_Types].xml',types.replace('</Types>','<Override PartName="/word/preferences/main-settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>'));
 const bytes=await zip.generateAsync({type:'nodebuffer'});
 for(const nativeIndexOnly of [false,true]){
  const doc=await inspectDocx(bytes,{nativeIndexOnly});
  assert.equal(doc.numberFormat,'[#C1-#E1]');
  assert.equal(doc.numberingRevision,27);
 }
});

test('MathType default numbering follows the package custom properties relationship',async()=>{
 const zip=await JSZip.loadAsync(await createDocx([{latex:'x',layout:{mode:'numbered-right',numberFormat:'(#E1)'}}],{numberingFamily:'mathtype'}));
 const originalProps=await zip.file('docProps/custom.xml').async('string');
 zip.file('docProps/thesis-properties.xml',originalProps.replace('(#E1)','[#E1]'));
 const rootRels=await zip.file('_rels/.rels').async('string');
 zip.file('_rels/.rels',rootRels.replace('Target="docProps/custom.xml"','Target="/docProps/thesis-properties.xml"'));
 const types=await zip.file('[Content_Types].xml').async('string');
 zip.file('[Content_Types].xml',types.replace('</Types>','<Override PartName="/docProps/thesis-properties.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/></Types>'));
 const doc=await inspectDocx(await zip.generateAsync({type:'nodebuffer'}));
 assert.equal(doc.numberFormat,'[#E1]');
 assert.equal(doc.objects[0].layout.numberFormat,'(#E1)');
});

test('Reformatting a number and its defaults updates relocated metadata without duplicating parts',async()=>{
 const zip=await JSZip.loadAsync(await createDocx([{latex:'x',layout:{mode:'numbered-right',numberFormat:'(#E1)'}}],{numberingFamily:'mathtype',references:[{target:0}]}));
 const settings='word/prefs/settings.xml',custom='docProps/prefs.xml';
 zip.file(settings,await zip.file('word/settings.xml').async('string'));
 zip.file(custom,await zip.file('docProps/custom.xml').async('string'));
 zip.remove('word/settings.xml');zip.remove('docProps/custom.xml');
 const rootRels=await zip.file('_rels/.rels').async('string'),bodyRels=await zip.file('word/_rels/document.xml.rels').async('string');
 zip.file('_rels/.rels',rootRels.replace('Target="docProps/custom.xml"',`Target="${custom}"`));
 zip.file('word/_rels/document.xml.rels',bodyRels.replace('Target="settings.xml"','Target="prefs/settings.xml"'));
 const types=await zip.file('[Content_Types].xml').async('string');
 zip.file('[Content_Types].xml',types.replace('/word/settings.xml','/'+settings).replace('/docProps/custom.xml','/'+custom));
 const bytes=await zip.generateAsync({type:'nodebuffer'}),before=await inspectDocx(bytes),numberFormat='[#E1]';
 const plan=await preflightNumbering(bytes,{scope:'current',index:0,numberFormat,updateFuture:true});
 assert.equal(plan.summary.ready,1);assert.equal(plan.documentDefaultChanged,true);
 const output=await applyNumbering(bytes,plan),after=await inspectDocx(output.buffer);
 assert.equal(after.numberFormat,numberFormat);
 assert.equal(after.objects[0].layout.numberFormat,numberFormat);
 assert.equal(after.objects[0].nativeSha256,before.objects[0].nativeSha256);
 assert.equal(after.objects[0].layout.bookmarkName,before.objects[0].layout.bookmarkName);
 assert.equal(output.report.references.markedForUpdate,1);
 assert.equal(after.zip.file('word/settings.xml'),null);
 assert.equal(after.zip.file('docProps/custom.xml'),null);
 assert.match(await after.zip.file(settings).async('string'),/w:val="\[#E1\]"/);
 assert.match(await after.zip.file(custom).async('string'),/>\[#E1\]<\/vt:lpwstr>/);
 for(const path of ['_rels/.rels','word/_rels/document.xml.rels','[Content_Types].xml']){
  assert.equal(await after.zip.file(path).async('string'),await before.zip.file(path).async('string'));
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
