import test from 'node:test';
import assert from 'node:assert/strict';
import {createWordDocumentRequests} from '../src/word-document-requests.mjs';
import {operation} from '../src/server.mjs';

const hex=value=>value.toString(16).padStart(64,'0');
const target={identity:'word-process:73',snapshot:991,index:4,nativeSha256:'a'.repeat(64)};

function fixture(options={}){
 let next=1;
 return createWordDocumentRequests({makeId:()=>hex(next++),...options});
}

test('App insert requests require an open editable destination and retain intent through both delivery paths',async()=>{
 for(const mode of ['inline','display','numbered-left','numbered-right'])for(const waiting of [false,true]){
  const queue=fixture(),host=hex(150);await queue.take({hostId:host,waitMs:0});
  queue.handle('native-document-workspace',{hostId:host,insertionRequestSupport:true,active:{identity:target.identity,name:'A.docx'},documents:[{identity:target.identity,name:'A.docx',readOnly:false},{identity:'word-process:74',name:'A.docx',readOnly:true}]});
  const poll=waiting?queue.take({hostId:host,waitMs:20000}):null;
  const destination=waiting?{target}:{documentIdentity:target.identity};
  const created=queue.request({...destination,insertionMode:mode});
  const delivered=await (poll||queue.take({hostId:host,waitMs:0}));
  assert.deepEqual(delivered,{state:'delivered',requestId:created.requestId,...destination,insertionMode:mode});
  queue.cancel({requestId:created.requestId});assert.equal(queue.finish({hostId:host,requestId:created.requestId,state:'opened'}).state,'cancelled');
  for(const body of [{insertionMode:mode},{documentIdentity:'word-process:closed',insertionMode:mode},{documentIdentity:'word-process:74',insertionMode:mode},{target:{...target,identity:'word-process:74'},insertionMode:mode}])assert.throws(()=>queue.request(body));
  assert.throws(()=>queue.request({...destination,insertionMode:'replace'}),/Invalid insertion mode/);
 }
});

test('a legacy Word host cannot silently accept an App insertion intent',async()=>{
 const queue=fixture(),hostId=hex(151);await queue.take({hostId,waitMs:0});
 queue.handle('native-document-workspace',{hostId,active:{identity:target.identity,name:'A.docx'},documents:[{identity:target.identity,name:'A.docx',readOnly:false}]});
 assert.throws(()=>queue.request({documentIdentity:target.identity,insertionMode:'inline'}),/Update the Word add-in/);
 const created=queue.request({documentIdentity:target.identity});assert.equal((await queue.take({hostId,waitMs:0})).requestId,created.requestId);
});

test('request, take and finish retain one exact target and report terminal status',async()=>{
 const queue=fixture();
 const created=queue.request({target});
 assert.deepEqual(created,{requestId:hex(1),state:'queued'});
 const claimed=await queue.take({hostId:hex(90),waitMs:0});
 assert.deepEqual(claimed,{state:'delivered',requestId:hex(1),target});
 assert.deepEqual(queue.status({requestId:hex(1)}),{requestId:hex(1),state:'delivered',identity:target.identity,index:target.index});
 assert.deepEqual(queue.finish({hostId:hex(90),requestId:hex(1),state:'opened'}),{requestId:hex(1),state:'opened'});
 assert.deepEqual(queue.finish({hostId:hex(90),requestId:hex(1),state:'opened'}),{requestId:hex(1),state:'opened'});
});

test('a long poll wakes once and the claim is delivered only to its bound host',async()=>{
 const queue=fixture();const host=hex(91);
 const waiting=queue.take({hostId:host,waitMs:20_000});
 const created=queue.request({});
 assert.deepEqual(await waiting,{state:'delivered',requestId:created.requestId});
 assert.throws(()=>queue.finish({hostId:hex(92),requestId:created.requestId,state:'opened'}),/not claimed/);
});

test('new requests supersede delivered work and stale finish cannot revive it',async()=>{
 const queue=fixture(),host=hex(93);
 const first=queue.request({target});
 assert.equal((await queue.take({hostId:host,waitMs:0})).requestId,first.requestId);
 const second=queue.request({});
 assert.equal(queue.status({requestId:first.requestId}).state,'superseded');
 assert.equal(queue.finish({hostId:host,requestId:first.requestId,state:'opened'}).state,'superseded');
 assert.equal((await queue.take({hostId:host,waitMs:0})).requestId,second.requestId);
});

