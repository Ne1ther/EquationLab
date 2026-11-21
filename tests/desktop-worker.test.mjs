import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {desktopRequest} from '../src/desktop-rpc.mjs';
import {makeNewOle,factoryTypography} from '../src/new-formula.mjs';
import {createDocx,inspectDocx,hash} from '../src/document.mjs';
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

async function mockWorker(t,dir,preload){
 const hook=join(dir,'preload.mjs');await writeFile(hook,preload);
 const child=spawn(process.execPath,['--import',hook,fileURLToPath(new URL('../src/desktop-rpc.mjs',import.meta.url)),'--stdio-worker'],{stdio:['pipe','pipe','pipe']});
 t.after(()=>{if(child.exitCode===null)child.kill('SIGTERM');});
 const pending=new Map(),order=[],markerWaiters=new Set();let buffer='',stderr='',closedError=null;
 const fail=error=>{
  if(!closedError)closedError=error;
  for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(closedError);}
  pending.clear();
  for(const waiter of markerWaiters){clearTimeout(waiter.timer);waiter.reject(closedError);}
  markerWaiters.clear();
 };
 child.stderr.on('data',data=>{
  stderr+=data;
  for(const waiter of [...markerWaiters])waiter.check();
 });
 child.stdout.on('data',data=>{
  buffer+=data;let end;
  while((end=buffer.indexOf('\n'))>=0){
   const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
   let reply;
   try{reply=JSON.parse(line);}
   catch(error){fail(Error(`worker stdout parse error: ${error.message}; line=${line}\n${stderr}`));return;}
   order.push(reply.id);
   const entry=pending.get(reply.id);
   if(entry){clearTimeout(entry.timer);pending.delete(reply.id);entry.resolve(reply);}
  }
 });
 child.stdin.on('error',error=>fail(Error(`worker stdin error: ${error.message}\n${stderr}`)));
 const ended=new Promise((resolve,reject)=>{
  child.once('error',error=>{fail(Error(`worker startup failed: ${error.message}\n${stderr}`));reject(error);});
  child.once('close',(code,signal)=>{fail(Error(`worker exited early (code=${code}, signal=${signal}): ${stderr}`));resolve(code);});
 });
 const send=(request,{timeoutMs=8000}={})=>{
  if(closedError)return Promise.reject(closedError);
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{pending.delete(request.id);reject(Error(`worker rpc timeout for ${request.id} (${request.action}): ${stderr}`));},timeoutMs);
   pending.set(request.id,{resolve,reject,timer});
   child.stdin.write(JSON.stringify(request)+'\n');
  });
 };
 const marker=(text,timeoutMs=5000)=>{
  if(stderr.includes(text))return Promise.resolve();
  if(closedError)return Promise.reject(closedError);
  return new Promise((resolve,reject)=>{
   const waiter={
    timer:null,
    reject,
    check(){if(stderr.includes(text)){clearTimeout(waiter.timer);markerWaiters.delete(waiter);resolve();}}
   };
   waiter.timer=setTimeout(()=>{markerWaiters.delete(waiter);reject(Error('worker marker not observed: '+text+' '+stderr));},timeoutMs);
   markerWaiters.add(waiter);
   waiter.check();
  });
 };
 return {
  send,marker,order,
  get stderr(){return stderr;},
  finish:async(timeoutMs=5000)=>{
   child.stdin.end();
   let timer;
   const code=await Promise.race([
    ended,
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`worker finish timeout: ${stderr}`)),timeoutMs);})
   ]).finally(()=>clearTimeout(timer));
   assert.equal(code,0,stderr);
  }
 };
}

test('a delayed Word enrichment status does not hold the production preview queue',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'equationlab-worker-enrich-wait-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const worker=await mockWorker(t,dir,`globalThis.fetch=async url=>{if(!String(url).endsWith('/native-enrich-request'))throw Error('unexpected request');process.stderr.write('ENRICH_WAIT\\n');await new Promise(r=>setTimeout(r,800));return {ok:true,json:async()=>({state:'pending'})};};`);
 assert.equal((await worker.send({id:'warm',action:'validate',payload:{latex:'x+1'}})).ok,true);
 const waiting=worker.send({id:'list',action:'wordSessionDocument',payload:{ticket:'a'.repeat(64)}});await worker.marker('ENRICH_WAIT');
 const preview=worker.send({id:'preview',action:'validate',payload:{latex:'y+2',previewOnly:true}});
 const [p,l]=await Promise.all([preview,waiting]);assert.equal(p.ok,true,p.error);assert.equal(l.ok,true,l.error);assert.equal(l.data.state,'pending');
 assert.ok(worker.order.indexOf('preview')<worker.order.indexOf('list'),worker.order.join(','));await worker.finish();
});

