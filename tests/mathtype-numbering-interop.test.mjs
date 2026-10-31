import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocx,inspectDocx,flatOpc,fromFlatOpc} from '../src/document.mjs';
import {scanWordNumberingPart} from '../src/document-audit.mjs';
import {equationLayout,chapterBreak} from '../src/layout.mjs';
import {DOMParser} from '@xmldom/xmldom';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const run='<w:r><w:object><o:OLEObject ProgID="Equation.DSMT4"/></w:object></w:r>';
const scan=xml=>scanWordNumberingPart(new DOMParser().parseFromString(`<w:document xmlns:w="${W}" xmlns:o="urn:schemas-microsoft-com:office:office"><w:body>${xml}</w:body></w:document>`,'application/xml'),'word/document.xml');

test('Shared numbering increments exactly once outside each reference bookmark and repeats inside it',()=>{
 const first=equationLayout(run,{numberingFamily:'mathtype',mode:'numbered-right',numberFormat:'(#C1.#S1.#E1)',chapter:3,section:2,equation:4,bookmarkName:'EL_Stable',bookmarkId:1});
 const state=scan(chapterBreak({numberingFamily:'mathtype',chapter:3,section:2})+first.xml);
 assert.deepEqual(state.structural,[]);
 const bookmark=state.bookmarks[0],equations=state.fields.filter(f=>f.instruction.role==='equation');
 assert.equal(bookmark.cachedText,'(3.2.4)');assert.equal(bookmark.numberFormat,'(#C1.#S1.#E1)');
 assert.equal(equations.filter(f=>f.instruction.hidden&&!f.instruction.repeat&&f.instruction.reset===null).length,1);
 const increment=equations.find(f=>f.instruction.hidden&&f.instruction.reset===null),visible=equations.find(f=>!f.instruction.hidden);
 assert.ok(increment.end<bookmark.start);assert.equal(visible.instruction.repeat,true);
 assert.equal(state.fields.filter(f=>f.instruction.family==='equationlab').length,0);
 assert.ok(state.fields.some(f=>/^\s*MACROBUTTON MTEditEquationSection2/.test(f.code)));
 assert.ok(state.fields.some(f=>/^\s*MACROBUTTON MTPlaceRef/.test(f.code)));
});

test('Shared counter reset is carried by the hidden increment rather than a second visible increment',()=>{
 const state=scan(equationLayout(run,{numberingFamily:'mathtype',mode:'numbered-left',equation:8,resetEquation:true}).xml);
 const counters=state.fields.filter(f=>f.instruction.role==='equation');
 assert.equal(counters.length,2);assert.equal(counters[0].instruction.reset,8);assert.equal(counters[0].instruction.hidden,true);assert.equal(counters[1].instruction.repeat,true);
 assert.equal(state.bookmarks[0].cachedText,'(8)');
});

