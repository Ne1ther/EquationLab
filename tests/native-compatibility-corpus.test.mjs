import test from 'node:test';
import assert from 'node:assert/strict';
import {makeNewOle} from '../src/new-formula.mjs';
import {inspectOle,oleLatex,replaceOleLatex,patchRuler,readRuler} from '../src/native.mjs';
import {createDocx,inspectDocx,hash} from '../src/document.mjs';
import {renderNative,nativePdf} from '../src/font-renderer.mjs';
// Original generated formulas. This is a regression corpus, not an original
// MathType/Word runtime oracle or a source of thesis/private document material.
const cases=[
 ['fraction',String.raw`q=\frac{x+3}{y^2+2}`],
 ['matrix',String.raw`A=\begin{bmatrix}1&x\\y&2\end{bmatrix}`],
 ['aligned',String.raw`\begin{aligned}u&=x+y\\v&=x-y\end{aligned}`],
 ['integral',String.raw`I=\int_0^2\frac{t}{1+t^2}\,dt`],
 ['cases-spacing',String.raw`g(x)=\begin{cases}x^2&x>0\\[4pt]0&x=0\end{cases}`],
 ['local-style',String.raw`\textcolor{#3344aa}{\mathbf{v}}+\mathit{x}`],
 ['ruler',String.raw`p\eltab q=3`,[{position:1152,type:0}]],
 ['unmapped',String.raw`x+\mtmissing{f700}{108}{Euclid Math One}{EuclidMath1}{0}`,undefined,true]
];
test('fixed generated native corpus preserves no-op bytes, rulers, preview geometry and DOCX readback',async()=>{
 const originals=[];
 for(const [id,latex,tabs,unmapped]of cases){
  const ole=tabs?patchRuler(makeNewOle(latex),tabs):makeNewOle(latex),before=Buffer.from(ole),native=inspectOle(ole).native;
  assert.deepEqual(replaceOleLatex(ole,oleLatex(ole)),ole,id+' no-op');
  const preview=await renderNative(ole,{raster:false});assert.ok([preview.width,preview.height,preview.depth].every(Number.isFinite));assert.ok(preview.width>0&&preview.height>0,id);
  assert.equal(preview.warnings.length>0,!!unmapped,id);assert.deepEqual(ole,before,id+' render is read-only');
  const pdf=await nativePdf(ole);assert.equal(Buffer.from(pdf.pdf,'base64').subarray(0,5).toString(),'%PDF-');
  originals.push({id,ole,nativeSha256:hash(native),ruler:readRuler(ole)});
 }
 const copy=await createDocx(originals.map(({id,ole})=>({ole,label:id})),{fragment:true}),readback=await inspectDocx(copy);
 assert.equal(readback.objects.length,cases.length);
 for(const [index,object]of readback.objects.entries()){assert.equal(object.nativeSha256,originals[index].nativeSha256);assert.deepEqual(readRuler(object.ole),originals[index].ruler);}
});
