/* global Office, Word, MathfieldElement */
MathfieldElement.fontsDirectory='/vendor/fonts';MathfieldElement.soundsDirectory=null;
const el=id=>document.getElementById(id),mf=el('formula');mf.mathVirtualKeyboardPolicy='manual';mf.smartFence=true;
let selectedXml=null,selectedObject=null,selectedScope='selection',selectedRange=null,objects=[],numberTargets=[],valid=false,busy=false,ready=false,revision=0,timer;
let typographyBase=null,typographyOriginal=null,newTypography=null,typographyDescriptors={spaces:[],extraSizes:[]},eqpSource=null,eqpBaseline=null;
let ribbonState='';
let lastPreviewSvg=null;
try{newTypography=JSON.parse(localStorage.getItem('equationlab.typography')||'null');}catch{}
function replacements(){return Object.fromEntries([...el('characters').querySelectorAll('input')].map(i=>[i.dataset.offset,i.value]));}
const dimensionContainers={sizes:'type-sizes',spaces:'type-spaces',extraSizes:'type-extra-sizes'};
function knownDimension(value){return !!value&&!value.unsupported&&['in','cm','pt','pc','%'].includes(value.unit)&&typeof value.value==='string'&&/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.value)&&Number.isFinite(Number(value.value));}
function dimensionRows(kind){return [...el(dimensionContainers[kind]).querySelectorAll('.type-dimension')];}
function typographyPatch(){
 if(!typographyBase)return null;const patch={styles:{},sizes:{},spaces:{},extraSizes:{}};
 for(const row of el('type-styles').children){const id=row.dataset.id,font=row.querySelector('input').value.trim(),style=Number(row.querySelector('select').value),base=typographyBase.styles.find(s=>s.id===Number(id));if(font!==base.font||style!==base.style)patch.styles[id]={font,style};}
 for(const kind of Object.keys(dimensionContainers))for(const row of dimensionRows(kind)){
  if(row.dataset.readonly==='true')continue;
  const value=row.querySelector('input').value,unit=row.querySelector('select').value;
  if(value!==row.dataset.originalValue||unit!==row.dataset.originalUnit)patch[kind][row.dataset.id]={value,unit};
 }
 for(const key of Object.keys(patch))if(!Object.keys(patch[key]).length)delete patch[key];
 return Object.keys(patch).length?patch:null;
}
function typographySnapshot(){
 const result={styles:{},sizes:{},spaces:{},extraSizes:{}};
 for(const row of el('type-styles').children){const font=row.querySelector('input').value.trim(),base=typographyBase.styles.find(s=>s.id===Number(row.dataset.id));if(font||base.font)result.styles[row.dataset.id]={font,style:Number(row.querySelector('select').value)};}
 for(const kind of Object.keys(dimensionContainers))for(const row of dimensionRows(kind))if(row.dataset.readonly!=='true')result[kind][row.dataset.id]={unit:row.querySelector('select').value,value:row.querySelector('input').value};
 return result;
}
function typographyDifference(before,after){
 const patch={};for(const kind of ['styles','sizes','spaces','extraSizes'])for(const [id,value]of Object.entries(after[kind]||{}))if(JSON.stringify(value)!==JSON.stringify(before[kind]?.[id])){if(!patch[kind])patch[kind]={};patch[kind][id]=value;}return patch;
}
function currentTypography(){
 const data=JSON.parse(JSON.stringify(typographyBase));
 for(const [kind,values]of Object.entries(typographyPatch()||{}))for(const [id,value]of Object.entries(values)){
  const index=kind==='styles'?data.styles.findIndex(s=>s.id===Number(id)):Number(id);data[kind][index]={...data[kind][index],...value};
 }
 return data;
}
function dimensionRow(kind,descriptor,source,preset){
 const {id,label:name,units}=descriptor,row=document.createElement('div');row.className='type-dimension';row.dataset.id=id;
 const label=document.createElement('label');label.textContent=name;row.append(label);
 if(!knownDimension(source)){
  row.dataset.readonly='true';const output=document.createElement('output');output.textContent=source?'未知编码 · 保留原值':'源公式未包含此项';
  output.title=source?.rawNibbles?'原生编码：'+source.rawNibbles.map(n=>n.toString(16)).join(' '):'未写入默认值，也不接受替换';row.append(output);return row;
 }
 row.dataset.originalValue=source.value;row.dataset.originalUnit=source.unit;
 const input=document.createElement('input');input.type='text';input.inputMode='decimal';input.spellcheck=false;input.value=preset?.value??source.value;input.setAttribute('aria-label',name+'数值');input.oninput=changed;
 const select=document.createElement('select');select.setAttribute('aria-label',name+'单位');
 for(const unit of [...new Set([...units,source.unit,...(preset?.unit?[preset.unit]:[])])]){const option=document.createElement('option');option.value=unit;option.textContent=unit;option.disabled=!units.includes(unit);select.append(option);}
 select.value=preset?.unit??source.unit;select.onchange=changed;
 const inputId=`type-${kind}-${id}`;input.id=inputId;label.htmlFor=inputId;row.append(input,select);return row;
}
function typography(base,preset=null){
 typographyBase=base;for(const id of ['type-styles',...Object.values(dimensionContainers)])el(id).replaceChildren();
 el('typography-factory').disabled=!!selectedObject;
 const labels=['文本','函数','变量','小写希腊','大写希腊','符号','向量矩阵','数字','用户 1','用户 2','MT Extra','东亚文本'];
 for(const s of base.styles){const row=document.createElement('div');row.className='type-style';row.dataset.id=s.id;const name=labels[s.id-1]||s.label,label=document.createElement('label');label.textContent=name;const input=document.createElement('input');input.value=preset?.styles?.[s.id]?.font??s.font;input.placeholder='未定义';input.setAttribute('list','font-families');input.setAttribute('aria-label',name+'字体');input.onchange=changed;const select=document.createElement('select');select.setAttribute('aria-label',name+'样式');for(const [value,text]of [[0,'正体'],[1,'粗体'],[2,'斜体'],[3,'粗斜体']]){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}select.value=preset?.styles?.[s.id]?.style??s.style;select.onchange=changed;row.append(label,input,select);el('type-styles').append(row);}
 const names=['完整','上下标','次级上下标','符号','次级符号'];
 base.sizes.slice(0,5).forEach((s,id)=>{let display=s;if(knownDimension(s)&&!['pt','%'].includes(s.unit))display={unit:'pt',value:String(Number(s.value)*(s.unit==='in'?72:s.unit==='cm'?72/2.54:12))};const row=dimensionRow('sizes',{id,label:names[id],units:id===0?['pt']:['pt','%']},display,preset?.sizes?.[id]);row.className+=' type-size';if(display!==s)row.title=`原生值 ${s.value} ${s.unit}；更改时写入 pt，未更改时保留原单位`;el('type-sizes').append(row);});
 for(const descriptor of typographyDescriptors.extraSizes)el('type-extra-sizes').append(dimensionRow('extraSizes',descriptor,base.extraSizes?.[descriptor.id],preset?.extraSizes?.[descriptor.id]));
 const groups=[['行距、字符与运算符',[0,16,17,18,19]],['上下标与上下限',[3,4,5,6,7,8]],['分数',[9,10,11,12,13,14]],['矩阵',[1,2,27]],['围栏与根号',[15,20,21,22,28,29]],['修饰符与线条',[23,24,25,26]]];
 for(const [name,ids]of groups){const group=document.createElement('details');group.className='spacing-group';const summary=document.createElement('summary');summary.textContent=name;group.append(summary);for(const id of ids){const descriptor=typographyDescriptors.spaces.find(d=>d.id===id);if(descriptor)group.append(dimensionRow('spaces',descriptor,base.spaces?.[id],preset?.spaces?.[id]));}el('type-spaces').append(group);}
}
function loadTypography(base,preset=null){typography(base,preset);typographyOriginal=typographySnapshot();}
function fontPreview(svg){lastPreviewSvg=svg||null;el('font-preview').hidden=!svg;if(svg)el('font-preview-image').src='data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(svg)));}
function clearEqpTemplate(){eqpSource=null;eqpBaseline=null;el('eqp-preserve').hidden=true;el('eqp-source-note').hidden=true;}
function downloadEqp(text,name){const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})),link=el('eqp-download');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function downloadSvg(svg){const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'})),link=el('eqp-download');link.href=url;link.download='EquationLab.svg';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
el('export-svg').onclick=()=>action(async()=>{if(!valid||!lastPreviewSvg)throw Error('请先通过当前公式的原生检查');downloadSvg(lastPreviewSvg);status('已导出当前原生字体的 SVG 轮廓图形；不含可编辑 OLE 数据。');});
el('export-latex').onclick=()=>action(async()=>{if(!mf.value.trim())throw Error('当前公式为空');downloadEqp(mf.value,'EquationLab.tex');status('已导出当前编辑器的 LaTeX 文本；未改写 Word 选区。');});
el('eqp-import').onclick=()=>el('eqp-file').click();
el('eqp-file').onchange=()=>action(async()=>{const file=el('eqp-file').files[0];if(!file)return;try{
 if(!typographyBase)throw Error('请先读取公式设置');if(file.size>256000)throw Error('偏好文件过大');
 const r=await api('eqp-import',{text:await file.text()}),preset=typographySnapshot();let loaded=0,skipped=0;
 for(const kind of ['styles','sizes'])Object.assign(preset[kind],r.typography[kind]);
 for(const kind of ['spaces','extraSizes'])for(const descriptor of typographyDescriptors[kind]){const value=r[kind]?.[descriptor.key];if(!value)continue;if(knownDimension(typographyBase[kind]?.[descriptor.id])){preset[kind][descriptor.id]=value;loaded++;}else skipped++;}
 typography(typographyBase,preset);eqpSource={text:r.originalText,name:file.name};eqpBaseline=typographySnapshot();el('eqp-preserve').hidden=false;el('eqp-source-note').hidden=false;
 const unsupported=r.unsupported.filter(v=>!['spacing-not-applied','extra-size-not-applied'].includes(v.code)).length;
 el('eqp-source-note').textContent=`已载入 ${file.name}。另存导入文件只更新载入后实际编辑的字段，保留未知键、注释和换行。${unsupported?`有 ${unsupported} 项未识别，未写入公式。`:''}${skipped?`源公式有 ${skipped} 项只读，未覆盖。`:''}`;
 el('typography-panel').open=true;el('spacing-panel').open=true;changed();status(`已载入 .eqp 字体、五类字号及 ${loaded} 项已知间距/额外字号，等待原生检查；插入或写回后生效。未知项随导入文件保留。`);
 }finally{el('eqp-file').value='';}});
el('eqp-export').onclick=()=>action(async()=>{if(!typographyBase)throw Error('请先读取公式设置');const r=await api('eqp-export',{typography:currentTypography()});downloadEqp(r.text,'EquationLab.eqp');status('已导出当前原生偏好的 .eqp，包含全部已知间距与额外字号；导入文件中的未知键可用“另存导入 .eqp”保留。');});
el('eqp-preserve').onclick=()=>action(async()=>{if(!eqpSource||!eqpBaseline)throw Error('请先导入 .eqp');const r=await api('eqp-export',{typography:typographyDifference(eqpBaseline,typographySnapshot()),originalText:eqpSource.text});downloadEqp(r.text,eqpSource.name.replace(/\.eqp$/i,'')+'-edited.eqp');status('已另存导入 .eqp：只更新实际编辑项，未知字段、注释和换行保留。原文件未改动。');});
el('typography-default').onclick=()=>action(async()=>{if(!typographyBase)throw Error('请先读取公式设置');const preset=typographySnapshot();await api('validate',{latex:'x',typography:preset});localStorage.setItem('equationlab.typography',JSON.stringify(preset));newTypography=preset;status('已保存此 Mac 加载项的新公式默认字体、字号和可识别的间距/额外字号。未知编码只随原公式保留，不迁移至新公式。');});
el('typography-reset').onclick=()=>{if(typographyBase)typography(typographyBase,typographyOriginal);changed();};
el('typography-factory').onclick=()=>action(async()=>{if(selectedObject)throw Error('请先新建公式；已有公式可恢复其原始设置');const factory=await api('typography-default',{});clearEqpTemplate();typography(factory);changed();status('当前新公式已恢复原厂 Times+Symbol 12 偏好。已保存的自定义默认未改动；如需以后都使用此设置，请再点“设为新公式默认”。');});
const templates=[['a/b','\\frac{#0}{#?}','分式'],['xⁿ','#0^{#?}','上标'],['xᵢ','#0_{#?}','下标'],['√','\\sqrt{#0}','根号'],['∫','\\int_{#?}^{#?}#0','积分'],['∑','\\sum_{i=1}^{n}#0','求和'],['( )','\\left(#0\\right)','括号'],['[A]','\\begin{bmatrix}#?&#?\\\\#?&#?\\end{bmatrix}','矩阵'],['{x','\\begin{cases}#?&#?\\\\#?&#?\\end{cases}','分段'],['α','\\alpha','希腊字母'],['x⃗','\\vec{#0}','向量'],['x̄','\\overline{#0}','上划线']];
for(const [label,latex,title]of templates){const b=document.createElement('button');b.textContent=label;b.title=title;b.onclick=()=>{mf.focus();mf.insert(latex,{selectionMode:'placeholder'});changed();};el('palette').append(b);}
function tab(name){for(const b of document.querySelectorAll('[data-pane]'))b.classList.toggle('active',b.dataset.pane===name);for(const n of ['editor','document','layout','help'])el('pane-'+n).hidden=n!==name;}
for(const b of document.querySelectorAll('[data-pane]'))b.onclick=()=>tab(b.dataset.pane);
const requestedPane=new URLSearchParams(location.search).get('view');
if(['editor','document','layout','help'].includes(requestedPane))tab(requestedPane);
function status(text,error=false){el('status').textContent=text;el('status').classList.toggle('error',error);}
function controls(){const canWrite=ready&&supports('WordApi','1.3')&&!busy;for(const b of document.querySelectorAll('[data-word]'))b.disabled=!canWrite;el('scan').disabled=!ready||busy;el('update').disabled=!ready||busy||!supports('WordApi','1.5');el('insert').disabled=!canWrite||!valid;el('save').disabled=!canWrite||!valid||!selectedObject;el('export-svg').disabled=busy||!valid||!lastPreviewSvg;el('export-latex').disabled=busy||!mf.value.trim();refreshCommandControls();}
async function api(path,body){const r=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),data=await r.json();if(!r.ok)throw Error(data.error||'本机处理失败');return data;}
async function event(stage,details={}){try{await api('event',{stage,...details});}catch{}}
async function action(f){if(busy)return;busy=true;controls();status('正在处理…');try{await f();}catch(e){status(e.message,true);await event('error',{message:e.message+(e.debugInfo?.errorLocation?' at '+e.debugInfo.errorLocation:'')});}finally{busy=false;controls();}}
function layout(mode){return {mode,numberFormat:el('number-format').value,chapter:Number(el('chapter').value),section:Number(el('section').value)};}
function selectionRange(context,scope='selection'){const selected=context.document.getSelection();if(scope!=='paragraph')return selected;const ps=selected.paragraphs;return ps.getFirst().getRange('Whole').expandTo(ps.getLast().getRange('Whole'));}
async function bodyXml(){return Word.run(async c=>{const x=c.document.body.getOoxml();await c.sync();return x.value;});}
async function scan(){const r=await api('inspect-selection',{ooxml:await bodyXml()});objects=r.objects.filter(o=>!o.part||o.part==='word/document.xml');numberTargets=r.numberTargets??objects.filter(o=>o.layout.bookmarkName).map(o=>({...o.layout,latex:o.latex}));renderObjects();return objects;}
function renderObjects(){el('objects').replaceChildren();el('reference-target').replaceChildren();for(const o of objects){const b=document.createElement('div');b.className='object-row';b.textContent=`${o.index+1}. ${o.latex||'暂不能解析的对象'}`;const s=document.createElement('small');s.textContent=o.parseError||o.previewError||o.layout.numberText||'原生 MathType 公式';b.append(s);el('objects').append(b);}for(const target of numberTargets){const option=document.createElement('option');option.value=target.bookmarkName;option.textContent=target.numberText||target.bookmarkName;el('reference-target').append(option);}if(!objects.length){const p=document.createElement('p');p.className='empty';p.textContent='正文中未找到 MathType OLE 对象。';el('objects').append(p);}if(!numberTargets.length){const option=document.createElement('option');option.value='';option.textContent='暂无 Equation Lab 编号';el('reference-target').append(option);}}
function setMode(){const chars=!!selectedObject&&el('edit-mode').value==='characters';mf.readOnly=chars;el('latex').readOnly=chars;for(const b of el('palette').children)b.disabled=chars;el('characters').hidden=!chars;el('mode-note').textContent=chars?'只替换数字或英文字母，保留原结构、样式和伴随数据。':'重建受支持的结构，保留原对象伴随数据；原有局部样式与精细排版可能改变。';valid=chars?true:valid;controls();}
async function releaseSelection(){const previous=selectedRange;selectedRange=null;if(previous)await Word.run(previous,async c=>{previous.untrack();await c.sync();});}
function reset(){void releaseSelection();clearEqpTemplate();selectedXml=null;selectedObject=null;selectedScope='selection';el('legacy').hidden=true;el('save').hidden=true;el('insert').hidden=false;setMode();mf.value='';api('typography-default',{}).then(base=>{loadTypography(base,newTypography);changed();}).catch(e=>status(e.message,true));changed();status('已新建公式。');}
function changed(){clearTimeout(timer);revision++;valid=false;controls();el('native').textContent='正在检查原生数据…';el('native').classList.remove('error');timer=setTimeout(validate,250);}
async function validate(){const rev=++revision;el('latex').value=mf.value;try{if(!mf.value.trim())throw Error('先输入公式或选择模板。');const patch=typographyPatch(),r=selectedObject?await api('typography-preview',{ooxml:selectedXml,mode:el('edit-mode').value,latex:mf.value,replacements:replacements(),typography:patch}):await api('validate',{latex:mf.value,typography:patch});if(rev!==revision)return;valid=true;el('native').textContent=r.nativeBytes?`原生数据检查通过 · ${r.nativeBytes} B`:'原生公式和字体检查通过';fontPreview(r.svg);el('native').classList.remove('error');}catch(e){if(rev!==revision)return;valid=false;el('native').textContent=e.message;el('native').classList.add('error');fontPreview(null);}controls();}
mf.addEventListener('input',changed);el('latex').oninput=()=>{mf.value=el('latex').value;changed();};el('new').onclick=reset;el('undo').onclick=()=>{mf.executeCommand('undo');changed();};el('redo').onclick=()=>{mf.executeCommand('redo');changed();};el('keyboard').onclick=()=>window.mathVirtualKeyboard.visible?window.mathVirtualKeyboard.hide():window.mathVirtualKeyboard.show();el('edit-mode').onchange=()=>{if(el('edit-mode').value==='characters'){mf.value=selectedObject.latex;el('latex').value=mf.value;}setMode();validate();};
el('read').onclick=()=>action(async()=>{
 await releaseSelection();selectedXml=null;selectedObject=null;
 if(!Office.context.requirements.isSetSupported('WordApi','1.3'))throw Error('安全编辑旧公式需要支持 WordApi 1.3 的 Word');
 async function capture(scope){selectedScope=scope;await Word.run(async c=>{const range=selectionRange(c,scope).track(),x=range.getOoxml();await c.sync();selectedRange=range;selectedXml=x.value;});return api('inspect-selection',{ooxml:selectedXml});}
 try{
  let r=await capture('selection');if(!r.objects.length){await releaseSelection();r=await capture('paragraph');}
  if(r.objects.length!==1)throw Error('请只选中一个 MathType 公式，或它所在的独立段落');
  const o=r.objects[0];if(o.parseError||o.previewError)throw Error(o.parseError||o.previewError);
  selectedObject=o;clearEqpTemplate();mf.value=o.latex;el('latex').value=o.latex;if(o.typography)loadTypography(o.typography);el('legacy').hidden=false;el('save').hidden=false;el('insert').hidden=true;el('edit-mode').value='characters';el('characters').replaceChildren();
  for(const c of o.characters){const label=document.createElement('label');label.textContent=c.char+' →';const input=document.createElement('input');input.value=c.char;input.dataset.offset=c.offset;input.maxLength=1;input.disabled=!/^[A-Za-z0-9]$/.test(c.char);input.setAttribute('aria-label','替换字符 '+c.char);input.oninput=changed;label.append(input);el('characters').append(label);}
  setMode();changed();status('已读取旧公式；修改后可以写回。');
 }catch(error){await releaseSelection();selectedXml=null;selectedObject=null;throw error;}
});
el('save').onclick=()=>action(async()=>{
 if(!selectedXml||!selectedRange)throw Error('请先读取旧公式');
 const replacements=Object.fromEntries([...el('characters').querySelectorAll('input')].map(i=>[i.dataset.offset,i.value]));
 await Word.run(selectedRange,async c=>{
  const range=selectedRange;
  async function check(){const location=selectionRange(c,selectedScope).compareLocationWith(range),x=range.getOoxml();await c.sync();if(location.value!=='Equal')throw Error('文档选区已改变，请重新选中并读取');const comparison=await api('compare-selection',{original:selectedXml,current:x.value});if(!comparison.equal)throw Error('文档内容已改变，请重新选中并读取');return x.value;}
  const original=await check(),r=await api('edit-selection',{ooxml:original,mode:el('edit-mode').value,latex:mf.value,replacements,typography:typographyPatch()});
  await check();range.insertOoxml(r.ooxml,'Replace');await c.sync();
 });
 await releaseSelection();selectedXml=null;selectedObject=null;selectedScope='selection';el('legacy').hidden=true;el('save').hidden=true;el('insert').hidden=false;setMode();status('已写回原生对象。请保存 Word 文档。');await event('edit-written');
});
el('insert').onclick=()=>action(async()=>{if(!valid)throw Error('请先通过原生公式检查');const opts=layout(el('insert-layout').value);await wordActions().atEmptySelection(async c=>{const xml=c.document.body.getOoxml();await c.sync();const inspected=await api('inspect-selection',{ooxml:xml.value});opts.equation=(inspected.numberTargets??inspected.objects.filter(o=>o.layout.bookmarkName)).length+1;return (await api('create',{latex:mf.value,layout:opts,typography:typographyPatch(),initializeContext:needsNumberingContext(inspected,xml.value)})).ooxml;});await finishWrite('已插入原生 MathType 对象。',opts.mode.startsWith('numbered-'));await event('insert-written');});
el('scan').onclick=()=>action(async()=>{await scan();status(`已读取正文中的 ${objects.length} 个对象。`);});
el('reference').onclick=()=>action(async()=>{const bookmarkName=el('reference-target').value;if(!bookmarkName)throw Error('先刷新文档并选择 Equation Lab 编号');await wordActions().atEmptySelection(async c=>{const xml=c.document.body.getOoxml();await c.sync();const inspected=await api('inspect-selection',{ooxml:xml.value}),o=(inspected.numberTargets??[]).find(o=>o.bookmarkName===bookmarkName);if(!o)throw Error('引用目标已改变，请刷新后重选');return (await api('reference',{bookmarkName,cachedText:o.numberText,prefix:el('reference-prefix').value})).ooxml;});await finishWrite('已插入交叉引用。');});
async function updateFields(){if(!Office.context.requirements.isSetSupported('WordApi','1.5'))throw Error('此 Word 版本暂不能通过加载项更新域；请在 Word 中选中正文并更新域');await Word.run(async c=>{const fields=c.document.body.fields;fields.load('items/code');await c.sync();for(const f of fields.items)if(/^\s*SEQ (EquationLab|ELChapter|ELSection)\b/i.test(f.code))f.updateResult();await c.sync();for(const f of fields.items)if(/^\s*REF EL_[A-Za-z0-9_]+\b/i.test(f.code))f.updateResult();await c.sync();});}
el('update').onclick=()=>action(async()=>{await updateFields();await scan();status('已更新正文中的 Equation Lab 编号和引用。');});
el('arrange').onclick=()=>action(async()=>{await Word.run(async c=>{const ps=c.document.getSelection().paragraphs,first=ps.getFirst().getRange('Whole'),last=ps.getLast().getRange('Whole'),range=first.expandTo(last);const x=range.getOoxml();await c.sync();const original=x.value,r=await api('arrange-selection',{ooxml:original,layout:layout(el('arrange-layout').value)});const latest=range.getOoxml();await c.sync();if(!(await api('compare-selection',{original,current:latest.value})).equal)throw Error('选中段落已改变，请重新操作');const location=selectionRange(c,'paragraph').compareLocationWith(range);await c.sync();if(location.value!=='Equal')throw Error('选中段落已改变，请重新操作');range.insertOoxml(r.ooxml,'Replace');await c.sync();});await finishWrite('已应用公式编排。');await event('layout-written');});
el('chapter-break').onclick=()=>action(async()=>{await wordActions().atEmptySelection(async()=>(await api('chapter',{chapter:Number(el('chapter').value),section:Number(el('section').value),resetEquation:el('reset').checked})).ooxml);await finishWrite('已插入隐藏的章 / 节标记。');});
el('standalone-number').onclick=()=>action(async()=>{await wordActions().atEmptySelection(async c=>{const xml=c.document.body.getOoxml();await c.sync();const r=await api('inspect-selection',{ooxml:xml.value}),opts=layout('numbered-right');delete opts.mode;opts.equation=(r.numberTargets??[]).length+1;return (await api('number',{layout:opts,initializeContext:needsNumberingContext(r,xml.value)})).ooxml;});await finishWrite('已插入独立 Equation Lab 编号。');});
controls();Promise.allSettled([api('typography-default',{}),api('typography-descriptors',{})]).then(([defaults,descriptors])=>{
 if(defaults.status==='rejected')throw defaults.reason;
 if(descriptors.status==='fulfilled'){typographyDescriptors=descriptors.value;el('spacing-preview-note').textContent=descriptors.value.spacingPreview+' 未知编码与源公式缺失项只读保留。';}
 else{el('spacing-preview-note').textContent='当前本机服务尚未提供 33 项设置描述。原有字体字号可继续使用；间距原值保留。更新本机服务后重新打开面板。';el('typography-default').disabled=true;}
 const pending=selectedObject?typographyPatch():null;if(selectedObject)typography(selectedObject.typography,pending);else loadTypography(defaults.value,newTypography);validate();
}).catch(e=>status(e.message,true));
if(typeof Office!=='undefined')Office.onReady(async info=>{if(info.host!==Office.HostType.Word){el('host').textContent='预览';status('界面预览。文档操作需在 Word 中运行。');return;}ready=true;el('host').textContent='Word';status('已连接 Word。');controls();el('runtime-note').textContent=supports('SharedRuntime','1.1')?'顶栏与侧栏共用当前编辑状态。':'此 Word 不支持 SharedRuntime 1.1；请使用侧栏“全部命令”。顶栏完整命令需要 Mac Word 16.61 或更新版本。';await event('ready',{host:info.host,platform:info.platform});});else{el('host').textContent='预览';status('本机界面预览，尚未连接 Word。');}

