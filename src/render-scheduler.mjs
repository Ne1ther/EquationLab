// One renderer. Writes remain FIFO; only explicitly marked previews may run
// inside a cooperative read-only checkpoint, one per checkpoint.
export function createRenderScheduler(ready=Promise.resolve()){
 let running=false,sequence=0,current=null,checkpointing=false;const queue=[];
 // Timing observers receive only scheduler metadata. Their failures must not
 // change execution, and they never receive request keys or document content.
 function report(job,outcome,startedAt=null){
  if(!job.onTiming)return;
  const finishedAt=performance.now(),queuedMs=(startedAt??finishedAt)-job.queuedAt,executionMs=startedAt===null?0:finishedAt-startedAt;
  try{job.onTiming({queuedMs,executionMs,elapsedMs:queuedMs+executionMs,outcome,sequence:job.order});}catch{}
 }
 async function execute(job){
  const startedAt=job.onTiming?performance.now():null,previous=current;let lastYield=-Infinity;current=job;
  const checkpoint=async()=>{
   if(current!==job||checkpointing)throw Error('Invalid scheduler checkpoint');
   // Keep cheap scans cheap while still admitting incoming messages at least
   // every eight milliseconds of checkpointed work. A queued preview wins now.
   if(!queue.some(pending=>pending.checkpointPreview)&&performance.now()-lastYield<8)return;
   checkpointing=true;
   try{
    // Give incoming RPC messages a chance to enter the queue, even when the
    // preceding work was synchronous or only yielded through microtasks.
    await new Promise(resolve=>setImmediate(resolve));lastYield=performance.now();
    let selected=-1;
    for(let i=0;i<queue.length;i++)if(queue[i].checkpointPreview&&(selected<0||queue[i].priority<queue[selected].priority||queue[i].priority===queue[selected].priority&&queue[i].order<queue[selected].order))selected=i;
    if(selected>=0)await execute(queue.splice(selected,1)[0]);
   }finally{checkpointing=false;}
  };
  try{const result=await job.run({checkpoint});report(job,'fulfilled',startedAt);job.resolve(result);}
  catch(error){report(job,'rejected',startedAt);job.reject(error);}
  finally{current=previous;}
 }
 async function drain(){
  if(running)return;running=true;
  try{await ready;while(queue.length){queue.sort((a,b)=>a.priority-b.priority||a.order-b.order);await execute(queue.shift());}}
  finally{running=false;}
 }
 return {
  enqueue(run,{priority=0,key=null,onTiming=null,checkpointPreview=false}={}){
   return new Promise((resolve,reject)=>{
    if(key)for(let i=queue.length-1;i>=0;i--)if(queue[i].key===key){const old=queue.splice(i,1)[0];report(old,'superseded');old.resolve({superseded:true});}
    queue.push({run,priority,key,checkpointPreview:checkpointPreview===true,order:sequence++,resolve,reject,onTiming:typeof onTiming==='function'?onTiming:null,queuedAt:onTiming?performance.now():null});void drain();
   });
  },
  get pending(){return queue.length;}
 };
}
