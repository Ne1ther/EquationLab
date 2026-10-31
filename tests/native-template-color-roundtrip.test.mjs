import test from 'node:test';
import assert from 'node:assert/strict';
import {makeNewOle} from '../src/new-formula.mjs';
import {oleLatex,replaceOleLatex} from '../src/native.mjs';
import {renderNative} from '../src/font-renderer.mjs';
import {vectorPdfRequest} from '../src/vector-pdf.mjs';

const inputs=[
 String.raw`\textcolor{#ff0000}{\sqrt{x_i}}`,
 String.raw`\textcolor{#ff0000}{\frac{x+1}{y}}`,
 String.raw`\textcolor{#ff0000}{\begin{bmatrix}a&b\\c&d\end{bmatrix}}`,
 String.raw`\textcolor{#ff0000}{\begin{gathered}x=y\\a=b\end{gathered}}`,
 String.raw`\textcolor{#ff0000}{\hat{x}_i^2}+z`,
 String.raw`\textcolor{#ff0000}{\sqrt{\textcolor{#000000}{\frac{x}{y}}}}`,
 String.raw`\textcolor{#ff0000}{\sqrt{\sin x+\textcolor{#000000}{\cos y}}}`
];
const ink=preview=>vectorPdfRequest(preview.svg,preview.width,preview.height).vector;

test('Editable LaTeX keeps template color scope through a structural rebuild',async()=>{
 for(const input of inputs){
  const original=makeNewOle(input),latex=oleLatex(original);
  // Force both rebuilds; an unchanged save intentionally preserves OLE bytes.
  const rebuilt=replaceOleLatex(replaceOleLatex(original,latex+'+q'),latex);
  const [before,after]=await Promise.all([renderNative(original,{raster:false}),renderNative(rebuilt,{raster:false})]);
  assert.deepEqual(ink(after),ink(before),`${input} decoded as ${latex}`);
  assert.deepEqual([after.width,after.height,after.depth],[before.width,before.height,before.depth],input);
  assert.equal(oleLatex(rebuilt),latex,'color scope is stable on the next edit');
 }
});

test('A red radical and an inner black fraction remain separately editable',()=>{
 const latex=oleLatex(makeNewOle(inputs[5]));
 assert.match(latex,/^\\textcolor\{#ff0000\}\{\\sqrt\{\\textcolor\{#000000\}\{\\frac/);
 const edited=replaceOleLatex(makeNewOle(inputs[5]),latex.replace('{x}','{x+1}'));
 assert.match(oleLatex(edited),/\\textcolor\{#000000\}\{\\frac\{x\+1\}/);
});
