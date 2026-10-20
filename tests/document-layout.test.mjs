import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {createDocx,inspectDocx,arrangeDocx,flatOpc,fromFlatOpc} from '../src/document.mjs';

test('Numbered DOCX integrates live chapter fields, stable references and package settings',async()=>{
 const bytes=await createDocx([{latex:'x^{2}',layout:{mode:'numbered-right',numberFormat:'(#C1.#E1)',chapter:3}},{latex:'y^{2}',layout:{mode:'numbered-left',numberFormat:'(#C1.#E1)',chapter:3}}],{fragment:true,references:[{target:0,prefix:'见式 '}]}),r=await inspectDocx(bytes);
 assert.deepEqual(r.objects.map(o=>o.layout.numberText),['(3.1)','(3.2)']);assert.deepEqual(r.objects.map(o=>o.layout.mode),['numbered-right','numbered-left']);
 assert.deepEqual(r.objects.map(o=>[o.layout.numberFormat,o.layout.chapter,o.layout.section]),[['(#C1.#E1)',3,1],['(#C1.#E1)',3,1]]);
 const xml=await r.zip.file('word/document.xml').async('string');assert.equal((xml.match(/SEQ ELChapter \\r 3/g)||[]).length,1);assert.ok(xml.includes('REF '+r.objects[0].layout.bookmarkName));
 assert.match(await r.zip.file('word/settings.xml').async('string'),/updateFields/);
 const opc=await flatOpc(bytes);assert.match(opc,/wordprocessingml.settings\+xml/);
 const after=await inspectDocx(await fromFlatOpc(opc));assert.equal(after.objects[0].nativeSha256,r.objects[0].nativeSha256);
});

test('Changing numbering side preserves native bytes, reference anchors and unrelated package parts',async()=>{
 const source=await createDocx([{latex:'x^{2}',layout:{mode:'numbered-right'}},{latex:'y^{2}',layout:{mode:'numbered-right'}}],{references:[{target:0}]}),a=await inspectDocx(source);
 const output=await arrangeDocx(source,{indices:[0],layout:{mode:'numbered-left',numberFormat:'(#C1.#E1)',chapter:2}}),b=await inspectDocx(output);
 assert.equal(b.objects[0].layout.mode,'numbered-left');assert.equal(b.objects[0].layout.bookmarkName,a.objects[0].layout.bookmarkName);
 assert.deepEqual(b.objects.map(o=>o.nativeSha256),a.objects.map(o=>o.nativeSha256));
 for(const name of Object.keys(a.zip.files).filter(n=>!['word/document.xml','word/styles.xml'].includes(n)&&!a.zip.files[n].dir))assert.deepEqual(await b.zip.file(name).async('nodebuffer'),await a.zip.file(name).async('nodebuffer'));
 await assert.rejects(arrangeDocx(output,{indices:[0],layout:{mode:'display'}}),/引用/);
});

test('Arrangement rejects inline prose and custom bookmarks before writing',async()=>{
 const bytes=await createDocx([{latex:'x^{2}'}]),zip=await JSZip.loadAsync(bytes);
 let xml=await zip.file('word/document.xml').async('string');xml=xml.replace('<w:object','<w:t>Do not discard this prose.</w:t><w:object');zip.file('word/document.xml',xml);
 const altered=await zip.generateAsync({type:'nodebuffer'});await assert.rejects(arrangeDocx(altered,{layout:{mode:'numbered-right'}}),/正文/);
 const {objects}=await inspectDocx(altered);assert.equal(objects[0].latex,'x^{2}');
});

test('Complex fields produced by Word remain recognizable with only cached number text',async()=>{
 const bytes=await createDocx([{latex:'x^{2}',layout:{mode:'numbered-right'}}]),zip=await JSZip.loadAsync(bytes);let xml=await zip.file('word/document.xml').async('string');
 xml=xml.replace(/<w:fldSimple w:instr="(SEQ EquationLab[^"]*)" w:dirty="true">([\s\S]*?)<\/w:fldSimple>/g,(_,code,result)=>`<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>${code}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${result}<w:r><w:fldChar w:fldCharType="end"/></w:r>`);zip.file('word/document.xml',xml);
 const input=await zip.generateAsync({type:'nodebuffer'}),r=await inspectDocx(input);assert.equal(r.objects[0].layout.mode,'numbered-right');assert.equal(r.objects[0].layout.numberText,'(1)');
 assert.equal(r.objects[0].layout.numberFormat,'(#E1)');
 const changed=await arrangeDocx(input,{layout:{mode:'numbered-left'}});assert.equal((await inspectDocx(changed)).objects[0].layout.bookmarkName,r.objects[0].layout.bookmarkName);
});

test('Adding chapter numbers to existing standalone formulas initializes context and continues live counters',async()=>{
 const bytes=await createDocx([{latex:'a'},{latex:'b'},{latex:'c'}],{fragment:true});
 const first=await arrangeDocx(bytes,{indices:[0],layout:{mode:'numbered-right',numberFormat:'(#C1.#E1)',chapter:4}});
 const second=await arrangeDocx(first,{indices:[2],layout:{mode:'numbered-right',numberFormat:'(#C1.#E1)',chapter:9}});
 const r=await inspectDocx(second);assert.equal(r.objects[0].layout.numberText,'(4.1)');assert.equal(r.objects[2].layout.numberText,'(4.2)');
 const xml=await r.zip.file('word/document.xml').async('string');assert.equal((xml.match(/SEQ ELChapter \\r 4/g)||[]).length,1);assert.doesNotMatch(xml,/SEQ ELChapter \\r 9/);
});

test('Arrangement preserves empty hidden shapes emitted by Word while rejecting image-bearing shapes',async()=>{
 const source=await createDocx([{latex:'x^{4}'}]),zip=await JSZip.loadAsync(source),native=(await inspectDocx(source)).objects[0].nativeSha256;
 const hidden='<w:r><w:pict><v:shape id="WordHidden" style="visibility:hidden;width:50pt;height:50pt"><v:stroke joinstyle="miter"/><v:formulas/><v:path/><o:lock v:ext="edit"/></v:shape></w:pict></w:r>';
 zip.file('word/document.xml',(await zip.file('word/document.xml').async('string')).replace('<w:r><w:rPr><w:position',hidden+'<w:r><w:rPr><w:position'));
 const input=await zip.generateAsync({type:'nodebuffer'}),result=await inspectDocx(await arrangeDocx(input,{layout:{mode:'numbered-right'}}));
 assert.equal(result.objects[0].nativeSha256,native);assert.match(await result.zip.file('word/document.xml').async('string'),/id="WordHidden"/);
 zip.file('word/document.xml',(await zip.file('word/document.xml').async('string')).replace('<v:formulas/>','<v:imagedata r:id="rImg1"/>'));
 await assert.rejects(arrangeDocx(await zip.generateAsync({type:'nodebuffer'}),{layout:{mode:'numbered-right'}}),/正文/);
});
