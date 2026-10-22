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
