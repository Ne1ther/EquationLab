import test from 'node:test';
import assert from 'node:assert/strict';
import {access,readFile} from 'node:fs/promises';
import {localServer} from '../src/server.mjs';
import {desktopRequest} from '../src/desktop-rpc.mjs';
import {nativeSessionOperation as operation} from '../src/word-native-session.mjs';
import {createDocx,flatOpc,inspectDocx,hash} from '../src/document.mjs';
import {inspectOle,makeOle,patchRuler} from '../src/native.mjs';
import {makeNewOle} from '../src/new-formula.mjs';

const originalFetch=globalThis.fetch,live=new Set(),calls=[];
let next=920000n;
const pdf=Buffer.from('%PDF-1.4\n%%EOF\n').toString('base64');
const defaultLayout={mode:'inline',numberFormat:'(#E1)',chapter:1,section:1,equation:1};

test.before(()=>{globalThis.fetch=async(url,options)=>{
 const parsed=new URL(url);assert.equal(parsed.origin,'http://127.0.0.1:37952');
 const body=JSON.parse(options.body),name=parsed.pathname.replace('/api/','');calls.push({operation:name,body});
 try{return {ok:true,json:async()=>await operation(name,body)};}
 catch(error){return {ok:false,json:async()=>({error:error.message})};}
};});
test.afterEach(async()=>{
 for(const ticket of live){await operation('native-cancel',{ticket}).catch(()=>{});await operation('native-poll',{ticket}).catch(()=>{});}
 live.clear();calls.length=0;
});
test.after(()=>{globalThis.fetch=originalFetch;});

async function openInsertion(equations=[],layout=defaultLayout,{session=String(next++),name='Untitled.docx',identity=`word-document-${session}`,snapshot=Number(session.slice(-5))||1}={}){
 const original=await createDocx(equations),opened=await operation('native-insert-open',{session,acknowledgement:true,document:{ooxml:await flatOpc(original),index:-1,name,identity,snapshot},layout});
 live.add(opened.ticket);return {...opened,session,original};
}
async function openEdit(latex='x^3'){
 const native=inspectOle(makeOle(latex)).native,session=String(next++),opened=await operation('native-open',{session,native:native.toString('base64')});
 live.add(opened.ticket);return {...opened,session,native};
}
async function gone(path){await assert.rejects(access(path),error=>error.code==='ENOENT');}
function insertionPayload(opened,read,patch={}){
 return {ticket:opened.ticket,input:read.activePath,latex:'u^2+1',layout:read.insertionLayout,...patch};
}

test('Insertion sessions read zero or many document equations with no active formula and keep normalized layout metadata',async()=>{
 const empty=await openInsertion([]),emptyRead=await operation('native-read',{ticket:empty.ticket});
 assert.equal(emptyRead.insertion,true);assert.deepEqual(emptyRead.documentContext,{state:'available',reason:'captured',identity:`word-document-${empty.session}`,snapshot:Number(empty.session.slice(-5))||1,count:0,index:-1});
 assert.equal(emptyRead.document.index,-1);assert.equal(emptyRead.layout.mode,'inline');
 const emptySnapshot=await desktopRequest({action:'wordSessionRead',payload:{ticket:empty.ticket}});
 assert.equal(emptySnapshot.insertion,true);assert.equal(emptySnapshot.activeIndex,null);assert.deepEqual(emptySnapshot.objects,[]);assert.equal(emptySnapshot.insertionLayout.mode,'inline');

 const multi=await openInsertion([{latex:'x^2'},{latex:'y_1'},{latex:'z+4'}],{mode:'right-numbered',numberFormat:'(#C1.#S1.#E1)',chapter:4,section:2,equation:17},{name:'多公式.docx',identity:'word-document-many',snapshot:'snapshot-many'});
 const read=await desktopRequest({action:'wordSessionRead',payload:{ticket:multi.ticket}});
 assert.equal(read.insertion,true);assert.equal(read.activeIndex,null);assert.equal(read.objects.length,3);assert.equal(read.documentName,'多公式.docx');
 assert.equal(read.documentIdentity,'word-document-many');assert.equal(read.documentSnapshot,'snapshot-many');assert.equal(read.documentContext.count,3);assert.equal(read.documentContext.index,-1);
 assert.deepEqual(read.insertionLayout,{mode:'numbered-right',numberFormat:'(#C1.#S1.#E1)',chapter:4,section:2,equation:17});
 const source=await inspectDocx(await readFile(read.activePath));assert.equal(source.objects.length,1,'the private editor seed stays separate from the original multi-equation document');
 assert.equal(source.objects[0].latex,'x');
});

