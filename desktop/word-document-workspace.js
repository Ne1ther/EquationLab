// Document thumbnails outlive an edit ticket. They never authorize a write:
// reopening requires a fresh, Word-owned document capture and OLE session.
window.createWordDocumentWorkspace = api => {
 let cached=null,pending=null,generation=0,selecting=false,statusFlight=null,refreshFlight=null,observedIdentity=undefined,active=null,wordDocumentUnavailable=false,unavailableIdentity=null,unavailableName='',knownRetired=new Set();
 let documents=[],connected=false,insertionSupported=false,metadataFlight=null,emptyDocument=null,preparedInsertionDraft=null,awaitingPublishedIdentity=null;
 let displayedDuringLoad=null,catalogueDuringDetach=null;
 let failedDocumentIdentity=null,autoRecovery=null,lastStatusError=null,localNumberingSave=null;
 const AUTO_RECOVERY_MAX_ATTEMPTS=3,AUTO_RECOVERY_BACKOFF_MS=[4000,10000,20000];
 const NUMBERING_READBACK_GRACE_MS=15000;
 const changed=()=>api.changed();
 const readStatus=()=>metadataFlight??(metadataFlight=api.native('wordWorkspaceStatus').then(status=>{lastStatusError=null;return status;}).finally(()=>{metadataFlight=null;}));
 function reportStatusError(prefix,error,force=false){
  const text=prefix+error.message;
  if(force||lastStatusError!==text){lastStatusError=text;api.message(text,true);}
 }
 function clearAutoRecovery(){autoRecovery=null;}
 function armAutoRecovery(identity,attempts=0,lastMessage=null){
  const state=api.state();
  if(!identity||wordDocumentUnavailable||knownRetired.has(identity)||state.wordTicket||state.source||state.outcomeUnknown||dirty(state)){autoRecovery=null;return;}
  if(attempts>=AUTO_RECOVERY_MAX_ATTEMPTS){autoRecovery={identity,attempts,nextRetryAt:Infinity,lastMessage};return;}
  const delay=AUTO_RECOVERY_BACKOFF_MS[Math.min(attempts,AUTO_RECOVERY_BACKOFF_MS.length-1)];
  autoRecovery={identity,attempts,nextRetryAt:api.now()+delay,lastMessage};
 }
 function updateCatalog(status){
  const nextConnected=status?.connected===true;
  const seen=new Set();
  const next=nextConnected&&Array.isArray(status.documents)?status.documents.slice(0,128).filter(item=>{
   if(!item||typeof item.identity!=='string'||typeof item.name!=='string'||seen.has(item.identity)||status.retiredIdentities?.includes(item.identity))return false;
   seen.add(item.identity);return true;
  }).map(({identity,name,readOnly,numberFormat,numberingRevision})=>({identity,name,readOnly:readOnly===true,...typeof numberFormat==='string'?{numberFormat}:{},...Number.isSafeInteger(numberingRevision)?{numberingRevision}:{}})):[];
  if(nextConnected)api.numberingMetadata?.(next);
  const cachedMetadata=next.find(item=>item.identity===cached?.documentIdentity);
  const savedMetadata=next.find(item=>item.identity===localNumberingSave?.identity);
  if(Number.isSafeInteger(savedMetadata?.numberingRevision)&&!localNumberingSave.revisions.includes(savedMetadata.numberingRevision))localNumberingSave=null;
  let cachedChanged=false;
  if(Number.isSafeInteger(cachedMetadata?.numberingRevision)&&Number.isSafeInteger(cached?.documentNumberingRevision)){
   const observed=cachedMetadata.numberingRevision;
   const matches=observed===cached.documentNumberingRevision||observed===cached.formatSaveRevision;
   if(cached.formatSaveRevision!==null&&!matches){
    cached.formatSaveRevision=null;
    cached.confirmedNumberingChange=true;
   }
   const stale=cached.numberingReadbackPending||cached.confirmedNumberingChange||!matches;
   if(stale)cached.confirmedContentSaveIndex=null;
   if(stale!==cached.numberingRefreshNeeded){cached.numberingRefreshNeeded=stale;cachedChanged=true;}
  }
  const nextInsertionSupported=nextConnected&&status.insertionRequestSupport===true;
  if(!cachedChanged&&connected===nextConnected&&insertionSupported===nextInsertionSupported&&JSON.stringify(documents)===JSON.stringify(next))return;
  connected=nextConnected;insertionSupported=nextInsertionSupported;documents=next;changed();
 }
 async function refreshList(){
  const before=generation;
  try{
   const status=await readStatus();if(before!==generation)return false;const unconfirmed=awaitingPublication(status);updateCatalog(status);
   if(status?.connected===true&&Array.isArray(status.retiredIdentities)){
    knownRetired=new Set(status.retiredIdentities.filter(identity=>typeof identity==='string'&&(!unconfirmed||identity!==awaitingPublishedIdentity)));
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
  catch(error){reportStatusError('未能读取 Word 文档列表：',error,false);return false;}
 }
 const validTarget=target=>target&&typeof target.identity==='string'&&target.identity.length>0&&target.snapshot!=null&&Number.isInteger(target.index)&&/^[a-f0-9]{64}$/.test(target.nativeSha256||'');
 const nextNumberingRevision=revision=>revision===2147483646?1:revision+1;
 const snapshotForRow=(document,index)=>document.formatSaveRevision!=null&&document.formatSaveIndex===index?document.formatSaveSnapshot:document.documentSnapshot;
 const cachedNumberingRevision=()=>cached?.formatSaveRevision??cached?.documentNumberingRevision;
 function matchesCachedNumbering(document){
  if(!cached||cached.numberingRefreshNeeded||document.numberingRefreshNeeded||cached.documentIdentity!==document.documentIdentity||
   document.documentTotal!==cached.objects.length||!Number.isSafeInteger(document.documentNumberingRevision)||
   document.documentNumberingRevision!==cachedNumberingRevision())return false;
  const owner=document.objects?.[document.activeIndex],row=cached.objects[document.documentPosition];
  return /^[a-f0-9]{64}$/.test(owner?.nativeSha256??'')&&owner.nativeSha256===row?.nativeSha256;
 }
 function restoreSavedNumberingLayout(document){
  const index=document.documentPosition;
  if(!document.documentLoading||document.insertion||!document.wordNumberingSupported||!cached||
   document.documentIdentity!==cached.documentIdentity||cached.formatSaveIndex!==index||
   cached.formatSaveRevision==null||cached.formatSaveRevision!==document.documentNumberingRevision||
   document.documentTotal!==cached.objects.length)return;
  const object=document.objects?.[document.activeIndex],previous=cached.objects[index];
  if(!previous?.layout||!/^[a-f0-9]{64}$/.test(object?.nativeSha256??'')||object.nativeSha256!==previous.nativeSha256)return;
  // An exact owner match also covers reopening directly from Word or Dock.
  document.savedNumberingLayout={...previous.layout};
  document.savedNumberingSnapshot=cached.formatSaveSnapshot;
  document.savedNumberingLocal=!cached.numberingRefreshNeeded;
  object.layout=document.savedNumberingLayout;
 }
 const NUMBERING_FIELDS=['mode','chapter','section','equation','numberFormat','numberText'];
 function trackLocalNumberingSave(document,index,previous,change,numbering,count){
  if(previous.numberFormat===numbering.format&&previous.numberText===numbering.previewText){localNumberingSave=null;return;}
  localNumberingSave={identity:document.documentIdentity,index,nativeSha256:change.nativeSha256,count,
   revisions:[document.documentNumberingRevision,nextNumberingRevision(document.documentNumberingRevision)],
   before:{...previous},after:{numberFormat:numbering.format,numberText:numbering.previewText},expiresAt:api.now()+NUMBERING_READBACK_GRACE_MS};
 }
 function reconcileNumberingReadback(document){
  const save=localNumberingSave;
  if(!save||document.documentLoading||document.documentLoadFailed)return;
  if(document.numberingReadbackPending)return;
  const row=document.objects?.[save.index],layout=row?.layout;
  if(api.now()>=save.expiresAt||document.insertion||document.documentIdentity!==save.identity||
   document.objects?.length!==save.count||row?.nativeSha256!==save.nativeSha256||
   !save.revisions.includes(document.documentNumberingRevision)||
   Number.isSafeInteger(document.liveNumberingRevision)&&!save.revisions.includes(document.liveNumberingRevision)||
   !layout||!NUMBERING_FIELDS.every(key=>layout[key]===save.before[key])){
   localNumberingSave=null;
   return;
  }
  // Word can report the new revision before its saved file is replaced. Keep
  // the acknowledged row visible while the bounded refresh verifies the file.
  row.layout={...layout,...save.after};
  document.numberingReadbackPending=true;
  document.numberingRefreshNeeded=true;
 }
 const clearUnavailable=()=>{if(!wordDocumentUnavailable&&!unavailableIdentity&&!unavailableName)return false;wordDocumentUnavailable=false;unavailableIdentity=null;unavailableName='';changed();return true;};
 const remember=(document,confirmedContentSaveIndex=null,formatSaveRevision=null,formatSaveIndex=null,formatSaveSnapshot=document?.documentSnapshot,hasUnconfirmedSave=false)=>{
  if(!document?.hasDocumentContext||!document.documentIdentity||document.documentLoading||document.documentLoadFailed)return;
  if(knownRetired.has(document.documentIdentity)||wordDocumentUnavailable&&document.documentIdentity===unavailableIdentity)return;
  if(cached?.documentIdentity===document.documentIdentity&&cached.documentSnapshot!==document.documentSnapshot){
   // A fresh capture often has only the owner preview. Reuse images for
   // byte-identical formulas so completing the capture does not blank them.
   const images=new Map(cached.objects.filter(object=>object.nativeSha256&&object.image&&!object.error).map(object=>[object.nativeSha256,object.image]));
   for(const object of document.objects){
    if(!object.image&&!object.error&&images.has(object.nativeSha256))object.image=images.get(object.nativeSha256);
   }
  }
  cached={documentName:document.documentName,documentIdentity:document.documentIdentity,documentSnapshot:document.documentSnapshot,documentNumberingRevision:document.documentNumberingRevision,numberingRefreshNeeded:!!document.numberingRefreshNeeded,numberingReadbackPending:!!document.numberingReadbackPending,confirmedNumberingChange:!!document.confirmedNumberingChange,confirmedContentSaveIndex,formatSaveRevision,formatSaveIndex,formatSaveSnapshot,hasUnconfirmedSave:!!hasUnconfirmedSave,hasDocumentContext:true,objects:document.objects.map(object=>({...object}))};
 };
 function rememberAfterCancel(document){
  if(!document?.hasDocumentContext||document.insertion||knownRetired.has(document.documentIdentity))return;
  if(document.documentLoading||document.documentLoadFailed){
   if(!matchesCachedNumbering(document))return;
  }else{
   remember(document);
   if(cached?.documentSnapshot!==document.documentSnapshot||cached?.documentIdentity!==document.documentIdentity)return;
  }
  cached.cancelledEdit=true;
 }
 function rememberScopedNumbering(document,change,numbering){
  const index=document.documentPosition,revision=document.documentNumberingRevision,layout=document.savedNumberingLayout;
  const previous=cached.objects[index],owner=document.objects[document.activeIndex],observed=document.liveNumberingRevision;
  if(document.insertion||document.wordNumberingExistingSupported!==true||!layout||!previous||!owner||
   cached.objects.length!==document.documentTotal||cached.formatSaveIndex!==index||cached.formatSaveSnapshot!==document.savedNumberingSnapshot||
   previous.layout?.mode!==layout.mode||previous.layout?.numberFormat!==layout.numberFormat||
   layout.mode!=='numbered-'+numbering?.side||typeof numbering?.format!=='string'||numbering.context||
   !Number.isSafeInteger(revision)||revision<0||revision>2147483646||numbering.existingRevision!==revision||
   Number.isSafeInteger(observed)&&observed!==revision&&observed!==nextNumberingRevision(revision)||
   !change||change.numberingChanged!==true||change.documentIdentity!==document.documentIdentity||
   change.documentSnapshot!==document.documentSnapshot||change.documentSnapshot==null||change.index!==index||
   !/^[a-f0-9]{64}$/.test(owner.nativeSha256??'')||previous.nativeSha256!==owner.nativeSha256||
   change.previousNativeSha256!==owner.nativeSha256||change.nativeSha256!==owner.nativeSha256)return false;
  const objects=cached.objects.slice();
  objects[index]={...previous,layout:{...layout,numberFormat:numbering.format,numberText:numbering.previewText??null}};
  // Bind only the confirmed row to the scoped snapshot. Other cached rows
  // retain their full snapshot and still require a fresh capture to edit.
  const stale=!document.savedNumberingLocal||typeof numbering.previewText!=='string'||!numbering.previewText;
  if(!stale&&change.numberingLocal===true)trackLocalNumberingSave(document,index,layout,change,numbering,cached.objects.length);
  remember({...cached,objects,documentNumberingRevision:revision,confirmedNumberingChange:!!stale,numberingRefreshNeeded:!!stale},
   null,nextNumberingRevision(revision),index,change.documentSnapshot);
  return true;
 }
 function rememberAfterSave(document,index,change,latex,numbering){
  if(!document?.hasDocumentContext||!document.documentIdentity)return;
  const insertion=!!document.insertion;
  const originalNumberingChanged=change?.numberingChanged===true;
  if(document.documentLoading||document.documentLoadFailed){
   if(cached?.documentIdentity!==document.documentIdentity)return;
   if(rememberScopedNumbering(document,change,numbering))return;
   // No current full snapshot can bind this row. Keep the old context visible
   // but prevent its stale row from being sent as a verified target.
   const partial=document,partialIndex=partial.documentPosition;
   const previous=insertion?null:Number.isInteger(partialIndex)?cached.objects[partialIndex]:null;
   const objects=cached.objects.slice();
   if(previous)objects[partialIndex]={...previous,nativeSha256:null,latex:previous.latex,image:null};
   const matchesRevision=rev=>Number.isSafeInteger(rev)&&(rev===cached.documentNumberingRevision||cached.formatSaveRevision!==null&&rev===cached.formatSaveRevision);
   const partialOwner=partial.objects?.[partial.activeIndex];
   const ownerMatches=!!(previous&&/^[a-f0-9]{64}$/.test(partialOwner?.nativeSha256??'')&&partialOwner.nativeSha256===previous.nativeSha256);
   const revisionDiverged=Number.isSafeInteger(partial.documentNumberingRevision)&&!matchesRevision(partial.documentNumberingRevision)
    ||Number.isSafeInteger(partial.liveNumberingRevision)&&!matchesRevision(partial.liveNumberingRevision);
   const preserveConfirmedNumbering=!insertion&&!numbering&&!originalNumberingChanged
    &&!cached.numberingRefreshNeeded&&!cached.confirmedNumberingChange
    &&!partial.numberingRefreshNeeded&&!partial.confirmedNumberingChange
    &&partial.documentTotal===cached.objects.length&&ownerMatches
    &&matchesRevision(partial.documentNumberingRevision)&&!revisionDiverged;
   const confirmedNumberingChange=!!(cached.confirmedNumberingChange||partial.confirmedNumberingChange||insertion||numbering||originalNumberingChanged||revisionDiverged);
   const numberingRefreshNeeded=!preserveConfirmedNumbering||confirmedNumberingChange;
   const formatSaveRevision=preserveConfirmedNumbering?cached.formatSaveRevision:null;
   const keepFormatBinding=formatSaveRevision!==null&&cached.formatSaveIndex!==partialIndex;
   const formatSaveIndex=keepFormatBinding?cached.formatSaveIndex:null;
   const formatSaveSnapshot=keepFormatBinding?cached.formatSaveSnapshot:cached.documentSnapshot;
   remember({...cached,objects,confirmedNumberingChange,numberingRefreshNeeded},null,formatSaveRevision,formatSaveIndex,formatSaveSnapshot,true);
   return;
  }
  if(insertion)index=undefined;
  const previous=document.objects[index];
  const confirmed=previous&&change?.documentIdentity===document.documentIdentity&&change.documentSnapshot===document.documentSnapshot&&change.index===index&&change.previousNativeSha256===previous.nativeSha256&&validTarget({identity:change.documentIdentity,snapshot:change.documentSnapshot,index,nativeSha256:change.nativeSha256});
  const objects=document.objects.slice();
  const revision=document.documentNumberingRevision;
  const publishedLocalSave=change?.numberingLocal===true&&Number.isSafeInteger(revision)&&
   numbering?.verifiedStartRevision===revision&&document.liveNumberingRevision===nextNumberingRevision(revision);
  const formatOnly=confirmed&&change.numberingChanged===true&&(!document.numberingRefreshNeeded||publishedLocalSave)
   &&typeof numbering?.format==='string'&&!numbering.context&&previous.layout?.numberText
   &&previous.layout.mode==='numbered-'+numbering.side&&Number.isSafeInteger(revision);
  if(previous&&(!confirmed||previous.nativeSha256!==change.nativeSha256)){
   objects[index]={...previous,nativeSha256:confirmed?change.nativeSha256:null,latex:confirmed?latex:previous.latex,image:null};
  }
  if(formatOnly)objects[index]={...objects[index],layout:{
   ...previous.layout,numberFormat:numbering.format,numberText:numbering.previewText??null
  }};
  // Only Word can confirm that no other numbering fields were rebuilt.
  const localNumbering=formatOnly&&change.numberingLocal===true&&typeof numbering.previewText==='string'&&!!numbering.previewText;
  if(localNumbering)trackLocalNumberingSave(document,index,previous.layout,change,numbering,objects.length);
  const confirmedNumberingChange=!!(document.confirmedNumberingChange||insertion||!localNumbering&&(numbering||change?.numberingChanged));
  const numberingRefreshNeeded=!!document.numberingRefreshNeeded&&!localNumbering||confirmedNumberingChange;
  const confirmedContentSave=!!confirmed&&index>=0&&previous.index===index&&/^[a-f0-9]{64}$/.test(previous.nativeSha256||'')
   &&change.numberingChanged===false&&!numberingRefreshNeeded&&Number.isSafeInteger(document.documentNumberingRevision);
  // Word advances this revision once per confirmed numbering transaction.
  // The previous publication can still be in flight when Dock reveals us.
  const formatSaveRevision=formatOnly?nextNumberingRevision(revision):null;
  remember({...document,objects,confirmedNumberingChange,numberingRefreshNeeded},confirmedContentSave?index:null,formatSaveRevision,formatOnly?index:null,document.documentSnapshot,!confirmed);
 }
 async function cancelPending(){
  const old=pending;pending=null;preparedInsertionDraft=null;clearAutoRecovery();generation++;changed();
  if(old?.requestId)void api.native('wordDocumentCancel',{requestId:old.requestId}).catch(()=>{});
 }
 function failure(request,text,{allowRecovery=true}={}){
  if(pending!==request)return;
  if(request.requestId)void api.native('wordDocumentCancel',{requestId:request.requestId}).catch(()=>{});
  if(!request.insertion&&!request.target&&!request.catalogTarget)failedDocumentIdentity=request.expectedIdentity??active?.identity??null;
  const suppressMessage=!!(allowRecovery&&request.autoRefresh&&request.lastMessage===text);
  pending=null;
  if(allowRecovery&&request.autoRefresh&&request.expectedIdentity)armAutoRecovery(request.expectedIdentity,request.recoveryAttempt??0,text);
  else clearAutoRecovery();
  changed();
  if(!suppressMessage)api.message(text,true);
 }
 function canRetrySavedTarget(target){
  const state=api.state(),entry=documents.find(item=>item.identity===target.identity);
  return !state.source&&!state.wordTicket&&!state.busy&&!state.outcomeUnknown&&!state.draftChanged
   &&connected&&!wordDocumentUnavailable&&!knownRetired.has(target.identity)
   &&active?.identity===target.identity&&entry?.readOnly===false
   &&cached?.documentIdentity===target.identity&&cached.documentSnapshot===target.snapshot
   &&!cached.numberingRefreshNeeded&&entry.numberingRevision===cached.documentNumberingRevision
   &&cached.objects[target.index]?.nativeSha256===target.nativeSha256;
 }
 async function fallbackToVerifiedDocument(request,identity){
  const before=api.state();
  if(pending!==request||request.generation!==generation)return 'handled';
  if(!identity||selecting||wordDocumentUnavailable||knownRetired.has(identity)
   ||before.source||before.wordTicket||before.busy||before.outcomeUnknown||dirty(before))return 'stop';
  let fresh;
  try{fresh=await readStatus();}catch{return 'retry';}
  if(pending!==request||request.generation!==generation)return 'handled';
  updateCatalog(fresh);
  if(fresh?.connected===true&&Array.isArray(fresh.retiredIdentities)){
   knownRetired=new Set(fresh.retiredIdentities.filter(item=>typeof item==='string'));
  }
  const current=api.state(),entry=documents.find(item=>item.identity===identity);
  if(!fresh?.connected)return 'retry';
  if(fresh.active?.identity!==identity||fresh.retiredIdentities?.includes(identity)||knownRetired.has(identity)
   ||entry?.readOnly!==false||selecting||wordDocumentUnavailable
   ||current.source||current.wordTicket||current.busy||current.outcomeUnknown||dirty(current)){
   clearAutoRecovery();
   return 'stop';
  }
  await requestOpen(null,request.discardApproved,identity,true,identity,null,false,null,{
   autoRefresh:request.autoRefresh,fallbackDocument:false,recoveryAttempt:request.recoveryAttempt??0,lastMessage:request.lastMessage??null
  });
  return 'handled';
 }
 async function monitor(request){
  // Match the host's bounded request lifetime. Large WordOpenXML captures
  // and the first document parse can legitimately take more than 25 seconds.
  const deadline=api.now()+60000;
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
      if(!fresh?.connected||!matches||fresh.retiredIdentities?.includes(request.expectedIdentity)){failure(request,'Word 当前文档已变化。草稿仍保留，请重新选择目标文档。',{allowRecovery:false});return;}
      emptyDocument=result.state==='empty'?(request.documentIdentity?documents.find(item=>item.identity===request.documentIdentity):fresh.active):null;
     }else emptyDocument=null;
     if(request.discardApproved&&!request.clearOnEmpty){observedIdentity=identityOf(cached);failure(request,'Word 当前文档没有可编辑公式。当前草稿仍保留。',{allowRecovery:false});return;}
     clearAutoRecovery();cached=null;pending=null;if(!dirty(api.state()))clearUnavailable();if(request.clearOnEmpty&&!dirty(api.state()))api.empty?.();changed();api.message(result.state==='empty'?'Word 当前文档中还没有 MathType 公式。':'请先打开 Word 文档。');return;
    }
    if(['failed','cancelled','superseded','expired'].includes(result.state)){
     const target=request.target;
     if(result.state==='failed'&&request.retrySavedTarget&&!result.reason&&request.generation===generation
      &&result.requestId===request.requestId&&result.identity===target.identity&&result.index===target.index
      &&(result.documentIdentity===undefined||result.documentIdentity===target.identity)&&canRetrySavedTarget(target)){
      // Word can retire a retained range when it replaces the saved OLE.
      // Keep the original row target for prepareIncoming to check again.
      await requestOpen(target,request.discardApproved,target.identity,false,target.identity);return;
     }
     let fallbackOutcome=null;
     if(result.state==='failed'&&request.fallbackDocument&&!result.reason&&target&&request.generation===generation
      &&result.requestId===request.requestId
      &&(result.identity===undefined||result.identity===target.identity)
      &&(result.index===undefined||result.index===target.index)
      &&(result.documentIdentity===undefined||result.documentIdentity===target.identity)){
      // An automatic refresh whose old ordinal expired falls back once to
      // refreshing the same verified active document rather than stranding stale rows.
      fallbackOutcome=await fallbackToVerifiedDocument(request,target.identity);
      if(fallbackOutcome==='handled')return;
     }
     const allowRecovery=fallbackOutcome!=='stop'&&!['cancelled','superseded'].includes(result.state)&&!['document-process-mismatch','invalid-document-identity'].includes(result.reason);
     failure(request,'未能打开 Word 公式。草稿仍保留；'+(result.reason||'请重新选择目标公式。'),{allowRecovery});return;
    }
   }catch(error){failure(request,'未能读取 Word 文档：'+error.message);return;}
   await api.pause(300);
  }
 }
 async function requestOpen(target=null,discardApproved=false,expectedIdentity=null,clearOnEmpty=false,documentIdentity=null,insertion=null,retrySavedTarget=false,catalogTarget=null,{autoRefresh=false,fallbackDocument=false,recoveryAttempt=0,lastMessage=null}={}){
  const nextGeneration=generation+1;
  await cancelPending();
  if(target&&documentIdentity&&(generation!==nextGeneration||pending||!canRetrySavedTarget(target)))return false;
  if(!insertion&&!target&&!catalogTarget)failedDocumentIdentity=null;
  let ready;const request={generation,requestId:null,target,discardApproved,expectedIdentity,clearOnEmpty,documentIdentity,insertion,retrySavedTarget,catalogTarget,catalogue:catalogTarget?catalogueDuringDetach:null,autoRefresh,fallbackDocument,recoveryAttempt,lastMessage,ready:new Promise(resolve=>{ready=resolve;})};pending=request;changed();
  if(!(autoRefresh&&recoveryAttempt>0))api.message(insertion?'正在准备 Word 插入位置…':catalogTarget?'正在读取选中的公式…':'正在读取 Word 文档…');
  try{
   const destination=catalogTarget?{catalogTarget}:documentIdentity?{documentIdentity}:target?{target}:{};
   const result=await api.native('wordDocumentOpen',{...destination,...insertion?{insertionMode:insertion.mode}:{}});
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
 function visibleSource(source){
  const transitioningCatalogue=pending?.catalogue||catalogueDuringDetach;
  if(wordDocumentUnavailable&&(identityOf(source)===unavailableIdentity||identityOf(cached)===unavailableIdentity||identityOf(transitioningCatalogue)===unavailableIdentity))return null;
  if(source?.catalogProof&&(identityOf(source)!==identityOf(cached)||source.documentTotal!==cached?.objects.length))return source;
  if(!source&&transitioningCatalogue)return transitioningCatalogue;
  const waitingOnCachedDocument=!source&&pending?.expectedIdentity&&pending.expectedIdentity===identityOf(cached);
  const loadingSameDocument=(source?.documentLoading||source?.documentLoadFailed)&&identityOf(source)===identityOf(cached);
  if(cached?.objects.length&&(waitingOnCachedDocument||loadingSameDocument)){
   const total=source?.documentTotal??cached.objects.length,failed=!!source?.documentLoadFailed;
   const projected=source?matchesCachedNumbering(source):!cached.numberingRefreshNeeded&&
    documents.some(doc=>doc.identity===cached.documentIdentity&&Number.isSafeInteger(doc.numberingRevision)&&doc.numberingRevision===cachedNumberingRevision());
   const stale=!projected;
   if(!displayedDuringLoad||displayedDuringLoad.objects!==cached.objects||displayedDuringLoad.documentTotal!==total||displayedDuringLoad.documentLoadFailed!==failed||displayedDuringLoad.numberingRefreshNeeded!==stale){
    displayedDuringLoad={...cached,documentTotal:total,documentLoading:!failed,documentLoadFailed:failed,numberingRefreshNeeded:stale};
   }
   return displayedDuringLoad;
  }
  displayedDuringLoad=null;
  return source||cached;
 }
 // A delivered OLE capture can precede the host's next workspace publication.
 // An older active/retired snapshot cannot revoke that newly accepted session.
 function awaitingPublication(status){
  if(!awaitingPublishedIdentity)return false;
  const state=api.state();
  if(!state.wordTicket||identityOf(state.source)!==awaitingPublishedIdentity){awaitingPublishedIdentity=null;return false;}
  if(!status?.connected||status.active?.identity!==awaitingPublishedIdentity||status.retiredIdentities?.includes(awaitingPublishedIdentity))return true;
  awaitingPublishedIdentity=null;return false;
 }
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
   const unconfirmed=awaitingPublication(status);
   if(Array.isArray(status.retiredIdentities))knownRetired=new Set(status.retiredIdentities.filter(identity=>typeof identity==='string'&&(!unconfirmed||identity!==awaitingPublishedIdentity)));
   const retired=new Set(knownRetired);
   const rawTarget=status.active&&typeof status.active.identity==='string'?status.active:null;
   const target=rawTarget&&!retired.has(rawTarget.identity)?rawTarget:null;
   const nextIdentity=target?.identity??null;
   activeMetadataChanged=active?.identity!==target?.identity||active?.name!==target?.name;
   active=target?{identity:target.identity,name:String(target.name||'Word 文档')}:null;
   if(unconfirmed&&!force)return false;
   const state=api.state(),sourceIdentity=identityOf(state.source),cacheIdentity=identityOf(cached),cachedBeforeRetirement=cached;
   // Direct OLE editing can retain an exact live owner without a document
   // snapshot. Metadata polling must not cancel it to open another equation.
   if(!force&&state.wordTicket&&state.source&&!state.source.hasDocumentContext)return false;
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
   if(autoRecovery){
    if(state.wordTicket||state.source||dirty(state)||wordDocumentUnavailable||knownRetired.has(autoRecovery.identity)||!target||target.identity!==autoRecovery.identity){
     clearAutoRecovery();
    }else if(!force&&!state.busy&&!state.outcomeUnknown&&!pending&&!selecting&&autoRecovery.attempts<AUTO_RECOVERY_MAX_ATTEMPTS&&api.now()>=autoRecovery.nextRetryAt){
     const entry=documents.find(item=>item.identity===autoRecovery.identity);
     if(entry?.readOnly===false){
      const nextAttempt=autoRecovery.attempts+1,priorMessage=autoRecovery.lastMessage,identity=autoRecovery.identity;
      observedIdentity=identity;
      return requestOpen(null,true,identity,true,identity,null,false,null,{autoRefresh:true,fallbackDocument:false,recoveryAttempt:nextAttempt,lastMessage:priorMessage});
     }
    }
   }
   if(!force&&nextIdentity===observedIdentity&&!wordDocumentUnavailable)return false;
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
    cached=null;emptyDocument=null;clearUnavailable();api.empty?.();changed();return true;
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
   if(identityOf(cached)!==nextIdentity)cached=null;
   changed();
   return requestOpen(null,!!ticketBefore,nextIdentity,!!ticketBefore);
  })().catch(error=>{reportStatusError('未能检查 Word 当前文档：',error,force);return false;}).finally(()=>{statusFlight=null;if(releaseSelection)selecting=false;if(releaseSelection||activeMetadataChanged)changed();});
  return statusFlight;
 }
 async function refreshCurrent(){
  clearAutoRecovery();
  if(refreshFlight)return refreshFlight;
  refreshFlight=(async()=>{if(statusFlight)await statusFlight;return syncCurrent({force:true});})().finally(()=>{refreshFlight=null;});
  return refreshFlight;
 }
 async function switchToCurrent(){
  const target=active,state=api.state(),beforeGeneration=generation;
  if(!target||(!wordDocumentUnavailable&&target.identity===currentIdentity())||state.busy||state.outcomeUnknown||pending||selecting)return false;
  clearAutoRecovery();
  selecting=true;changed();
  try{
   const answer=await api.native('confirmWordSessionSwitch');if(!answer?.discard)return false;
   if(generation!==beforeGeneration)return false;
   const fresh=await api.native('wordWorkspaceStatus');
   if(generation!==beforeGeneration)return false;
   if(!fresh?.connected||fresh.active?.identity!==target.identity||fresh.retiredIdentities?.includes(target.identity)){active=fresh?.connected&&fresh.active&&!fresh.retiredIdentities?.includes(fresh.active.identity)?fresh.active:null;api.message('Word 当前文档已切换，请重新选择目标文档。',true);return false;}
   if(Array.isArray(fresh.retiredIdentities))knownRetired=new Set(fresh.retiredIdentities.filter(identity=>typeof identity==='string'));
   const before=api.state();if(before.busy||before.outcomeUnknown||active?.identity!==target.identity)return false;
   if(before.wordTicket&&!await api.detach())return false;
   if(generation!==beforeGeneration)return false;
   const after=api.state();if(after.wordTicket||after.busy||after.outcomeUnknown||active?.identity!==target.identity)return false;
   cached=null;observedIdentity=target.identity;changed();
   return await requestOpen(null,true,target.identity);
  }finally{selecting=false;changed();}
 }
 async function chooseDocument(identity){
  const state=api.state(),beforeGeneration=generation;
  if(typeof identity!=='string'||state.busy||state.outcomeUnknown||pending||selecting)return false;
  clearAutoRecovery();
  selecting=true;changed();
  try{
   let status=await readStatus();if(generation!==beforeGeneration)return false;updateCatalog(status);
   let target=documents.find(item=>item.identity===identity);
   if(!connected||!target||target.readOnly){api.message('该 Word 文档已关闭或为只读，请重新选择。',true);return false;}
   if(!wordDocumentUnavailable&&identity===currentIdentity()&&identity!==failedDocumentIdentity)return true;
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
 async function insert(mode){
  const before=api.state(),identity=currentIdentity(),beforeGeneration=generation;
  if(!['inline','display','numbered-left','numbered-right'].includes(mode)||!identity||before.busy||before.outcomeUnknown||before.source?.insertion||pending||selecting)return false;
  clearAutoRecovery();
  selecting=true;changed();
  try{
   const status=await readStatus();if(generation!==beforeGeneration)return false;updateCatalog(status);
   if(!insertionSupported)throw Error('请先更新 Word 插件并重新打开 Word，再从 App 插入。');
   if(!connected||!documents.some(doc=>doc.identity===identity&&!doc.readOnly)||status.retiredIdentities?.includes(identity))throw Error('目标 Word 文档已关闭或不可编辑。');
   const index=before.selectedIndex??before.source?.activeIndex;
   const object=before.wordTicket&&before.source?.hasDocumentContext?before.source.objects?.[index]:null;
   const target=object?{identity,snapshot:before.source.documentSnapshot,index:before.source.documentPosition??index,nativeSha256:object.nativeSha256}:null;
   if(before.wordTicket&&!validTarget(target))throw Error('当前公式位置尚未就绪，请等待文档加载完成。');
   let draft=null;
   if(before.wordTicket&&dirty(before)){
    const answer=await api.native('confirmWordSessionSwitch',{newFormula:true});if(!answer?.discard)return false;
   }else if(!before.wordTicket)draft=api.captureInsertionDraft?.()??null;
   let current=api.state();
   if(generation!==beforeGeneration||current.wordTicket!==before.wordTicket||current.source!==before.source||current.busy||current.outcomeUnknown)return false;
   if(current.wordTicket&&!await api.detach({preserveDraft:true}))return false;
   current=api.state();
   if(generation!==beforeGeneration||current.wordTicket||current.busy||current.outcomeUnknown)return false;
   return await requestOpen(target,true,identity,false,target?null:identity,{mode,draft});
  }catch(error){api.message('未能准备 Word 插入：'+error.message+' 草稿仍保留。',true);return false;}
  finally{selecting=false;changed();}
 }
 return {
  remember,
  reconcileNumberingReadback,
  rememberAfterCancel,
  rememberAfterSave,
  visibleSource,
  get wordDocumentUnavailable(){return wordDocumentUnavailable;},
  get pending(){return pending!==null||selecting;},
  get hasDocument(){return cached!==null;},
  get openDocuments(){return documents.map(item=>({...item}));},
  get connected(){return connected;},
  get insertionSupported(){return insertionSupported;},
  get documentIdentity(){return currentIdentity();},
  get documentReadState(){
   if(pending&&!pending.insertion&&!pending.target&&!pending.catalogTarget)return 'loading';
   const identity=currentIdentity();
   if(!identity||wordDocumentUnavailable||knownRetired.has(identity))return null;
   if(identity===failedDocumentIdentity)return 'failed';
   return emptyDocument?.identity===identity?'empty':null;
  },
  get documentName(){
   const identity=currentIdentity();
   if(wordDocumentUnavailable)return unavailableName;
   if(emptyDocument?.identity===identity)return emptyDocument.name;
   if(active?.identity===identity)return active.name;
   return documents.find(document=>document.identity===identity)?.name??null;
  },
  get otherWordDocumentName(){const identity=currentIdentity();return active&&(wordDocumentUnavailable||active.identity!==identity)?active.name:null;},
  syncCurrent,
  refreshCurrent,
  retryRead(){return failedDocumentIdentity&&failedDocumentIdentity===currentIdentity()?chooseDocument(failedDocumentIdentity):refreshCurrent();},
  switchToCurrent,
  chooseDocument,
  insert,
  takeInsertionDraft(requestId){const entry=preparedInsertionDraft;preparedInsertionDraft=null;return entry?.requestId===requestId?entry.draft:null;},
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
   if(cached)cached.warmDockVerified=false;
   if(status?.connected){
    if(Array.isArray(status.retiredIdentities))knownRetired=new Set(status.retiredIdentities.filter(identity=>typeof identity==='string'));
    const sourceIdentity=identityOf(current.source),cacheIdentity=identityOf(cached),cachedBeforeRetirement=cached;
    const retiredIdentity=sourceIdentity&&knownRetired.has(sourceIdentity)?sourceIdentity:!sourceIdentity&&cacheIdentity&&knownRetired.has(cacheIdentity)?cacheIdentity:null;
    if(cacheIdentity&&knownRetired.has(cacheIdentity))cached=null;
    if(retiredIdentity){
     wordDocumentUnavailable=true;unavailableIdentity=retiredIdentity;
     unavailableName=String(current.source?.documentName||cachedBeforeRetirement?.documentName||'Word 文档');
     cached=null;changed();
     if(current.busy||current.wordTicket||current.outcomeUnknown||current.draftChanged)return false;
    }
    const next=status.active&&typeof status.active.identity==='string'?status.active:null;
    if(next&&knownRetired.has(next.identity)){active=null;observedIdentity=null;changed();return false;}
    active=next?{identity:next.identity,name:String(next.name||'Word 文档')}:null;observedIdentity=active?.identity??null;
    updateCatalog(status);
    const entry=documents.find(item=>item.identity===active?.identity);
    // A matching save receipt and catalog let Dock reveal the cached list.
    // Selecting any row still requires a fresh Word capture with its target.
    const matchingDocument=cached&&active?.identity===cached.documentIdentity&&entry?.readOnly===false&&!wordDocumentUnavailable;
    const contentSave=matchingDocument&&Number.isInteger(cached.confirmedContentSaveIndex)&&!cached.numberingRefreshNeeded&&entry.numberingRevision===cached.documentNumberingRevision;
    const formatSave=matchingDocument&&!cached.numberingRefreshNeeded&&!cached.hasUnconfirmedSave&&cached.formatSaveRevision!==null
     &&(entry.numberingRevision===cached.documentNumberingRevision||entry.numberingRevision===cached.formatSaveRevision);
    const cancelledEdit=matchingDocument&&cached.cancelledEdit&&!cached.numberingRefreshNeeded&&!cached.hasUnconfirmedSave
     &&Number.isSafeInteger(entry.numberingRevision)&&entry.numberingRevision===cachedNumberingRevision();
    if(contentSave||formatSave||cancelledEdit){
     cached.warmDockVerified=true;
     changed();return true;
    }
   }
   return requestOpen(null,false,status?.connected?active?.identity:null);
  },
  async select(index,{reload=false,fallbackToDocument=false}={}){
   const beforeGeneration=generation,state=api.state(),document=state.source||cached;
   const retryOwner=reload&&state.wordTicket&&document?.documentLoadFailed&&index===document.activeIndex;
   const fallbackDocument=!!(reload&&fallbackToDocument);
   const object=document?.objects[index];
   if(wordDocumentUnavailable){api.message('文档连接已结束，无法再选择原文档公式。草稿已保留。',true);return false;}
   if(state.wordTicket&&state.source?.catalogProof&&!reload){
    if(state.busy||state.outcomeUnknown||pending||selecting||!Number.isInteger(index)||index<0||index>=document.documentTotal||index===document.documentPosition)return false;
    if(state.draftChanged){api.message('当前公式有修改，请先保存回 Word，再打开其他公式。',true);return false;}
    clearAutoRecovery();
    const target={identity:document.documentIdentity,snapshot:document.documentSnapshot,index,count:document.documentTotal,proof:document.catalogProof};
    selecting=true;catalogueDuringDetach=document;changed();
    try{
     if(!await api.detach())return false;
     const current=api.state();
     if(generation!==beforeGeneration||current.wordTicket||current.busy||current.outcomeUnknown||wordDocumentUnavailable)return false;
     // The previous editor was checked for changes and locked before detaching.
     // Its displayed LaTeX should not prompt as an independent draft.
     return await requestOpen(null,true,target.identity,false,null,null,false,target);
    }catch(error){api.message('未能打开 Word 公式：'+error.message,true);return false;}
    finally{catalogueDuringDetach=null;selecting=false;changed();}
   }
   if(state.busy||state.outcomeUnknown||pending||selecting||!object)return false;
   if(reload&&state.draftChanged)return false;
   if(!fallbackDocument)clearAutoRecovery();
   const target={identity:document.documentIdentity,snapshot:snapshotForRow(document,index),index:retryOwner?document.documentPosition??index:index,nativeSha256:object.nativeSha256};
   if(!validTarget(target)){
    if(fallbackDocument&&typeof document?.documentIdentity==='string'&&document.documentIdentity.length>0&&!knownRetired.has(document.documentIdentity)){
     selecting=true;changed();
     try{
      const identity=document.documentIdentity;
      const fresh=await readStatus();
      if(generation!==beforeGeneration)return false;
      updateCatalog(fresh);
      const entry=documents.find(item=>item.identity===identity);
      const current=api.state();
      if(!fresh?.connected||fresh.active?.identity!==identity||fresh.retiredIdentities?.includes(identity)||entry?.readOnly!==false||current.source!==state.source||current.wordTicket!==state.wordTicket||current.busy||current.outcomeUnknown||current.draftChanged)return false;
      if(document!==cached||cached.formatSaveRevision===null)remember(document);
      if(state.wordTicket&&!await api.detach())return false;
      const detached=api.state();
      if(generation!==beforeGeneration||detached.wordTicket||detached.busy||detached.outcomeUnknown||dirty(detached))return false;
      return await requestOpen(null,true,identity,true,identity,null,false,null,{autoRefresh:true,fallbackDocument:false,recoveryAttempt:0});
     }catch(error){reportStatusError('未能检查 Word 当前文档：',error,false);return false;}
     finally{selecting=false;changed();}
    }
    api.message('文档信息已失效，请从 Word 重新打开公式。',true);return false;
   }
   const retrySavedTarget=!reload&&document.warmDockVerified&&document.confirmedContentSaveIndex===index&&canRetrySavedTarget(target);
   selecting=true;changed();
   try{
    let approved=false;
    if(state.draftChanged){const answer=await api.native('confirmWordSessionSwitch',{browsing:true});if(!answer?.discard)return false;approved=true;}
    let current=api.state();
    if(generation!==beforeGeneration||current.source!==state.source||current.wordTicket!==state.wordTicket||current.busy||current.outcomeUnknown||current.draftChanged&&!approved)return false;
    if(document!==cached||cached.formatSaveRevision===null)remember(document);
    if(state.wordTicket&&!await api.detach())return false;
    current=api.state();
    if(generation!==beforeGeneration||current.wordTicket||current.busy||current.outcomeUnknown||!state.wordTicket&&current.source!==state.source)return false;
    return await requestOpen(target,approved||reload,(retryOwner||fallbackDocument)?target.identity:null,false,null,null,retrySavedTarget,null,{autoRefresh:fallbackDocument,fallbackDocument,recoveryAttempt:0});
   }finally{selecting=false;changed();}
  },
  async newFormula(){
   const before=api.state();
   if(!before.wordTicket||before.busy||before.outcomeUnknown||pending||selecting)return false;
   clearAutoRecovery();
   const originalTicket=before.wordTicket,originalSource=before.source;
   selecting=true;changed();
   try{
    if(before.draftChanged){const answer=await api.native('confirmWordSessionSwitch',{newFormula:true});if(!answer?.discard)return false;}
    const current=api.state();
    if(current.wordTicket!==originalTicket||current.source!==originalSource||current.busy||current.outcomeUnknown)return false;
    if(!await api.detach())return false;
    const detached=api.state();
    if(detached.wordTicket||detached.busy||detached.outcomeUnknown)return false;
    api.empty?.();changed();return true;
   }catch(error){api.message('未能结束 Word 编辑：'+error.message,true);return false;}
   finally{selecting=false;changed();}
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
   if(requestId&&(pending!==request||request.generation!==generation))throw Error('这次 Word 文档打开请求已经结束。');
   if(!request){restoreSavedNumberingLayout(document);return false;}
   if(!requestId){await cancelPending();restoreSavedNumberingLayout(document);return false;}
   if(request.expectedIdentity&&document.documentIdentity!==request.expectedIdentity){await cancelPending();throw Error('Word 当前文档已变化。草稿仍保留，请重新打开目标文档。');}
   if(request.insertion&&(!document.insertion||document.insertionLayout?.mode!==request.insertion.mode)){await cancelPending();throw Error('Word 返回的插入会话不匹配。草稿仍保留。');}
   if(!request.insertion&&request.autoRefresh&&document.insertion){await cancelPending();throw Error('Word 返回的会话类型不匹配。草稿仍保留。');}
   const target=request.target,object=document.objects?.[request.insertion?target?.index:document.activeIndex];
   if(request.catalogTarget&&(document.insertion||(document.documentPosition??document.activeIndex)!==request.catalogTarget.index||!/^[0-9a-f]{64}$/.test(object?.nativeSha256||''))){await cancelPending();throw Error('Word 返回的公式与所选目录行不一致。请刷新文档后再选。');}
   const same=target&&document.documentIdentity===target.identity&&(request.insertion?target.index:(document.documentPosition??document.activeIndex))===target.index;
   if(target&&(!same||object?.nativeSha256!==target.nativeSha256)){
    await cancelPending();
    if(request.fallbackDocument&&request.autoRefresh&&document.documentIdentity===target.identity&&!document.insertion&&!dirty(api.state())&&!wordDocumentUnavailable&&!knownRetired.has(target.identity)){
     armAutoRecovery(target.identity,request.recoveryAttempt??0,null);
    }
    throw Error('Word 中的公式内容或位置已经变化。草稿仍保留，请重新打开文档后再选。');
   }
   restoreSavedNumberingLayout(document);
   const approved=request.discardApproved&&(!target||same);
   preparedInsertionDraft=request.insertion?{requestId,draft:request.insertion.draft}:null;
   pending=null;clearAutoRecovery();generation++;changed();return !!approved;
  },
  clearUnavailable,
  accepted(document){generation++;clearAutoRecovery();lastStatusError=null;emptyDocument=null;failedDocumentIdentity=null;const identity=identityOf(document);awaitingPublishedIdentity=identity;if(identity)knownRetired.delete(identity);else cached=null;wordDocumentUnavailable=false;unavailableIdentity=null;unavailableName='';reconcileNumberingReadback(document);remember(document);observedIdentity=identity;active=identity?{identity,name:document.documentName||'Word 文档'}:active;changed();}
 };
};
