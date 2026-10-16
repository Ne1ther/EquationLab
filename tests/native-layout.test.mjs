import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {makeOle,patchRuler} from '../src/native.mjs';
import {patchTypography} from '../src/typography-native.mjs';
import {renderNative,nativePdf,nativeRendererStats} from '../src/font-renderer.mjs';
import {vectorPdfRequest} from '../src/vector-pdf.mjs';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';

test('Empty root templates retain a readable radical without writing fake placeholder glyphs',async()=>{
 const filled=await renderNative(makeOle('\\sqrt[n]{x}'),{raster:false});
 for(const latex of ['\\sqrt{\\placeholder{}}','\\sqrt[\\placeholder{}]{\\placeholder{}}','\\sqrt[n]{\\placeholder{}}']){
  const ole=makeOle(latex),before=Buffer.from(ole),empty=await renderNative(ole,{raster:false});
  assert.ok(empty.height>filled.height*.75,`${latex}: empty radical must not collapse`);assert.ok(empty.width>filled.width*.7);assert.deepEqual(ole,before);
 }
});

test('Nth-root degree ink never touches the entry hook in actual exported outlines',async()=>{
 for(const latex of ['\\sqrt[n]{x}','\\sqrt[3]{x}','\\sqrt[n+1]{x}','\\sqrt[123]{x}','\\sqrt[3]{\\frac{x+1}{y^2}}','\\sqrt[n]{\\begin{matrix}a&b\\\\c&d\\end{matrix}}']){
  const result=await renderNative(makeOle(latex),{raster:false});
  const dom=new DOMParser().parseFromString(result.svg,'image/svg+xml'),serializer=new XMLSerializer();
  async function mask(degree){
   const clone=dom.cloneNode(true),root=Array.from(clone.getElementsByTagName('g')).find(n=>n.getAttribute('data-mml-node')==='mroot');
   assert.ok(root,'indexed radical exists');const children=Array.from(root.childNodes).filter(n=>n.nodeType===1);
   for(const [index,node]of children.entries())if(index!==(degree?children.length-1:0))root.removeChild(node);
   return sharp(Buffer.from(serializer.serializeToString(clone)),{density:144}).resize({width:800}).ensureAlpha().raw().toBuffer();
  }
  const surd=await mask(false),degree=await mask(true);assert.equal(surd.length,degree.length);
  let overlap=0;for(let i=3;i<surd.length;i+=4)if(surd[i]>100&&degree[i]>100)overlap++;
  assert.equal(overlap,0,`${latex}: degree overlaps radical ink at ${overlap} pixels`);
 }
});

test('Radicands, nested radicals and degree indices stay inside the exported vector viewport',async()=>{
 for(const latex of ['\\sqrt{x}','\\sqrt{x+y}','\\sqrt[n]{x}','\\sqrt[123456]{x}','\\sqrt{\\frac{x+1}{y^2}}','\\sqrt{\\sqrt{x}}','x_{\\sqrt{y}}','\\sqrt{\\begin{matrix}a&b\\\\c&d\\end{matrix}}']){
  const ole=makeOle(latex),before=Buffer.from(ole),p=await renderNative(ole,{raster:false});
  const {vector,viewBox:[left,top,width,height]}=vectorPdfRequest(p.svg,p.width,p.height);
  // Check the actual transformed path geometry, including curve control
  // points. Translating the parent of an inferred radicand used to move the
  // whole square root out of this viewport and overlap the body with its stem.
  for(const {matrix:[a,b,c,d,e,f],commands}of vector)for(const command of commands)for(let i=0;i<command.values.length;i+=2){
   const [x,y]=command.values.slice(i,i+2),px=a*x+c*y+e,py=b*x+d*y+f;
   assert.ok(px>=left-.2&&px<=left+width+.2&&py>=top-.2&&py<=top+height+.2,`${latex}: outline (${px},${py}) exceeds its viewport`);
  }
  assert.deepEqual(ole,before,'display corrections preserve all native equation bytes');
 }
});

