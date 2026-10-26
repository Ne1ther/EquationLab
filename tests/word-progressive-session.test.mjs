import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
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
  assert.equal(current.documentLoading,true);assert.equal(current.activeIndex,0);assert.equal(current.documentPosition,index);assert.equal(current.objects.length,1);assert.equal(current.objects[0].nativeSha256,doc.objects[index].nativeSha256);
  await assert.rejects(op('native-navigate',{ticket,index:1}),/navigation/);
  assert.deepEqual(await op('native-enrich-request',{ticket}),{state:'pending'});
  assert.equal((await op('native-poll',{ticket})).loadDocument,true);
  await op('native-enrich',{ticket,session:read.session,initialSnapshot:100,document:context(false)});
  const loaded=await local(()=>desktopRequest({action:'wordSessionDocument',payload:{ticket}}));
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
