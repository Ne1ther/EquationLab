import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {makeOle,patchRuler} from '../src/native.mjs';
import {patchTypography} from '../src/typography-native.mjs';
import {renderNative,nativePdf,nativeRendererStats} from '../src/font-renderer.mjs';
import {vectorPdfRequest,vectorInkBounds} from '../src/vector-pdf.mjs';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';

function limitInk(svg){
 const dom=new DOMParser().parseFromString(svg,'image/svg+xml'),serialize=new XMLSerializer(),stack=Array.from(dom.getElementsByTagName('g')).find(n=>n.getAttribute('data-mml-node')==='munderover');
 assert.ok(stack,'stacked limits exist');
 const defs=serialize.serializeToString(dom.getElementsByTagName('defs')[0]);
 return Array.from(stack.childNodes).filter(n=>n.nodeType===1).map(child=>{
  const isolated=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="-5000 -5000 10000 10000">${defs}<g transform="scale(1,-1)">${serialize.serializeToString(child)}</g></svg>`;
  const points=vectorPdfRequest(isolated,120,120).vector.flatMap(({matrix:[a,b,c,d,e,f],commands})=>commands.flatMap(command=>Array.from({length:command.values.length/2},(_,i)=>{const [x,y]=command.values.slice(i*2,i*2+2);return [a*x+c*y+e,b*x+d*y+f];})));
  assert.ok(points.length);return {left:Math.min(...points.map(p=>p[0])),right:Math.max(...points.map(p=>p[0])),top:Math.min(...points.map(p=>p[1])),bottom:Math.max(...points.map(p=>p[1]))};
 });
}

function childInk(svg,predicate){
 const dom=new DOMParser().parseFromString(svg,'image/svg+xml'),serialize=new XMLSerializer(),node=Array.from(dom.getElementsByTagName('g')).find(predicate);
 assert.ok(node);const defs=serialize.serializeToString(dom.getElementsByTagName('defs')[0]);
 return Array.from(node.childNodes).filter(n=>n.nodeType===1).map(child=>vectorInkBounds(vectorPdfRequest(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="-5000 -5000 10000 10000">${defs}<g transform="scale(1,-1)">${serialize.serializeToString(child)}</g></svg>`,1,1)));
}

test('Drawn integral contours cover tall bodies and retain the original equation data',async()=>{
 const heights=[];
 for(const body of ['x','\\frac{a+b}{\\sqrt{x^2+y^2}}','\\frac{1}{\\frac{1}{x}}']){
  const source=makeOle(`\\mtintA{1}{${body}}{}{}`),before=Buffer.from(source),p=await renderNative(source,{raster:false});
  const [operator,expression]=childInk(p.svg,n=>n.getAttribute('data-equation-integral')==='true');
  heights.push(operator[3]-operator[1]);assert.ok(expression[3]>expression[1]);assert.ok(operator[3]-operator[1]>=expression[3]-expression[1]-.5,'visible integral ink must cover the body');assert.deepEqual(source,before);
 }
 assert.ok(heights[1]>heights[0]*1.5);assert.ok(heights[2]>heights[0]*1.5);
});

test('Integral pens do not grow thicker with taller bodies or larger variable symbols',async()=>{
 const strokes=[];for(const [body,size]of [['x',18],['\\frac{a+b}{\\sqrt{x^2+y^2}}',18],['x',24]]){
  const p=await renderNative(patchTypography(makeOle(`\\mtintA{1}{${body}}{}{}`),{sizes:{3:{unit:'pt',value:size}}}),{raster:false}),dom=new DOMParser().parseFromString(p.svg,'image/svg+xml'),contour=Array.from(dom.getElementsByTagName('g')).find(n=>n.getAttribute('data-equation-integral-contour')==='true');
  assert.ok(contour);const path=Array.from(contour.childNodes).find(n=>n.nodeType===1&&n.getAttribute('fill')==='none');strokes.push(Number(path.getAttribute('stroke-width')));
  const result=await nativePdf(makeOle(`\\mtintA{1}{${body}}{}{}`));assert.doesNotMatch(Buffer.from(result.pdf,'base64').toString('latin1'),/\/Subtype\s*\/Image/);
 }
 assert.ok(strokes[0]>0);assert.equal(strokes[0],strokes[1]);assert.equal(strokes[0],strokes[2]);
});

