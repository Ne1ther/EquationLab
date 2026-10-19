import test from 'node:test';
import assert from 'node:assert/strict';
import {previewNumberFormat,equationLayout} from '../src/layout.mjs';
import {desktopRequest} from '../src/desktop-rpc.mjs';
import {createDocx,inspectDocx} from '../src/document.mjs';
import {XMLSerializer} from '@xmldom/xmldom';

test('Inspector previews match the exact exported Word number, including custom punctuation and Word alphabetic sequences',async()=>{
 const run='<w:r><w:t>x</w:t></w:r>';
 for(const [pattern,values,expected] of [
  ['(#E1)',{equation:12},'(12)'],['(#C1.#E1)',{chapter:3,equation:2},'(3.2)'],
  ['(#C1.#S1.#E1)',{chapter:3,section:2,equation:10},'(3.2.10)'],
  ['[#E1]',{equation:7},'[7]'],['(#C1-#E1)',{chapter:3,equation:2},'(3-2)'],
  ['式（#C1—#EI）',{chapter:3,equation:14},'式（3—XIV）'],
  ['#EA',{equation:28},'BB'],['#Ei',{equation:49},'xlix']
 ]){
  assert.equal(previewNumberFormat(pattern,values),expected);
  assert.equal(equationLayout(run,{mode:'numbered-right',numberFormat:pattern,...values}).numberText,expected);
  assert.deepEqual(await desktopRequest({action:'numberingPreview',payload:{pattern,values}}),{text:expected});
 }
 for(const pattern of ['(#C1)','#E1.#E1','#E1.#C1','#E0','(#E1)\u0000'])await assert.rejects(desktopRequest({action:'numberingPreview',payload:{pattern}}));
 for(const values of [{chapter:0},{section:1.5},{equation:32768}])assert.throws(()=>previewNumberFormat('(#E1)',values));
 assert.throws(()=>previewNumberFormat('(#EI)',{equation:4000}));
});

test('Document details distinguish the actual cached number from counters and count references to the exact bookmark',async()=>{
 const bytes=await createDocx([
  {latex:'x',layout:{mode:'numbered-right',chapter:3,section:2,numberFormat:'(#C1.#S1.#E1)'}},
  {latex:'y',layout:{mode:'numbered-left',chapter:3,section:2,numberFormat:'(#C1.#S1.#E1)'}}
 ],{references:[{target:1},{target:1},{target:0}]});
 const result=await inspectDocx(bytes);
 assert.deepEqual(result.objects.map(o=>[o.layout.numberText,o.layout.chapter,o.layout.section,o.layout.equation,o.layout.referenceCount]),[
  ['(3.2.1)',3,2,1,1],['(3.2.2)',3,2,2,2]
 ]);
 const w='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
 const counters=Array.from(result.doc.getElementsByTagNameNS(w,'fldSimple')).filter(f=>/^SEQ EquationLab /.test(f.getAttributeNS(w,'instr')));
 counters.at(-1).getElementsByTagNameNS(w,'t')[0].textContent='99';
 result.zip.file('word/document.xml',new XMLSerializer().serializeToString(result.doc));
 const stale=await inspectDocx(await result.zip.generateAsync({type:'nodebuffer'}));
 assert.equal(stale.objects[1].layout.equation,2);
 assert.equal(stale.objects[1].layout.numberText,'(3.2.99)');
});