test('Cancelling a blank insertion removes only private staging and leaves other sessions usable',async()=>{
 const opened=await openInsertion([{latex:'a+b'},{latex:'c+d'}],defaultLayout,{identity:'word-document-cancel',snapshot:12}),saved=Buffer.from(opened.original);
 const read=await operation('native-read',{ticket:opened.ticket}),stagedSnapshot=read.document.path;
 const snapshotBefore=await readFile(stagedSnapshot);assert.equal((await inspectDocx(snapshotBefore)).objects.length,2);
 const other=await openEdit('q^3'),otherRead=await operation('native-read',{ticket:other.ticket});
 assert.deepEqual(await operation('native-cancel',{ticket:opened.ticket}),{ok:true,state:'cancelled'});
 assert.deepEqual(await operation('native-poll',{ticket:opened.ticket}),{state:'cancelled'});live.delete(opened.ticket);
 await gone(read.path);await gone(stagedSnapshot);assert.deepEqual(opened.original,saved);
 assert.deepEqual(await operation('native-poll',{ticket:other.ticket}),{state:'editing'});assert.equal((await operation('native-read',{ticket:other.ticket})).path,otherRead.path);
 assert.equal(calls.some(call=>call.operation==='native-complete'),false);
});

test('RPC insertion commits a one-equation DOCX fragment with the exact native and retained numbering values',async()=>{
 const opened=await openInsertion([{latex:'existing_1'},{latex:'existing_2'}],{mode:'left-numbered',numberFormat:'[Ch #C1.S #S1.Eq #E1]',chapter:7,section:3,equation:29},{identity:'word-document-commit',snapshot:29});
 const read=await desktopRequest({action:'wordSessionRead',payload:{ticket:opened.ticket}}),serviceRead=await operation('native-read',{ticket:opened.ticket}),snapshotPath=serviceRead.document.path,stagedSnapshot=await readFile(snapshotPath),original=Buffer.from(opened.original),typography={fullSize:14},ruler=[{position:2304,type:4}],latex='\\frac{u_1}{v^2}+\\alpha';
 const expectedOle=patchRuler(makeNewOle(latex,typography),ruler),expectedNative=inspectOle(expectedOle).native;
 const result=await desktopRequest({action:'wordSessionInsert',payload:insertionPayload(opened,read,{latex,typography,ruler})});
 assert.deepEqual(result,{ok:true,checked:true,state:'complete',insertion:true,acknowledgement:true});
 await assert.rejects(operation('native-cancel',{ticket:opened.ticket,session:opened.session}),/Cannot cancel a completed Word insertion/);
 assert.deepEqual(await operation('native-status',{ticket:opened.ticket,session:opened.session}),{state:'queued'},'refusing cancellation must leave the accepted host mutation available for acknowledgement');
 const complete=calls.find(call=>call.operation==='native-complete');assert.ok(complete);assert.equal(complete.body.session,opened.session);assert.equal(complete.body.target,undefined);
 assert.equal(complete.body.native,expectedNative.toString('base64'));
 const fragment=await inspectDocx(Buffer.from(complete.body.docx,'base64'));
 assert.equal(fragment.objects.length,1);assert.equal(fragment.objects[0].mainDocument,true);assert.equal(fragment.objects[0].nativeSha256,hash(expectedNative));
 assert.deepEqual(fragment.objects[0].ruler,ruler);assert.equal(fragment.objects[0].layout.mode,'numbered-left');
 assert.equal(fragment.objects[0].layout.numberFormat,'[Ch #C1.S #S1.Eq #E1]');assert.equal(fragment.objects[0].layout.numberText,'[Ch 7.S 3.Eq 29]');
 const polled=await operation('native-poll',{ticket:opened.ticket});live.delete(opened.ticket);
 assert.equal(polled.state,'complete');assert.equal(polled.native,complete.body.native);assert.equal(polled.docx,complete.body.docx);assert.match(Buffer.from(polled.pdf,'base64').subarray(0,9).toString(),/^%PDF-/);assert.ok(polled.width>0&&polled.height>0);
 assert.equal((await operation('native-ack',{ticket:opened.ticket,session:opened.session,ok:true})).state,'committed');
 assert.equal((await operation('native-ack',{ticket:opened.ticket,session:opened.session,ok:true})).state,'committed','a retried identical host acknowledgement must return the same terminal state');
 await assert.rejects(operation('native-ack',{ticket:opened.ticket,session:opened.session,ok:false}),/Conflicting native acknowledgement/);
 await gone(read.activePath);await gone(snapshotPath);assert.deepEqual(opened.original,original);
 assert.deepEqual((await inspectDocx(stagedSnapshot)).objects.map(object=>object.latex),['existing_{1}','existing_{2}']);
});

