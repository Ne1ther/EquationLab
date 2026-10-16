import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {desktopRequest} from '../src/desktop-rpc.mjs';
import {makeNewOle} from '../src/new-formula.mjs';
import {inspectOle,oleLatex,characters} from '../src/native.mjs';
import {renderNative} from '../src/font-renderer.mjs';

test('Persistent worker frames split requests, recovers from invalid input, drains at EOF and matches direct validation',async()=>{
 const child=spawn(process.execPath,[fileURLToPath(new URL('../src/desktop-rpc.mjs',import.meta.url)),'--stdio-worker'],{stdio:['pipe','pipe','pipe']});
 let out='',errors='';child.stdout.on('data',s=>out+=s);child.stderr.on('data',s=>errors+=s);
 const finished=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve(code));});
 const request={id:'first',action:'validate',payload:{latex:'x^3'}};
 const line=JSON.stringify(request)+'\n';child.stdin.write(line.slice(0,13));child.stdin.write(line.slice(13));
 child.stdin.write('{invalid}\n');
 child.stdin.write(JSON.stringify({id:'rejected',action:'validate',payload:{latex:'\\unsupportedcommand'}})+'\n');
 child.stdin.end(JSON.stringify({...request,id:'last',payload:{latex:'\\frac{a}{b}'}})+'\n');
 assert.equal(await finished,0,errors);
 const results=out.trim().split('\n').map(s=>JSON.parse(s));assert.equal(results.length,4);
 assert.deepEqual(results.map(r=>r.ok),[true,false,false,true]);
 assert.equal(results[0].id,'first');assert.equal(results[2].id,'rejected');assert.equal(results[3].id,'last');
 assert.deepEqual(results[0].data,await desktopRequest(request));
 assert.deepEqual(results[3].data,await desktopRequest({action:'validate',payload:{latex:'\\frac{a}{b}'}}));
 assert.ok(results.every(r=>Number.isFinite(r.elapsedMs)));
});

test('SVG-only validation preserves geometry and native bytes; short vector accents remain distinct from wide arrows',async()=>{
 const ole=makeNewOle('\\vec{x}+\\hat{x}+\\overline{x}+\\dot{x}'),before=Buffer.from(ole);
 const vector=await renderNative(ole,{raster:false}),raster=await renderNative(ole);
 assert.equal(vector.png,undefined);assert.ok(raster.png.length>100);
 assert.equal(vector.svg,raster.svg);assert.equal(vector.width,raster.width);assert.equal(vector.height,raster.height);assert.deepEqual(ole,before);
 assert.match(oleLatex(ole),/\\vec\{x\}/);assert.match(vector.svg,/data-c="20D7"/);
 assert.doesNotMatch((await renderNative(makeNewOle('\\vec{x}'),{raster:false})).svg,/data-c="2192"/);
 const wide=makeNewOle('\\overrightarrow{AB}');assert.equal(oleLatex(wide),'\\overrightarrow{AB}');
 assert.match((await renderNative(wide,{raster:false})).svg,/data-c="2192"/);
});

test('Letter catalog provides every standard case, exact displayed glyphs and explicit font requirements for variants',async()=>{
 const catalog=JSON.parse(await readFile(new URL('../src/letter-catalog.json',import.meta.url),'utf8'));
 assert.equal(new Set(catalog.map(x=>x.id)).size,107);
 for(const [family,count] of [['greek',24],['latin',26]])for(const kind of ['lower','upper']){
  const rows=catalog.filter(x=>x.family===family&&x.kind===kind);assert.equal(rows.length,count);
  for(const item of rows){
   const ole=makeNewOle(item.latex);assert.equal(characters(inspectOle(ole).parsed).map(c=>c.char).join(''),item.symbol,item.id);
   const svg=(await renderNative(ole,{raster:false})).svg;assert.ok(svg.includes('data-c='),item.id);
  }
 }
 for(const item of catalog.filter(x=>x.family==='variants')){
  if(item.requiresUnicodeFont){
   const ole=makeNewOle(item.latex),parsed=inspectOle(ole).parsed;
   assert.equal(characters(parsed)[0].char,item.symbol);
   assert.ok(characters(parsed)[0].typeface<0,'Missing Symbol variants must use an explicit bundled font');
   assert.ok(parsed.records.some(r=>r.type===17&&r.name==='STIX Two Math'));
   assert.ok((await renderNative(ole,{raster:false})).svg.includes('data-c='));
  }else assert.ok((await renderNative(makeNewOle(item.latex),{raster:false})).svg.includes('data-c='));
 }
});