test('cancel is idempotent and terminal cancellation rejects host finish',async()=>{
 const queue=fixture(),host=hex(94),created=queue.request({});
 await queue.take({hostId:host,waitMs:0});
 assert.equal(queue.cancel({requestId:created.requestId}).state,'cancelled');
 assert.equal(queue.cancel({requestId:created.requestId}).state,'cancelled');
 assert.equal(queue.finish({hostId:host,requestId:created.requestId,state:'opened'}).state,'cancelled');
});

test('explicit close can cancel an opened request so a late editor delivery stays rejected',async()=>{
 const queue=fixture(),host=hex(99),created=queue.request({});
 await queue.take({hostId:host,waitMs:0});queue.finish({hostId:host,requestId:created.requestId,state:'opened'});
 assert.equal(queue.cancel({requestId:created.requestId}).state,'cancelled');
 assert.equal(queue.status({requestId:created.requestId}).state,'cancelled');
 assert.equal(queue.finish({hostId:host,requestId:created.requestId,state:'opened'}).state,'cancelled');
});

test('TTL expires queued or delivered requests and late completion stays expired',async()=>{
 let time=1000;const queue=fixture({now:()=>time,ttlMs:1000});
 const created=queue.request({});const host=hex(95);
 await queue.take({hostId:host,waitMs:0});time=2001;
 assert.equal(queue.status({requestId:created.requestId}).state,'expired');
 assert.equal(queue.finish({hostId:host,requestId:created.requestId,state:'opened'}).state,'expired');
});

test('host restart retires an older delivered claim',async()=>{
 const queue=fixture(),firstHost=hex(96),nextHost=hex(97),created=queue.request({});
 await queue.take({hostId:firstHost,waitMs:0});
 assert.deepEqual(await queue.take({hostId:nextHost,waitMs:0}),{state:'empty'});
 assert.equal(queue.status({requestId:created.requestId}).state,'failed');
 assert.equal(queue.finish({hostId:firstHost,requestId:created.requestId,state:'opened'}).state,'failed');
 assert.throws(()=>queue.take({hostId:firstHost,waitMs:0}),/retired/);
});

test('invalid targets, waiter bounds, and long-poll duration are rejected',async()=>{
 const queue=fixture();
 for(const invalid of [
  {target:{...target,index:-1}},
  {target:{...target,nativeSha256:'A'.repeat(64)}},
  {target:{...target,snapshot:0}},
  {target,...{extra:true}},
 ])assert.throws(()=>queue.request(invalid));
 const host=hex(98),waiting=queue.take({hostId:host,waitMs:20_000});
 assert.throws(()=>queue.take({hostId:host,waitMs:20_000}),/already active/);
 assert.throws(()=>queue.take({hostId:host,waitMs:20_001}),/waitMs/);
 const created=queue.request({});assert.equal((await waiting).requestId,created.requestId);
});

test('server operations expose the agreed request, status, and cancel routes',async()=>{
 const created=await operation('native-document-request',{});
 assert.match(created.requestId,/^[0-9a-f]{64}$/);assert.equal(created.state,'queued');
 assert.equal((await operation('native-document-status',{requestId:created.requestId})).state,'queued');
 assert.equal((await operation('native-document-cancel',{requestId:created.requestId})).state,'cancelled');
});

test('workspace metadata requires a current host and reports an empty initial status',async()=>{
 const queue=fixture();
 assert.deepEqual(queue.handle('native-document-workspace-status',{}),{connected:false,revision:0,active:null,documents:[],retiredIdentities:[]});
 assert.throws(()=>queue.handle('native-document-workspace',{hostId:hex(110),active:null}),/current native host/);
 await queue.take({hostId:hex(110),waitMs:0});
 assert.deepEqual(queue.handle('native-document-workspace-status',{}),{connected:true,revision:0,active:null,documents:[],retiredIdentities:[]});
 assert.deepEqual(queue.handle('native-document-workspace',{hostId:hex(110),active:{identity:'word-process:73',name:'draft.docx'}}),{connected:true,revision:1,active:{identity:'word-process:73',name:'draft.docx'},documents:[],retiredIdentities:[]});
});

