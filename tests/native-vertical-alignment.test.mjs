import test from 'node:test';
import assert from 'node:assert/strict';
import {makeNewOle} from '../src/new-formula.mjs';
import {inspectOle,oleLatex,replaceOleLatex} from '../src/native.mjs';
import {renderNative} from '../src/font-renderer.mjs';
const collect=(nodes,type)=>nodes.flatMap(n=>[...(n.type===type?[n]:[]),...collect(n.children??[],type)]);

test('New matrices and multiline piles use MathType center-baseline wire value 1',()=>{
 for(const [latex,type]of [[String.raw`\begin{matrix}a&b\\c&d\end{matrix}`,5],[String.raw`\begin{gathered}a\\b\end{gathered}`,4]]){
  const ole=makeNewOle(latex),record=collect(inspectOle(ole).parsed.records,type)[0];
  assert.equal(record.valign,1);assert.doesNotMatch(oleLatex(ole),/\\mt(?:matrix|pile)/);
 }
});

test('Original top, center and bottom baseline records remain editable and produce different vertical placements',async()=>{
 for(const type of ['matrix','pile']){
  const previews=[];
  for(const alignment of [0,1,2]){
   const latex=type==='matrix'?`\\mtmatrix{1}{1}{${alignment}}{\\begin{matrix}a&b\\\\c&d\\end{matrix}}+z`:`\\mtpile{2}{${alignment}}{\\begin{gathered}a\\\\b\\end{gathered}}+z`,ole=makeNewOle(latex),decoded=oleLatex(ole),edited=replaceOleLatex(ole,decoded.replace(/(\\begin\{(?:matrix|gathered)\})a/,'$1q'));
   assert.equal(collect(inspectOle(edited).parsed.records,type==='matrix'?5:4)[0].valign,alignment);
   const before=Buffer.from(ole),p=await renderNative(ole,{raster:false});assert.deepEqual(ole,before);previews.push(p);
  }
  assert.ok(previews[0].depth>previews[1].depth+2,'top row baseline leaves more content below the line');
  assert.ok(previews[1].depth>previews[2].depth+2,'bottom row baseline moves the body above the line');
  assert.ok(previews.every(p=>Math.abs(p.height-previews[0].height)<0.01));
 }
});

test('Legacy writer values 3 and 4 retain their raw bytes and reproduce the Windows fallback above the first row',async()=>{
 for(const alignment of [3,4]){
  const ole=makeNewOle(`\\mtmatrix{1}{1}{${alignment}}{\\begin{matrix}a&b\\\\c&d\\end{matrix}}+z`),before=Buffer.from(ole),p=await renderNative(ole,{raster:false}),top=await renderNative(makeNewOle(String.raw`\mtmatrix{1}{1}{0}{\begin{matrix}a&b\\c&d\end{matrix}}+z`),{raster:false});
  assert.ok(p.depth>top.depth+5);assert.equal(collect(inspectOle(ole).parsed.records,5)[0].valign,alignment);assert.deepEqual(ole,before);
 }
});
