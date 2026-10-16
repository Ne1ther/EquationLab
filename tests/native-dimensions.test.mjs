import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeDimension32} from '../src/native-dimensions.mjs';
test('Original unit table and percent getter retain integer truncation and cm multiplier',()=>{
 assert.equal(nativeDimension32({unit:'%',value:'58'},24*32),445);
 assert.equal(nativeDimension32({unit:'%',value:'58'},12*32),222);
 assert.equal(nativeDimension32({unit:'cm',value:'1'}),907);
 assert.equal(nativeDimension32({unit:'in',value:'1.5'}),3456);
 assert.equal(nativeDimension32({unit:'pc',value:'1.5'}),576);
 assert.equal(nativeDimension32({unit:'pt',value:'12.01'}),384);
 assert.equal(nativeDimension32({unit:'%',value:'12.5'},384,{relative:false}),400);
 assert.equal(nativeDimension32({unit:'%',value:'-2.5'},384),-9);
});