test('Insertion reports the verified completed fragment layout after changing the initial mode',async()=>{
 for(const [initial,completed] of [['display','inline'],['inline','display'],['inline','numbered-left'],['inline','numbered-right']]){
  const opened=await openInsertion([],{...defaultLayout,mode:initial}),read=await desktopRequest({action:'wordSessionRead',payload:{ticket:opened.ticket}});
  await desktopRequest({action:'wordSessionInsert',payload:insertionPayload(opened,read,{layout:{...read.insertionLayout,mode:completed}})});
  const polled=await operation('native-poll',{ticket:opened.ticket});live.delete(opened.ticket);
  assert.equal(polled.insertionMode,completed);
  assert.equal((await inspectDocx(Buffer.from(polled.docx,'base64'))).objects[0].layout.mode,completed);
  await operation('native-ack',{ticket:opened.ticket,session:opened.session,ok:true});
 }
});

test('Insertion rejects cross-session, wrong-intent, update-save and malformed/cross-mode completions atomically',async()=>{
 const a=await openInsertion([{latex:'a'}],defaultLayout,{identity:'word-document-a',snapshot:1}),b=await openInsertion([{latex:'b'},{latex:'c'}],defaultLayout,{identity:'word-document-b',snapshot:2});
 const ra=await desktopRequest({action:'wordSessionRead',payload:{ticket:a.ticket}}),rb=await desktopRequest({action:'wordSessionRead',payload:{ticket:b.ticket}});
 await assert.rejects(desktopRequest({action:'wordSessionInsert',payload:insertionPayload(a,ra,{session:b.session,input:rb.activePath})}),/source session does not match/);
 await assert.rejects(desktopRequest({action:'wordSessionInsert',payload:insertionPayload(a,ra,{input:rb.activePath})}),/不属于当前 Word 会话/);
 await assert.rejects(desktopRequest({action:'wordSessionInsert',payload:insertionPayload(a,ra,{intent:'edit'})}),/intent is invalid/);
 await assert.rejects(desktopRequest({action:'wordSessionInsert',payload:insertionPayload(a,ra,{layout:{...ra.insertionLayout,chapter:ra.insertionLayout.chapter+1}})}),/retain the captured numbering values/);
 await assert.rejects(desktopRequest({action:'wordSessionSave',payload:{ticket:a.ticket,input:ra.activePath,mode:'rebuild',latex:'x'}}),/cannot save over/);
 assert.deepEqual(await operation('native-poll',{ticket:a.ticket}),{state:'editing'});assert.deepEqual(await operation('native-poll',{ticket:b.ticket}),{state:'editing'});

 const expectedOle=makeNewOle('different'),expectedNative=inspectOle(expectedOle).native,wrongDocx=(await createDocx([{ole:makeNewOle('mismatch')}],{fragment:true})).toString('base64'),twoDocx=(await createDocx([{ole:expectedOle},{latex:'extra'}],{fragment:true})).toString('base64');
 const completion={ticket:a.ticket,session:a.session,native:expectedNative.toString('base64'),pdf,width:1200,height:600};
 await assert.rejects(operation('native-complete',completion),/requires a DOCX fragment/);
 await assert.rejects(operation('native-complete',{...completion,docx:'bm90LWRvY3g='}));
 await assert.rejects(operation('native-complete',{...completion,docx:wrongDocx}),/does not match submitted native/);
 await assert.rejects(operation('native-complete',{...completion,docx:twoDocx}),/exactly one valid equation/);
 await assert.rejects(operation('native-complete',{...completion,docx:wrongDocx,target:{index:0,expectedNativeSha256:'0'.repeat(64),documentIdentity:'word-document-a'}}),/cannot target/);
 assert.deepEqual(await operation('native-poll',{ticket:a.ticket}),{state:'editing'});

 const normal=await openEdit('normal'),normalRead=await desktopRequest({action:'wordSessionRead',payload:{ticket:normal.ticket}}),normalFragment=(await createDocx([{latex:'extra'}],{fragment:true})).toString('base64');
 await assert.rejects(desktopRequest({action:'wordSessionInsert',payload:{ticket:normal.ticket,input:normalRead.activePath,latex:'new',layout:defaultLayout}}),/cannot accept an insertion payload/);
 await assert.rejects(operation('native-complete',{ticket:normal.ticket,native:normal.native.toString('base64'),pdf,width:1200,height:600,docx:normalFragment}),/only valid for insertion/);
 assert.deepEqual(await operation('native-poll',{ticket:normal.ticket}),{state:'editing'});
});

