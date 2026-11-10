import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createDocumentSnapshotCache,estimateSnapshotBytes,projectDocumentSnapshot} from '../src/document-snapshot-cache.mjs';

async function workspace(t){
 const dir=await mkdtemp(join(tmpdir(),'equationlab-snapshot-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 return {path:name=>join(dir,name),write:(name,content)=>writeFile(join(dir,name),content)};
}
function fixture(bytes){
 return {zip:{large:Buffer.alloc(4096)},doc:{nodeType:9},objects:[{index:0,ole:Buffer.from(bytes),latex:bytes.toString(),nativeSha256:'test',imagePath:'word/media/a.png',layout:{mode:'inline'},characters:[{text:'x'}],element:{nodeType:1},partDoc:{nodeType:9},rels:{nodeType:9}}],numberFormat:null,numberingRevision:0};
}
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}

test('projection keeps independent metadata and OLE without DOM, ZIP or media',()=>{
 const original=fixture(Buffer.from('formula'));
 const snapshot=projectDocumentSnapshot(original,{font:'Times'});
 assert.deepEqual(Object.keys(snapshot),['objects','numberFormat','numberingRevision','typographyPreset']);
 assert.equal(snapshot.objects[0].element,undefined);
 assert.equal(snapshot.objects[0].partDoc,undefined);
 assert.equal(snapshot.objects[0].rels,undefined);
 assert.equal(snapshot.zip,undefined);
 original.objects[0].ole.fill(0);original.objects[0].layout.mode='changed';
 assert.equal(snapshot.objects[0].ole.toString(),'formula');
 assert.equal(snapshot.objects[0].layout.mode,'inline');
 assert.ok(estimateSnapshotBytes(snapshot)<estimateSnapshotBytes(original));
});

test('identity invalidates modified paths and equal content reuses a snapshot',async t=>{
 const w=await workspace(t);await w.write('a','first');await w.write('b','first');let count=0;
 const cache=createDocumentSnapshotCache({inspect:async bytes=>{count++;return fixture(bytes);}});
 const a=await cache.get(w.path('a')),same=await cache.get(w.path('a')),b=await cache.get(w.path('b'));
 assert.strictEqual(a.document,same.document);assert.strictEqual(a.document,b.document);assert.equal(count,1);
 await w.write('replacement','other');await rename(w.path('replacement'),w.path('a'));
 const changed=await cache.get(w.path('a'));
 assert.notEqual(changed.contentHash,a.contentHash);assert.equal(changed.document.objects[0].latex,'other');
 assert.strictEqual((await cache.get(w.path('b'))).document,b.document);assert.equal(count,2);
 assert.equal(cache.stats().misses,2);assert.ok(cache.stats().hits>=2);
});

test('LRU tracks retained estimates, evicts least recently used, and skips oversized snapshots',async t=>{
 const w=await workspace(t);for(const n of ['a','b','c'])await w.write(n,n);
 let count=0;const expected=estimateSnapshotBytes(projectDocumentSnapshot(fixture(Buffer.from('a')),null));
 const cache=createDocumentSnapshotCache({inspect:async bytes=>{count++;return fixture(bytes);},maxBytes:expected*2,maxEntries:2});
 await cache.get(w.path('a'));await cache.get(w.path('b'));await cache.get(w.path('a'));await cache.get(w.path('c'));
 assert.equal(cache.stats().entries,2);assert.equal(cache.stats().retainedBytes,expected*2);
 await cache.get(w.path('a'));assert.equal(count,3);await cache.get(w.path('b'));assert.equal(count,4);
 const tiny=createDocumentSnapshotCache({inspect:async bytes=>fixture(bytes),maxBytes:expected-1});
 await tiny.get(w.path('a'));assert.equal(tiny.stats().entries,0);assert.equal(tiny.stats().retainedBytes,0);
});

test('concurrent same paths and equal content coalesce, and failed parses can retry',async t=>{
 const w=await workspace(t);await w.write('a','same');await w.write('b','same');const gate=deferred();let count=0;
 const cache=createDocumentSnapshotCache({inspect:async bytes=>{count++;await gate.promise;return fixture(bytes);}});
 const requests=[cache.get(w.path('a')),cache.get(w.path('a')),cache.get(w.path('b'))];
 // Wait until both paths reached parsing before releasing it.
 while(cache.stats().pendingPaths<2||cache.stats().pendingContent<1)await new Promise(resolve=>setImmediate(resolve));
 gate.resolve();const results=await Promise.all(requests);
 assert.equal(count,1);assert.strictEqual(results[0].document,results[2].document);
 assert.equal(cache.stats().pendingPaths,0);assert.equal(cache.stats().pendingContent,0);
 let attempts=0;const failing=createDocumentSnapshotCache({inspect:async bytes=>{if(++attempts===1)throw Error('bad document');return fixture(bytes);}});
 await assert.rejects(failing.get(w.path('a')),/bad document/);
 assert.equal(failing.stats().entries,0);assert.equal(failing.stats().files,0);
 assert.equal((await failing.get(w.path('a'))).document.objects[0].latex,'same');assert.equal(attempts,2);
});

test('preview extraction binds bytes to the requested content and rejects changes during extraction',async t=>{
 const w=await workspace(t);await w.write('a','first');const gate=deferred(),started=deferred();let calls=0;
 const cache=createDocumentSnapshotCache({inspect:async bytes=>fixture(bytes),extractPreviews:async (bytes,paths)=>{calls++;started.resolve();await gate.promise;return paths.map(path=>[path,bytes.toString()]);}});
 const first=await cache.get(w.path('a'));
 const pending=cache.getStoredPreviews(w.path('a'),first.contentHash,['word/media/a.png']);await started.promise;
 await w.write('next','other');await rename(w.path('next'),w.path('a'));gate.resolve();
 await assert.rejects(pending,/changed/);
 await assert.rejects(cache.getStoredPreviews(w.path('a'),first.contentHash,['word/media/a.png']),/changed/);
 assert.equal(calls,1);
 const latest=await cache.get(w.path('a'));
 assert.deepEqual(await cache.getStoredPreviews(w.path('a'),latest.contentHash,['word/media/a.png']),[['word/media/a.png','other']]);
});


test('a replacement during parsing cannot bind old content to the new file identity',async t=>{
 const w=await workspace(t);await w.write('a','old');const gate=deferred(),started=deferred();
 const cache=createDocumentSnapshotCache({inspect:async bytes=>{started.resolve();await gate.promise;return fixture(bytes);}});
 const pending=cache.get(w.path('a'));await started.promise;await w.write('replacement','new');await rename(w.path('replacement'),w.path('a'));gate.resolve();
 await assert.rejects(pending,/changed/);assert.equal(cache.stats().files,0);
 const latest=await cache.get(w.path('a'));assert.equal(latest.document.objects[0].latex,'new');
});

test('preview batches reuse verified content, copy results, preserve path order and include empty batches',async t=>{
 const w=await workspace(t);await w.write('a','first');await w.write('b','first');let calls=0;
 const cache=createDocumentSnapshotCache({inspect:async bytes=>fixture(bytes),extractPreviews:async (bytes,paths)=>{calls++;return {paths:[...paths],image:Buffer.from(bytes)};}});
 const first=await cache.get(w.path('a'));
 const result=await cache.getStoredPreviews(w.path('a'),first.contentHash,['x','y']);
 result.image.fill(0);result.paths.push('mutated');
 const cached=await cache.getStoredPreviews(w.path('a'),first.contentHash,['x','y']);
 assert.equal(calls,1);assert.equal(cached.image.toString(),'first');assert.deepEqual(cached.paths,['x','y']);
 cached.image.fill(0);assert.equal((await cache.getStoredPreviews(w.path('a'),first.contentHash,['x','y'])).image.toString(),'first');
 // An unknown path must hash its content before it can reuse a cached result.
 assert.equal((await cache.getStoredPreviews(w.path('b'),first.contentHash,['x','y'])).image.toString(),'first');assert.equal(calls,1);
 await cache.getStoredPreviews(w.path('a'),first.contentHash,['y','x']);assert.equal(calls,2);
 assert.deepEqual((await cache.getStoredPreviews(w.path('a'),first.contentHash,[])).paths,[]);
 await cache.getStoredPreviews(w.path('a'),first.contentHash,[]);assert.equal(calls,3);
 assert.ok(cache.stats().previewHits>=4);assert.equal(cache.stats().previewMisses,3);
});

test('preview cache never trusts a changed file or an unbound path',async t=>{
 const w=await workspace(t);await w.write('a','first');await w.write('b','other');let calls=0;
 const cache=createDocumentSnapshotCache({inspect:async bytes=>fixture(bytes),extractPreviews:async bytes=>{calls++;return bytes.toString();}});
 const first=await cache.get(w.path('a'));await cache.getStoredPreviews(w.path('a'),first.contentHash,['x']);
 await assert.rejects(cache.getStoredPreviews(w.path('b'),first.contentHash,['x']),/changed/);assert.equal(calls,1);
 await w.write('replacement','other');await rename(w.path('replacement'),w.path('a'));
 await assert.rejects(cache.getStoredPreviews(w.path('a'),first.contentHash,['x']),/changed/);assert.equal(calls,1);
 // Replacement with equal bytes can only reuse after a new stable hash.
 await w.write('replacement','first');await rename(w.path('replacement'),w.path('a'));
 assert.equal(await cache.getStoredPreviews(w.path('a'),first.contentHash,['x']),'first');assert.equal(calls,1);
});

test('preview results have an independent LRU budget and survive snapshot eviction only within it',async t=>{
 const w=await workspace(t);await w.write('a','first');let calls=0;
 const cache=createDocumentSnapshotCache({inspect:async bytes=>fixture(bytes),extractPreviews:async (_bytes,paths)=>{calls++;return {image:paths[0]};},maxEntries:0,maxPreviewEntries:2,maxPreviewBytes:4096});
 const doc=await cache.get(w.path('a'));assert.equal(cache.stats().entries,0);
 await cache.getStoredPreviews(w.path('a'),doc.contentHash,['a']);await cache.getStoredPreviews(w.path('a'),doc.contentHash,['b']);
 await cache.getStoredPreviews(w.path('a'),doc.contentHash,['a']);await cache.getStoredPreviews(w.path('a'),doc.contentHash,['c']);
 assert.equal(cache.stats().previewEntries,2);assert.ok(cache.stats().previewRetainedBytes<=4096);
 await cache.getStoredPreviews(w.path('a'),doc.contentHash,['a']);assert.equal(calls,3);
 await cache.getStoredPreviews(w.path('a'),doc.contentHash,['b']);assert.equal(calls,4);
 const small=createDocumentSnapshotCache({inspect:async bytes=>fixture(bytes),extractPreviews:async()=>({image:'large'}),maxPreviewBytes:1});
 const first=await small.get(w.path('a'));assert.deepEqual(await small.getStoredPreviews(w.path('a'),first.contentHash,['x']),{image:'large'});
 assert.equal(small.stats().previewEntries,0);assert.equal(small.stats().previewRetainedBytes,0);
});

test('unsupported extractor result types remain usable without being retained',async t=>{
 const w=await workspace(t);await w.write('a','first');let calls=0;
 const cache=createDocumentSnapshotCache({inspect:async bytes=>fixture(bytes),extractPreviews:async()=>{calls++;return new Map([['a','b']]);}});
 const doc=await cache.get(w.path('a'));
 assert.deepEqual(await cache.getStoredPreviews(w.path('a'),doc.contentHash,[]),new Map([['a','b']]));
 await cache.getStoredPreviews(w.path('a'),doc.contentHash,[]);assert.equal(calls,2);assert.equal(cache.stats().previewEntries,0);
});
