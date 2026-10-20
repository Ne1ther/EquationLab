import test from 'node:test';
import assert from 'node:assert/strict';
import {makeNewOle} from '../src/new-formula.mjs';
import {inspectOle,oleLatex,replaceOleLatex} from '../src/native.mjs';
import {createDocx,inspectDocx} from '../src/document.mjs';
import {renderNative,nativePdf} from '../src/font-renderer.mjs';

const samples=[
 String.raw`a=1\\b=2\\c=3`,
 String.raw`\begin{aligned}x+y&=1\\x-y&=2\end{aligned}`,
 String.raw`\begin{align*}x+y&=1\\x-y&=2\end{align*}`,
 String.raw`\begin{gathered}x=\frac{1}{2}\\y=\sqrt{x}\end{gathered}`,
 String.raw`\begin{cases}x^2&x>0\\0&x\leq0\end{cases}`
];
for(const latex of samples)test(`Multiline native data, DOCX and vector preview retain rows: ${latex}`,async()=>{
 const ole=makeNewOle(latex),canonical=oleLatex(ole),native=inspectOle(ole).native;
 assert.match(canonical,/\\\\/);assert.doesNotMatch(canonical,/\\backslash/);
 const rendered=await renderNative(ole,{raster:false});assert.ok(rendered.height>25,'a multiline preview must not collapse into one line');
 const pdf=await nativePdf(ole);assert.ok(pdf.height>800);assert.match(Buffer.from(pdf.pdf,'base64').toString('latin1'),/^%PDF-/);assert.doesNotMatch(Buffer.from(pdf.pdf,'base64').toString('latin1'),/\/Subtype\s*\/Image/);
 const doc=await createDocx([{ole}]),reopened=(await inspectDocx(doc)).objects[0];assert.equal(reopened.parseError,undefined);assert.equal(reopened.latex,canonical);assert.deepEqual(inspectOle(reopened.ole).native,native);
 const rebuilt=replaceOleLatex(reopened.ole,canonical);assert.equal(oleLatex(rebuilt),canonical);
});
test('The video Laplace formula renders and survives reopening with its script L and Chinese annotation',async()=>{
 const ole=makeNewOle(String.raw`\mathcal{L}\{f(t)\}(s)=\int_0^{\infty}e^{-st}f(t)\,dt\quad\text{（拉普拉斯变换）}`),canonical=oleLatex(ole);
 assert.match(canonical,/\\mathcal\{L\}/);assert.ok(inspectOle(ole).parsed.records.some(r=>r.type===17&&r.name==='Arial Unicode MS'));
 const p=await renderNative(ole,{raster:false});assert.ok(p.width>200);assert.doesNotMatch(p.svg,/<text\b/);
 const restored=(await inspectDocx(await createDocx([{ole}]))).objects[0];assert.equal(restored.latex,canonical);assert.deepEqual(inspectOle(restored.ole).native,inspectOle(ole).native);
});