test('Stacked integral limits clear the visible contour by a small gap',async()=>{
 for(const macro of ['mtintB','mtintD']){
  const p=await renderNative(makeOle(`\\${macro}{1}{\\frac{a+b}{\\sqrt{x^2+y^2}}}{a}${macro==='mtintB'?'{b}':'{}'}`),{raster:false}),parts=childInk(p.svg,n=>n.getAttribute('data-equation-integral')==='true'),[operator,lower]=parts;
  assert.ok(lower[1]-operator[3]>0&&lower[1]-operator[3]<250,'lower limit must not float away');if(macro==='mtintB'){const upper=parts[2];assert.ok(operator[1]-upper[3]>0&&operator[1]-upper[3]<250,'upper limit must not float away');}
 }
});

test('A partitioned matrix embeds its frame styling and leaves the cells visible',async()=>{
 const p=await renderNative(makeOle('\\begin{array}{|c|c|}\\hline a&b\\\\\\hline c&d\\\\\\hline\\end{array}'));
 const dom=new DOMParser().parseFromString(p.svg,'image/svg+xml'),frame=Array.from(dom.getElementsByTagName('rect')).find(n=>n.hasAttribute('data-frame'));
 assert.equal(frame.getAttribute('fill'),'none');assert.ok(Number(frame.getAttribute('stroke-width'))>0);
 const strokes=vectorPdfRequest(p.svg,p.width,p.height).vector.filter(v=>v.strokeWidth>0);assert.equal(strokes.length,3);assert.ok(strokes.every(v=>v.fill==='none'));
 const stats=await sharp(p.png).stats();assert.ok(stats.channels[3].mean<100,'matrix should not become a solid black rectangle');
});

test('Character marks below a letter use accent spacing rather than large-operator limit spacing',async()=>{
 for(const latex of ['\\mtembX{x}','\\mtembAC{x}','\\mtembAD{x}','\\mtembAI{x}']){
  const p=await renderNative(makeOle(latex),{raster:false}),[base,under]=childInk(p.svg,n=>n.getAttribute('data-mml-node')==='munder');
  const gap=under[1]-base[3];assert.ok(gap>=0&&gap<300,`${latex}: detached accent gap ${gap/1000}em`);
 }
});

test('Italic glyphs and radical bars have transparent antialiasing margins on all four edges',async()=>{
 for(const latex of ['s=vt+1','f(x)=x^2','\\sqrt{x}','x_r=\\sqrt{\\frac{1}{n}\\sum_{i=1}^{n}x_i^2}','\\int x','\\mtembC{x}','\\mtembI{x}','\\mtembAF{x}','\\mtintA{1}{x}{}{}'])for(const size of [6,12,24]){
  const ole=patchTypography(makeOle(latex),{fullSize:size}),before=Buffer.from(ole),p=await renderNative(ole),{data,info:{width,height,channels}}=await sharp(p.png).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const alpha=(x,y)=>data[(y*width+x)*channels+3];
  for(let x=0;x<width;x++)assert.ok(alpha(x,0)===0&&alpha(x,height-1)===0,`${latex}: top/bottom ink is clipped`);
  for(let y=0;y<height;y++)assert.ok(alpha(0,y)===0&&alpha(width-1,y)===0,`${latex}: left/right ink is clipped`);
  assert.ok(data.some((v,i)=>i%channels===3&&v>200),'image contains visible equation ink');assert.deepEqual(ole,before);
 }
});

