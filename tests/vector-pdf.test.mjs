import test from 'node:test';
import assert from 'node:assert/strict';
import {nativePdf,renderNative} from '../src/font-renderer.mjs';
import {makeNewOle} from '../src/new-formula.mjs';
import {inspectOle,replaceOleLatex,oleLatex} from '../src/native.mjs';
import {outlineCommands,vectorPdfRequest,vectorInkBounds} from '../src/vector-pdf.mjs';

test('Ink bounds measure transformed Bezier extrema and intersect nested viewports',()=>{
 const svg='<svg viewBox="0 0 10 10"><g transform="translate(-5 2) scale(2)"><path d="M0 0Q10 20 20 0"/></g></svg>';
 assert.deepEqual(vectorInkBounds(vectorPdfRequest(svg,1,1)),[-5,2,35,22]);
 const cubic='<svg viewBox="0 0 10 10"><path d="M0 0C0 20 20 20 20 0"/></svg>';
 assert.deepEqual(vectorInkBounds(vectorPdfRequest(cubic,1,1)),[0,0,20,15]);
 const clipped='<svg viewBox="0 0 100 100"><svg x="10" y="20" width="30" height="40" viewBox="0 0 30 40"><path d="M0 -100L30 100"/></svg></svg>';
 assert.deepEqual(vectorInkBounds(vectorPdfRequest(clipped,1,1)),[10,20,40,60]);
});

test('Native outlines become PDF vector paths without bitmap XObjects',async()=>{
 for(const latex of ['x+1','\\frac{a+b}{\\sqrt{x^2+y^2}}','\\int_0^1 x^2','\\iint_D f(x,y)','\\begin{bmatrix}a&b\\\\c&d\\end{bmatrix}','\\begin{vmatrix}a&b\\\\c&d\\end{vmatrix}','\\hat{x}+\\sin{x}']){
  const ole=makeNewOle(latex),before=Buffer.from(ole),preview=await renderNative(ole),result=await nativePdf(ole),pdf=Buffer.from(result.pdf,'base64');
  assert.ok(pdf.length>500);assert.match(pdf.toString('latin1'),/^%PDF-/);assert.doesNotMatch(pdf.toString('latin1'),/\/Subtype\s*\/Image/);
  assert.equal(result.width,Math.round(preview.width*2540/72));assert.equal(result.height,Math.round(preview.height*2540/72));assert.deepEqual(ole,before);
  assert.ok(vectorPdfRequest(preview.svg,preview.width,preview.height).vector.length>0);
 }
});
test('Nested SVG delimiter viewports retain their translation and clipping in PDF',()=>{
 const result=vectorPdfRequest('<svg viewBox="0 0 100 100"><svg x="10" y="20" width="30" height="40" viewBox="0 -5 30 40"><path d="M0 -100L0 100"/></svg></svg>',12,12);
 assert.deepEqual(result.vector[0].matrix,[1,0,0,1,10,25]);
 assert.deepEqual(result.vector[0].clips,[{matrix:[1,0,0,1,0,0],rect:[10,20,30,40]}]);
});
test('Outline normalization preserves relative geometry and reflected curve controls',()=>{
 assert.deepEqual(outlineCommands('M1 2h3v4q1 2 3 4t5 6z'),[
  {op:'M',values:[1,2]},{op:'L',values:[4,2]},{op:'L',values:[4,6]},
  {op:'Q',values:[5,8,7,10]},{op:'Q',values:[9,12,12,16]},{op:'Z',values:[]}
 ]);
 const arc=outlineCommands('M0 0A2 2 0 0 0 4 4');assert.ok(arc.slice(1).every(c=>c.op==='C'));assert.deepEqual(arc.at(-1).values.slice(-2),[4,4]);
 assert.throws(()=>outlineCommands('M0 0A2 2 0 2 0 4 4'),/Invalid vector arc/);
});
test('Unmodified structure editing keeps every original native and companion byte',()=>{
 const original=makeNewOle('\\frac{x+1}{y}'),before=inspectOle(original).native;
 assert.deepEqual(replaceOleLatex(original,oleLatex(original)),original);
 assert.deepEqual(inspectOle(replaceOleLatex(original,oleLatex(original))).native,before);
});