test('list parsing yields to an independent preview and same-path cache waits without deadlock',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'equationlab-worker-enrich-parse-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=join(dir,'snapshot.docx'),bytes=await createDocx(Array.from({length:30},(_,i)=>({latex:`x_{${i+1}}+1`})),{fragment:true});await writeFile(file,bytes);
 const original=await inspectDocx(bytes),ticket='b'.repeat(64),native=inspectOle(original.objects[0].ole).native.toString('base64');
 const session={ticket,session:'88',native,path:file,document:{path:file,index:0,name:'fixture',identity:'test:identity',snapshot:2}};
 const preload=`const original=globalThis.setImmediate;let paused=false,armed=false;globalThis.setImmediate=(fn,...args)=>{if(armed&&!paused&&new Error().stack.includes('desktop-rpc.mjs')){paused=true;process.stderr.write('INDEX_PAUSED\\n');return setTimeout(()=>original(fn,...args),800);}return original(fn,...args);};globalThis.fetch=async (url,options)=>{if(String(url).endsWith('/native-enrich-request'))return {ok:true,json:async()=>({state:'available'})};armed=true;const request=JSON.parse(options.body),session=${JSON.stringify(session)};if(request.ticket==='c'.repeat(64)){session.ticket=request.ticket;session.native=Buffer.from('wrong native').toString('base64');}return {ok:true,json:async()=>session};};`;
 const worker=await mockWorker(t,dir,preload);assert.equal((await worker.send({id:'warm',action:'validate',payload:{latex:'x+1'}})).ok,true);
 const list=worker.send({id:'list',action:'wordSessionDocument',payload:{ticket}});await worker.marker('INDEX_PAUSED');
 const preview=worker.send({id:'preview',action:'validate',payload:{latex:'y+2',previewOnly:true}});
 const same=worker.send({id:'same-path',action:'editPreview',payload:{input:file,index:0,mode:'rebuild',latex:'z+2',previewOnly:true}});
 const [p,l,s]=await Promise.all([preview,list,same]);assert.equal(p.ok,true,p.error);assert.equal(l.ok,true,l.error);assert.equal(s.ok,true,s.error);
 assert.equal(l.data.document.documentIdentity,'test:identity');assert.equal(l.data.document.documentSnapshot,2);assert.deepEqual(l.data.document.objects.map(o=>o.nativeSha256),original.objects.map(o=>o.nativeSha256));
 assert.ok(worker.order.indexOf('preview')<worker.order.indexOf('list'),worker.order.join(','));
 const mismatch=await worker.send({id:'mismatch',action:'wordSessionDocument',payload:{ticket:'c'.repeat(64)}});assert.equal(mismatch.ok,false);assert.match(mismatch.error,/快照与当前公式不一致/);
 await worker.finish();
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

test('sidebar and favorite thumbnails yield to two FIFO writes and a live preview without concurrent renders',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'equationlab-worker-thumb-yield-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=join(dir,'snapshot.docx'),bytes=await createDocx([{latex:'a^2+b^2=c^2'},{latex:'\\frac{x+1}{y+2}'},{latex:'\\sqrt{z^3+1}'}],{fragment:true});
 await writeFile(file,bytes);
 const original=await inspectDocx(bytes),ticket='d'.repeat(64),native=inspectOle(original.objects[0].ole).native.toString('base64');
 const session={ticket,session:'91',native,path:file,document:{path:file,index:0,name:'yield.docx',identity:'test:yield',snapshot:7}};
 const preload=`
  import {registerHooks} from 'node:module';
  let active=0,maxActive=0,rasterCount=0;
  globalThis.__wrapRenderNative=async(real,ole,options)=>{
   active++;maxActive=Math.max(maxActive,active);
   const isThumb=options?.maxWidth===640&&options?.maxHeight===240;
   const tag=isThumb?'thumb-'+(rasterCount++):'preview';
   process.stderr.write('EVENT:'+tag+':start:active='+active+'\\n');
   try{
    if(tag==='thumb-0')await new Promise(r=>setTimeout(r,350));
    return await real(ole,options);
   }finally{
    process.stderr.write('EVENT:'+tag+':end:maxActive='+maxActive+'\\n');
    active--;
   }
  };
  registerHooks({
   load(url,context,nextLoad){
    const loaded=nextLoad(url,context);
    if(url.endsWith('/src/font-renderer.mjs')){
     const source=typeof loaded.source==='string'?loaded.source:Buffer.from(loaded.source).toString('utf8');
     return {...loaded,source:source.replace('export async function renderNative(','async function __realRenderNative(')+'\\nexport async function renderNative(ole,options){return globalThis.__wrapRenderNative(__realRenderNative,ole,options);}\\n'};
    }
    return loaded;
   }
  });
  globalThis.fetch=async(url)=>{
   if(!String(url).endsWith('/native-read'))throw Error('unexpected fetch: '+url);
   return {ok:true,json:async()=>(${JSON.stringify(session)})};
  };
 `;
 const worker=await mockWorker(t,dir,preload);
 assert.equal((await worker.send({id:'warm',action:'validate',payload:{latex:'x+1'}})).ok,true);
 const thumbs=worker.send({id:'thumbs',action:'wordSessionThumbnails',payload:{ticket,indices:[0,1,2],documentIdentity:'test:yield',documentSnapshot:7}});
 await worker.marker('EVENT:thumb-0:start:active=1');
 const favorite=worker.send({id:'favorite',action:'preview',payload:{latex:'x+1',favoriteThumbnail:true}});
 const write1=worker.send({id:'write-1',action:'preferencesExport',payload:{output:join(dir,'w1.eqp'),typography:factoryTypography()}});
 const preview=worker.send({id:'live-preview',action:'validate',coalescePreview:true,payload:{previewOnly:true,latex:'\\alpha+\\beta'}});
 const write2=worker.send({id:'write-2',action:'preferencesExport',payload:{output:join(dir,'w2.eqp'),typography:factoryTypography()}});
 const [w1,p,w2,th,fav]=await Promise.all([write1,preview,write2,thumbs,favorite]);
 for(const reply of [w1,p,w2,th,fav])assert.equal(reply.ok,true,reply.error);
 assert.equal(th.data.images.length,3);
 assert.ok(th.data.images.every(item=>typeof item.image==='string'&&item.image.startsWith('data:image/png;base64,')));
 assert.deepEqual(Object.keys(fav.data),['png']);
 assert.ok(fav.data.png);
 // Writes stay FIFO and both writes + live preview finish before the thumbnail batch finishes.
 assert.ok(worker.order.indexOf('write-1')<worker.order.indexOf('write-2'),worker.order.join(','));
 assert.ok(worker.order.indexOf('write-2')<worker.order.indexOf('live-preview'),worker.order.join(','));
 assert.ok(worker.order.indexOf('live-preview')<worker.order.indexOf('favorite'),worker.order.join(','));
 assert.ok(worker.order.indexOf('live-preview')<worker.order.indexOf('thumbs'),worker.order.join(','));
 // Verify preview ran strictly between thumb-0 and thumb-1, with max concurrency 1.
 await worker.marker('EVENT:thumb-2:end:maxActive=1');
 const lines=worker.stderr.trim().split('\n').filter(line=>line.startsWith('EVENT:'));
 const thumb0End=lines.findIndex(line=>line.startsWith('EVENT:thumb-0:end:'));
 const previewStart=lines.findIndex((line,i)=>i>thumb0End&&line.startsWith('EVENT:preview:start:'));
 const thumb1Start=lines.findIndex(line=>line.startsWith('EVENT:thumb-1:start:'));
 assert.ok(thumb0End>=0&&previewStart>thumb0End&&thumb1Start>previewStart,lines.join('\n'));
 assert.ok(lines.every(line=>!line.includes('active=2')&&!line.includes('maxActive=2')),lines.join('\n'));
 await worker.finish();
});

