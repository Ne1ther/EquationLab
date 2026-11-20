import test from 'node:test';
import assert from 'node:assert/strict';
import {access,readFile} from 'node:fs/promises';
import {deflateRawSync} from 'node:zlib';
import {nativeSessionOperation as op} from '../src/word-native-session.mjs';
import {createDocx,flatOpc,inspectDocx} from '../src/document.mjs';
import {inspectOle} from '../src/native.mjs';
import {desktopRequest} from '../src/desktop-rpc.mjs';

const bytes=await readFile(new URL('../docs/examples/equation-lab-30-formulas.docx',import.meta.url));
const full=await flatOpc(bytes),doc=await inspectDocx(bytes),index=25,native=inspectOle(doc.objects[index].ole).native.toString('base64');
const fragment=await flatOpc(await createDocx([{ole:doc.objects[index].ole}]));
let seq=99100000n;
const context=(partial=true)=>({ooxml:partial?fragment:full,index,count:30,name:'Live thesis.docx',identity:'live:42',snapshot:partial?100:101,...partial?{scope:'selection'}:{}});
async function open(){return op('native-open',{session:String(seq++),native,document:context()});}
async function close(ticket){await op('native-cancel',{ticket}).catch(()=>{});await op('native-poll',{ticket}).catch(()=>{});}
async function local(fn){const old=globalThis.fetch;globalThis.fetch=async(url,options)=>{try{return {ok:true,json:()=>op(new URL(url).pathname,JSON.parse(options.body))};}catch(error){return {ok:false,json:async()=>({error:error.message})};}};try{return await fn();}finally{globalThis.fetch=old;}}

test('The exact current owner is editable before the full list; enrichment retains its ticket and all native bytes',async()=>{
 const opened=await open(),ticket=opened.ticket;
 try{
  const read=await op('native-read',{ticket});assert.equal(read.document.index,0);assert.equal(read.document.position,index);assert.equal(read.document.count,30);
  const current=await local(()=>desktopRequest({action:'wordSessionRead',payload:{ticket}}));
  assert.match(read.catalogProof,/^\d{13}\.[0-9a-f]{64}$/);
  assert.equal(current.catalogProof,read.catalogProof);
  assert.equal(current.documentLoading,true);assert.equal(current.activeIndex,0);assert.equal(current.documentPosition,index);assert.equal(current.objects.length,1);assert.equal(current.objects[0].nativeSha256,doc.objects[index].nativeSha256);
  await assert.rejects(op('native-navigate',{ticket,index:1}),/navigation/);
  assert.deepEqual(await op('native-enrich-request',{ticket}),{state:'pending'});
  assert.equal((await op('native-poll',{ticket})).loadDocument,true);
  await op('native-enrich',{ticket,session:read.session,initialSnapshot:100,document:context(false)});
  const loaded=await local(()=>desktopRequest({action:'wordSessionDocument',payload:{ticket}}));
  assert.equal(loaded.document.catalogProof,undefined);
  assert.equal(loaded.state,'available');assert.equal(loaded.document.activeIndex,index);assert.equal(loaded.document.wordTicket,ticket);
  assert.deepEqual(loaded.document.objects.map(o=>o.nativeSha256),doc.objects.map(o=>o.nativeSha256));
  await assert.rejects(local(()=>desktopRequest({action:'wordSessionThumbnails',payload:{ticket,indices:[0],documentIdentity:'live:42',documentSnapshot:100}})),/snapshot is no longer current/);
  // The old preview file is immutable while the editor switches source paths.
  assert.equal((await inspectDocx(await readFile(read.document.path))).objects.length,1);
  assert.equal((await op('native-poll',{ticket})).loadDocument,undefined);
 }finally{await close(ticket);}
});
test('Wrong document/index/count/native and stale/terminal loads never grant full-document authority',async()=>{
 const opened=await open(),ticket=opened.ticket,read=await op('native-read',{ticket});
 try{
  for(const change of [{identity:'other:42'},{index:24},{snapshot:100},{count:29}])await assert.rejects(op('native-enrich',{ticket,session:read.session,initialSnapshot:100,document:{...context(false),...change}}));
  await assert.rejects(op('native-enrich',{ticket,session:'1',initialSnapshot:100,document:context(false)}));
  await assert.rejects(op('native-enrich',{ticket,session:read.session,initialSnapshot:99,document:context(false)}));
  assert.equal((await op('native-read',{ticket})).document.scope,'selection');
  await close(ticket);await assert.rejects(op('native-enrich',{ticket,session:read.session,initialSnapshot:100,document:context(false)}),/Unknown or expired/);
 }finally{await close(ticket);}
});
test('List failure leaves the current owner and native data available for a direct save',async()=>{
 const opened=await open(),ticket=opened.ticket;try{
  const read=await op('native-read',{ticket});await op('native-enrich-request',{ticket});
  await op('native-enrich',{ticket,session:read.session,initialSnapshot:100,failed:true});
  assert.deepEqual(await op('native-enrich-request',{ticket}),{state:'failed'});
  assert.equal((await op('native-read',{ticket})).native,native);
  assert.equal((await op('native-poll',{ticket})).state,'editing');
 }finally{await close(ticket);}
});
test('A partial capture must contain exactly the activated equation, not another formula or a full list',async()=>{
 await assert.rejects(op('native-open',{session:String(seq++),native,document:{...context(),ooxml:full}}),/equation count/);
 await assert.rejects(op('native-open',{session:String(seq++),native:inspectOle(doc.objects[0].ole).native.toString('base64'),document:context()}),/activated equation/);
});

