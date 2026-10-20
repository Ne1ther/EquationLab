import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import sharp from 'sharp';
import {DOMParser} from '@xmldom/xmldom';
import {radicalContour} from '../src/radical-contour.mjs';
import {buildMathLiveEditor} from '../packaging/mathlive-editor.mjs';

const directory=await mkdtemp(join(tmpdir(),'equationlab-radical-test-'));
const oldHTMLElement=globalThis.HTMLElement;globalThis.HTMLElement=class{};
const upstream=await readFile(new URL('../node_modules/mathlive/mathlive.mjs',import.meta.url),'utf8');
const expose=`\nexport function equationRadicalBoxes(text){const context=new Context({from:getDefaultContext(),mathstyle:'displaystyle'});const root=new Atom({type:'root',mode:'math',body:parseLatex(text,{context,parseMode:'math',mathstyle:'displaystyle'})});return {root,box:root.render(context)};}\nexport function equationInstallRadicals(){globalThis.installEquationRadicalRenderer(SurdAtom.prototype);}`;
await writeFile(join(directory,'mathlive.mjs'),upstream+expose);
const mathlive=await import(pathToFileURL(join(directory,'mathlive.mjs')));
test.after(async()=>{if(oldHTMLElement===undefined)delete globalThis.HTMLElement;else globalThis.HTMLElement=oldHTMLElement;delete globalThis.installEquationRadicalRenderer;delete globalThis.equationRadicalContour;await rm(directory,{recursive:true,force:true});});
const samples=['\\sqrt{x}','\\sqrt{x+y+z}','\\sqrt{\\sum_{i=1}^{n}x_i^2}','\\sqrt[3]{\\frac{x+1}{y^2}}','\\sqrt{\\sqrt{x+y}}','\\sqrt[123]{x}','x_{\\sqrt{y+z}}','x^{\\sqrt{y+z}}','\\sqrt{\\placeholder{}}','\\sqrt[\\placeholder{}]{\\placeholder{}}'];
const baseline=samples.map(latex=>{const {root,box}=mathlive.equationRadicalBoxes(latex);return {latex,width:box.width,height:box.height,depth:box.depth,value:root.bodyToLatex({expandMacro:false})};});
globalThis.equationRadicalContour=radicalContour;
vm.runInThisContext(await readFile(new URL('../desktop/radical-rendering.js',import.meta.url),'utf8'));
mathlive.equationInstallRadicals();

test('Actual MathLive radical render preserves every layout box extent and LaTeX, including nested and empty roots',()=>{
 for(const before of baseline){const {root,box}=mathlive.equationRadicalBoxes(before.latex);assert.equal(box.width,before.width,before.latex);assert.equal(box.height,before.height,before.latex);assert.equal(box.depth,before.depth,before.latex);assert.equal(root.bodyToLatex({expandMacro:false}),before.value,before.latex);
  const markup=box.toMarkup(),count=(before.latex.match(/\\sqrt/g)||[]).length;
  assert.equal((markup.match(/data-equation-radical="continuous"/g)||[]).length,count,before.latex);assert.doesNotMatch(markup,/ML__sqrt-line|[\uE000\uE001\u23B7]/,before.latex);
 }
});

test('Continuous radical overbar has one connected, uniform ink band from its stem to its end',async()=>{
 for(const [height,stemWidth,rule]of [[1,.833,.04],[1.2,1.056,.04],[1.8,1.056,.04],[2.4,1.056,.04],[3,1.056,.04],[4.4,1.056,.04],[2,.6,.04],[7,1.056,.08]]){
  const width=stemWidth+2.5,p=radicalContour({width,height,stemWidth,rule});
  assert.equal((p.d.match(/[Mm]/g)||[]).length,1);assert.equal((p.d.match(/[Zz]/g)||[]).length,1);
  const pixels=400,svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${Math.ceil(width*pixels)}" height="${Math.ceil(height*pixels)}"><path d="${p.d}" transform="scale(${p.scaleX} ${p.scaleY})"/></svg>`;
  const {data,info}=await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const bands=[];
  for(const x of [stemWidth+.1,stemWidth+.6,width-.1]){let rows=0,runs=0,last=false;for(let y=0;y<Math.ceil(rule*pixels*3);y++){const dark=data[(y*info.width+Math.round(x*pixels))*4+3]>127;if(dark)rows++;if(dark&&!last)runs++;last=dark;}assert.equal(runs,1,`height ${height}: doubled or missing rule`);bands.push(rows);}
  assert.ok(Math.max(...bands)-Math.min(...bands)<=1,`height ${height}: uneven rule ${bands}`);assert.ok(Math.abs(bands[0]-rule*pixels)<=1,`height ${height}: rule ${bands[0]} differs from ${rule*pixels}`);
 }
});

test('Packaged MathLive uses the same pinned radical adapter and fails on changed upstream sources',async()=>{
 const output=join(directory,'mathlive-editor.js'),root=resolve(new URL('..',import.meta.url).pathname),mathliveDirectory=resolve(root,'node_modules/mathlive');
 const result=await buildMathLiveEditor({root,mathliveDirectory,output});assert.equal(result.continuousRadical,true);
 const source=await readFile(output,'utf8');assert.match(source,/globalThis\.installEquationRadicalRenderer\(SurdAtom\.prototype\)/);assert.match(source,/equationRadicalContour=function radicalContour/);
 const context=vm.createContext({HTMLElement:class{},console:{info(){},warn(){},error(){},log(){},assert(){}},setTimeout,clearTimeout});vm.runInContext(source,context);
 for(const latex of samples){
  // Use the actual packaged UMD's complete render pipeline, including the
  // inter-atom spacing inserted after SurdAtom.render (Box.width is stale).
  const markup=context.MathLive.convertLatexToMarkup(latex),dom=new DOMParser().parseFromString(`<root>${markup}</root>`,'application/xml'),svgs=Array.from(dom.getElementsByTagName('svg')),stems=svgs.filter(n=>n.hasAttribute('data-equation-radical')),rules=svgs.filter(n=>n.hasAttribute('data-equation-radical-rule')),count=(latex.match(/\\sqrt/g)||[]).length;
  assert.equal(stems.length,count,latex);assert.equal(rules.length,count,latex);
  for(const rule of rules){assert.equal(rule.getAttribute('width'),'100%',`${latex}: the rule must follow the actual radicand width after symbol spacing`);assert.equal(rule.getElementsByTagName('rect')[0].getAttribute('width'),'100%',latex);assert.equal(rule.getElementsByTagName('rect')[0].getAttribute('height'),'100%',latex);assert.match(rule.getAttribute('style'),/top:-[0-9.]+em/,latex);}
  assert.doesNotMatch(markup,/ML__sqrt-line|[\uE000\uE001\u23B7]/,`${latex}: no old cap/pseudo-line is painted`);
 }
 const fixture=join(directory,'changed');await import('node:fs/promises').then(m=>m.mkdir(fixture));await writeFile(join(fixture,'package.json'),JSON.stringify({version:'0.111.1'}));await writeFile(join(fixture,'mathlive.js'),'changed');
 await assert.rejects(buildMathLiveEditor({root,mathliveDirectory:fixture,output}),/digest mismatch/);
});
