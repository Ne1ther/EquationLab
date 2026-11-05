(function(){
 if(!window.createDraftRecovery)return;
 const id=crypto.randomUUID();
 let recoveryError='',restoring=false;
 function capture(){
  if(window.editorIsComposing?.())return null;
  if((wordTicket||selected)&&!wordSessionChanged()&&!wordOutcomeUnknown)return null;
  const typography=window.desktopTypographySnapshot?.()??window.desktopTypographyPatch?.();
  const layout=wordLayout(),knownLayout=['inline','display','numbered-left','numbered-right'].includes(layout.mode)&&[layout.chapter,layout.section].every(n=>Number.isSafeInteger(n)&&n>0&&n<=32767);
  const layoutChanged=knownLayout&&(layout.mode!=='inline'||layout.numberFormat!=='(#E1)'||layout.chapter!==1||layout.section!==1);
  if(!mf.value.trim()&&!window.desktopTypographyPatch?.()&&!editingRuler?.length&&!layoutChanged&&!wordTicket)return null;
  if(selected?.editorNumberingRequested&&knownLayout&&!layout.mode.startsWith('numbered-'))layout.mode='numbered-right';
  return {draft:{latex:mf.value,mode:selected?sourceEditMode():'rebuild',...typography?{typography}:{},...editingRuler!==undefined?{ruler:editingRuler}:{},...knownLayout?{layout}:{},replacements:Object.fromEntries([...$('character-editor').querySelectorAll('input')].map(el=>[el.dataset.offset,el.value])),outcomeUnknown:wordOutcomeUnknown||wordSaveQueued||!!window.wordSaveInFlight||!!window.draftOutcomeUnknown},...source&&selected&&!selected.error?{source:{path:source.path,index:selected.index,nativeSha256:selected.nativeSha256}}:{}};
 }
 function publish(){
  const candidate=window.draftRecovery.available;
  window.draftRecoveryState={available:!!candidate.available,updatedAt:candidate.updatedAt??null,outcomeUnknown:!!candidate.outcomeUnknown,restored:!!candidate.restored,error:recoveryError};
  requestWorkbenchSync();
 }
 window.draftRecovery=window.createDraftRecovery({id,native,capture,canCapture:()=>!window.editorIsComposing?.()&&!restoring,changed:publish,onSaved:()=>{if(recoveryError){recoveryError='';publish();}},onError:()=>{recoveryError='本地草稿备份未完成，请先保存或导出当前公式。';publish();}});
 window.nativeFlushDraft=async()=>{try{return await window.draftRecovery.flush();}catch(error){recoveryError='本地草稿备份未完成，请先保存或导出当前公式。';publish();return false;}};
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
  if(capture()){
   const answer=await native('confirmWordSessionSwitch',{newFormula:true});if(!answer?.discard)return false;
  }
  if(wordTicket&&!await window.nativeCancelWordSession())return false;
  return window.draftRecovery.restore(window.applyRecoveredDraft);
 });
 window.applyRecoveredDraft=async result=>{
   restoring=true;window.restoringRecoveryDraft=true;
   try{
    resetNewFormula();window.draftOutcomeUnknown=!!result.draft.outcomeUnknown;await window.desktopTypographyReady;
    if(result.source){source=result.source;selectObject(0);mode=result.draft.mode;renderModes();}
    mf.value=result.draft.latex;editingRuler=result.draft.ruler;
    window.desktopTypographyRestorePatch?.(result.draft.typography);
    if(result.draft.layout)for(const [field,key]of [['layout-mode','mode'],['layout-format','numberFormat'],['layout-chapter','chapter'],['layout-section','section']])$(field).value=String(result.draft.layout[key]);
    for(const input of $('character-editor').querySelectorAll('input'))if(Object.hasOwn(result.draft.replacements??{},input.dataset.offset))input.value=result.draft.replacements[input.dataset.offset];
    window.resetEditorHistory?.();changed();await validate();recoveryError='';
    message(result.draft.outcomeUnknown?'草稿已恢复为独立编辑。上次 Word 保存结果未确认，请先检查原文档。':'草稿已恢复为独立编辑，可导出或重新选择 Word 插入位置。');return true;
   }finally{restoring=false;window.restoringRecoveryDraft=false;}
 };
 for(const field of ['layout-mode','layout-format','layout-chapter','layout-section'])for(const event of ['input','change'])$(field).addEventListener(event,()=>window.draftRecovery.schedule());
 window.draftRecovery.initialize().catch(()=>{recoveryError='未能读取本地恢复草稿。';publish();});
})();