test('An active segmented load cannot hold up a save or install a snapshot after the session ends',async()=>{
 const opened=await open(),ticket=opened.ticket;
 try{
  const partial=await op('native-read',{ticket});
  const document={...context(false),encoding:'parts-deflate-base64',ooxml:deflateRawSync(JSON.stringify([full])).toString('base64')};
  const loading=op('native-enrich',{ticket,session:partial.session,initialSnapshot:100,document});
  const rejected=assert.rejects(loading,/no longer current|expired/);
  const read=await op('native-read',{ticket});
  assert.equal(read.document.scope,'selection','an independent read can still access the validated current equation');
  await op('native-complete',{ticket,native,pdf:Buffer.from('%PDF-1.7\n').toString('base64'),width:12,height:14});
  const final=await op('native-poll',{ticket});
  assert.equal(final.state,'complete');assert.equal(final.native,native);
  await rejected;
  await assert.rejects(access(partial.path));
  await assert.rejects(op('native-read',{ticket}),/expired/);
 }finally{await close(ticket);}
});

test('An acknowledged numbering-only save uses the live owner before or after enrichment',async()=>{
 for(const enriched of [false,true]){
  const revision=7,session=String(seq++);
  const opened=await op('native-open',{session,native,acknowledgement:true,numberingSupport:true,numberingExistingSupport:true,document:{...context(),numberingRevision:revision}});
  const ticket=opened.ticket,object=doc.objects[index];
  try{
   const staged=await op('native-read',{ticket});
   assert.equal(staged.numberingExistingSupport,true);
   const partial=await local(()=>desktopRequest({action:'wordSessionRead',payload:{ticket}}));
   assert.equal(partial.wordNumberingExistingSupported,true);
   assert.equal(partial.documentLoading,true);
   assert.equal(partial.activeIndex,0);
   assert.equal(partial.documentPosition,index);
   if(enriched)await op('native-enrich',{ticket,session,initialSnapshot:100,document:{...context(false),numberingRevision:revision}});
   const target={index,expectedNativeSha256:object.nativeSha256,documentIdentity:partial.documentIdentity};
   const numbering={format:'(#C1-#E1)',side:'right',existingRevision:revision};
   const payload={ticket,input:partial.activePath,mode:'characters',replacements:{},target,numbering};
   const save=(patch={})=>local(()=>desktopRequest({action:'wordSessionSave',payload:{...payload,...patch}}));
   await assert.rejects(save({numbering:{...numbering,existingRevision:revision-1}}),/revision changed/);
   await assert.rejects(save({target:{...target,index:0}}),/target or revision changed/);
   await assert.rejects(save({target:{...target,documentIdentity:'other:42'}}),/不属于当前文档/);
   await assert.rejects(save({mode:'rebuild',latex:'w+7'}),/仅改编号时不能修改公式内容/);
   if(!enriched)await assert.rejects(save({numbering:{format:numbering.format,side:numbering.side}}),/尚未载入完整/);
   const complete={ticket,session,native,pdf:Buffer.from('%PDF-1.7\n').toString('base64'),width:12,height:14,target,numbering};
   await assert.rejects(op('native-complete',{...complete,target:{...target,expectedNativeSha256:'1'.repeat(64)}}),/equation does not match/);
   await assert.rejects(op('native-complete',{...complete,native:inspectOle(doc.objects[0].ole).native.toString('base64')}),/cannot change the native equation/);
   await assert.rejects(op('native-complete',{...complete,numbering:{...numbering,context:{chapter:1,section:1,expectedChapter:1,expectedSection:1}}}),/Invalid existing Word numbering revision/);
   assert.equal((await op('native-poll',{ticket})).state,'editing');
   assert.equal((await save()).acknowledgement,true);
   assert.deepEqual(await op('native-status',{ticket}),{state:'queued'});
   const delivered=await op('native-poll',{ticket});
   assert.deepEqual(delivered.target,target);
   assert.deepEqual(delivered.numbering,numbering);
   assert.equal(delivered.native,native);
   await assert.rejects(op('native-ack',{ticket,session,ok:false,numberingLocal:true}),/Invalid native numbering acknowledgement/);
   await op('native-ack',{ticket,session,ok:true,...enriched?{}:{numberingLocal:true}});
   // Repeated acknowledgements cannot upgrade or erase the first scope.
   await op('native-ack',{ticket,session,ok:true,...enriched?{numberingLocal:true}:{}});
   assert.deepEqual(await op('native-status',{ticket}),{state:'committed',change:{
    documentIdentity:target.documentIdentity,documentSnapshot:enriched?101:100,index,
    previousNativeSha256:object.nativeSha256,nativeSha256:object.nativeSha256,numberingChanged:true,
    ...enriched?{}:{numberingLocal:true}
   }});
  }finally{await close(ticket);}
 }
});

test('Guarded numbering rejects older and non-acknowledging hosts and uncaptured revisions',async()=>{
 const base={native,numberingSupport:true,acknowledgement:true,document:{...context(),numberingRevision:0}};
 await assert.rejects(op('native-open',{...base,session:String(seq++),numberingSupport:undefined,numberingExistingSupport:true}),/Invalid native existing numbering capability/);
 for(const patch of [{},{numberingExistingSupport:true,acknowledgement:undefined},{numberingExistingSupport:true,document:context()}]){
  const {ticket}=await op('native-open',{...base,...patch,session:String(seq++)});
  try{
   const target={index,expectedNativeSha256:doc.objects[index].nativeSha256,documentIdentity:'live:42'};
   const numbering={format:'(#C1-#E1)',side:'right',existingRevision:0};
   const payload={ticket,native,pdf:Buffer.from('%PDF-1.7\n').toString('base64'),width:12,height:14,target,numbering};
   await assert.rejects(op('native-complete',payload),/Invalid existing Word numbering revision|target or revision changed/);
   assert.equal((await op('native-poll',{ticket})).state,'editing');
  }finally{await close(ticket);}
 }
});
