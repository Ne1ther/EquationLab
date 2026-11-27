import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocx,flatOpc} from '../src/document.mjs';
import {makeNewOle} from '../src/new-formula.mjs';
import {inspectOle} from '../src/native.mjs';
import {nativeSessionOperation as operation} from '../src/word-native-session.mjs';

const ole=makeNewOle('x^2');
const native=inspectOle(ole).native.toString('base64');
const docx=(await createDocx([{ole}],{fragment:true})).toString('base64');
const pdf=Buffer.from('%PDF-1.4\n%%EOF\n').toString('base64');
const ooxml=await flatOpc(await createDocx([]));
let sequence=0;

async function openInsertion(call=operation){
 const session=String(++sequence);
 const result=await call('native-insert-open',{session,acknowledgement:true,document:{ooxml,index:-1,identity:'recovery:1',snapshot:sequence,name:'Retry.docx'},layout:{mode:'inline',numberFormat:'(#E1)',chapter:1,section:1,equation:1}});
 assert.equal(result.insertionReplay,true);
 return {ticket:result.ticket,session};
}

async function complete(binding,call=operation){
 await call('native-complete',{...binding,native,pdf,docx,width:1200,height:600});
}

test('a lost Word insertion response can be replayed once or more until the host reports its one mutation',async()=>{
 for(const outcome of [true,false,'uncertain']){
  const binding=await openInsertion();
  await complete(binding);
  const request={...binding,insertionReplay:true};
  await assert.rejects(operation('native-poll',{ticket:binding.ticket,insertionReplay:true}),/Invalid Word insertion delivery request/);
  await assert.rejects(operation('native-poll',{...request,session:'1000'}),/Unknown or expired/);
  const lostResponse=await operation('native-poll',request);
  assert.equal(lostResponse.state,'complete');
  assert.equal(lostResponse.docx,docx);
  assert.equal(lostResponse.native,undefined);
  assert.equal(lostResponse.pdf,undefined);
  assert.deepEqual(await operation('native-status',binding),{state:'delivered'});
  await assert.rejects(operation('native-poll',binding),/replay-capable polling/);
  assert.deepEqual(await operation('native-poll',request),lostResponse);
  const acknowledgement={...binding,...outcome==='uncertain'?{ok:false,uncertain:true}:{ok:outcome}};
  const expected={state:outcome==='uncertain'?'unconfirmed':outcome?'committed':'failed'};
  assert.deepEqual(await operation('native-ack',acknowledgement),expected);
  assert.deepEqual(await operation('native-ack',acknowledgement),expected);
  await assert.rejects(operation('native-poll',request),/Unknown or expired/);
 }
});

test('an abandoned replay expires at the original delivery deadline',async()=>{
 const binding=await openInsertion();
 await complete(binding);
 const request={...binding,insertionReplay:true};
 const realNow=Date.now;
 let now=Date.now();
 Date.now=()=>now;
 try{
  await operation('native-poll',request);
  now+=59_999;
  assert.equal((await operation('native-poll',request)).state,'complete');
  now++;
  await assert.rejects(operation('native-poll',request),/Unknown or expired/);
  assert.deepEqual(await operation('native-status',binding),{state:'unconfirmed'});
 }finally{Date.now=realNow;}
 assert.deepEqual(await operation('native-ack',{...binding,ok:false}),{state:'failed'});
});

const confirmationWindow=60_000,receiptLifetime=20*60_000;

async function delivery(call,replay=true){
 const binding=await openInsertion(call);
 await complete(binding,call);
 await call('native-poll',replay?{...binding,insertionReplay:true}:binding);
 return binding;
}

test('older terminal receipts make room after 64 insertions while unresolved results remain available',async t=>{
 const {nativeSessionOperation:call}=await import('../src/word-native-session.mjs?old-terminals');
 t.mock.timers.enable({apis:['Date'],now:Date.now()});
 const pending=await delivery(call);
 let first,last;
 for(let index=0;index<66;index++){
  const binding=await delivery(call);
  await call('native-ack',{...binding,ok:index%2===0});
  first??=binding;
  last=binding;
  t.mock.timers.tick(1000);
 }
 await assert.rejects(call('native-status',first),/Unknown or expired/);
 assert.deepEqual(await call('native-status',last),{state:'failed'});
 assert.deepEqual(await call('native-status',pending),{state:'unconfirmed'});
 assert.deepEqual(await call('native-ack',{...pending,ok:true}),{state:'committed'});
});

test('64 deliveries without a status query or acknowledgement release receipt capacity on schedule',async t=>{
 const {nativeSessionOperation:call}=await import('../src/word-native-session.mjs?abandoned-deliveries');
 const started=Date.now();
 t.mock.timers.enable({apis:['Date'],now:started});
 let first;
 for(let i=0;i<64;i++){
  const binding=await delivery(call,i%2===0);
  first??=binding;
  // Expire replay payloads in batches. No status queries or acknowledgements
  // should be needed to give their receipts an expiration time.
  if(i%8===7)t.mock.timers.tick(confirmationWindow);
 }
 t.mock.timers.setTime(started+confirmationWindow+receiptLifetime-1);
 await assert.rejects(openInsertion(call),/Too many unconfirmed native receipts/);
 t.mock.timers.tick(1);
 const next=await openInsertion(call);
 await assert.rejects(call('native-status',first),/Unknown or expired/);
 assert.deepEqual(await call('native-cancel',next),{ok:true,state:'cancelled'});
});

test('receipt pressure protects the freshly committed result and reserves active sessions',async t=>{
 const {nativeSessionOperation:call}=await import('../src/word-native-session.mjs?protected-terminals');
 t.mock.timers.enable({apis:['Date'],now:Date.now()});
 for(let i=0;i<63;i++){
  const binding=await delivery(call);
  await call('native-ack',{...binding,ok:false,uncertain:true});
 }
 t.mock.timers.tick(confirmationWindow);
 const final=await openInsertion(call);
 await assert.rejects(openInsertion(call),/Too many unconfirmed native receipts/);
 await complete(final,call);
 await call('native-poll',{...final,insertionReplay:true});
 const ack={...final,ok:true};
 await call('native-ack',ack);
 t.mock.timers.tick(confirmationWindow-1);
 await assert.rejects(openInsertion(call),/Too many unconfirmed native receipts/);
 assert.deepEqual(await call('native-status',final),{state:'committed'});
 assert.deepEqual(await call('native-ack',ack),{state:'committed'});
 t.mock.timers.tick(1);
 const next=await openInsertion(call);
 await assert.rejects(call('native-status',final),/Unknown or expired/);
 assert.deepEqual(await call('native-cancel',next),{ok:true,state:'cancelled'});
});
