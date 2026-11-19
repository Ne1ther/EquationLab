(function(){
 let currentReport=null;
 const completeDocument=()=>source&&!source.documentLoading&&!source.documentLoadFailed&&!wordSourceUnavailable()&&(!wordTicket||source.hasDocumentContext);
 const copyObjects=document=>document.documentToolObjects??document.objects;
 function input(){
  if(!completeDocument())throw Error('请先载入完整且可用的文档');
  if(source.numberingRefreshNeeded)throw Error('Word 中的编号已更新，请刷新文档后重试。');
  return {input:source.path,...wordTicket?{ticket:wordTicket,documentIdentity:source.documentIdentity,documentSnapshot:source.documentSnapshot}:{}};
 }
 const same=report=>{
  const bound=report?.sourceBinding??report?.binding;
  return report&&completeDocument()&&report.source===source&&report.ticket===wordTicket&&!source.numberingRefreshNeeded&&bound?.input===source.path&&(!report.ticket||bound.documentIdentity===source.documentIdentity&&bound.documentSnapshot===source.documentSnapshot);
 };
 async function copyBinding(){
  const sourceBinding=input(),document=source,ticket=wordTicket;
  if(!ticket)return {source:document,ticket,sourceBinding,binding:sourceBinding};
  const chosen=await native('chooseDocumentToolSource',{name:source.documentName});
  if(!chosen)return null;
  const context={source:document,ticket,sourceBinding,binding:{input:chosen.path},sourceName:chosen.name};
  if(!same(context))throw Error('文档已变化，请重新预检');
  return context;
 }
 function checkCopyTargets(context,result,indices,hashKey){
  if(!context.ticket)return;
  const objects=new Map(copyObjects(context.source).map(item=>[item.index,item.nativeSha256??null]));
  const expected=new Set(indices);
  for(const target of result.targets){
   if(!expected.has(target.index)||!objects.has(target.index)||target[hashKey]!==objects.get(target.index)||(!target[hashKey]&&target.status!=='skipped'))break;
   expected.delete(target.index);
  }
  if(expected.size||indices.length!==result.targets.length)throw Error('所选文件与当前 Word 文档中的公式不一致。请先在 Word 保存，再选择对应的 .docx 文件。');
 }
 async function show(kind,result,binding,context={}){currentReport={kind,result,source,ticket:wordTicket,binding,...context};await native('documentToolsResult',{kind,result:context.sourceName?{...result,sourceName:context.sourceName}:result});}
 window.nativeDocumentAudit=()=>perform(async()=>{const binding=input(),document=source,ticket=wordTicket;const result=await native('documentAudit',binding);if(!same({source:document,ticket,binding}))throw Error('文档已变化，请重新检查');await show('audit',result,binding);});
 window.nativeUseDocumentTypography=()=>perform(async()=>{const preset=source?.documentTypographyPreset;if(!preset)throw Error('当前文档没有可用的样式预设');window.desktopTypographyRestorePatch?.(preset.typography);changed();message('文档预设已载入当前草稿，提交后生效。');});
 window.nativeDocumentTypographyPlan=scope=>perform(async()=>{
  const snapshot=window.desktopTypographySnapshot?.();if(!snapshot)throw Error('当前公式设置尚未就绪');const typography=JSON.parse(JSON.stringify(snapshot));
  if(!['current','all','future'].includes(scope))throw Error('无效的样式应用范围');
  const indices=scope==='all'&&source?copyObjects(source).map(item=>item.index):scope==='current'&&selected?[selected.index]:[];
  if(scope==='current'&&!selected)throw Error('请先选择公式');
  const options={indices,...scope==='future'?{preset:{name:'Document formula style',scope:'new-equations',typography}}:{typography}};
  const context=await copyBinding();if(!context)return;
  const result=await native('documentTypographyPreflight',{...context.binding,options});if(!same(context))throw Error('文档已变化，请重新预检');
  checkCopyTargets(context,result,indices,'beforeNativeSha256');
  await show('typography',result,context.binding,context);
 },false,{allowPreflightEditing:true});
 window.nativeDocumentNumberingPlan=scope=>perform(async()=>{
  if(!['current','all','future'].includes(scope))throw Error('无效的编号应用范围');
  if(scope==='current'&&!selected)throw Error('请先选择公式');
  const options={scope,...scope==='current'?{index:selected.index}:{},numberFormat:$('layout-format').value};
  const context=await copyBinding();if(!context)return;
  const result=await native('documentNumberingPreflight',{...context.binding,options});
  if(!same(context))throw Error('文档已变化，请重新预检');
  if(scope==='current')checkCopyTargets(context,result,[options.index],'nativeSha256');
  if(scope==='all')checkCopyTargets(context,result,copyObjects(context.source).map(item=>item.index),'nativeSha256');
  await show('numbering',result,context.binding,context);
 },false,{allowPreflightEditing:true});
 window.nativeApplyDocumentTool=()=>perform(async()=>{
  const report=currentReport;if(!same(report)||report.kind==='audit')throw Error('文档已变化，请重新预检');
  const result=await native(report.kind==='typography'?'documentTypographyApply':'documentNumberingApply',{...report.binding,plan:report.result});
  if(!result)return;currentReport=null;message('已保存新的文档副本，原文档未改动：'+result.path);await native('documentToolsResult',{kind:'saved',result});
 });
 window.nativeSelectAuditedEquation=index=>{
  const report=currentReport;if(!same(report)||report.kind!=='audit'){message('文档已变化，请重新检查',true);return;}
  const target=report.result.equations.find(item=>item.index===index);
  if(!target||target.nativeSha256!==source.objects[index]?.nativeSha256){message('公式已变化，请重新检查',true);return;}
  return window.nativeSelectObject(index);
 };
})();
