// Document thumbnails outlive an edit ticket. They never authorize a write:
// reopening requires a fresh, Word-owned document capture and OLE session.
window.createWordDocumentWorkspace = api => {
 let cached=null,pending=null,generation=0,selecting=false;
 const changed=()=>api.changed();
 const validTarget=target=>target&&typeof target.identity==='string'&&target.identity.length>0&&target.snapshot!=null&&Number.isInteger(target.index)&&/^[a-f0-9]{64}$/.test(target.nativeSha256||'');
 const remember=document=>{
  if(!document?.hasDocumentContext||!document.documentIdentity)return;
  cached={documentName:document.documentName,documentIdentity:document.documentIdentity,documentSnapshot:document.documentSnapshot,hasDocumentContext:true,objects:document.objects.map(object=>({...object}))};
 };
 async function cancelPending(){
  const old=pending;pending=null;generation++;changed();
  if(old?.requestId)void api.native('wordDocumentCancel',{requestId:old.requestId}).catch(()=>{});
 }
 function failure(request,text){
  if(pending!==request)return;
  if(request.requestId)void api.native('wordDocumentCancel',{requestId:request.requestId}).catch(()=>{});
  pending=null;changed();api.message(text,true);
 }
 async function monitor(request){
  const deadline=api.now()+25000;
  while(pending===request){
   if(api.now()>=deadline){await api.native('wordDocumentCancel',{requestId:request.requestId}).catch(()=>{});failure(request,'未能读取 Word 当前文档。草稿仍保留，请检查 Word 后重试。');return;}
   try{
    const result=await api.native('wordDocumentStatus',{requestId:request.requestId});
    if(pending!==request)return;
    if(result.state==='empty'||result.state==='no-document'){
     cached=null;pending=null;changed();api.message(result.state==='empty'?'Word 当前文档中还没有 MathType 公式。':'请先打开 Word 文档。');return;
    }
    if(['failed','cancelled','superseded','expired'].includes(result.state)){
     failure(request,'未能打开 Word 公式。草稿仍保留；'+(result.reason||'请重新选择目标公式。'));return;
    }
   }catch(error){failure(request,'未能读取 Word 文档：'+error.message);return;}
   await api.pause(300);
  }
 }
 async function requestOpen(target=null,discardApproved=false){
  await cancelPending();
  let ready;const request={generation,requestId:null,target,discardApproved,ready:new Promise(resolve=>{ready=resolve;})};pending=request;changed();api.message('正在读取 Word 文档…');
  try{
   const result=await api.native('wordDocumentOpen',target?{target}:{});
   if(pending!==request||request.generation!==generation){if(result.requestId)await api.native('wordDocumentCancel',{requestId:result.requestId}).catch(()=>{});return false;}
   if(!/^[a-f0-9]{64}$/.test(result.requestId||''))throw Error('Word 文档请求无效');
   request.requestId=result.requestId;ready();void monitor(request);return true;
  }catch(error){failure(request,'未能打开 Word 文档：'+error.message);return false;}finally{ready();}
 }
 return {
  remember,
  visibleSource:source=>source||cached,
  get pending(){return pending!==null||selecting;},
  get hasDocument(){return cached!==null;},
  cancelPending,
  async resume(wordRunning=true){
   const state=api.state();
   if(pending||selecting)return true;
   if(state.busy||state.wordTicket||state.outcomeUnknown||state.draftChanged)return false;
   if(state.source&&!state.source.wordTicket&&!state.source.insertion)return false;
   if(!wordRunning){await cancelPending();cached=null;changed();return false;}
   return requestOpen();
  },
  async select(index){
   const state=api.state(),document=state.source||cached,object=document?.objects[index];
   if(state.busy||state.outcomeUnknown||pending||selecting||!object)return false;
   const target={identity:document.documentIdentity,snapshot:document.documentSnapshot,index,nativeSha256:object.nativeSha256};
   if(!validTarget(target)){api.message('文档信息已失效，请从 Word 重新打开公式。',true);return false;}
   selecting=true;changed();
   try{
    let approved=false;
    if(state.draftChanged){const answer=await api.native('confirmWordSessionSwitch',{browsing:true});if(!answer?.discard)return false;approved=true;}
    remember(document);
    if(state.wordTicket&&!await api.detach())return false;
    return await requestOpen(target,approved);
   }finally{selecting=false;changed();}
  },
  async prepareIncoming(document,requestId=null){
   const request=pending;
   if(requestId&&request&&!request.requestId)await request.ready;
   if(requestId&&(!request||pending!==request||request.requestId!==requestId))throw Error('这次 Word 文档打开请求已经结束。');
   if(!request)return false;
   if(!requestId){await cancelPending();return false;}
   const target=request.target,object=document.objects?.[document.activeIndex];
   const same=target&&document.documentIdentity===target.identity&&document.activeIndex===target.index;
   if(target&&(!same||object?.nativeSha256!==target.nativeSha256)){await cancelPending();throw Error('Word 中的公式内容或位置已经变化。草稿仍保留，请重新打开文档后再选。');}
   const approved=same&&request.discardApproved;
   pending=null;generation++;changed();return !!approved;
  },
  accepted(document){remember(document);changed();}
 };
};
