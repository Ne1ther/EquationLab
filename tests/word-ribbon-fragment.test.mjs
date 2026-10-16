import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {operation} from '../src/server.mjs';
import {inspectDocx} from '../src/document.mjs';
test('native ribbon inserts a single editable equation fragment without prototype prose',async()=>{
 for(const mode of ['inline','display','numbered-right','numbered-left']){
  const result=await operation('ribbon-create',{layout:{mode}}),bytes=Buffer.from(result.docx,'base64'),zip=await JSZip.loadAsync(bytes);
  const xml=await zip.file('word/document.xml').async('string');assert.doesNotMatch(xml,/compatibility prototype|Formula 1/);
  const objects=(await inspectDocx(bytes)).objects;assert.equal(objects.length,1);assert.match(xml,/ProgID="Equation.DSMT4"/);
  if(mode.startsWith('numbered'))assert.match(xml,/SEQ EquationLab/);
  assert.match(result.ooxml,/Equation.DSMT4/);
 }
});
test('native chapter and standalone-number fragments preserve both live counters and the chosen format',async()=>{
 const layout={mode:'inline',chapter:3,section:2,equation:2,numberFormat:'(#C1.#S1.#E1)'};
 const chapter=await operation('ribbon-chapter',{layout}),number=await operation('ribbon-number',{layout});
 const chapterZip=await JSZip.loadAsync(Buffer.from(chapter.docx,'base64')),numberZip=await JSZip.loadAsync(Buffer.from(number.docx,'base64'));
 const context=await chapterZip.file('word/document.xml').async('string'),xml=await numberZip.file('word/document.xml').async('string');
 assert.match(context,/SEQ ELChapter \\r 3 \\h/);assert.match(context,/SEQ ELSection \\r 2 \\h/);
 assert.match(xml,/SEQ ELChapter \\c/);assert.match(xml,/SEQ ELSection \\c/);assert.match(xml,/SEQ EquationLab \\n/);assert.match(xml,/w:name="EL_/);
});
