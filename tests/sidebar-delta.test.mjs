import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createDocx,inspectDocx} from '../src/document.mjs';
const source=await readFile(new URL('../desktop/sidebar-state.js',import.meta.url),'utf8');
function publisher(){const c=vm.createContext({});vm.runInContext(source,c);return c.createSidebarPublisher();}
test('500-row sidebar does no row work while only editor state changes; a thumbnail updates one row',()=>{
 let reads=0;const doc={objects:Array.from({length:500},(_,index)=>({index,get latex(){reads++;return 'x_'+index;},application:'MathType',image:null}))};
 const p=publisher(),first=p.snapshot(doc);assert.equal(first.delta.reset.length,500);assert.equal(reads,500);
 for(let i=0;i<1200;i++)assert.equal(p.snapshot(doc).delta,null);
 assert.equal(reads,500,'typing and cursor publications must not traverse rows');
 doc.objects[499].image='data:image/png;base64,changed';p.invalidate(doc,[499]);
 const update=p.snapshot(doc).delta;assert.equal(update.upserts.length,1);assert.equal(update.upserts[0].id,499);assert.equal(update.baseRevision,1);assert.equal(update.revision,2);assert.equal(reads,501);
 assert.ok(JSON.stringify(update).length<JSON.stringify(first.delta).length/100);
});
test('retired documents reset to empty and stale thumbnail completions cannot change the new source',()=>{
 const p=publisher(),a={objects:[{index:0,latex:'a'}]},b={objects:[{index:0,latex:'b'}]};
 const ga=p.snapshot(a).delta.generation,gb=p.snapshot(b).delta.generation;assert.notEqual(ga,gb);
 p.invalidate(a,[0]);assert.equal(p.snapshot(b).delta,null);assert.equal(p.snapshot(b).objects[0].latex,'b');
 assert.equal(p.snapshot(null).delta.reset.length,0);
 p.invalidate(b,[0]);assert.equal(p.snapshot(null).delta,null);
 p.snapshot(b);p.reset();assert.equal(p.snapshot(b).delta.reset[0].latex,'b','recovery resets the actually displayed cached source');
});
test('a reloaded web editor resets a retained native sidebar with a new publisher identity',()=>{
 const doc={objects:[{index:0,latex:'x'}]};assert.notEqual(publisher().snapshot(doc).delta.generation,publisher().snapshot(doc).delta.generation);
});
test('real DOCX number metadata reaches rows, later deltas and snapshot refreshes without replacing ids',async()=>{
 const bytes=await createDocx([{latex:'x',layout:{mode:'numbered-right',chapter:3,equation:28,numberFormat:'(#C1.#E1)'}},{latex:'y',layout:{mode:'inline'}}],{fragment:true});
 const doc=await inspectDocx(bytes),p=publisher(),initial=p.snapshot(doc);
 assert.equal(initial.objects[0].numberText,'(3.28)');assert.equal(initial.objects[0].position,1);assert.equal(initial.objects[1].numberText,null);
 assert.equal(initial.objects[0].numberStatus,'snapshot');
 doc.objects[0].layout.numberText='(4.1)';doc.objects[1].layout.numberText='(4.1)';p.invalidate(doc,[0,1]);
 const update=p.snapshot(doc).delta;assert.deepEqual(Array.from(update.upserts,item=>[item.id,item.numberText]),[[0,'(4.1)'],[1,'(4.1)']]);
 doc.numberingRefreshNeeded=true;assert.equal(p.snapshot(doc).delta.reset[0].numberStatus,'stale');
 doc.numberingRefreshNeeded=false;doc.objects[0].layout.numberText=null;p.invalidate(doc,[0]);
 const refreshed=p.snapshot(doc);assert.equal(refreshed.objects[0].numberText,null);assert.equal(refreshed.objects[0].id,0);assert.equal(refreshed.objects[0].position,1);
 const partial={documentPosition:27,documentLoading:true,objects:[{index:0,latex:'z'}]};
 const pending=p.snapshot(partial);assert.equal(pending.objects[0].numberText,null);assert.equal(pending.objects[0].position,28);assert.equal(pending.objects[0].numberStatus,'pending');
 partial.objects[0].layout={numberText:'(3.28)'};p.invalidate(partial,[0]);assert.equal(p.snapshot(partial).delta.upserts[0].numberText,'(3.28)');
 partial.documentLoading=false;assert.equal(p.snapshot(partial).delta.reset[0].numberStatus,'snapshot');
 p.snapshot(doc);p.invalidate(partial,[0]);assert.equal(p.snapshot(doc).delta,null,'late metadata cannot affect a different document');
});