test('Native spacing preferences change their intended geometry, including nested fraction strokes',async()=>{
 for(const [latex,id,dimension,unit,value] of [
  ['\\begin{matrix}x&y\\\\z&w\\end{matrix}',1,'height','%',250],
  ['\\begin{matrix}x&y\\\\z&w\\end{matrix}',2,'width','%',200],
  ['x^2',3,'height','%',100],['x_2',4,'height','%',100],['x^2',5,'width','pt',5],
  ['\\frac{a}{b}',9,'height','%',150],['\\frac{a}{b}',12,'height','pt',2],
  ['\\frac{\\frac{a}{b}}{c}',13,'height','pt',2],['x+y',16,'width','%',300],
  ['\\sqrt{x}',20,'height','%',60],['\\sqrt{x}',21,'width','pt',5],['\\sqrt{x}',22,'width','%',200],
  ['\\hat{x}',23,'height','pt',3],['\\underbrace{x+y}',29,'height','pt',3]
 ]){
  const ole=makeOle(latex),before=Buffer.from(ole),a=await renderNative(ole,{raster:false}),b=await renderNative(patchTypography(ole,{spaces:{[id]:{unit,value}}}),{raster:false});
  assert.ok(b[dimension]>a[dimension]+.1,`${id}: ${latex}`);assert.deepEqual(ole,before);
 }
});

test('Native ruler aligns the same segment by left, center, right, relation and decimal anchors',async()=>{
 const widths=[];
 for(let type=0;type<5;type++){
  const ole=patchRuler(makeOle('x\\eltab y=2.5'),[{position:2304,type}]),p=await renderNative(ole,{raster:false});widths.push(p.width);
  const pdf=await nativePdf(ole);assert.match(Buffer.from(pdf.pdf,'base64').toString('latin1'),/^%PDF-/);
 }
 assert.ok(widths[0]>widths[1]&&widths[1]>widths[2]);assert.ok(widths[3]>widths[1]);assert.ok(widths[4]<widths[1]&&widths[4]>widths[2]);
});

test('Glyph cache shares reordered formulas and requests only an additional glyph without another process',async()=>{
 await renderNative(makeOle('QW'),{raster:false});const a=nativeRendererStats();
 await renderNative(makeOle('WQ'),{raster:false});const b=nativeRendererStats();assert.equal(b.helperRequests,a.helperRequests);assert.equal(b.glyphMisses,a.glyphMisses);
 await renderNative(makeOle('QWJ'),{raster:false});const c=nativeRendererStats();assert.equal(c.helperStarts,b.helperStarts);assert.equal(c.glyphMisses-b.glyphMisses,1);
});

test('Reusable SVG outlines retain strict PDF references and native PNG pixel bounds',async()=>{
 const latex='\\begin{matrix}'+Array(5).fill(Array(5).fill('x').join('&')).join('\\\\')+'\\end{matrix}',p=await renderNative(makeOle(latex),{maxWidth:100,maxHeight:40});
 assert.match(p.svg,/<defs>/);assert.match(p.svg,/<use /);assert.equal((p.svg.match(/<path /g)||[]).length,1);
 const metadata=await sharp(p.png).metadata();assert.ok(metadata.width<=100&&metadata.height<=40);assert.ok((await sharp(p.png).stats()).channels[3].sum>1000);
 const referenced=vectorPdfRequest('<svg viewBox="0 0 20 20"><defs><path id="a" d="M0 0h2v2z"/></defs><use href="#a" x="3" y="4"/></svg>',12,12);assert.deepEqual(referenced.vector[0].matrix,[1,0,0,1,3,4]);
 for(const svg of ['<svg viewBox="0 0 20 20"><use href="https://example.com/x.svg#a"/></svg>','<svg viewBox="0 0 20 20"><defs><g id="a"><use href="#a"/></g></defs><use href="#a"/></svg>'])assert.throws(()=>vectorPdfRequest(svg,12,12),/External|Cyclic/);
});
