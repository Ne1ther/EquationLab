import test from 'node:test';
import assert from 'node:assert/strict';
import {makeNewOle} from '../src/new-formula.mjs';
import {renderNative,nativePdf} from '../src/font-renderer.mjs';

test('Replacement operators and parametric marks render as SVG and vector PDF without changing native data',async()=>{
 const samples=[String.raw`\coprod_i^n x_i+\bigcap_i^n A_i+\bigcup_i^n B_i`,
  String.raw`\mtjstat{x}+\mtjstat{ABCD}`,String.raw`\oint x+\oiint x+\oiiint x`,
  String.raw`\ointctrclockwise x+\varointclockwise x`];
 for(const latex of samples){
  const ole=makeNewOle(latex),before=Buffer.from(ole),preview=await renderNative(ole),pdf=Buffer.from((await nativePdf(ole)).pdf,'base64');
  assert.ok(preview.width>0&&preview.height>0,latex);
  assert.ok(preview.png.length>100,latex);
  assert.doesNotMatch(preview.svg,/<text\b|data-mjx-error/,latex);
  assert.match(pdf.toString('latin1'),/^%PDF-/,latex);
  assert.doesNotMatch(pdf.toString('latin1'),/\/Subtype\s*\/Image/,latex);
  assert.deepEqual(ole,before,latex);
 }
});
