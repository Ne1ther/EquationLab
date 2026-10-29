import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {nativeSessionOperation as op} from '../src/word-native-session.mjs';
import {createDocx,flatOpc,inspectDocx} from '../src/document.mjs';
import {inspectOle,makeOle} from '../src/native.mjs';

const bytes=await readFile(new URL('../docs/examples/equation-lab-30-formulas.docx',import.meta.url));
const full=await flatOpc(bytes),objects=(await inspectDocx(bytes)).objects,index=25;
const anchor=await flatOpc(await createDocx([{ole:objects[index].ole}]));
const empty=await flatOpc(await createDocx([]));
const layout={mode:'numbered-right',numberFormat:'(#C1.#E1)',chapter:3,section:1,equation:27};
const after={index,nativeSha256:objects[index].nativeSha256};
let sequence=99300000n;const live=new Set();
const context=(withAnchor=true)=>({identity:'insert:42',snapshot:100,index:-1,count:30,name:'Large synthetic.docx',scope:'insertion',ooxml:withAnchor?anchor:empty,...withAnchor?{insertionAfter:after}:{}});
const completeContext=(withAnchor=true)=>({...context(withAnchor),scope:undefined,snapshot:101,ooxml:full});
async function open(document=context()){const session=String(sequence++),result=await op('native-insert-open',{session,acknowledgement:true,document,layout});live.add(result.ticket);return {...result,session};}
async function close(ticket){await op('native-cancel',{ticket}).catch(()=>{});await op('native-poll',{ticket}).catch(()=>{});live.delete(ticket);}
test.afterEach(async()=>{for(const ticket of live)await close(ticket);});

test('Large insertion opens with only an exact anchor or empty cursor and enriches the same ticket',async()=>{
 for(const withAnchor of [false,true]){
  const opened=await open(context(withAnchor)),read=await op('native-read',{ticket:opened.ticket});
  assert.equal(read.insertion,true);assert.equal(read.document.index,-1);assert.equal(read.document.scope,'insertion');assert.equal(read.document.count,30);
  assert.equal((await inspectDocx(await readFile(read.document.path))).objects.length,withAnchor?1:0);
  assert.deepEqual(read.layout,layout);assert.equal(read.documentContext.reason,'insertion-captured');
  assert.deepEqual(await op('native-enrich-request',{ticket:opened.ticket}),{state:'pending'});
  assert.equal((await op('native-poll',{ticket:opened.ticket})).loadDocument,true);
  await op('native-enrich',{ticket:opened.ticket,session:opened.session,initialSnapshot:100,document:completeContext(withAnchor)});
  const loaded=await op('native-read',{ticket:opened.ticket});
  assert.equal(loaded.ticket,read.ticket);assert.equal(loaded.document.index,-1);assert.equal(loaded.document.scope,undefined);assert.equal(loaded.documentContext.count,30);
  assert.deepEqual(loaded.layout,layout);assert.equal(loaded.native,read.native);
  assert.deepEqual((await inspectDocx(await readFile(loaded.document.path))).objects.map(o=>o.nativeSha256),objects.map(o=>o.nativeSha256));
  assert.equal((await inspectDocx(await readFile(read.document.path))).objects.length,withAnchor?1:0,'initial insertion staging stays immutable');
  await close(opened.ticket);
 }
});

test('Partial insertion requires the exact after-target bytes and never accepts a full list as a fragment',async()=>{
 for(const change of [{insertionAfter:{...after,nativeSha256:objects[0].nativeSha256}},{insertionAfter:{...after,index:30}},{ooxml:full},{ooxml:empty},{index:0},{count:undefined},{scope:'selection'}])await assert.rejects(open({...context(),...change}));
 await assert.rejects(open({...context(false),ooxml:anchor}),/count/);
 await assert.rejects(op('native-open',{session:String(sequence++),native:inspectOle(objects[index].ole).native.toString('base64'),document:context()}),/context/);
});

test('Enrichment rejects changed identity/count/anchor and a cancelled insertion cannot be resurrected',async()=>{
 const opened=await open();
 for(const change of [{identity:'other:42'},{index:0},{count:29},{snapshot:100},{insertionAfter:undefined},{insertionAfter:{...after,index:24}}]){
  await assert.rejects(op('native-enrich',{ticket:opened.ticket,session:opened.session,initialSnapshot:100,document:{...completeContext(),...change}}));
 }
 assert.equal((await op('native-read',{ticket:opened.ticket})).document.scope,'insertion');
 await close(opened.ticket);
 await assert.rejects(op('native-enrich',{ticket:opened.ticket,session:opened.session,initialSnapshot:100,document:completeContext()}),/Unknown or expired/);
});

test('Failure to load the list does not prevent the bound insertion from completing once',async()=>{
 const opened=await open(context(false));await op('native-enrich-request',{ticket:opened.ticket});
 await op('native-enrich',{ticket:opened.ticket,session:opened.session,initialSnapshot:100,failed:true});
 assert.deepEqual(await op('native-enrich-request',{ticket:opened.ticket}),{state:'failed'});
 const ole=makeOle('z+1'),native=inspectOle(ole).native;
 const docx=await createDocx([{ole,layout:{...layout,equation:27}}],{fragment:true});
 await op('native-complete',{ticket:opened.ticket,session:opened.session,native:native.toString('base64'),pdf:Buffer.from('%PDF-1.4\n%%EOF\n').toString('base64'),width:1000,height:500,docx:docx.toString('base64')});
 const result=await op('native-poll',{ticket:opened.ticket});live.delete(opened.ticket);
 assert.equal(result.state,'complete');assert.equal(result.native,native.toString('base64'));assert.equal(result.insertionMode,'numbered-right');
 assert.equal((await op('native-ack',{ticket:opened.ticket,session:opened.session,ok:true})).state,'committed');
});

test('A long document without equations can enrich an empty insertion list',async()=>{
 const opened=await open({...context(false),count:0});
 await op('native-enrich-request',{ticket:opened.ticket});
 await op('native-enrich',{ticket:opened.ticket,session:opened.session,initialSnapshot:100,document:{...completeContext(false),count:0,ooxml:empty}});
 const read=await op('native-read',{ticket:opened.ticket});assert.equal(read.documentContext.count,0);assert.equal(read.documentContext.state,'available');
});
