import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,lstat,access} from 'node:fs/promises';
import {dirname,basename} from 'node:path';
import {nativeSessionOperation as operation} from '../src/word-native-session.mjs';
import {makeOle,inspectOle} from '../src/native.mjs';
import {inspectDocx} from '../src/document.mjs';

const initial=inspectOle(makeOle('x^3')).native,changed=inspectOle(makeOle('x^4')).native;
const pdf=Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n').toString('base64');
const tickets=new Set();let next=1000n;
const realSetTimeout=globalThis.setTimeout;
async function open(native=initial,session=String(next++)){
 const result=await operation('native-open',{native:native.toString('base64'),session});tickets.add(result.ticket);return {...result,session};
}
async function close(ticket){
 try{await operation('native-cancel',{ticket});}catch{}
 try{await operation('native-poll',{ticket});}catch{}
 tickets.delete(ticket);
}
test.afterEach(async()=>{for(const ticket of tickets)await close(ticket);});
const resultBody=ticket=>({ticket,native:changed.toString('base64'),pdf,width:1500,height:700});
async function gone(path){await assert.rejects(access(path),error=>error.code==='ENOENT');}

test('Native open/read stages a private DOCX with the exact original Equation Native and stable ticket',async()=>{
 const session=await open();assert.match(session.ticket,/^[a-f0-9]{64}$/);assert.equal(session.editorUrl,'equationlab://word-edit/'+session.ticket);
 assert.deepEqual(await operation('/api/native-poll',{ticket:session.ticket}),{state:'editing'});
 const read=await operation('native-read',{ticket:session.ticket,session:session.session});assert.equal(read.ticket,session.ticket);assert.equal(read.session,session.session);assert.equal(read.native,initial.toString('base64'));
 assert.equal(basename(read.path),'equation.docx');assert.match(basename(dirname(read.path)),/^equationlab-word-native-/);assert.ok(!read.path.includes(session.ticket));
 assert.equal((await lstat(dirname(read.path))).mode&0o777,0o700);assert.equal((await lstat(read.path)).mode&0o777,0o600);
 const doc=await inspectDocx(await readFile(read.path));assert.equal(doc.objects.length,1);assert.deepEqual(inspectOle(doc.objects[0].ole).native,initial);
 assert.equal((await operation('native-read',{ticket:session.ticket})).path,read.path,'repeated reads reuse one private staging document');
});

test('Complete cleans staging and produces one consumable final poll with checked native/PDF/extents',async()=>{
 const session=await open(),read=await operation('native-read',{ticket:session.ticket}),body=resultBody(session.ticket);
 assert.deepEqual(await operation('native-complete',body),{ok:true,checked:true,state:'complete'});await gone(read.path);await gone(dirname(read.path));
 await assert.rejects(operation('native-complete',body),/no longer editing/);await assert.rejects(operation('native-cancel',{ticket:session.ticket}),/no longer editing/);await assert.rejects(operation('native-read',{ticket:session.ticket}),/no longer editing/);
 const final=await operation('native-poll',{ticket:session.ticket});assert.deepEqual(final,{state:'complete',native:changed.toString('base64'),pdf,width:1500,height:700});
 await assert.rejects(operation('native-poll',{ticket:session.ticket}),/Unknown or expired/);tickets.delete(session.ticket);
 const reused=await open(initial,session.session);assert.notEqual(reused.ticket,session.ticket);
});

test('Cancel removes the staged file, keeps the input untouched and reports cancellation once',async()=>{
 const source=Buffer.from(initial),saved=Buffer.from(source),session=await open(source),read=await operation('native-read',{ticket:session.ticket});
 assert.deepEqual(await operation('native-cancel',{ticket:session.ticket}),{ok:true,state:'cancelled'});assert.deepEqual(source,saved);await gone(read.path);await gone(dirname(read.path));
 await assert.rejects(operation('native-complete',resultBody(session.ticket)),/no longer editing/);
 assert.deepEqual(await operation('native-poll',{ticket:session.ticket}),{state:'cancelled'});await assert.rejects(operation('native-read',{ticket:session.ticket}),/Unknown or expired/);tickets.delete(session.ticket);
});

test('Independent sessions cannot use a ticket with another uint64 identity or affect each other',async()=>{
 const a=await open(initial),b=await open(changed);
 for(const command of ['native-read','native-poll','native-cancel'])await assert.rejects(operation(command,{ticket:a.ticket,session:b.session}),/Unknown or expired/);
 await assert.rejects(operation('native-complete',{...resultBody(a.ticket),session:b.session}),/Unknown or expired/);
 const [ra,rb]=await Promise.all([operation('native-read',{ticket:a.ticket}),operation('native-read',{ticket:b.ticket})]);assert.notEqual(ra.path,rb.path);assert.equal(ra.native,initial.toString('base64'));assert.equal(rb.native,changed.toString('base64'));
 await operation('native-complete',{...resultBody(a.ticket),session:a.session});assert.deepEqual(await operation('native-poll',{ticket:b.ticket}),{state:'editing'});assert.equal((await operation('native-read',{ticket:b.ticket})).native,changed.toString('base64'));
});

