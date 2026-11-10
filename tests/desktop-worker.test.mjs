import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {desktopRequest} from '../src/desktop-rpc.mjs';
import {makeNewOle,factoryTypography} from '../src/new-formula.mjs';
import {createDocx,hash} from '../src/document.mjs';
import {inspectOle,oleLatex,characters} from '../src/native.mjs';
import {renderNative} from '../src/font-renderer.mjs';

test('Editor control requests bypass rendering warmup and queued previews',async()=>{
 const child=spawn(process.execPath,[fileURLToPath(new URL('../src/desktop-rpc.mjs',import.meta.url)),'--stdio-worker'],{stdio:['pipe','pipe','pipe']});
 let out='',errors='';child.stdout.on('data',s=>out+=s);child.stderr.on('data',s=>errors+=s);
 const finished=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 for(let i=0;i<8;i++)child.stdin.write(JSON.stringify({id:'preview-'+i,action:'validate',payload:{latex:'x^'+(i+1)}})+'\n');
 child.stdin.end(JSON.stringify({id:'control',action:'typography-default'})+'\n');
 assert.equal(await finished,0,errors);const replies=out.trim().split('\n').map(s=>JSON.parse(s));
 assert.ok(replies.every(r=>r.ok),out);assert.equal(replies[0].id,'control','cancel/status/open use the same control path and must not queue behind rendering');
 assert.equal(replies.length,9);
});

test('production worker serves a preview inside readonly preflight while copy writes stay FIFO',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'equationlab-worker-preflight-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const input=join(dir,'input.docx'),bytes=await createDocx(Array.from({length:30},(_,i)=>({latex:`x_{${i+1}}+1`})),{fragment:true});await writeFile(input,bytes);
 const child=spawn(process.execPath,[fileURLToPath(new URL('../src/desktop-rpc.mjs',import.meta.url)),'--stdio-worker'],{stdio:['pipe','pipe','pipe']});
 t.after(()=>{if(child.exitCode===null)child.kill('SIGTERM');});
 const pending=new Map(),order=[];let buffer='',stderr='';
 child.stderr.on('data',chunk=>stderr+=chunk);
 child.stdout.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const reply=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);order.push(reply.id);pending.get(reply.id)?.(reply);pending.delete(reply.id);}});
 const ended=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 const send=request=>new Promise(resolve=>{pending.set(request.id,resolve);child.stdin.write(JSON.stringify(request)+'\n');});
 assert.equal((await send({id:'warm',action:'validate',payload:{latex:'x+1'}})).ok,true);
 const plan=send({id:'plan',action:'documentTypographyPreflight',payload:{input,options:{typography:{fullSize:14}}}});
 const first=send({id:'write-1',action:'preferencesExport',payload:{output:join(dir,'first.eqp'),typography:factoryTypography()}});
 const preview=send({id:'foreground',action:'validate',coalescePreview:true,payload:{previewOnly:true,latex:'y+2'}});
 const last=send({id:'write-2',action:'preferencesExport',payload:{output:join(dir,'last.eqp'),typography:factoryTypography()}});
 const control=send({id:'control',action:'typography-default'});
 for(const reply of await Promise.all([plan,first,preview,last,control]))assert.equal(reply.ok,true,reply.error);
 child.stdin.end();assert.equal(await ended,0,stderr);
 assert.ok(order.indexOf('foreground')<order.indexOf('plan'),order.join(','));
 assert.ok(order.indexOf('plan')<order.indexOf('write-1'),order.join(','));
 assert.ok(order.indexOf('write-1')<order.indexOf('write-2'),order.join(','));
 assert.ok(order.indexOf('control')<order.indexOf('plan'),order.join(','));
 assert.equal(hash(await readFile(input)),hash(bytes));
 assert.deepEqual(await readFile(join(dir,'first.eqp')),await readFile(join(dir,'last.eqp')));
});

test('only explicitly disposable previews coalesce; preference validation must actually run',async()=>{
 const child=spawn(process.execPath,[fileURLToPath(new URL('../src/desktop-rpc.mjs',import.meta.url)),'--stdio-worker'],{stdio:['pipe','pipe','pipe']});
 let output='',errors='';child.stdout.on('data',s=>output+=s);child.stderr.on('data',s=>errors+=s);
 const end=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 const requests=[
  {id:'default-check',action:'validate',coalescePreview:true,payload:{latex:'\\unsupportedcommand'}},
  ...Array.from({length:8},(_,i)=>({id:'preview-'+i,action:'validate',coalescePreview:true,payload:{previewOnly:true,latex:'x^'+(i+1)}}))
 ];
 child.stdin.end(requests.map(value=>JSON.stringify(value)).join('\n')+'\n');assert.equal(await end,0,errors);
 const replies=output.trim().split('\n').map(JSON.parse),defaults=replies.find(value=>value.id==='default-check');
 assert.equal(defaults.ok,false);assert.equal(defaults.cancelled,undefined);assert.ok(defaults.error);
 assert.equal(replies.find(value=>value.id==='preview-7').ok,true);assert.ok(replies.some(value=>value.superseded));assert.equal(replies.length,9);
});

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
 const byId=new Map(results.map(r=>[r.id,r]));
 assert.deepEqual(['first',undefined,'rejected','last'].map(id=>byId.get(id).ok),[true,false,false,true]);
 assert.deepEqual(byId.get('first').data,await desktopRequest(request));
 assert.deepEqual(byId.get('last').data,await desktopRequest({action:'validate',payload:{latex:'\\frac{a}{b}'}}));
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
