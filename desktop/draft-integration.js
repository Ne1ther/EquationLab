(function(){
 if(!window.createDraftRecovery)return;
 const id=crypto.randomUUID();
 let recoveryError='',restoring=false;
 function draftChanges(){
  if(window.editorIsComposing?.())return null;
  const outcomeUnknown=wordOutcomeUnknown||wordSaveQueued||!!window.wordSaveInFlight||!!window.draftOutcomeUnknown;
  const boundEditor=!!(wordTicket||selected);
  const standaloneSelection=!wordTicket&&selected&&!selected.error;
  const detached=!wordTicket&&!selected?window.wordDetachedCleanBaseline:null;
  const layout=wordLayout(),knownLayout=['inline','display','numbered-left','numbered-right'].includes(layout.mode)&&[layout.chapter,layout.section].every(n=>Number.isSafeInteger(n)&&n>0&&n<=32767);
  const baseline=standaloneSelection?{
   mode:selected.layout?.mode||'inline',numberFormat:selected.editorNumberFormatBaseline??selected.layout?.numberFormat??'(#E1)',
   chapter:Number(selected.editorCounterBaseline?.chapter??selected.layout?.chapter??1),section:Number(selected.editorCounterBaseline?.section??selected.layout?.section??1)
  }:detached?.layout??{mode:'inline',numberFormat:'(#E1)',chapter:1,section:1};
  const layoutChanged=knownLayout&&Object.keys(baseline).some(key=>layout[key]!==baseline[key]);
  if(boundEditor&&!wordSessionChanged()&&!(standaloneSelection&&layoutChanged)&&!outcomeUnknown)return null;
  const patch=window.desktopTypographyPatch?.();
  if(detached&&!outcomeUnknown&&(!detached.layout||!layoutChanged)&&mf.value===detached.latex&&
   JSON.stringify(patch??null)===detached.typography&&JSON.stringify(editingRuler??[])===detached.ruler)return null;
  if(!boundEditor&&!mf.value.trim()&&!patch&&!editingRuler?.length&&!layoutChanged&&!outcomeUnknown)return null;
  return {layout,knownLayout,outcomeUnknown,patch};
 }
 function capture(){
  const current=draftChanges();if(!current)return null;
  const {layout,knownLayout,outcomeUnknown,patch}=current;
  const typography=window.desktopTypographySnapshot?.()??patch;
  if(selected?.editorNumberingRequested&&knownLayout&&!layout.mode.startsWith('numbered-'))layout.mode='numbered-right';
  const sourceBinding=source&&selected&&!selected.error?{path:source.path,index:selected.index,nativeSha256:selected.nativeSha256}:null;
  return {draft:{latex:mf.value,mode:sourceBinding?mode:'rebuild',...typography?{typography}:{},...editingRuler!==undefined?{ruler:editingRuler}:{},...knownLayout?{layout}:{},replacements:Object.fromEntries([...$('character-editor').querySelectorAll('input')].map(el=>[el.dataset.offset,el.value])),outcomeUnknown},...sourceBinding?{source:sourceBinding}:{}};
 }
 window.hasRecoverableDraft=()=>draftChanges()!==null;
 function publish(){
  const candidate=window.draftRecovery.available;
  window.draftRecoveryState={available:!!candidate.available,updatedAt:candidate.updatedAt??null,outcomeUnknown:!!candidate.outcomeUnknown,restored:!!candidate.restored,error:recoveryError};
  requestWorkbenchSync();
 }
 window.draftRecovery=window.createDraftRecovery({id,native,capture,canCapture:()=>!window.editorIsComposing?.()&&!restoring,
  // Clearing this launch’s record also removes its staged recovery document.
  canClearCleanDraft:()=>!source?.recoveredDraft,
  changed:publish,onSaved:()=>{if(recoveryError){recoveryError='';publish();}},onError:()=>{recoveryError='本地草稿备份未完成，请先保存或导出当前公式。';publish();}});
 // An unchanged snapshot may have been removed by another app launch.
 window.nativeFlushDraft=async()=>{try{return await window.draftRecovery.flush({force:true});}catch(error){recoveryError='本地草稿备份未完成，请先保存或导出当前公式。';publish();return false;}};
 window.materializeUnknownDraft=async()=>{if(!await window.nativeFlushDraft())return null;return native('draftRestore',{id,clientId:id});};
 window.clearSavedDrafts=async()=>{
  try{await window.draftRecovery.clear();if(window.draftRecovery.available.restored)await window.draftRecovery.discardRecovery();}
  catch(error){recoveryError='本地草稿清理未完成，下次备份前会重试。';publish();throw error;}
 };
 window.nativeDiscardRecovery=async()=>{
  if(busy||wordCommitRunning)return false;
  const answer=await native('confirmDraftDiscard');if(!answer?.discard)return false;
  await window.draftRecovery.discardRecovery();return true;
 };
 window.nativeRestoreDraft=()=>perform(async()=>{
  if(window.editorIsComposing?.()||window.wordSaveInFlight||wordOutcomeUnknown){message('请先结束当前输入或核对 Word 保存结果，再恢复草稿。',true);return false;}
  if(window.wordDocumentWorkspace?.pending){message(window.workbenchEnglish?'Wait for the current Word document to open before restoring a draft.':'请等待当前 Word 文档打开后，再恢复草稿。',true);return false;}
  const ticket=wordTicket;
  if(draftChanges()){
   const answer=await native('confirmWordSessionSwitch',{newFormula:true});if(!answer?.discard)return false;
  }
  const restored=await window.draftRecovery.restore(async result=>{
   if(wordTicket!==ticket||window.wordSaveInFlight||wordOutcomeUnknown||window.wordDocumentWorkspace?.pending)return false;
   if(ticket){
    // Resetting the canceled Word editor must keep the staged recovery source.
    window.restoringRecoveryDraft=true;
    try{if(!await window.nativeCancelWordSession()||wordTicket)return false;}
    finally{window.restoringRecoveryDraft=false;}
   }
   return window.applyRecoveredDraft(result);
  });
  if(!restored)message(window.workbenchEnglish?'Recovery stopped. The current edit was kept.':'草稿恢复未完成，当前编辑已保留。',true);
  return restored;
 });
 window.applyRecoveredDraft=async result=>{
   restoring=true;window.restoringRecoveryDraft=true;
   try{
    if(resetNewFormula()===false)return false;
    window.draftOutcomeUnknown=!!result.draft.outcomeUnknown;await window.desktopTypographyReady;
    if(result.source){source=result.source;selectObject(0);mode=result.draft.mode;renderModes();}
    mf.value=result.draft.latex;editingRuler=result.draft.ruler;
    window.desktopTypographyRestorePatch?.(result.draft.typography);
    if(result.draft.layout)for(const [field,key]of [['layout-mode','mode'],['layout-format','numberFormat'],['layout-chapter','chapter'],['layout-section','section']])$(field).value=String(result.draft.layout[key]);
    for(const input of $('character-editor').querySelectorAll('input'))if(Object.hasOwn(result.draft.replacements??{},input.dataset.offset))input.value=result.draft.replacements[input.dataset.offset];
    window.resetEditorHistory?.();changed();await validate();
    window.nativeRefreshEditorSurface?.();recoveryError='';
    message(result.draft.outcomeUnknown?'草稿已恢复为独立编辑。上次 Word 保存结果未确认，请先检查原文档。':'草稿已恢复为独立编辑，可导出或重新选择 Word 插入位置。');return true;
   }finally{restoring=false;window.restoringRecoveryDraft=false;}
 };
 for(const field of ['layout-mode','layout-format','layout-chapter','layout-section'])for(const event of ['input','change'])$(field).addEventListener(event,()=>window.draftRecovery.schedule());
 window.draftRecovery.initialize().catch(()=>{recoveryError='未能读取本地恢复草稿。';publish();});
})();
