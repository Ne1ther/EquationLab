import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {operation} from '../src/server.mjs';
import {inspectDocx} from '../src/document.mjs';
import {scanWordNumberingPart,parseDocxXml} from '../src/document-audit.mjs';
test('native ribbon inserts a single editable equation fragment without prototype prose',async()=>{
 for(const mode of ['inline','display','numbered-right','numbered-left']){
  const result=await operation('ribbon-create',{layout:{mode}}),bytes=Buffer.from(result.docx,'base64'),zip=await JSZip.loadAsync(bytes);
  const xml=await zip.file('word/document.xml').async('string');assert.doesNotMatch(xml,/compatibility prototype|Formula 1/);
  const objects=(await inspectDocx(bytes)).objects;assert.equal(objects.length,1);assert.match(xml,/ProgID="Equation.DSMT4"/);
  if(mode.startsWith('numbered')){
   assert.equal(objects[0].layout.numberingFamily,'mathtype');assert.match(xml,/SEQ MTEqn/);
   assert.doesNotMatch(xml,/SEQ (?:EquationLab|ELChapter|ELSection)\b/);
  }
  assert.match(result.ooxml,/Equation.DSMT4/);
 }
});
test('native chapter and standalone-number fragments preserve both live counters and the chosen format',async()=>{
 const layout={mode:'inline',chapter:3,section:2,equation:2,numberFormat:'(#C1.#S1.#E1)'};
 const chapter=await operation('ribbon-chapter',{layout}),number=await operation('ribbon-number',{layout});
 const chapterZip=await JSZip.loadAsync(Buffer.from(chapter.docx,'base64')),numberZip=await JSZip.loadAsync(Buffer.from(number.docx,'base64'));
 const context=await chapterZip.file('word/document.xml').async('string'),xml=await numberZip.file('word/document.xml').async('string');
 assert.match(context,/SEQ MTChap \\r 3 \\h/);assert.match(context,/SEQ MTSec \\r 2 \\h/);
 assert.match(xml,/SEQ MTChap \\c/);assert.match(xml,/SEQ MTSec \\c/);assert.match(xml,/SEQ MTEqn \\n \\h/);assert.match(xml,/w:name="ZEqnNum\d{6}"/);
 const scan=scanWordNumberingPart(parseDocxXml(xml),'word/document.xml');
 assert.deepEqual(scan.structural,[]);assert.equal(scan.bookmarks[0].numberFormat,layout.numberFormat);assert.equal(scan.bookmarks[0].cachedText,'(3.2.2)');
 assert.equal(scan.fields.filter(f=>f.instruction.role==='equation'&&!f.instruction.repeat).length,1);
 assert.doesNotMatch(context+xml,/SEQ (?:EquationLab|ELChapter|ELSection)\b/);
});
