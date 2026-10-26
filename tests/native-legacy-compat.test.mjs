import test from 'node:test';
import assert from 'node:assert/strict';
import {makeOle,inspectOle,wrapNative,oleLatex,replaceOleLatex} from '../src/native.mjs';
import {renderNative,nativePdf} from '../src/font-renderer.mjs';

function editRecords(ole,change){const s=inspectOle(ole),data=change(s),header=Buffer.from(s.header);header.writeUInt32LE(data.length,8);return wrapNative(Buffer.concat([header,data]),ole);}
test('MathType private blackboard/script characters use real STIX Unicode outlines without rewriting Native',async()=>{
 const ole=makeOle('\\mathbb{E}+\\mathcal{N}+\\centerdot'),before=Buffer.from(ole),latex=oleLatex(ole);
 assert.match(latex,/\\mathbb\{E\}/);assert.match(latex,/\\mathcal\{N\}/);assert.match(latex,/\\centerdot/);
 const preview=await renderNative(ole,{raster:false});assert.ok(preview.faces.every(f=>f.font==='STIX Two Math'||f.font==='Symbol'));assert.ok(preview.svg.includes('1D53C'));assert.ok(preview.svg.includes('1D4A9'));
 assert.deepEqual(replaceOleLatex(ole,latex),before);assert.deepEqual(ole,before);assert.ok((await nativePdf(ole)).pdf);
});

test('A PILE directly inside a fence template retains alignment and renders all rows',async()=>{
 const ole=makeOle('\\left\\{\\mtpile{1}{1}{\\begin{gathered}a=1\\\\b=2\\end{gathered}}\\right.');
 const direct=editRecords(ole,({data,parsed})=>{const root=parsed.records.find(n=>n.type===1),fence=root.children.find(n=>n.type===3),line=fence.children.find(n=>n.type===1),pile=line.children.find(n=>n.type===4);return Buffer.concat([data.subarray(0,line.start),data.subarray(pile.start,pile.end),data.subarray(line.end)]);});
 const latex=oleLatex(direct);assert.match(latex,/\\mtpile\{1\}\{1\}/);const svg=(await renderNative(direct,{raster:false})).svg;assert.ok(svg.includes('data-c="61"'));assert.ok(svg.includes('data-c="62"'));assert.deepEqual(replaceOleLatex(direct,latex),direct);
});

test('Explicit color definitions survive public LaTeX, native preview and a structural edit',async()=>{
 const ole=makeOle('\\textcolor{#ff0000}{\\sin x}+y'),latex=oleLatex(ole);assert.match(latex,/\\textcolor\{#ff0000\}/);
 const preview=await renderNative(ole,{raster:false});assert.match(preview.svg,/fill="#ff0000"/);
 const changed=replaceOleLatex(ole,latex+'+1'),readback=oleLatex(changed);assert.match(readback,/\\textcolor\{#ff0000\}/);assert.match((await renderNative(changed,{raster:false})).svg,/fill="#ff0000"/);
});

test('Consecutive native scripts separated by SIZE records do not become invalid double exponents',async()=>{
 const original=makeOle('x^{a}'),ole=editRecords(original,({data,parsed})=>{const root=parsed.records.find(n=>n.type===1),script=root.children.find(n=>n.type===3);return Buffer.concat([data.subarray(0,script.end),Buffer.from([10]),data.subarray(script.start,script.end),data.subarray(script.end)]);});
 assert.doesNotMatch(oleLatex(ole),/\^\{a\}\^/);assert.ok((await renderNative(ole,{raster:false})).svg.includes('<svg'));assert.deepEqual(replaceOleLatex(ole,oleLatex(ole)),ole);
});

test('An original unmapped glyph stays explicit and byte-preserved instead of blocking the entire formula',async()=>{
 const ole=makeOle('x+\\mtmissing{f700}{108}{Euclid Math One}{EuclidMath1}{0}+y'),before=Buffer.from(ole),latex=oleLatex(ole);
 assert.match(latex,/\\mtmissing\{f700\}\{108\}/);const preview=await renderNative(ole,{raster:false});assert.equal(preview.warnings.length,1);assert.ok(preview.svg.includes('25A1'));assert.deepEqual(replaceOleLatex(ole,latex),before);
 const changed=replaceOleLatex(ole,latex+'+1'),chars=[];function walk(ns){for(const n of ns){if(n.type===2&&n.code===0xf700)chars.push(n.fontPosition);if(n.children)walk(n.children);}}walk(inspectOle(changed).parsed.records);assert.deepEqual(chars,[108]);
});