test('workspace publication heartbeats without changing revision and host takeover resets metadata',async()=>{
 let time=10_000;const queue=fixture({now:()=>time}),first=hex(111),second=hex(112),active={identity:'word-process:73',name:'draft.docx'},documents=[{...active,readOnly:false}];
 await queue.take({hostId:first,waitMs:0});
 queue.handle('native-document-workspace',{hostId:first,active,documents});
 time+=30_000;
 assert.deepEqual(queue.handle('native-document-workspace',{hostId:first,active,documents}),{connected:true,revision:1,active,documents,retiredIdentities:[]});
 assert.deepEqual(queue.handle('native-document-workspace-status',{}),{connected:true,revision:1,active,documents,retiredIdentities:[]});
 await queue.take({hostId:second,waitMs:0});
 assert.deepEqual(queue.handle('native-document-workspace-status',{}),{connected:true,revision:2,active:null,documents:[],retiredIdentities:[]});
 assert.throws(()=>queue.handle('native-document-workspace',{hostId:first,active}),/current native host/);
 assert.throws(()=>queue.handle('native-document-workspace',{hostId:second,active:null,extra:true}));
});

test('workspace status expires after 45 seconds and clears active metadata',async()=>{
 let time=20_000;const queue=fixture({now:()=>time}),host=hex(113);
 await queue.take({hostId:host,waitMs:0});
 queue.handle('native-document-workspace',{hostId:host,active:{identity:'word-process:73',name:'draft.docx'}});
 time+=44_999;
 assert.deepEqual(queue.handle('native-document-workspace-status',{}),{connected:true,revision:1,active:{identity:'word-process:73',name:'draft.docx'},documents:[],retiredIdentities:[]});
 time++;
 assert.deepEqual(queue.handle('native-document-workspace-status',{}),{connected:false,revision:2,active:null,documents:[],retiredIdentities:[]});
});

test('workspace retirements are host-bound, revisioned, cumulative-compatible and cleared on reset',async()=>{
 let time=30_000;const queue=fixture({now:()=>time}),host=hex(116),next=hex(117),active={identity:'word-process:B',name:'B.docx'};
 await queue.take({hostId:host,waitMs:0});
 const first=queue.handle('native-document-workspace',{hostId:host,active,documents:[{...active,readOnly:false}],retiredIdentities:['word-process:A']});
 assert.deepEqual(first,{connected:true,revision:1,active,documents:[{...active,readOnly:false}],retiredIdentities:['word-process:A']});
 assert.deepEqual(queue.handle('native-document-workspace',{hostId:host,active}),first,'a legacy publisher without the field preserves known retirements');
 assert.deepEqual(queue.handle('native-document-workspace',{hostId:host,active:{identity:'word-process:A',name:'A.docx'}}),{connected:true,revision:2,active:{identity:'word-process:A',name:'A.docx'},documents:[{...active,readOnly:false}],retiredIdentities:[]},'a legacy publisher without documents preserves the known catalog');
 queue.handle('native-document-workspace',{hostId:host,active,retiredIdentities:['word-process:A']});
 await queue.take({hostId:next,waitMs:0});
 assert.deepEqual(queue.handle('native-document-workspace-status',{}),{connected:true,revision:4,active:null,documents:[],retiredIdentities:[]});
 assert.throws(()=>queue.handle('native-document-workspace',{hostId:host,active,retiredIdentities:['word-process:A']}),/current native host/);
 time+=45_000;
 assert.deepEqual(queue.handle('native-document-workspace-status',{}),{connected:false,revision:4,active:null,documents:[],retiredIdentities:[]});
});

test('workspace metadata rejects malformed hosts, keys, identities, names, controls and objects',async()=>{
 const queue=fixture(),host=hex(114);await queue.take({hostId:host,waitMs:0});
 for(const body of [
  {hostId:host,active:{identity:'ab',name:'x'}},
  {hostId:host,active:{identity:'word-process:73',name:'x'.repeat(513)}},
  {hostId:host,active:{identity:'word-process:73',name:'bad\nname'}},
  {hostId:host,active:{identity:{value:'word-process:73'},name:'x'}},
  {hostId:host,active:{identity:'word-process:73',name:'x',path:'/private/a.docx'}},
  {hostId:host,active:{identity:'word-process:73',name:'x'},path:'/private/a.docx'},
  {hostId:host,active:{identity:'word-process:73',name:'x'},xml:'<w:doc/>'},
  {hostId:host,active:null,documents:[{identity:'word-process:73',name:'x',readOnly:0}]},
  {hostId:host,active:{identity:'word-process:73',name:'x'},documents:[{identity:'word-process:74',name:'x',readOnly:false}]},
  {hostId:host,active:null,documents:[{identity:'word-process:73',name:'x',readOnly:false},{identity:'word-process:73',name:'y',readOnly:true}]},
  {hostId:host,active:null,documents:Array.from({length:129},(_,i)=>({identity:`word-process:${i}`,name:'x',readOnly:false}))},
  {hostId:host,active:null,documents:[{identity:'word-process:73',name:'bad\u007fname',readOnly:false}]},
  {hostId:host,active:null,retiredIdentities:'word-process:73'},
  {hostId:host,active:null,retiredIdentities:Array.from({length:129},(_,i)=>`word-process:${i}`)},
  {hostId:host,active:null,retiredIdentities:['word-process:73','word-process:73']},
  {hostId:host,active:null,retiredIdentities:['ab']},
  {hostId:host,active:null,retiredIdentities:[{identity:'word-process:73'}]},
  {hostId:hex(115),active:null},
 ])assert.throws(()=>queue.handle('native-document-workspace',body));
 assert.throws(()=>queue.handle('native-document-workspace-status',{hostId:host}));
 assert.throws(()=>queue.handle('native-document-workspace-status',null));
 assert.throws(()=>queue.handle('native-document-workspace-status-extra',{}),/Unknown/);
});

