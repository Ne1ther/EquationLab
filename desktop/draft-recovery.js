(function(root){
 'use strict';
 root.createDraftRecovery=function({id,native,capture,canCapture=()=>true,canClearCleanDraft=()=>true,changed=()=>{},onError=()=>{},onSaved=()=>{},setTimer=setTimeout,clearTimer=clearTimeout}){
  let ready=false,timer=null,tail=Promise.resolve(),last=null,available={available:false},suspended=0;
  const pendingClears=new Set();
  const enqueue=run=>{const result=tail.then(run);tail=result.catch(()=>{});return result;};
  async function clearDraft(target){
   if(target===id)last=undefined;
   await native('draftClear',{clientId:target});
   if(target===id)last=null;
  }
  async function clearPending(){
   for(const target of pendingClears){
    await clearDraft(target);pendingClears.delete(target);
   }
  }
  function clearRecord(target){
   return enqueue(()=>{pendingClears.add(target);return clearPending();});
  }
  const cancelTimer=()=>{if(timer!==null)clearTimer(timer);timer=null;};
  async function refresh(){available=await native('draftStatus',{clientId:id});changed();return available;}
  function persist(snapshot,force=false){
   const encoded=snapshot?JSON.stringify(snapshot):null;
   return enqueue(async()=>{
    await clearPending();
    if(encoded===null){
     if(last!==null&&canClearCleanDraft()){await clearDraft(id);onSaved();}
     return;
    }
    if(!force&&encoded===last)return;
    // A failed reply can follow a committed write. Recheck on the next flush.
    last=undefined;
    await native('draftSave',{clientId:id,...JSON.parse(encoded)});
    last=encoded;onSaved();
   });
  }
  async function flush({force=false}={}){
   cancelTimer();if(suspended||!canCapture())return false;
   if(!ready)return false;
   await persist(capture(),force);return true;
  }
  const api={
   get available(){return available;},
   async initialize(){ready=true;try{await refresh();return available;}finally{api.schedule();}},
   schedule(){if(!ready||suspended||!canCapture())return;cancelTimer();timer=setTimer(()=>{timer=null;void flush().catch(onError);},500);},
   flush,
   async clear(){cancelTimer();await clearRecord(id);},
   async discardRecovery(){const candidate=available;if(!candidate.available)return;await clearRecord(candidate.id);await refresh();},
   async restore(apply){
    const candidate=available;if(!candidate.available||!canCapture())return false;
    cancelTimer();suspended++;
    try{
     // Persist a current draft separately before offering the older record.
     const current=capture();if(current)await persist(current,true);else await enqueue(clearPending);
     const result=await native('draftRestore',{id:candidate.id,clientId:id});
     if(!result?.draft){if(result?.available===false)await refresh();return false;}
     if(await apply(result)===false)return false;
     // The original recovery record remains durable until a later explicit
     // save/discard. It must survive a crash during UI restoration itself.
     available={...candidate,restored:true};changed();return true;
    }finally{suspended--;api.schedule();}
   }
  };
  return api;
 };
})(typeof window==='undefined'?globalThis:window);