test('Uint64 identifiers and tickets are strict, duplicate identities and unknown request fields reject',async()=>{
 for(const session of [undefined,null,1,-1,'','-1','+1','01',' 1','1.0','1e3','18446744073709551616','999999999999999999999'])await assert.rejects(operation('native-open',{session,native:initial.toString('base64')}),/identifier/);
 const session=await open(initial,'18446744073709551615');await assert.rejects(operation('native-open',{session:session.session,native:initial.toString('base64')}),/already exists/);
 await open(initial,'0');
 for(const ticket of [undefined,null,10,'','a'.repeat(63),'A'.repeat(64),'0'.repeat(65),'../../private',' '+session.ticket])await assert.rejects(operation('native-poll',{ticket}),/ticket/);
 await assert.rejects(operation('native-poll',{ticket:'0'.repeat(64)}),/Unknown or expired/);
 await assert.rejects(operation('native-poll',{ticket:session.ticket,session:'01'}),/identifier/);
 await assert.rejects(operation('native-read',{ticket:session.ticket,path:'/tmp/untrusted.docx'}),/request fields/);
 await assert.rejects(operation('native-open',[]),/request/);await assert.rejects(operation('other',{}),/Unknown native/);
});

test('Payload validation is atomic: malformed base64/native/PDF and invalid HIMETRIC do not finish a session',async()=>{
 const session=await open(),valid=initial.toString('base64'),badHeader=Buffer.from(initial);badHeader.writeUInt32LE(initial.length,8);
 for(const native of [null,initial,'',valid+'\n',valid.replace(/.$/,'!'),'data:application/octet-stream;base64,'+valid,'Zh==',badHeader.toString('base64'),makeOle('x').toString('base64')])await assert.rejects(operation('native-open',{session:String(next++),native}));
 for(const extent of [undefined,null,0,-1,1.5,'1500',NaN,Infinity,2147483648])await assert.rejects(operation('native-complete',{...resultBody(session.ticket),width:extent}),/HIMETRIC/);
 for(const candidate of ['',Buffer.from('%PDF-1.4').toString('base64'),Buffer.from('%PDF-9.9\n').toString('base64'),Buffer.from('not PDF').toString('base64'),pdf+'\n'])await assert.rejects(operation('native-complete',{...resultBody(session.ticket),pdf:candidate}));
 await assert.rejects(operation('native-complete',{...resultBody(session.ticket),native:badHeader.toString('base64')}),/Equation Native/);
 assert.deepEqual(await operation('native-poll',{ticket:session.ticket}),{state:'editing'});assert.equal((await operation('native-read',{ticket:session.ticket})).native,valid);
 await operation('native-complete',resultBody(session.ticket));assert.equal((await operation('native-poll',{ticket:session.ticket})).state,'complete');tickets.delete(session.ticket);
});

test('Concurrent read/cancel and complete/complete are serialized without orphan staging or duplicate commits',async()=>{
 const a=await open();
 const [read,cancel]=await Promise.all([operation('native-read',{ticket:a.ticket}),operation('native-cancel',{ticket:a.ticket})]);assert.equal(cancel.state,'cancelled');await gone(read.path);await gone(dirname(read.path));
 const b=await open(),results=await Promise.allSettled([operation('native-complete',resultBody(b.ticket)),operation('native-complete',resultBody(b.ticket))]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);assert.equal((await operation('native-poll',{ticket:b.ticket})).state,'complete');tickets.delete(b.ticket);
 const body={session:String(next++),native:initial.toString('base64')},pending=operation('native-open',body);body.session='invalid';body.native='invalid';
 const snapshot=await pending;tickets.add(snapshot.ticket);assert.equal((await operation('native-read',{ticket:snapshot.ticket})).native,initial.toString('base64'),'caller mutation cannot change a queued, validated request');
});

test('At most sixteen outstanding sessions are retained and consumed terminal state frees a slot',async()=>{
 const opened=[];for(let i=0;i<16;i++)opened.push(await open());
 await assert.rejects(open(),/Too many/);await operation('native-cancel',{ticket:opened[0].ticket});await assert.rejects(open(),/Too many/,'an unconsumed terminal result still occupies its bounded slot');
 assert.equal((await operation('native-poll',{ticket:opened[0].ticket})).state,'cancelled');tickets.delete(opened[0].ticket);await open();
});

test('Twenty-minute expiration removes private staging without a later service request',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.now()});
 const session=await open(),read=await operation('native-read',{ticket:session.ticket});
 t.mock.timers.tick(20*60*1000-1);assert.deepEqual(await operation('native-poll',{ticket:session.ticket}),{state:'editing'});
 t.mock.timers.tick(1);
 let deleted=false;for(let i=0;i<30;i++){
  try{await access(read.path);}catch(error){if(error.code==='ENOENT'){deleted=true;break;}throw error;}
  await new Promise(resolve=>realSetTimeout(resolve,10));
 }
 assert.equal(deleted,true,'the expiry timer must delete staging even while the UI is idle');await gone(dirname(read.path));
 await assert.rejects(operation('native-poll',{ticket:session.ticket}),/Unknown or expired/);tickets.delete(session.ticket);
 t.mock.timers.reset();
 const replacement=await open(initial,session.session);assert.notEqual(replacement.ticket,session.ticket);
});

