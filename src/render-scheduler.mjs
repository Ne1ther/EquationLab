// A single non-preemptive renderer. Writes remain FIFO with other writes;
// pending previews outrank thumbnails and superseded previews never execute.
export function createRenderScheduler(ready=Promise.resolve()){
 let running=false,sequence=0;const queue=[];
 // Timing observers receive only scheduler metadata. Their failures must not
 // change execution, and they never receive request keys or document content.
 function report(job,outcome,startedAt=null){
  if(!job.onTiming)return;
  const finishedAt=performance.now(),queuedMs=(startedAt??finishedAt)-job.queuedAt,executionMs=startedAt===null?0:finishedAt-startedAt;
  try{job.onTiming({queuedMs,executionMs,elapsedMs:queuedMs+executionMs,outcome,sequence:job.order});}catch{}
 }
 async function drain(){
  if(running)return;running=true;
  try{await ready;while(queue.length){queue.sort((a,b)=>a.priority-b.priority||a.order-b.order);const job=queue.shift(),startedAt=job.onTiming?performance.now():null;try{const result=await job.run();report(job,'fulfilled',startedAt);job.resolve(result);}catch(error){report(job,'rejected',startedAt);job.reject(error);}}}
  finally{running=false;}
 }
 return {
  enqueue(run,{priority=0,key=null,onTiming=null}={}){
   return new Promise((resolve,reject)=>{
    if(key)for(let i=queue.length-1;i>=0;i--)if(queue[i].key===key){const old=queue.splice(i,1)[0];report(old,'superseded');old.resolve({superseded:true});}
    queue.push({run,priority,key,order:sequence++,resolve,reject,onTiming:typeof onTiming==='function'?onTiming:null,queuedAt:onTiming?performance.now():null});void drain();
   });
  },
  get pending(){return queue.length;}
 };
}
