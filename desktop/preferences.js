/* Native preferences are independent of MathLive's editing font. */
(()=>{
 function decodedPreviewSwap(image,visibility,makeImage=()=>new Image()){
  let generation=0,displayed='';
  return async url=>{
   const current=++generation;
   if(!url){displayed='';image.removeAttribute('src');visibility(false);return;}
   if(url===displayed){visibility(true);return;}
   const next=makeImage();next.decoding='async';next.src=url;
   try{await next.decode();}
   catch{if(current===generation){displayed='';image.removeAttribute('src');visibility(false);}return;}
   if(current!==generation)return;
   image.src=url;displayed=url;visibility(true);
  };
 }
 let base=null,defaults=null,descriptors=null,factory=null,original=null;
 let importedText;
 try{defaults=JSON.parse(localStorage.getItem('equationlab.native-defaults')||'null');}catch{}
 const styleLabels=['文本','函数','变量','小写希腊','大写希腊','符号','向量矩阵','数字','用户 1','用户 2','MT Extra','东亚文本'];
 const sizeLabels=['完整','上下标','次级上下标','符号','次级符号'];
 function dimensionRows(container,values,labels,kind,preset){
  container.replaceChildren();
  labels.forEach((descriptor,index)=>{
   const sourceValue=values[index],row=document.createElement('label');row.className='preference-dimension';row.dataset.kind=kind;row.dataset.id=index;
   const title=document.createElement('span');title.textContent=descriptor.label;
   const input=document.createElement('input');input.type='text';input.inputMode='decimal';input.setAttribute('aria-label',descriptor.label+'数值');
   const select=document.createElement('select');select.setAttribute('aria-label',descriptor.label+'单位');
   if(!sourceValue||sourceValue.unsupported){input.disabled=true;select.disabled=true;input.value=sourceValue?'未识别，保留原值':'未定义';}
   else{
    let value=sourceValue.value,unit=sourceValue.unit;
    if(kind==='sizes'&&!descriptor.units.includes(unit)){value=String(Number(value)*({in:72,cm:72/2.54,pc:12}[unit]||1));unit='pt';}
    for(const u of descriptor.units){const option=document.createElement('option');option.value=u;option.textContent=u;select.append(option);}
    row.dataset.originalValue=value;row.dataset.originalUnit=unit;
    input.value=preset?.[index]?.value??value;select.value=preset?.[index]?.unit??unit;
    input.oninput=changed;select.onchange=changed;
   }
   row.append(title,input,select);container.append(row);
  });
 }
 function render(profile,preset=null){
  if(!profile)return;base=profile;$('desktop-fonts').replaceChildren();
  $('desktop-factory-fonts').disabled=!!selected;
  profile.styles.forEach(style=>{
   const row=document.createElement('label');row.className='preference-font';row.dataset.id=style.id;
   const title=document.createElement('span');title.textContent=styleLabels[style.id-1]||style.label;
   const input=document.createElement('input');input.value=preset?.styles?.[style.id]?.font??style.font;input.placeholder='未定义';input.setAttribute('list','desktop-font-families');input.setAttribute('aria-label',title.textContent+'字体');input.onchange=changed;
   const select=document.createElement('select');select.setAttribute('aria-label',title.textContent+'样式');
   for(const [value,text]of [[0,'正体'],[1,'粗体'],[2,'斜体'],[3,'粗斜体']]){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}
   select.value=preset?.styles?.[style.id]?.style??style.style;select.onchange=changed;row.append(title,input,select);$('desktop-fonts').append(row);
  });
  dimensionRows($('desktop-sizes'),profile.sizes,sizeLabels.map((label,id)=>({label,units:id===0?['pt']:['pt','%']})),'sizes',preset?.sizes);
  if(descriptors){dimensionRows($('desktop-extra-sizes'),profile.extraSizes,descriptors.extraSizes,'extraSizes',preset?.extraSizes);dimensionRows($('desktop-spaces'),profile.spaces,descriptors.spaces,'spaces',preset?.spaces);}
 }
 function snapshot(){
  const styles={},sizes={},spaces={},extraSizes={};
  for(const row of $('desktop-fonts').children){const font=row.querySelector('input').value.trim(),before=base.styles[Number(row.dataset.id)-1];if(font||before.font)styles[row.dataset.id]={font,style:Number(row.querySelector('select').value)};}
  for(const row of document.querySelectorAll('.preference-dimension')){if(row.querySelector('input').disabled)continue;({sizes,spaces,extraSizes})[row.dataset.kind][row.dataset.id]={unit:row.querySelector('select').value,value:row.querySelector('input').value};}
  return {styles,sizes,spaces,extraSizes};
 }
 function load(profile,preset=null){render(profile,preset);original=snapshot();}
 window.desktopTypographyLoad=profile=>load(profile);
 window.desktopTypographySnapshot=()=>base?snapshot():null;
 window.desktopTypographyRestorePatch=patch=>{if(base)load(base,patch);};
 window.desktopImportPreferences=async()=>{
  const result=await native('preferencesImport');if(!result)return;
  importedText=result.originalText;
  const profile=result.profile,preset={styles:Object.fromEntries(profile.styles.filter(s=>s.font).map(s=>[s.id,{font:s.font,style:s.style}])),sizes:Object.fromEntries(profile.sizes.map((v,i)=>[i,v])),spaces:Object.fromEntries(profile.spaces.flatMap((v,i)=>v.unsupported?[]:[[i,v]])),extraSizes:Object.fromEntries(profile.extraSizes.flatMap((v,i)=>v.unsupported?[]:[[i,v]]))};
  render(base||factory,preset);changed();message('已加载 MathType 偏好；可另存保留未识别字段。');
 };
 window.desktopExportPreferences=async()=>{
  const result=await native('preferencesExport',{typography:snapshot(),originalText:importedText});if(result)message('已保存 MathType 偏好：'+result.path);
 };
 window.desktopTypographyPatch=()=>{
  if(!base)return null;const patch={styles:{},sizes:{},spaces:{},extraSizes:{}};
  for(const row of $('desktop-fonts').children){const id=Number(row.dataset.id),original=base.styles[id-1],font=row.querySelector('input').value.trim(),style=Number(row.querySelector('select').value);if(font!==original.font||style!==original.style)patch.styles[id]={font,style};}
  for(const row of document.querySelectorAll('.preference-dimension')){const input=row.querySelector('input');if(input.disabled)continue;const value=input.value,unit=row.querySelector('select').value;if(value!==row.dataset.originalValue||unit!==row.dataset.originalUnit)patch[row.dataset.kind][row.dataset.id]={unit,value};}
  for(const key of Object.keys(patch))if(!Object.keys(patch[key]).length)delete patch[key];return Object.keys(patch).length?patch:null;
 };
 const swapPreview=decodedPreviewSwap($('desktop-font-preview-image'),visible=>{
  $('desktop-font-preview').hidden=!visible;
  const empty=$('word-preview-placeholder');
  if(empty){empty.hidden=visible;empty.textContent=mf.value.trim()?$('status-detail').textContent:(window.workbenchEnglish?'Enter an equation to preview its font and size.':'输入公式后，查看实际字体与字号。');}
  requestWorkbenchSync();
 });
 window.desktopFontPreview=svg=>swapPreview(svg?'data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(svg))):null);
 window.desktopTypographyNew=()=>{if(factory)load(factory,defaults);};
 $('desktop-reset-fonts').onclick=()=>{render(base,original);changed();};
 $('desktop-factory-fonts').onclick=()=>perform(async()=>{if(selected)throw Error('请先新建公式；已有公式可恢复其原始设置');if(!factory)throw Error('原厂偏好尚未载入');render(factory);changed();message('当前新公式已恢复原厂 Times+Symbol 12 偏好；已保存的自定义默认未改动。如需以后使用此设置，请再点“设为新公式默认”。');});
 $('desktop-default-fonts').onclick=()=>perform(async()=>{
  if(!valid)throw Error('请先完成原生设置检查');
  const preset=snapshot();await native('validate',{latex:'x',typography:preset});
  localStorage.setItem('equationlab.native-defaults',JSON.stringify(preset));defaults=preset;message('已保存新公式的默认字体、字号与已知间距。');
 });
 native('typography-default').then(result=>{factory=result.profile;descriptors=result;if(selected?.typography)load(selected.typography);else load(factory,defaults);changed();}).catch(error=>message(error.message,true));
})();