test('An accepted result that Word never receives expires as a definitive failed acknowledgement',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.now()});
 const sessionId=String(next++),opened=await operation('native-open',{session:sessionId,native:initial.toString('base64'),acknowledgement:true});tickets.add(opened.ticket);
 await operation('native-complete',{...resultBody(opened.ticket),session:sessionId});
 assert.deepEqual(await operation('native-status',{ticket:opened.ticket}),{state:'queued'});
 t.mock.timers.tick(20*60*1000);
 assert.deepEqual(await operation('native-status',{ticket:opened.ticket}),{state:'failed'},'an undelivered payload cannot remain pending after its session expires');
 tickets.delete(opened.ticket);t.mock.timers.reset();
});

function nativeOfSize(size){
 const parsed=inspectOle(makeOle('x')),chunks=[parsed.header,parsed.data.subarray(0,-1)];let remaining=size-parsed.native.length;
 while(remaining){
  let total=Math.min(65539,remaining);if(remaining-total===1)total--;if(total===257||total===258)total-=2;
  if(total<2)throw Error('Fixture dimension cannot be represented');
  if(total<=256)chunks.push(Buffer.from([100,total-2]),Buffer.alloc(total-2));
  else{const head=Buffer.alloc(4);head[0]=100;head[1]=255;head.writeUInt16LE(total-4,2);chunks.push(head,Buffer.alloc(total-4));}
  remaining-=total;
 }
 chunks.push(Buffer.from([0]));const native=Buffer.concat(chunks);native.writeUInt32LE(native.length-28,8);return native;
}
test('The 16 MiB limit applies to decoded native and PDF blobs, including legal boundary payloads',async()=>{
 const maximum=16*1024*1024,native=nativeOfSize(maximum);assert.equal(native.length,maximum);
 const session=await open(native);await assert.rejects(operation('native-open',{session:String(next++),native:Buffer.concat([native,Buffer.from([0])]).toString('base64')}),/oversized/);
 await close(session.ticket);
 const small=await open(),largePdf=Buffer.alloc(maximum);largePdf.write('%PDF-1.7\n');
 await assert.rejects(operation('native-complete',{...resultBody(small.ticket),pdf:Buffer.concat([largePdf,Buffer.from([0])]).toString('base64')}),/oversized/);
 await operation('native-complete',{...resultBody(small.ticket),pdf:largePdf.toString('base64')});const final=await operation('native-poll',{ticket:small.ticket});assert.equal(Buffer.from(final.pdf,'base64').length,maximum);tickets.delete(small.ticket);
});
test('Host save receipts bind uint64 identity, distinguish delivery from persistence, and expose no formula',async()=>{
 const native=inspectOle(makeOle('x')).native,session='99000001';
 const opened=await operation('native-open',{session,native:native.toString('base64'),acknowledgement:true});tickets.add(opened.ticket);
 assert.equal((await operation('native-read',{ticket:opened.ticket})).acknowledgement,true);
 await operation('native-complete',{...resultBody(opened.ticket),session});
 assert.deepEqual(await operation('native-status',{ticket:opened.ticket}),{state:'queued'});
 await assert.rejects(operation('native-ack',{ticket:opened.ticket,session,ok:true}),/Invalid native acknowledgement/);
 await operation('native-poll',{ticket:opened.ticket});tickets.delete(opened.ticket);
 assert.deepEqual(await operation('native-status',{ticket:opened.ticket}),{state:'delivered'});
 await assert.rejects(operation('native-ack',{ticket:opened.ticket,session:'99000002',ok:true}),/Unknown or expired/);
 assert.deepEqual(await operation('native-ack',{ticket:opened.ticket,session,ok:true}),{state:'committed'});
 assert.deepEqual(await operation('native-ack',{ticket:opened.ticket,session,ok:true}),{state:'committed'},'repeating the same acknowledgement returns its terminal state');
 assert.deepEqual(await operation('native-status',{ticket:opened.ticket}),{state:'committed'});
 await assert.rejects(operation('native-ack',{ticket:opened.ticket,session,ok:false}),/Conflicting/);
});

test('A failed host acknowledgement is also idempotent and rejects a conflicting retry',async()=>{
 const session='99000002',opened=await operation('native-open',{session,native:initial.toString('base64'),acknowledgement:true});tickets.add(opened.ticket);
 await operation('native-complete',{...resultBody(opened.ticket),session});await operation('native-poll',{ticket:opened.ticket});tickets.delete(opened.ticket);
 assert.deepEqual(await operation('native-ack',{ticket:opened.ticket,session,ok:false}),{state:'failed'});
 assert.deepEqual(await operation('native-ack',{ticket:opened.ticket,session,ok:false}),{state:'failed'});
 await assert.rejects(operation('native-ack',{ticket:opened.ticket,session,ok:true}),/Conflicting native acknowledgement/);
});
