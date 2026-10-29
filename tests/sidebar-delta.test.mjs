import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
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
