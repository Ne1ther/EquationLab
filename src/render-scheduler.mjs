// A single non-preemptive renderer. Writes remain FIFO with other writes;
// pending previews outrank thumbnails and superseded previews never execute.
export function createRenderScheduler(ready=Promise.resolve()){
 let running=false,sequence=0;const queue=[];
 async function drain(){
  if(running)return;running=true;
  try{await ready;while(queue.length){queue.sort((a,b)=>a.priority-b.priority||a.order-b.order);const job=queue.shift();try{job.resolve(await job.run());}catch(error){job.reject(error);}}}
  finally{running=false;}
 }
 return {
  enqueue(run,{priority=0,key=null}={}){
   return new Promise((resolve,reject)=>{
    if(key)for(let i=queue.length-1;i>=0;i--)if(queue[i].key===key){const old=queue.splice(i,1)[0];old.resolve({superseded:true});}
    queue.push({run,priority,key,order:sequence++,resolve,reject});void drain();
   });
  },
  get pending(){return queue.length;}
 };
}
