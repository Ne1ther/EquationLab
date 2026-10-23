// Document thumbnails outlive an edit ticket. They never authorize a write:
// reopening requires a fresh, Word-owned document capture and OLE session.
window.createWordDocumentWorkspace = api => {
 let cached=null,pending=null,generation=0,selecting=false,statusFlight=null,refreshFlight=null,observedIdentity=undefined,active=null,wordDocumentUnavailable=false,unavailableIdentity=null,unavailableName='',knownRetired=new Set();
 let documents=[],connected=false,metadataFlight=null,emptyDocument=null;
 const changed=()=>api.changed();
 const readStatus=()=>metadataFlight??(metadataFlight=api.native('wordWorkspaceStatus').finally(()=>{metadataFlight=null;}));
 function updateCatalog(status){
  const nextConnected=status?.connected===true;
  const seen=new Set();
  const next=nextConnected&&Array.isArray(status.documents)?status.documents.slice(0,128).filter(item=>{
   if(!item||typeof item.identity!=='string'||typeof item.name!=='string'||seen.has(item.identity)||status.retiredIdentities?.includes(item.identity))return false;
   seen.add(item.identity);return true;
  }).map(({identity,name,readOnly})=>({identity,name,readOnly:readOnly===true})):[];
  if(connected===nextConnected&&JSON.stringify(documents)===JSON.stringify(next))return;
  connected=nextConnected;documents=next;changed();
 }
 async function refreshList(){
  const before=generation;
  try{
   const status=await readStatus();if(before!==generation)return false;updateCatalog(status);
   if(status?.connected===true&&Array.isArray(status.retiredIdentities)){
    knownRetired=new Set(status.retiredIdentities.filter(identity=>typeof identity==='string'));
    const state=api.state(),sourceIdentity=identityOf(state.source),cacheIdentity=identityOf(cached);
    const retiredIdentity=sourceIdentity&&knownRetired.has(sourceIdentity)?sourceIdentity:!sourceIdentity&&cacheIdentity&&knownRetired.has(cacheIdentity)?cacheIdentity:null;
    if(retiredIdentity){
     const name=String(state.source&&sourceIdentity===retiredIdentity?state.source.documentName||'Word 文档':cached?.documentName||'Word 文档');
     if(!wordDocumentUnavailable||unavailableIdentity!==retiredIdentity||unavailableName!==name){
      wordDocumentUnavailable=true;unavailableIdentity=retiredIdentity;unavailableName=name;changed();
     }
    }
   }
   return connected;
  }
  catch(error){api.message('未能读取 Word 文档列表：'+error.message,true);return false;}
 }
 const validTarget=target=>target&&typeof target.identity==='string'&&target.identity.length>0&&target.snapshot!=null&&Number.isInteger(target.index)&&/^[a-f0-9]{64}$/.test(target.nativeSha256||'');
 const clearUnavailable=()=>{if(!wordDocumentUnavailable&&!unavailableIdentity&&!unavailableName)return false;wordDocumentUnavailable=false;unavailableIdentity=null;unavailableName='';changed();return true;};
 const remember=document=>{
  if(!document?.hasDocumentContext||!document.documentIdentity)return;
  if(knownRetired.has(document.documentIdentity)||wordDocumentUnavailable&&document.documentIdentity===unavailableIdentity)return;
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
     if(request.expectedIdentity){
      const fresh=await readStatus();
      if(pending!==request)return;
      updateCatalog(fresh);
      const matches=request.documentIdentity?result.documentIdentity===request.documentIdentity&&documents.some(item=>item.identity===request.documentIdentity):fresh.active?.identity===request.expectedIdentity;
      if(!fresh?.connected||!matches||fresh.retiredIdentities?.includes(request.expectedIdentity)){failure(request,'Word 当前文档已变化。草稿仍保留，请重新选择目标文档。');return;}
      emptyDocument=request.documentIdentity?documents.find(item=>item.identity===request.documentIdentity):fresh.active;
     }
     if(request.discardApproved&&!request.clearOnEmpty){observedIdentity=identityOf(cached);failure(request,'Word 当前文档没有可编辑公式。当前草稿仍保留。');return;}
     cached=null;pending=null;if(request.clearOnEmpty)api.empty?.();changed();api.message(result.state==='empty'?'Word 当前文档中还没有 MathType 公式。':'请先打开 Word 文档。');return;
    }
    if(['failed','cancelled','superseded','expired'].includes(result.state)){
     failure(request,'未能打开 Word 公式。草稿仍保留；'+(result.reason||'请重新选择目标公式。'));return;
    }
   }catch(error){failure(request,'未能读取 Word 文档：'+error.message);return;}
   await api.pause(300);
  }
 }
 async function requestOpen(target=null,discardApproved=false,expectedIdentity=null,clearOnEmpty=false,documentIdentity=null){
  await cancelPending();
  let ready;const request={generation,requestId:null,target,discardApproved,expectedIdentity,clearOnEmpty,documentIdentity,ready:new Promise(resolve=>{ready=resolve;})};pending=request;changed();api.message('正在读取 Word 文档…');
  try{
   const result=await api.native('wordDocumentOpen',documentIdentity?{documentIdentity}:target?{target}:{});
   if(pending!==request||request.generation!==generation){if(result.requestId)await api.native('wordDocumentCancel',{requestId:result.requestId}).catch(()=>{});return false;}
   if(!/^[a-f0-9]{64}$/.test(result.requestId||''))throw Error('Word 文档请求无效');
   request.requestId=result.requestId;ready();void monitor(request);return true;
  }catch(error){failure(request,'未能打开 Word 文档：'+error.message);return false;}finally{ready();}
 }
 async function isRetired(identity){
  if(!knownRetired.has(identity))return false;
  try{
   const fresh=await api.native('wordWorkspaceStatus');
   if(fresh?.connected&&Array.isArray(fresh.retiredIdentities))knownRetired=new Set(fresh.retiredIdentities.filter(value=>typeof value==='string'));
  }catch{}
  return knownRetired.has(identity);
 }
 const identityOf=document=>document?.hasDocumentContext&&typeof document.documentIdentity==='string'?document.documentIdentity:null;
 const currentIdentity=()=>identityOf(api.state().source)||identityOf(cached)||(wordDocumentUnavailable?unavailableIdentity:emptyDocument?.identity||observedIdentity)||null;
 async function detachClean(keepSelecting=false,options={}){selecting=true;changed();try{return await api.detach(options);}finally{if(!keepSelecting){selecting=false;changed();}}}
 const dirty=state=>!!state.draftChanged;
 async function syncCurrent({force=false}={}){
  if(statusFlight){if(!force)return statusFlight;const inFlight=statusFlight;await inFlight;return syncCurrent({force:true});}
  const statusGeneration=generation;
  let releaseSelection=false,activeMetadataChanged=false;
  statusFlight=(async()=>{
   const status=await readStatus();
   if(statusGeneration!==generation)return false;
   updateCatalog(status);
   if(!status||!Number.isInteger(status.revision)||!status.connected)return false;
   if(Array.isArray(status.retiredIdentities))knownRetired=new Set(status.retiredIdentities.filter(identity=>typeof identity==='string'));
   const retired=new Set(knownRetired);
   const rawTarget=status.active&&typeof status.active.identity==='string'?status.active:null;
   const target=rawTarget&&!retired.has(rawTarget.identity)?rawTarget:null;
   const nextIdentity=target?.identity??null;
   activeMetadataChanged=active?.identity!==target?.identity||active?.name!==target?.name;
   active=target?{identity:target.identity,name:String(target.name||'Word 文档')}:null;
   const state=api.state(),sourceIdentity=identityOf(state.source),cacheIdentity=identityOf(cached),cachedBeforeRetirement=cached;
   const retiredSource=sourceIdentity&&retired.has(sourceIdentity)?sourceIdentity:null;
   const retiredCache=cacheIdentity&&retired.has(cacheIdentity)?cacheIdentity:null;
   const retiredIdentity=retiredSource||(!sourceIdentity&&retiredCache)||null;
   if(retiredCache)cached=null;
   if(retiredIdentity){
    const displayDocument=state.source&&identityOf(state.source)===retiredIdentity?state.source:cachedBeforeRetirement;
    wordDocumentUnavailable=true;unavailableIdentity=retiredIdentity;
    unavailableName=String(displayDocument?.documentName||unavailableName||'Word 文档');
    cached=null;changed();
    if(state.busy||state.outcomeUnknown||pending||selecting)return false;
    const wasDirty=dirty(state),sourceBefore=state.source,ticketBefore=state.wordTicket;
    if(wasDirty){
     if((ticketBefore||sourceIdentity===retiredIdentity)&&!await detachClean(false,{preserveDraft:true})){return false;}
     if(statusGeneration!==generation)return false;
     const current=api.state();
     if(current.busy||current.wordTicket||current.outcomeUnknown||sourceBefore&&current.source===sourceBefore)return false;
     observedIdentity=nextIdentity;
     api.message('文档连接已结束，草稿已保留。');changed();return true;
    }
    if(ticketBefore||sourceIdentity===retiredIdentity){
     if(!await detachClean(false)){return false;}
     if(statusGeneration!==generation)return false;
     const current=api.state();
     if(current.busy||current.wordTicket||current.outcomeUnknown||sourceBefore&&current.source===sourceBefore)return false;
    }
    observedIdentity=nextIdentity;
    if(!target){emptyDocument=null;clearUnavailable();api.empty?.();changed();return true;}
    clearUnavailable();cached=null;changed();
    return requestOpen(null,!!ticketBefore,nextIdentity,!!ticketBefore);
   }
   if(wordDocumentUnavailable&&target?.identity===unavailableIdentity){
    if(state.busy||state.outcomeUnknown||pending||selecting)return false;
    if(dirty(state)){observedIdentity=nextIdentity;return false;}
    const sourceBefore=state.source,ticketBefore=state.wordTicket;
    if(ticketBefore||sourceIdentity===unavailableIdentity){
     if(!await detachClean(false)){return false;}
     if(statusGeneration!==generation)return false;
     const current=api.state();
     if(current.busy||current.wordTicket||current.outcomeUnknown||sourceBefore&&current.source===sourceBefore)return false;
    }
    observedIdentity=nextIdentity;cached=null;clearUnavailable();changed();
    return requestOpen(null,!!ticketBefore,nextIdentity,!!ticketBefore);
   }
   if(!force&&nextIdentity===observedIdentity)return false;
   const oldIdentity=currentIdentity();
   if(force&&dirty(state)){api.message('刷新已跳过：当前公式有未保存更改，草稿已保留。',true);return false;}
   if(state.busy||state.outcomeUnknown||pending||selecting)return false;
   if(nextIdentity===oldIdentity&&!force){observedIdentity=nextIdentity;return false;}
   if(!target){
    if(dirty(state))return false;
    observedIdentity=null;
    const sourceBefore=state.source;
    if(state.wordTicket&&!await detachClean()){observedIdentity=oldIdentity;return false;}
    if(statusGeneration!==generation)return false;
    const current=api.state();
    if(current.wordTicket||current.busy||current.outcomeUnknown){observedIdentity=oldIdentity;return false;}
    if(sourceBefore&&current.source&&current.source!==sourceBefore){observedIdentity=oldIdentity;return false;}
    cached=null;emptyDocument=null;changed();return true;
   }
   if(dirty(state))return false;
   const sourceBefore=state.source,ticketBefore=state.wordTicket;
   observedIdentity=nextIdentity;
   if(force){selecting=true;releaseSelection=true;changed();}
   if(ticketBefore&&!await detachClean(force)){observedIdentity=oldIdentity;return false;}
   if(statusGeneration!==generation)return false;
   const current=api.state();
   if(current.busy||current.wordTicket||current.outcomeUnknown||(!ticketBefore&&dirty(current))){observedIdentity=oldIdentity;return false;}
   if(sourceBefore&&current.source&&current.source!==sourceBefore){observedIdentity=oldIdentity;return false;}
   cached=null;changed();
   return requestOpen(null,!!ticketBefore,nextIdentity,!!ticketBefore);
  })().catch(error=>{api.message('未能检查 Word 当前文档：'+error.message,true);return false;}).finally(()=>{statusFlight=null;if(releaseSelection)selecting=false;if(releaseSelection||activeMetadataChanged)changed();});
  return statusFlight;
 }
 async function refreshCurrent(){
  if(refreshFlight)return refreshFlight;
  refreshFlight=(async()=>{if(statusFlight)await statusFlight;return syncCurrent({force:true});})().finally(()=>{refreshFlight=null;});
  return refreshFlight;
 }
 async function switchToCurrent(){
  const target=active,state=api.state();
  if(!target||(!wordDocumentUnavailable&&target.identity===currentIdentity())||state.busy||state.outcomeUnknown||pending||selecting)return false;
  selecting=true;changed();
  try{
   const answer=await api.native('confirmWordSessionSwitch');if(!answer?.discard)return false;
   const fresh=await api.native('wordWorkspaceStatus');
   if(!fresh?.connected||fresh.active?.identity!==target.identity||fresh.retiredIdentities?.includes(target.identity)){active=fresh?.connected&&fresh.active&&!fresh.retiredIdentities?.includes(fresh.active.identity)?fresh.active:null;api.message('Word 当前文档已切换，请重新选择目标文档。',true);return false;}
   if(Array.isArray(fresh.retiredIdentities))knownRetired=new Set(fresh.retiredIdentities.filter(identity=>typeof identity==='string'));
   const before=api.state();if(before.busy||before.outcomeUnknown||active?.identity!==target.identity)return false;
   if(before.wordTicket&&!await api.detach())return false;
   const after=api.state();if(after.wordTicket||after.busy||after.outcomeUnknown||active?.identity!==target.identity)return false;
   cached=null;observedIdentity=target.identity;changed();
   return await requestOpen(null,true,target.identity);
  }finally{selecting=false;changed();}
 }
 async function chooseDocument(identity){
  const state=api.state(),beforeGeneration=generation;
  if(typeof identity!=='string'||state.busy||state.outcomeUnknown||pending||selecting)return false;
  selecting=true;changed();
  try{
   let status=await readStatus();if(generation!==beforeGeneration)return false;updateCatalog(status);
   let target=documents.find(item=>item.identity===identity);
   if(!connected||!target||target.readOnly){api.message('该 Word 文档已关闭或为只读，请重新选择。',true);return false;}
   if(!wordDocumentUnavailable&&identity===currentIdentity())return true;
   const changedDraft=dirty(api.state());
   if(changedDraft){const answer=await api.native('confirmWordSessionSwitch',{document:true});if(!answer?.discard)return false;}
   if(generation!==beforeGeneration)return false;
   status=await readStatus();if(generation!==beforeGeneration)return false;updateCatalog(status);
   target=documents.find(item=>item.identity===identity);
   if(!connected||!target||target.readOnly){api.message('目标 Word 文档已关闭或不可编辑，草稿已保留。',true);return false;}
   const before=api.state();if(before.busy||before.outcomeUnknown||pending)return false;
   if(before.wordTicket&&!await api.detach())return false;
   if(generation!==beforeGeneration)return false;
   const after=api.state();if(after.wordTicket||after.busy||after.outcomeUnknown)return false;
   emptyDocument=null;observedIdentity=identity;changed();
   return await requestOpen(null,changedDraft||!!before.wordTicket,identity,true,identity);
  }catch(error){api.message('未能切换 Word 文档：'+error.message,true);return false;}
  finally{selecting=false;changed();}
 }
 return {
  remember,
  visibleSource:source=>wordDocumentUnavailable&&(identityOf(source)===unavailableIdentity||identityOf(cached)===unavailableIdentity)?null:source||cached,
  get wordDocumentUnavailable(){return wordDocumentUnavailable;},
  get pending(){return pending!==null||selecting;},
  get hasDocument(){return cached!==null;},
  get openDocuments(){return documents.map(item=>({...item}));},
  get connected(){return connected;},
  get documentIdentity(){return currentIdentity();},
  get documentName(){return wordDocumentUnavailable?unavailableName:emptyDocument?.name|| (active&&active.identity===currentIdentity()?active.name:null);},
  get otherWordDocumentName(){const identity=currentIdentity();return active&&(wordDocumentUnavailable||active.identity!==identity)?active.name:null;},
  syncCurrent,
  refreshCurrent,
  switchToCurrent,
  chooseDocument,
  refreshList,
  cancelPending,
  async resume(wordRunning=true){
   const state=api.state();
   if(pending||selecting)return true;
   if(state.busy||state.wordTicket||state.outcomeUnknown||state.draftChanged)return false;
   if(state.source&&!state.source.wordTicket&&!state.source.insertion)return false;
   if(!wordRunning){await cancelPending();cached=null;active=null;observedIdentity=null;clearUnavailable();changed();return false;}
   const before=generation;
   const status=await api.native('wordWorkspaceStatus').catch(()=>null);
   const current=api.state();
   if(before!==generation||pending||selecting||current.busy||current.wordTicket||current.outcomeUnknown||current.draftChanged||current.source!==state.source)return false;
   if(status?.connected){if(Array.isArray(status.retiredIdentities))knownRetired=new Set(status.retiredIdentities.filter(identity=>typeof identity==='string'));const retired=new Set(knownRetired);const sourceIdentity=identityOf(current.source),cacheIdentity=identityOf(cached),cachedBeforeRetirement=cached,retiredIdentity=sourceIdentity&&retired.has(sourceIdentity)?sourceIdentity:!sourceIdentity&&cacheIdentity&&retired.has(cacheIdentity)?cacheIdentity:null;if(cacheIdentity&&retired.has(cacheIdentity))cached=null;if(retiredIdentity){wordDocumentUnavailable=true;unavailableIdentity=retiredIdentity;unavailableName=String(current.source?.documentName||cachedBeforeRetirement?.documentName||'Word 文档');cached=null;changed();if(current.busy||current.wordTicket||current.outcomeUnknown||current.draftChanged)return false;}if(status.active&&typeof status.active.identity==='string'&&retired.has(status.active.identity)){active=null;observedIdentity=null;changed();return false;}const next=status.active&&typeof status.active.identity==='string'?status.active:null;active=next?{identity:next.identity,name:String(next.name||'Word 文档')}:null;observedIdentity=active?.identity??null;}
   return requestOpen(null,false,status?.connected?active?.identity:null);
  },
  async select(index){
   const state=api.state(),document=state.source||cached,object=document?.objects[index];
   if(wordDocumentUnavailable){api.message('文档连接已结束，无法再选择原文档公式。草稿已保留。',true);return false;}
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
   const identity=identityOf(document);
   if(identity&&await isRetired(identity)){
    if(requestId&&pending===request){pending=null;generation++;changed();}
    throw Error('该 Word 文档连接已结束。草稿仍保留，请重新选择当前文档。');
   }
   if(!request)return false;
   if(!requestId){await cancelPending();return false;}
   if(request.expectedIdentity&&document.documentIdentity!==request.expectedIdentity){await cancelPending();throw Error('Word 当前文档已变化。草稿仍保留，请重新打开目标文档。');}
   const target=request.target,object=document.objects?.[document.activeIndex];
   const same=target&&document.documentIdentity===target.identity&&document.activeIndex===target.index;
   if(target&&(!same||object?.nativeSha256!==target.nativeSha256)){await cancelPending();throw Error('Word 中的公式内容或位置已经变化。草稿仍保留，请重新打开文档后再选。');}
   const approved=request.discardApproved&&(!target||same);
   pending=null;generation++;changed();return !!approved;
  },
  clearUnavailable,
  accepted(document){generation++;emptyDocument=null;const identity=identityOf(document);if(identity)knownRetired.delete(identity);wordDocumentUnavailable=false;unavailableIdentity=null;unavailableName='';remember(document);observedIdentity=identity;active=identity?{identity,name:document.documentName||'Word 文档'}:active;changed();}
 };
};
