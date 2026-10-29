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
