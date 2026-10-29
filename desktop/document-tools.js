(function(){
 let currentReport=null;
 function input(){
  if(!source||source.documentLoading||wordSourceUnavailable())throw Error('请先载入完整且可用的文档');
  return {input:source.path,...wordTicket?{ticket:wordTicket,documentIdentity:source.documentIdentity,documentSnapshot:source.documentSnapshot}:{}};
 }
 const same=report=>report&&report.source===source&&report.ticket===wordTicket&&!wordSourceUnavailable();
 async function show(kind,result,binding){currentReport={kind,result,source,ticket:wordTicket,binding};await native('documentToolsResult',{kind,result});}
 window.nativeDocumentAudit=()=>perform(async()=>{const binding=input(),document=source;const result=await native('documentAudit',binding);if(source!==document)throw Error('文档已变化，请重新检查');await show('audit',result,binding);});
 window.nativeUseDocumentTypography=()=>perform(async()=>{const preset=source?.documentTypographyPreset;if(!preset)throw Error('当前文档没有可用的样式预设');window.desktopTypographyRestorePatch?.(preset.typography);changed();message('文档预设已载入当前草稿，提交后生效。');});
 window.nativeDocumentTypographyPlan=scope=>perform(async()=>{
  const binding=input(),document=source,typography=window.desktopTypographySnapshot?.();if(!typography)throw Error('当前公式设置尚未就绪');
  if(!['current','all','future'].includes(scope))throw Error('无效的样式应用范围');
  const indices=scope==='all'?source.objects.map(item=>item.index):scope==='current'&&selected?[selected.index]:[];
  if(scope==='current'&&!selected)throw Error('请先选择公式');
  const options={indices,...scope==='future'?{preset:{name:'Document formula style',scope:'new-equations',typography}}:{typography}};
  const result=await native('documentTypographyPreflight',{...binding,options});if(source!==document)throw Error('文档已变化，请重新预检');await show('typography',result,binding);
 });
 window.nativeDocumentNumberingPlan=scope=>perform(async()=>{
  const binding=input(),document=source;if(!['current','all','future'].includes(scope))throw Error('无效的编号应用范围');
  if(scope==='current'&&!selected)throw Error('请先选择公式');
  const result=await native('documentNumberingPreflight',{...binding,options:{scope,...scope==='current'?{index:selected.index}:{},numberFormat:$('layout-format').value}});
  if(source!==document)throw Error('文档已变化，请重新预检');await show('numbering',result,binding);
 });
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
