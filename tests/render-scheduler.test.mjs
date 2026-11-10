import test from 'node:test';
import assert from 'node:assert/strict';
import {createRenderScheduler} from '../src/render-scheduler.mjs';
test('latest pending preview overtakes thumbnails without cancelling active work or reordering writes',async()=>{
 let ready;const scheduler=createRenderScheduler(new Promise(resolve=>ready=resolve)),order=[];
 const add=(label,options)=>scheduler.enqueue(async()=>{order.push(label);return label;},options);
 const jobs=[add('thumbnail1',{priority:2}),add('old',{priority:1,key:'preview'}),add('save1'),add('thumbnail2',{priority:2}),add('new',{priority:1,key:'preview'}),add('save2')];
 ready();const results=await Promise.all(jobs);
 assert.deepEqual(order,['save1','save2','new','thumbnail1','thumbnail2']);assert.deepEqual(results[1],{superseded:true});assert.equal(scheduler.pending,0);
});
test('running request finishes once and failures do not poison later work',async()=>{
 let release,started;const start=new Promise(r=>started=r);const s=createRenderScheduler(),events=[];
 const first=s.enqueue(async()=>{started();await new Promise(r=>release=r);events.push('first');return 1;},{key:'preview',priority:1});
 await start;
 const next=s.enqueue(async()=>{events.push('next');throw Error('render failed');},{key:'preview',priority:1});
 const last=s.enqueue(async()=>{events.push('last');return 3;},{priority:2});
 const failure=assert.rejects(next,/render failed/);release();assert.equal(await first,1);await failure;assert.equal(await last,3);assert.deepEqual(events,['first','next','last']);
});

test('timings are numeric and content-free for successful, rejected and superseded work',async()=>{
 let ready;const scheduler=createRenderScheduler(new Promise(resolve=>ready=resolve)),timings=[],executed=[];
 const record=timing=>timings.push(timing);
 const old=scheduler.enqueue(()=>executed.push('old'),{key:'private-preview-content',priority:1,onTiming:record});
 const latest=scheduler.enqueue(()=>executed.push('latest'),{key:'private-preview-content',priority:1,onTiming:record});
 const failed=scheduler.enqueue(()=>{throw Error('private error');},{onTiming:record});
 const rejection=assert.rejects(failed,/private error/);ready();await Promise.all([old,latest,rejection]);
 assert.deepEqual(executed,['latest']);
 assert.deepEqual(timings.map(t=>t.outcome),['superseded','rejected','fulfilled']);
 assert.deepEqual(timings.map(t=>t.sequence),[0,2,1]);
 for(const timing of timings){
  assert.deepEqual(Object.keys(timing).sort(),['elapsedMs','executionMs','outcome','queuedMs','sequence']);
  for(const field of ['queuedMs','executionMs','elapsedMs'])assert.ok(Number.isFinite(timing[field])&&timing[field]>=0);
  assert.equal(timing.elapsedMs,timing.queuedMs+timing.executionMs);
 }
 assert.equal(timings[0].executionMs,0);assert.equal(scheduler.pending,0);
});

test('throwing observers preserve write FIFO and do not reject the work',async()=>{
 let release,started;const scheduler=createRenderScheduler(),order=[];
 const active=scheduler.enqueue(async()=>{started?.();await new Promise(resolve=>release=resolve);});
 // Allow the active job to start before adding writes and pending previews.
 await new Promise(resolve=>{started=resolve;});
 const onTiming=()=>{throw Error('observer failed');};
 const first=scheduler.enqueue(()=>{order.push('write1');return 1;},{onTiming});
 const old=scheduler.enqueue(()=>order.push('old'),{priority:1,key:'preview',onTiming});
 const last=scheduler.enqueue(()=>{order.push('write2');return 2;},{onTiming});
 const latest=scheduler.enqueue(()=>{order.push('preview');return 3;},{priority:1,key:'preview',onTiming});
 release();assert.deepEqual(await Promise.all([first,old,last,latest]),[1,{superseded:true},2,3]);await active;
 assert.deepEqual(order,['write1','write2','preview']);
});

test('cooperative checkpoints run one marked preview, isolate failures and leave writes in FIFO order',async()=>{
 let release,started;const start=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve);
 const scheduler=createRenderScheduler(),events=[];
 const preflight=scheduler.enqueue(async({checkpoint})=>{
  events.push('preflight-start');started();await gate;
  await checkpoint();events.push('checkpoint-1');
  await checkpoint();events.push('checkpoint-2');
  return 'plan';
 });
 await start;
 const write1=scheduler.enqueue(()=>events.push('write-1'));
 const old=scheduler.enqueue(()=>events.push('old-preview'),{priority:1,key:'preview',checkpointPreview:true});
 const latest=scheduler.enqueue(()=>{events.push('latest-preview');throw Error('preview failed');},{priority:1,key:'preview',checkpointPreview:true});
 const failed=assert.rejects(latest,/preview failed/);
 const second=scheduler.enqueue(()=>events.push('second-preview'),{priority:1,checkpointPreview:true});
 const otherPreflight=scheduler.enqueue(()=>events.push('other-preflight'));
 const write2=scheduler.enqueue(()=>events.push('write-2'));
 release();assert.equal(await preflight,'plan');await Promise.all([write1,old,failed,second,otherPreflight,write2]);
 assert.deepEqual(await old,{superseded:true});
 assert.deepEqual(events,['preflight-start','latest-preview','checkpoint-1','second-preview','checkpoint-2','write-1','other-preflight','write-2']);
});

test('checkpoint yields to the event loop before selecting a pending preview',async()=>{
 const scheduler=createRenderScheduler(),events=[];let preview;
 const preflight=scheduler.enqueue(async({checkpoint})=>{
  setImmediate(()=>{preview=scheduler.enqueue(()=>events.push('preview'),{priority:1,checkpointPreview:true});});
  await checkpoint();events.push('resumed');
 });
 await preflight;await preview;assert.deepEqual(events,['preview','resumed']);
});