test('workspace operation names are routed through the server operation dispatcher',async()=>{
 const status=await operation('native-document-workspace-status',{});
 assert.deepEqual(status,{connected:false,revision:0,active:null,documents:[],retiredIdentities:[]});
 await assert.rejects(()=>operation('native-document-workspace-status-extra',{}),/Unknown document request operation/);
});

test('catalog holds three same-name documents and explicit requests preserve a non-active identity through empty finish',async()=>{
 const queue=fixture(),host=hex(121),active={identity:'word:41',name:'draft.docx'},documents=[
  {...active,readOnly:false},{identity:'word:42',name:'draft.docx',readOnly:true},{identity:'word:43',name:'notes.docx',readOnly:false},
 ];
 await queue.take({hostId:host,waitMs:0});
 const status=queue.handle('native-document-workspace',{hostId:host,active,documents});
 assert.equal(status.documents.length,3);assert.equal(status.documents[0].name,status.documents[1].name);assert.notEqual(status.documents[0].identity,status.documents[1].identity);
 const created=queue.request({documentIdentity:'word:42'});
 const claim=await queue.take({hostId:host,waitMs:0});assert.equal(claim.documentIdentity,'word:42');
 assert.equal(queue.status({requestId:created.requestId}).documentIdentity,'word:42');
 assert.deepEqual(queue.finish({hostId:host,requestId:created.requestId,state:'empty'}),{requestId:created.requestId,state:'empty',documentIdentity:'word:42'});
 assert.equal(queue.status({requestId:created.requestId}).documentIdentity,'word:42');
});

test('closed inactive and retired identities fail without falling back; host reset clears the catalog',async()=>{
 const queue=fixture(),host=hex(122),nextHost=hex(123),active={identity:'word:51',name:'same.docx'},inactive={identity:'word:52',name:'same.docx',readOnly:false};
 await queue.take({hostId:host,waitMs:0});
 queue.handle('native-document-workspace',{hostId:host,active,documents:[{...active,readOnly:false},inactive]});
 queue.handle('native-document-workspace',{hostId:host,active,documents:[{...active,readOnly:false}],retiredIdentities:[inactive.identity]});
 assert.throws(()=>queue.request({documentIdentity:inactive.identity}),/not open in the current host/);
 assert.throws(()=>queue.request({documentIdentity:'word:999'}),/not open in the current host/);
 await queue.take({hostId:nextHost,waitMs:0});
 assert.deepEqual(queue.handle('native-document-workspace-status',{}),{connected:true,revision:3,active:null,documents:[],retiredIdentities:[]});
});

test('malformed and conflicting request bodies are rejected and stale claimed requests cannot finish after cancellation',async()=>{
 const queue=fixture(),host=hex(124),active={identity:'word:61',name:'doc.docx'};
 await queue.take({hostId:host,waitMs:0});queue.handle('native-document-workspace',{hostId:host,active,documents:[{...active,readOnly:false}]});
 for(const body of [null,[],{documentIdentity:''},{documentIdentity:active.identity,target},{documentIdentity:active.identity,extra:true},{target,documentIdentity:active.identity}])assert.throws(()=>queue.request(body));
 const created=queue.request({documentIdentity:active.identity});await queue.take({hostId:host,waitMs:0});
 assert.equal(queue.cancel({requestId:created.requestId}).state,'cancelled');
 assert.deepEqual(queue.finish({hostId:host,requestId:created.requestId,state:'opened'}),{requestId:created.requestId,state:'cancelled',reason:'client-cancelled',documentIdentity:active.identity});
});
