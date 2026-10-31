import test from 'node:test';
import assert from 'node:assert/strict';
import {makeNewOle} from '../src/new-formula.mjs';
import {oleLatex,replaceOleLatex,inspectOle,characters} from '../src/native.mjs';
import {renderNative,nativePdf} from '../src/font-renderer.mjs';
import {createDocx,inspectDocx,replaceDocxEquation} from '../src/document.mjs';
import {desktopRequest} from '../src/desktop-rpc.mjs';

// Generated inputs only; supplementary-plane characters and emoji are outside this regression.
for(const [label,latex,chars] of [
 ['raw mixed','x中','中'],['raw Chinese','中文','中文'],
 ['fraction',String.raw`\frac{中文}{x中}`,'中文中'],
 ['text and symbols',String.raw`\text{中文}+x+\alpha+\sum`,'中文']
]) test(`BMP Chinese ${label} validates, previews, and survives DOCX no-op and rebuild`,async()=>{
 const validation=await desktopRequest({action:'validate',payload:{previewOnly:true,latex}});
 assert.ok(validation.nativeBytes>0);assert.deepEqual(validation.warnings,[]);
 const ole=makeNewOle(latex),before=Buffer.from(ole),decoded=oleLatex(ole);
 assert.equal([...decoded].filter(c=>/[中文]/u.test(c)).join(''),chars);
 const preview=await renderNative(ole,{raster:false});assert.deepEqual(preview.warnings,[]);
 assert.ok(preview.faces.some(f=>f.font==='Arial Unicode MS'&&f.postscript==='ArialUnicodeMS'));
 assert.ok(preview.width>0&&preview.height>0);assert.ok((await nativePdf(ole)).pdf);
 if(label==='text and symbols'){
  assert.ok(preview.faces.some(f=>f.font==='Times New Roman'));
  assert.ok(preview.faces.some(f=>f.font==='Symbol'));
  assert.match(decoded,/\\alpha/);assert.match(decoded,/\\sum/);
 }
 assert.deepEqual(replaceOleLatex(ole,decoded),before);
 const doc=await createDocx([{ole}]),opened=await inspectDocx(doc);
 assert.equal(opened.objects.length,1);assert.equal(opened.objects[0].previewError,undefined);
 assert.deepEqual(opened.objects[0].ole,before);
 const noop=await inspectDocx(await replaceDocxEquation(doc,0,opened.objects[0].latex));
 assert.deepEqual(noop.objects[0].ole,before);
 const rebuilt=await inspectDocx(await replaceDocxEquation(doc,0,opened.objects[0].latex+String.raw`+\sqrt{z}`));
 assert.equal([...rebuilt.objects[0].latex].filter(c=>/[中文]/u.test(c)).join(''),chars);
 assert.match(rebuilt.objects[0].latex,/\\sqrt\{z\}/);assert.notDeepEqual(rebuilt.objects[0].ole,before);
 assert.deepEqual((await renderNative(rebuilt.objects[0].ole,{raster:false})).warnings,[]);
 assert.deepEqual(ole,before);
});

test('ASCII text, variables, Greek and mathematical symbols retain their native faces',async()=>{
 const ole=makeNewOle(String.raw`\text{Hello}+x+\alpha+\sum`),preview=await renderNative(ole,{raster:false});
 assert.deepEqual(preview.warnings,[]);
 assert.ok(preview.faces.some(f=>f.font==='Times New Roman'&&f.style===0&&f.postscript==='TimesNewRomanPSMT'));
 assert.ok(preview.faces.some(f=>f.font==='Times New Roman'&&f.style===2&&f.postscript==='TimesNewRomanPS-ItalicMT'));
 assert.ok(preview.faces.some(f=>f.font==='Symbol'&&f.postscript==='Symbol'));
 assert.ok(!preview.faces.some(f=>f.font==='Arial Unicode MS'));
 const decoded=oleLatex(ole);for(const char of 'Hello')assert.ok(decoded.includes(`\\text{${char}}`));
 assert.match(decoded,/\\alpha/);assert.match(decoded,/\\sum/);
});

// The selected faces have no Chinese glyph on this host. Keep the rejection
// explicit: silently changing the author's requested family is data loss.
for(const [command,family] of [['mathtt','Courier New'],['mathsf','Arial'],['mathrm','Times New Roman']])
 test(`explicit ${command} is retained on no-op and CJK rebuild fails safely when unsupported`,async()=>{
  const original=makeNewOle(`\\${command}{x}`),before=Buffer.from(original);
  const p=inspectOle(original).parsed,styles=p.records.filter(n=>n.type===8),fonts=p.records.filter(n=>n.type===17),x=characters(p).find(c=>c.char==='x');
  assert.equal(fonts[styles[-x.typeface-1].font-1].name,family);
  const doc=await createDocx([{ole:original}]),opened=await inspectDocx(doc);
  const saved=await inspectDocx(await replaceDocxEquation(doc,0,opened.objects[0].latex));
  assert.deepEqual(saved.objects[0].ole,before);
  const edited=`\\${command}{中x}`;
  assert.throws(()=>replaceOleLatex(original,edited),/U\+4e2d/);
  await assert.rejects(replaceDocxEquation(doc,0,edited),/U\+4e2d/);
  assert.deepEqual(original,before);assert.deepEqual((await inspectDocx(doc)).objects[0].ole,before);
 });
