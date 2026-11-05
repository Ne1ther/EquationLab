import test from 'node:test';
import assert from 'node:assert/strict';
import {parseArguments,summarizeTimings} from '../scripts/benchmark-document.mjs';

test('benchmark refuses unbounded fixture sizes and duplicate cases',()=>{
 for(const args of [['--counts','301'],['--counts','0'],['--counts','30,30'],['--counts','1,2,3,4,5']])assert.throws(()=>parseArguments(args),/unique synthetic counts/);
 assert.deepEqual(parseArguments(['--counts','1,30,300']).counts,[1,30,300]);
 assert.throws(()=>parseArguments(['--counts','none']),/none with a document/);
 const sidebar=parseArguments(['--counts','none','--document','authorized-copy.docx','--scenario','sidebar']);
 assert.deepEqual(sidebar.counts,[]);assert.equal(sidebar.scenario,'sidebar');
 assert.throws(()=>parseArguments(['--scenario','unknown']),/Unknown benchmark scenario/);
});

test('benchmark distributions count superseded work without pretending it executed',()=>{
 const result=summarizeTimings([
  {queuedMs:5,executionMs:3,elapsedMs:8,outcome:'fulfilled'},
  {queuedMs:7,executionMs:0,elapsedMs:7,outcome:'superseded'},
  {queuedMs:10,executionMs:4,elapsedMs:14,outcome:'fulfilled'},
  {queuedMs:2,executionMs:1,elapsedMs:3,outcome:'rejected'}
 ]);
 assert.equal(result.requested,4);assert.equal(result.completed,2);assert.equal(result.superseded,1);assert.equal(result.rejected,1);
 assert.deepEqual(result.executionMs,{samples:2,min:3,median:3,p95:4,max:4});
 assert.deepEqual(summarizeTimings([]).executionMs,{samples:0});
});