async function finishWrite(text,update=true){try{if(update)await updateFields();status(text+(update?' 编号与引用已更新。':''));}catch(e){status(text+' 自动更新尚未完成：'+e.message,true);}}
setTimeout(()=>{if(!ready){el('host').textContent='预览';status('本机界面预览。文档操作需在 Word 中运行。');}},3000);

function supports(name,version){return typeof Office!=='undefined'&&Office.context.requirements.isSetSupported(name,version);}
function needsNumberingContext(inspected,xml){const context=inspected.numberingContext;if(context)return !context.equation&&!(context.chapter&&context.section);return !xml.includes('SEQ EquationLab')&&!xml.includes('ELChapter');}
function wordActions(){if(!ready)throw Error('此操作需要在 Word 中运行');return EquationLabWordActions.create({Word,api,supports});}
function focusControl(id){const target=el(id);if(!target)return;for(let parent=target;parent;parent=parent.parentElement)if(parent.tagName?.toLowerCase()==='details')parent.open=true;target.scrollIntoView?.({block:'center'});target.focus?.({preventScroll:true});}
function refreshCommandControls(){
 if(typeof EquationLabCommands==='undefined')return;
 const state={ready,busy,supports};
 for(const button of document.querySelectorAll('[data-command]')){const availability=EquationLabCommands.availability(EquationLabCommands.get(button.dataset.command),state);button.disabled=!availability.enabled;button.title=availability.reason;}
 if(!ready||!supports('SharedRuntime','1.1')||!supports('RibbonApi','1.1')||!Office.ribbon?.requestUpdate)return;
 const groups=EquationLabCommands.groups.map(group=>({id:'EquationLab.'+group.id,controls:group.commands.map(id=>({id:EquationLabCommands.get(id).ribbonId,enabled:EquationLabCommands.availability(EquationLabCommands.get(id),state).enabled}))}));
 const next=JSON.stringify(groups);if(next===ribbonState)return;ribbonState=next;
 Office.ribbon.requestUpdate({tabs:[{id:'EquationLab.Tab',groups}]}).catch(()=>{ribbonState='';});
}
if(typeof EquationLabCommands!=='undefined'){
 const execute=async name=>{
  if(name==='reference-picker'){await action(async()=>{await scan();status(numberTargets.length?'请选择引用目标，再确认插入。':'正文中暂无可引用的 Equation Lab 编号。');});return;}
  if(name==='previous'||name==='next'){await action(async()=>{const result=await wordActions().navigate(name);status(result.found?(result.paragraphFallback?'已定位独立公式段落。':'已选中 MathType 公式。'):(name==='previous'?'前方没有正文 MathType 公式；选区保持不变。':'后方没有正文 MathType 公式；选区保持不变。'));});return;}
  await el(name).onclick();
 };
 const dispatch=EquationLabCommands.createDispatcher({state:()=>({ready,busy,supports}),showPane:async pane=>{tab(pane);if(ready&&supports('SharedRuntime','1.1')&&Office.addin?.showAsTaskpane)await Office.addin.showAsTaskpane();},focus:focusControl,execute,prepare:async mode=>{if(selectedObject)throw Error('当前正在编辑旧公式；请先写回，或明确点击“新建”。');el('insert-layout').value=mode;status('已选择'+el('insert-layout').selectedOptions?.[0]?.textContent+'；编辑后确认插入。');}});
 globalThis.EquationLabRunCommand=dispatch;
 globalThis.EquationLabCommandError=error=>status(error.message,true);
 for(const group of EquationLabCommands.groups){const section=document.createElement('section'),heading=document.createElement('h2');heading.textContent=group.label;section.append(heading);const row=document.createElement('div');row.className='command-grid';for(const id of group.commands){const command=EquationLabCommands.get(id),button=document.createElement('button');button.dataset.command=id;button.textContent=command.label;row.append(button);}section.append(row);el('shared-commands').append(section);}
 for(const [label,reason]of EquationLabCommands.unsupported){const row=document.createElement('div'),button=document.createElement('button'),description=document.createElement('small');button.disabled=true;button.textContent=label+' · 未支持';button.title=reason;description.textContent=reason;row.append(button,description);el('capability-items').append(row);if(['批量格式化','批量转换','批量公式导出','发布 MathPage','TeX 切换'].includes(label)){const item=row.cloneNode(true);el('unsupported-tools').append(item);}}
 for(const button of document.querySelectorAll('[data-command]'))button.onclick=()=>dispatch(button.dataset.command).catch(globalThis.EquationLabCommandError);
 for(const symbol of EquationLabWordActions.symbols){const button=document.createElement('button');button.textContent=symbol;button.dataset.word='';button.title='在 Word 空白光标处插入 '+symbol;button.setAttribute('aria-label',button.title);button.onclick=()=>action(async()=>{await wordActions().insertSymbol(symbol);status('已在 Word 光标处插入 '+symbol+'。');});el('word-symbol-grid').append(button);}
 el('open-latex').onclick=()=>focusControl('latex');
 controls();
}
