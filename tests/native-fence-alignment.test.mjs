import test from 'node:test';
import assert from 'node:assert/strict';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {makeNewOle} from '../src/new-formula.mjs';
import {inspectOle,wrapNative} from '../src/native.mjs';
import {renderNative,nativePdf} from '../src/font-renderer.mjs';
import {vectorPdfRequest,vectorInkBounds} from '../src/vector-pdf.mjs';

// Measure actual exported outlines, retaining ancestor transforms. Looking
// only at a delimiter's layout box misses a finite glyph drawn at the old axis.
function parts(preview){
 const dom=new DOMParser().parseFromString(preview.svg,'image/svg+xml'),serialize=new XMLSerializer(),groups=Array.from(dom.getElementsByTagName('g'));
 const ink=node=>{
  let part=node.cloneNode(true);
  for(let parent=node.parentNode;parent?.nodeType===1;parent=parent.parentNode){const shell=parent.cloneNode(false);shell.appendChild(part);part=shell;}
  part.insertBefore(dom.getElementsByTagName('defs')[0].cloneNode(true),part.firstChild);
  return vectorInkBounds(vectorPdfRequest(serialize.serializeToString(part),1,1));
 };
 // Native CHARs use el* font variants; the scalable fence outlines come
 // from MathJax's TEX glyphs, including the pieces of assembled fences.
 return {fences:groups.filter(n=>n.getAttribute('data-mml-node')==='mo'&&Array.from(n.getElementsByTagName('use')).some(use=>/-TEX-/.test(use.getAttribute('xlink:href')))).map(ink),tables:groups.filter(n=>n.getAttribute('data-mml-node')==='mtable').map(ink),ink};
}
const height=box=>box[3]-box[1],center=box=>(box[1]+box[3])/2;
function assertViewport(p){const request=vectorPdfRequest(p.svg,p.width,p.height),[x,y,w,h]=request.viewBox,ink=vectorInkBounds(request);assert.ok(ink[0]>=x-.2&&ink[1]>=y-.2&&ink[2]<=x+w+.2&&ink[3]<=y+h+.2);}
const matrix=(v,rows)=>`\\mtmatrix{1}{1}{${v}}{\\begin{matrix}${rows}\\end{matrix}}`;

test('Off-axis native matrix fences fit and follow both short and tall bodies without rewriting OLE',async()=>{
 for(const [left,right]of [['[',']'],['(',')'],['\\{','\\}'],['|','|']])for(const rows of ['a&b\\\\c&d','a&b\\\\c&d\\\\e&f\\\\g&h\\\\i&j\\\\k&l']){
  const sizes=[];
  for(const alignment of [0,2,4]){
   const ole=makeNewOle(`\\left${left}${matrix(alignment,rows)}\\right${right}+z`),before=Buffer.from(ole),p=await renderNative(ole,{raster:false}),{fences,tables:[body]}=parts(p);
   assert.equal(fences.length,2);assert.ok(body);
   for(const fence of fences){assert.ok(fence[1]<body[1]&&fence[3]>body[3],`${left}: fence must enclose every row at alignment ${alignment}`);assert.ok(Math.abs(center(fence)-center(body))<160,`${left}: visible fence must follow body center`);assert.ok(height(fence)<height(body)+1200,`${left}: off-axis baseline must not double the fence`);}
   sizes.push(height(fences[0]));assertViewport(p);assert.deepEqual(ole,before);
  }
  assert.ok(Math.max(...sizes)-Math.min(...sizes)<2,'changing only the baseline must not change delimiter height');
 }
});

test('Nested fences keep their own native sizing decisions',async()=>{
 const inner=`\\left[${matrix(4,'a&b\\\\c&d')}\\right]`,solo=await renderNative(makeNewOle(inner),{raster:false}),nested=await renderNative(makeNewOle(`\\left(${inner}+\\frac{x}{y}\\right)`),{raster:false}),a=parts(solo),b=parts(nested);
 assert.equal(a.fences.length,2);assert.equal(b.fences.length,4);
 for(const fence of b.fences.slice(1,3)){assert.ok(Math.abs(height(fence)-height(a.fences[0]))<2);assert.ok(Math.abs(center(fence)-center(b.tables[0]))<160);}
 assert.ok(height(b.fences[0])>height(b.fences[1])+1000,'outer symmetric fence still encloses the off-axis inner expression');assertViewport(nested);
});

test('Explicit native body-fit fence option reaches vector PDF and preserves source bytes',async()=>{
 const source=makeNewOle('\\left[\\frac{x}{\\frac{y}{z}}\\right]'),{header,data,parsed}=inspectOle(source),fence=parsed.records.flatMap(n=>n.children??[]).find(n=>n.type===3&&n.selector<=7),mtef=Buffer.from(data);
 assert.ok(fence);assert.equal(mtef[fence.start+4],0);mtef[fence.start+4]=1;
 const ole=wrapNative(Buffer.concat([header,mtef]),source),before=Buffer.from(ole),p=await renderNative(ole,{raster:false}),dom=new DOMParser().parseFromString(p.svg,'image/svg+xml'),geometry=parts(p),fraction=Array.from(dom.getElementsByTagName('g')).find(n=>n.getAttribute('data-mml-node')==='mfrac'),body=geometry.ink(fraction);
 assert.equal(geometry.fences.length,2);for(const fence of geometry.fences){assert.ok(fence[1]<body[1]&&fence[3]>body[3]);assert.ok(Math.abs(center(fence)-center(body))<180);}
 const pdf=Buffer.from((await nativePdf(ole)).pdf,'base64');assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.doesNotMatch(pdf.toString('latin1'),/\/Subtype\s*\/Image\b/);assertViewport(p);assert.deepEqual(ole,before);
});