test('Stacked operator limits stay close to the actual symbol ink and centred on it',async()=>{
 for(const latex of ['\\sum_{i=1}^{n}x_i','\\prod_{i=1}^{n}x_i','\\sqrt{\\sum_{i=1}^{n}x_i^2}','\\frac{1}{n}\\sum_{i=1}^{n}x_i']){
  const ole=makeOle(latex),before=Buffer.from(ole),p=await renderNative(ole,{raster:false}),[base,under,over]=limitInk(p.svg);
  for(const gap of [under.top-base.bottom,base.top-over.bottom])assert.ok(gap>0&&gap<300,`${latex}: gap ${gap/1000}em should not detach the limits`);
  for(const limit of [under,over])assert.ok(Math.abs((limit.left+limit.right-base.left-base.right)/2)<180,`${latex}: limit must be centred on the operator`);
  assert.deepEqual(ole,before,'rendering must preserve native equation bytes');
 }
});

test('Enlarging the symbol does not enlarge the gap to unchanged limit text',async()=>{
 const ole=makeOle('\\sum_{i=1}^{n}x_i'),normal=await renderNative(ole,{raster:false}),large=await renderNative(patchTypography(ole,{sizes:{3:{unit:'pt',value:24}}}),{raster:false});
 const gaps=svg=>{const [base,under,over]=limitInk(svg);return [under.top-base.bottom,base.top-over.bottom];};
 const a=gaps(normal.svg),b=gaps(large.svg);for(let i=0;i<a.length;i++)assert.ok(Math.abs(a[i]-b[i])<2,`limit gap changed by ${(b[i]-a[i])/1000}em`);
 const spaced=await renderNative(patchTypography(ole,{spaces:{7:{unit:'%',value:200}}}),{raster:false});assert.ok(gaps(spaced.svg)[0]>a[0]+500,'explicit lower-limit spacing still takes effect');
 const side=await renderNative(makeOle('\\sum\\nolimits_{i=1}^{n}x_i'),{raster:false});assert.doesNotMatch(side.svg,/data-mml-node="munderover"/,'side limits retain their native placement');
});

test('A radical keeps its own stroke size when it contains an enlarged operator',async()=>{
 const thickness=async svg=>{
  const dom=new DOMParser().parseFromString(svg,'image/svg+xml'),serialize=new XMLSerializer(),root=Array.from(dom.getElementsByTagName('g')).find(n=>n.getAttribute('data-mml-node')==='msqrt'),radical=Array.from(root.childNodes).find(n=>n.nodeType===1),body=`<g transform="scale(1,-1)">${serialize.serializeToString(radical)}</g>`;
  const [left,top,right,bottom]=vectorInkBounds(vectorPdfRequest(`<svg viewBox="-5000 -5000 10000 10000">${body}</svg>`,1,1)),scale=.4,width=right-left+100,height=bottom-top+100;
  const {data,info}=await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${left-50} ${top-50} ${width} ${height}" width="${Math.ceil(width*scale)}" height="${Math.ceil(height*scale)}">${body}</svg>`)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let rows=0;const x=Math.round((right-left-50)*scale);for(let y=0;y<info.height;y++)if(data[(y*info.width+x)*4+3]>127)rows++;assert.ok(rows>0);return rows;
 };
 const plain=await renderNative(makeOle('\\sqrt{x}'),{raster:false}),sum=await renderNative(makeOle('\\sqrt{\\sum_{i=1}^{n}x_i^2}'),{raster:false});assert.equal(await thickness(sum.svg),await thickness(plain.svg),'an enlarged radicand must not thicken the actual exported radical ink');
});

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
 for(const latex of ['\\sqrt{x}','\\sqrt{x+y}','\\sqrt[n]{x}','\\sqrt[123456]{x}','\\sqrt{\\frac{x+1}{y^2}}','\\sqrt{\\sqrt{x}}','x_{\\sqrt{y}}','\\sqrt{\\begin{matrix}a&b\\\\c&d\\end{matrix}}','\\sqrt{\\sum_{i=1}^{n}x_i^2}']){
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
