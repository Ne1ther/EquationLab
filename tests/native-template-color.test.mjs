import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import JSZip from 'jszip';
import {makeNewOle} from '../src/new-formula.mjs';
import {inspectOle} from '../src/native.mjs';
import {renderNative,nativePdf} from '../src/font-renderer.mjs';
import {vectorPdfRequest} from '../src/vector-pdf.mjs';
import {createDocx,inspectDocx,hash} from '../src/document.mjs';

const structures=[
 String.raw`\sqrt{x_i}`,String.raw`\frac{x+1}{y}`,String.raw`\bar{x}+\hat{y}_i^2`,
 String.raw`\mtintA{1}{x}{}{}`,String.raw`\begin{bmatrix}a&b\\c&d\end{bmatrix}`,
 String.raw`\begin{array}{|c|c|}\hline a&b\\\hline c&d\\\hline\end{array}`
];

test('Native COLOR covers template ink and glyphs without changing layout or native data',async()=>{
 for(const latex of structures){
  const ole=makeNewOle(`\\textcolor{#ff0000}{${latex}}`),before=Buffer.from(ole),p=await renderNative(ole),black=await renderNative(makeNewOle(latex),{raster:false});
  assert.deepEqual([p.width,p.height,p.depth],[black.width,black.height,black.depth],latex);
  const paint=vectorPdfRequest(p.svg,p.width,p.height).vector.flatMap(item=>[item.fill,item.strokeWidth>0?item.stroke:'none']).filter(c=>c!=='none');
  assert.ok(paint.length>0);assert.ok(paint.every(c=>c==='#ff0000'),`${latex}: all visible vector ink must inherit native red`);
  const channels=(await sharp(p.png).stats()).channels;
  assert.ok(channels[0].sum>1000,latex);assert.equal(channels[1].sum+channels[2].sum,0,`${latex}: raster must not contain black template ink`);
  const pdf=Buffer.from((await nativePdf(ole)).pdf,'base64');assert.doesNotMatch(pdf.toString('latin1'),/\/Subtype\s*\/Image/);
  assert.deepEqual(ole,before,`${latex}: rendering must preserve original native bytes`);
 }
});

test('Nested black template color overrides an outer red box in SVG and PNG',async()=>{
 const ole=makeNewOle(String.raw`\textcolor{#ff0000}{\sqrt{\textcolor{#000000}{\frac{x}{y}}}}`),p=await renderNative(ole);
 const colors=new Set(vectorPdfRequest(p.svg,p.width,p.height).vector.map(item=>item.fill).filter(c=>c!=='none'));
 assert.deepEqual([...colors].sort(),['#000000','#ff0000']);
 const {data,info}=await sharp(p.png).raw().toBuffer({resolveWithObject:true});let red=0,black=0;
 for(let i=0;i<data.length;i+=info.channels)if(data[i+3]>200){if(data[i]>200&&data[i+1]===0&&data[i+2]===0)red++;if(data[i]+data[i+1]+data[i+2]===0)black++;}
 assert.ok(red>10&&black>10,'radical stays red while the complete nested fraction stays black');
});

test('DOCX fallback preserves the renderer pixels, point dimensions and exact native payload',async()=>{
 const ole=makeNewOle(String.raw`\textcolor{#ff0000}{\sqrt{x_i}+\frac{1}{n}}`),p=await renderNative(ole),docx=await createDocx([{ole}]),zip=await JSZip.loadAsync(docx),object=(await inspectDocx(docx)).objects[0];
 assert.deepEqual(await zip.file('word/media/image1.png').async('nodebuffer'),p.png);
 assert.equal(object.nativeSha256,hash(inspectOle(ole).native));
 const metadata=await sharp(p.png).metadata();assert.equal(metadata.width,Math.ceil(p.width*8));assert.equal(metadata.height,Math.ceil(p.height*8));
 const xml=await zip.file('word/document.xml').async('string');assert.ok(xml.includes(`width:${p.width.toFixed(3)}pt;height:${p.height.toFixed(3)}pt`));
});
