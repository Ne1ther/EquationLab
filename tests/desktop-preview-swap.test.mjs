import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../desktop/preferences.js',import.meta.url),'utf8');
const factory=vm.runInNewContext('('+source.slice(source.indexOf('function decodedPreviewSwap('),source.indexOf('\n let base='))+')');
function preview(){
 const target={src:'',removeAttribute(){this.src='';}},visibility=[],pending=[];
 const swap=factory(target,value=>visibility.push(value),()=>{
  const image={};image.decode=()=>new Promise((resolve,reject)=>pending.push({image,resolve,reject}));return image;
 });
 return {target,visibility,pending,swap};
}
test('A formula preview remains visible until its replacement image is decoded',async()=>{
 const p=preview(),first=p.swap('first');p.pending[0].resolve();await first;
 const second=p.swap('second');assert.equal(p.target.src,'first');assert.deepEqual(p.visibility,[true]);
 p.pending[1].resolve();await second;assert.equal(p.target.src,'second');
});
test('Fast formula switches cannot display an older image after the latest one',async()=>{
 const p=preview(),first=p.swap('first'),second=p.swap('second');p.pending[1].resolve();await second;
 p.pending[0].resolve();await first;assert.equal(p.target.src,'second');assert.deepEqual(p.visibility,[true]);
});
test('Closing the formula cancels an outstanding decode and clears the preview',async()=>{
 const p=preview(),loading=p.swap('first');await p.swap(null);p.pending[0].resolve();await loading;
 assert.equal(p.target.src,'');assert.deepEqual(p.visibility,[false]);
});
test('A failed replacement cannot leave the previous formula labelled as the current preview',async()=>{
 const p=preview(),first=p.swap('first');p.pending[0].resolve();await first;
 const second=p.swap('invalid');p.pending[1].reject(Error('decode failed'));await second;
 assert.equal(p.target.src,'');assert.equal(p.visibility.at(-1),false);
});
test('The current decoded image is reused and invalidates an obsolete replacement',async()=>{
 const p=preview(),first=p.swap('first');p.pending[0].resolve();await first;
 const loading=p.swap('second');await p.swap('first');p.pending[1].resolve();await loading;
 assert.equal(p.target.src,'first');assert.equal(p.pending.length,2);
});
