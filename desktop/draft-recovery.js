(function(root){
 'use strict';
 root.createDraftRecovery=function({id,native,capture,canCapture=()=>true,changed=()=>{},onError=()=>{},onSaved=()=>{},setTimer=setTimeout,clearTimer=clearTimeout}){
  let ready=false,timer=null,tail=Promise.resolve(),last=null,available={available:false},suspended=0,persistenceFailure=null;
  const pendingClears=new Set();
  const enqueue=run=>{const result=tail.then(async()=>{try{for(const target of [...pendingClears]){await native('draftClear',{clientId:target});pendingClears.delete(target);}const value=await run();persistenceFailure=null;return value;}catch(error){persistenceFailure=error;throw error;}});tail=result.catch(()=>{});return result;};
  const cancelTimer=()=>{if(timer!==null)clearTimer(timer);timer=null;};
  async function refresh(){available=await native('draftStatus',{clientId:id});changed();return available;}
  async function flush(){
   cancelTimer();if(suspended||!canCapture())return false;
   if(!ready)return false;
   const snapshot=capture();if(!snapshot){await tail;if(persistenceFailure)throw persistenceFailure;return true;}
   const encoded=JSON.stringify(snapshot);
   await enqueue(async()=>{if(encoded===last)return;await native('draftSave',{clientId:id,...JSON.parse(encoded)});last=encoded;onSaved();});return true;
  }
  const api={
   get available(){return available;},
   async initialize(){ready=true;try{await refresh();return available;}finally{api.schedule();}},
   schedule(){if(!ready||suspended||!canCapture())return;cancelTimer();timer=setTimer(()=>{timer=null;void flush().catch(onError);},500);},
   flush,
   async clear(){cancelTimer();pendingClears.add(id);await enqueue(()=>{last=null;});},
   async discardRecovery(){const candidate=available;if(!candidate.available)return;pendingClears.add(candidate.id);await enqueue(()=>{});await refresh();},
   async restore(apply){
    const candidate=available;if(!candidate.available||!canCapture())return false;
    cancelTimer();suspended++;
    try{
     // Persist a current draft separately before offering the older record.
     const current=capture();if(current)await enqueue(()=>native('draftSave',{clientId:id,...current}));
     const result=await native('draftRestore',{id:candidate.id,clientId:id});
     if(!result?.draft)return false;
     if(await apply(result)===false)return false;
     // The original recovery record remains durable until a later explicit
     // save/discard. It must survive a crash during UI restoration itself.
     last=null;available={...candidate,restored:true};changed();return true;
    }finally{suspended--;api.schedule();}
   }
  };
  return api;
 };
})(typeof window==='undefined'?globalThis:window);