test('thumbnail batch discards stale results and skips remaining renders when a Word save overtakes it',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'equationlab-worker-thumb-stale-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=join(dir,'snapshot.docx'),bytes=await createDocx([{latex:'m_1+n_1'},{latex:'m_2+n_2'},{latex:'m_3+n_3'}],{fragment:true});
 await writeFile(file,bytes);
 const original=await inspectDocx(bytes),ticket='e'.repeat(64),native=inspectOle(original.objects[0].ole).native.toString('base64');
 const single=join(dir,'single.docx');await writeFile(single,await createDocx([{ole:original.objects[0].ole}],{fragment:true}));
 const session={ticket,session:'92',native,path:single,document:{path:file,index:0,name:'stale.docx',identity:'test:stale',snapshot:10}};
 const preload=`
  import {registerHooks} from 'node:module';
  let rasterCount=0,completed=false;
  globalThis.__wrapRenderNative=async(real,ole,options)=>{
   const isThumb=options?.maxWidth===640&&options?.maxHeight===240;
   if(isThumb){
    const idx=rasterCount++;
    process.stderr.write('THUMB_RENDER:'+idx+'\\n');
    if(idx===0)await new Promise(r=>setTimeout(r,300));
   }
   return real(ole,options);
  };
  registerHooks({
   load(url,context,nextLoad){
    const loaded=nextLoad(url,context);
    if(url.endsWith('/src/font-renderer.mjs')){
     const source=typeof loaded.source==='string'?loaded.source:Buffer.from(loaded.source).toString('utf8');
     return {...loaded,source:source.replace('export async function renderNative(','async function __realRenderNative(')+'\\nexport async function renderNative(ole,options){return globalThis.__wrapRenderNative(__realRenderNative,ole,options);}\\n'};
    }
    return loaded;
   }
  });
  globalThis.fetch=async(url)=>{
   const target=String(url);
   if(target.endsWith('/native-complete')){completed=true;return {ok:true,json:async()=>({ok:true,checked:true,state:'complete'})};}
   if(target.endsWith('/native-read')){
    if(completed)return {ok:false,json:async()=>({error:'Native session is no longer editing'})};
    return {ok:true,json:async()=>(${JSON.stringify(session)})};
   }
   throw Error('unexpected fetch: '+target);
  };
 `;
 const worker=await mockWorker(t,dir,preload);
 assert.equal((await worker.send({id:'warm',action:'validate',payload:{latex:'x+1'}})).ok,true);
 const thumbs=worker.send({id:'thumbs',action:'wordSessionThumbnails',payload:{ticket,indices:[0,1,2],documentIdentity:'test:stale',documentSnapshot:10}});
 await worker.marker('THUMB_RENDER:0');
 const save=worker.send({id:'word-save',action:'wordSessionSave',payload:{ticket,input:single,mode:'rebuild',latex:'m_1+99'}});
 const preview=worker.send({id:'preview',action:'validate',coalescePreview:true,payload:{previewOnly:true,latex:'p+q'}});
 const [s,p,th]=await Promise.all([save,preview,thumbs]);
 assert.equal(s.ok,true,s.error);
 assert.equal(p.ok,true,p.error);
 assert.equal(th.ok,false,'stale thumbnail batch must be rejected after Word save');
 assert.match(th.error,/snapshot is no longer current|no longer editing/);
 assert.equal(worker.stderr.includes('THUMB_RENDER:1'),false,'remaining stale thumbnails must not render after save');
 assert.ok(worker.order.indexOf('word-save')<worker.order.indexOf('preview'),worker.order.join(','));
 await worker.finish();
});

test('delayed outer Word session read for thumbnails does not block a live preview',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'equationlab-worker-thumb-outer-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const preload=`
  globalThis.fetch=async(url)=>{
   if(!String(url).endsWith('/native-read'))throw Error('unexpected fetch');
   process.stderr.write('THUMB_READ_WAIT\\n');
   await new Promise(r=>setTimeout(r,500));
   return {ok:false,json:async()=>({error:'Native session is no longer editing'})};
  };
 `;
 const worker=await mockWorker(t,dir,preload);
 assert.equal((await worker.send({id:'warm',action:'validate',payload:{latex:'x+1'}})).ok,true);
 const thumbs=worker.send({id:'thumbs',action:'wordSessionThumbnails',payload:{ticket:'f'.repeat(64),indices:[0,1]}});
 await worker.marker('THUMB_READ_WAIT');
 const preview=worker.send({id:'preview',action:'validate',coalescePreview:true,payload:{previewOnly:true,latex:'u+v'}});
 const [p,th]=await Promise.all([preview,thumbs]);
 assert.equal(p.ok,true,p.error);
 assert.equal(th.ok,false);
 assert.ok(worker.order.indexOf('preview')<worker.order.indexOf('thumbs'),worker.order.join(','));
 await worker.finish();
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