test('Delivered insertion becomes unconfirmed after 60 seconds and accepts a late definitive acknowledgement',async()=>{
 const realNow=Date.now;let now=1_800_000_000_000;Date.now=()=>now;
 try{
  const opened=await openInsertion([]),read=await desktopRequest({action:'wordSessionRead',payload:{ticket:opened.ticket}});
  await desktopRequest({action:'wordSessionInsert',payload:insertionPayload(opened,read)});
  const delivered=await operation('native-poll',{ticket:opened.ticket});live.delete(opened.ticket);assert.equal(delivered.state,'complete');
  assert.deepEqual(await operation('native-status',{ticket:opened.ticket,session:opened.session}),{state:'delivered'});
  now+=59_999;assert.deepEqual(await operation('native-status',{ticket:opened.ticket}),{state:'delivered'},'the receipt stays pending before the bound');
  now+=1;assert.deepEqual(await operation('native-status',{ticket:opened.ticket}),{state:'unconfirmed'},'the bound ends an unanswered delivered receipt');
  await assert.rejects(operation('native-ack',{ticket:opened.ticket,session:opened.session,ok:true,uncertain:true}),/Invalid native acknowledgement/);
  await assert.rejects(operation('native-ack',{ticket:opened.ticket,session:opened.session,ok:false,uncertain:false}),/Invalid native acknowledgement/);
  assert.deepEqual(await operation('native-ack',{ticket:opened.ticket,session:opened.session,ok:false,uncertain:true}),{state:'unconfirmed'});
  assert.deepEqual(await operation('native-ack',{ticket:opened.ticket,session:opened.session,ok:true}),{state:'committed'},'a later host confirmation reconciles an unknown outcome');
  await assert.rejects(operation('native-ack',{ticket:opened.ticket,session:opened.session,ok:false}),/Conflicting native acknowledgement/);
 }finally{Date.now=realNow;}
});

test('The local server recognizes the new insertion-open endpoint',async()=>{
 const server=localServer({port:0});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const base=`http://127.0.0.1:${server.address().port}`,response=await originalFetch(base+'/api/native-insert-open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});
  assert.equal(response.status,400);assert.match((await response.json()).error,/37952/,'route recognition reaches the native-port guard');
 }finally{await new Promise(resolve=>server.close(resolve));}
});