test('Shared DOCX saves the MathType default and preserves Native, exact number format and REF anchors through Flat OPC',async()=>{
 const bytes=await createDocx([{latex:'x^2',layout:{mode:'numbered-right',chapter:3,section:2,numberFormat:'(#C1.#E1)'}},{latex:'y^2',layout:{mode:'numbered-left',chapter:3,section:2,numberFormat:'(#C1.#E1)'}}],{numberingFamily:'mathtype',fragment:true,references:[{target:0}]}),first=await inspectDocx(bytes),second=await inspectDocx(await fromFlatOpc(await flatOpc(bytes)));
 assert.deepEqual(second.objects.map(o=>o.nativeSha256),first.objects.map(o=>o.nativeSha256));
 assert.deepEqual(second.objects.map(o=>[o.layout.mode,o.layout.numberText,o.layout.numberingFamily,o.layout.numberFormat,o.layout.chapter,o.layout.section]),[['numbered-right','(3.1)','mathtype','(#C1.#E1)',3,2],['numbered-left','(3.2)','mathtype','(#C1.#E1)',3,2]]);
 assert.equal(second.objects[0].layout.referenceCount,1);assert.equal(second.objects[0].layout.bookmarkName,first.objects[0].layout.bookmarkName);
 assert.match(await first.zip.file('docProps/custom.xml').async('string'),/name="MTEquationNumber2"><vt:lpwstr>\(#C1\.#E1\)<\/vt:lpwstr>/);
 assert.match(await first.zip.file('docProps/custom.xml').async('string'),/name="MTEquationSection"/);
 assert.match(await first.zip.file('_rels/.rels').async('string'),/relationships\/custom-properties/);
 assert.match(await first.zip.file('[Content_Types].xml').async('string'),/PartName="\/docProps\/custom.xml"/);
 assert.match(await first.zip.file('word/settings.xml').async('string'),/w:name="EquationLabNumberFormat" w:val="\(#C1\.#E1\)"/);
});

test('An unreferenced native MathType number remains readable before MathType creates its reference bookmark',async()=>{
 const before=await inspectDocx(await createDocx([{latex:'x+1',layout:{mode:'numbered-right',chapter:3,section:2,numberFormat:'(#C1.#S1.#E1)'}}],{numberingFamily:'mathtype'}));
 const original=await before.zip.file(before.mainPart).async('string');
 const xml=original.replace(/<w:bookmark(?:Start|End)\b[^>]*\/>/g,'');before.zip.file(before.mainPart,xml);
 const bytes=await before.zip.generateAsync({type:'nodebuffer'}),after=await inspectDocx(bytes),layout=after.objects[0].layout;
 assert.equal(after.objects[0].nativeSha256,before.objects[0].nativeSha256);
 assert.equal(layout.numberText,'(3.2.1)');assert.equal(layout.numberFormat,'(#C1.#S1.#E1)');assert.equal(layout.numberingFamily,'mathtype');assert.equal(layout.mode,'numbered-right');assert.equal(layout.equation,1);
 assert.equal(layout.bookmarkName,null);assert.equal(layout.referenceCount,0);
 assert.equal(await after.zip.file(after.mainPart).async('string'),xml,'inspection does not synthesize an anchor');
 const {arrangeDocx}=await import('../src/document.mjs');
 await assert.rejects(arrangeDocx(bytes,{layout:{mode:'numbered-left'}}),/编号/,'read-only recognition does not bypass the copy writer anchor check');
});

test('Unbookmarked number recognition rejects ambiguous, locked, tracked and foreign-field envelopes',async()=>{
 const original=await inspectDocx(await createDocx([{latex:'x',layout:{mode:'numbered-right',numberFormat:'(#E1)'}}],{numberingFamily:'mathtype'}));
 const base=(await original.zip.file(original.mainPart).async('string')).replace(/<w:bookmark(?:Start|End)\b[^>]*\/>/g,'');
 const variants=[
  base.replace('SEQ MTEqn \\c','SEQ Figure \\c'),
  base.replace(/(<w:fldChar w:fldCharType="begin")\/(><\/w:r><w:r><w:instrText[^>]*> MACROBUTTON MTPlaceRef)/,'$1 w:fldLock="true"/$2'),
  base.replace(' MACROBUTTON MTPlaceRef ',' MACROBUTTON MTPlaceRef \\unknown '),
  base.replace(/(<w:p\b[^>]*>)([\s\S]*?)(<\/w:p>)/g,(all,start,contents,end)=>contents.includes('MTPlaceRef')?start+'<w:ins>'+contents+'</w:ins>'+end:all)
 ];
 for(const [index,xml]of variants.entries()){original.zip.file(original.mainPart,xml);const after=await inspectDocx(await original.zip.generateAsync({type:'nodebuffer'}));assert.equal(after.objects[0].layout.numberingFamily,undefined,`unsafe envelope ${index}`);}
});

test('A document cannot mix private and shared counter families under one cached sequence',async()=>{
 await assert.rejects(createDocx([{latex:'x',layout:{mode:'numbered-right',chapter:3,numberingFamily:'mathtype'}},{latex:'y',layout:{mode:'numbered-right',chapter:3,numberingFamily:'equationlab'}}],{numberingFamily:'mathtype'}),/one numbering family/);
});

test('A MathType format change takes precedence over its older synchronized EL default',async()=>{
 const before=await inspectDocx(await createDocx([{latex:'x',layout:{mode:'numbered-right',chapter:3,numberFormat:'(#C1.#E1)'}}],{numberingFamily:'mathtype'}));
 before.zip.file('docProps/custom.xml',(await before.zip.file('docProps/custom.xml').async('string')).replace('(#C1.#E1)','[#C1.#S1.#E1]'));
 const after=await inspectDocx(await before.zip.generateAsync({type:'nodebuffer'}));
 assert.equal(after.numberFormat,'[#C1.#S1.#E1]');assert.equal(after.objects[0].layout.numberFormat,'(#C1.#E1)','the document default does not silently rewrite an existing number');
});

test('Arranging a shared number keeps its counter family, Native bytes and reference name',async()=>{
 const {arrangeDocx}=await import('../src/document.mjs');
 const bytes=await createDocx([{latex:'x',layout:{mode:'numbered-right',chapter:3,section:2,numberFormat:'(#C1.#E1)'}},{latex:'y',layout:{mode:'numbered-right',chapter:3,section:2,numberFormat:'(#C1.#E1)'}}],{numberingFamily:'mathtype',references:[{target:1}]}),before=await inspectDocx(bytes),after=await inspectDocx(await arrangeDocx(bytes,{indices:[1],layout:{mode:'numbered-left',numberFormat:'[#C1.#S1.#E1]'}}));
 assert.deepEqual(after.objects.map(o=>o.nativeSha256),before.objects.map(o=>o.nativeSha256));
 assert.equal(after.objects[1].layout.bookmarkName,before.objects[1].layout.bookmarkName);assert.match(after.objects[1].layout.bookmarkName,/^ZEqnNum\d{6}$/);
 assert.equal(after.objects[1].layout.referenceCount,1);assert.equal(after.objects[1].layout.numberingFamily,'mathtype');assert.equal(after.objects[1].layout.mode,'numbered-left');assert.equal(after.objects[1].layout.numberText,'[3.2.2]');
});

test('Shared copy arrangement refuses content or extra fields outside the bounded number bookmark',async()=>{
 const {arrangeDocx}=await import('../src/document.mjs');
 for(const prefix of ['Eq. ','<field>']){
  const before=await inspectDocx(await createDocx([{latex:'x',layout:{mode:'numbered-right'}}],{numberingFamily:'mathtype'}));
  let xml=await before.zip.file('word/document.xml').async('string');
  const added=prefix==='<field>'?'<w:fldSimple w:instr="SEQ Figure \\n"><w:r><w:t>9</w:t></w:r></w:fldSimple>':'<w:r><w:instrText>Eq. </w:instrText></w:r>';
  xml=xml.replace('<w:bookmarkStart ',added+'<w:bookmarkStart ');before.zip.file('word/document.xml',xml);
  await assert.rejects(arrangeDocx(await before.zip.generateAsync({type:'nodebuffer'}),{layout:{mode:'numbered-left'}}),/编号/);
 }
});

test('Shared copy formatting changes only the bounded display and synchronizes both future defaults',async()=>{
 const {preflightNumbering,applyNumbering}=await import('../src/document-numbering-plan.mjs');
 const input=await createDocx([{latex:'x',layout:{mode:'numbered-right',chapter:3,section:2,numberFormat:'(#C1.#E1)'}},{latex:'y',layout:{mode:'numbered-right',chapter:3,section:2,numberFormat:'(#C1.#E1)'}}],{numberingFamily:'mathtype',references:[{target:1}]}),before=await inspectDocx(input),plan=await preflightNumbering(input,{scope:'current',index:1,numberFormat:'[#C1.#S1.#EI]',updateFuture:true});
 assert.equal(plan.summary.ready,1,JSON.stringify(plan.targets));
 const output=await applyNumbering(input,plan),after=await inspectDocx(output.buffer);
 assert.equal(after.objects[0].layout.numberText,'(3.1)');assert.equal(after.objects[1].layout.numberText,'[3.2.II]');assert.equal(after.numberFormat,'[#C1.#S1.#EI]');
 assert.deepEqual(after.objects.map(o=>o.nativeSha256),before.objects.map(o=>o.nativeSha256));assert.equal(after.objects[1].layout.bookmarkName,before.objects[1].layout.bookmarkName);
 const original=scanWordNumberingPart(before.doc,before.mainPart).fields.filter(f=>f.instruction.hidden).map(f=>f.code),written=scanWordNumberingPart(after.doc,after.mainPart).fields.filter(f=>f.instruction.hidden).map(f=>f.code);
 assert.deepEqual(written,original,'display formatting never rebuilds or increments the hidden counter chain');
 assert.match(await after.zip.file('word/settings.xml').async('string'),/w:val="\[#C1\.#S1\.#EI\]"/);
 assert.match(await after.zip.file('docProps/custom.xml').async('string'),/>\[#C1\.#S1\.#EI\]<\/vt:lpwstr>/);
});

test('An explicit equation restart survives both shared side changes and display-format changes',async()=>{
 const {arrangeDocx}=await import('../src/document.mjs'),{preflightNumbering,applyNumbering}=await import('../src/document-numbering-plan.mjs');
 const bytes=await createDocx([{latex:'x',layout:{mode:'numbered-right',resetEquation:true,equation:8,chapter:3,numberFormat:'(#C1.#E1)'}},{latex:'y',layout:{mode:'numbered-right',chapter:3,numberFormat:'(#C1.#E1)'}}],{numberingFamily:'mathtype'});
 const moved=await arrangeDocx(bytes,{indices:[0],layout:{mode:'numbered-left',numberFormat:'[#E1]'}}),a=await inspectDocx(moved);
 assert.equal(a.objects[0].layout.equationReset,8);assert.equal(a.objects[0].layout.numberText,'[8]');assert.equal(a.objects[1].layout.numberText,'(3.9)');
 const result=await applyNumbering(moved,await preflightNumbering(moved,{scope:'current',index:0,numberFormat:'(#EI)'})),b=await inspectDocx(result.buffer);
 assert.equal(b.objects[0].layout.equationReset,8);assert.equal(b.objects[0].layout.numberText,'(VIII)');assert.equal(b.objects[1].layout.numberText,'(3.9)');
});

test('A future default set before the first number is shared with MathType and later MathType changes remain visible',async()=>{
 const {preflightNumbering,applyNumbering}=await import('../src/document-numbering-plan.mjs');
 const input=await createDocx([{latex:'x',layout:{mode:'display'}}],{numberingFamily:'mathtype'}),before=await inspectDocx(input);
 const {buffer}=await applyNumbering(input,await preflightNumbering(input,{scope:'future',numberFormat:'(#C1.#E1)'})),after=await inspectDocx(buffer);
 assert.equal(after.numberFormat,'(#C1.#E1)');assert.equal(after.objects[0].layout.bookmarkName,null);
 assert.equal(after.objects[0].nativeSha256,before.objects[0].nativeSha256);
 assert.equal(await after.zip.file('word/document.xml').async('string'),await before.zip.file('word/document.xml').async('string'));
 assert.match(await after.zip.file('docProps/custom.xml').async('string'),/>\(#C1\.#E1\)<\/vt:lpwstr>/);
 after.zip.file('docProps/custom.xml',(await after.zip.file('docProps/custom.xml').async('string')).replace('(#C1.#E1)','[#E1]'));
 assert.equal((await inspectDocx(await after.zip.generateAsync({type:'nodebuffer'}))).numberFormat,'[#E1]');
});
