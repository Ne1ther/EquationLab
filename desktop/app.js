MathfieldElement.fontsDirectory='vendor/fonts';MathfieldElement.soundsDirectory=null;
const $=id=>document.getElementById(id),mf=$('formula');mf.mathVirtualKeyboardPolicy='manual';mf.smartFence=true;mf.maxMatrixCols=31;mf.environmentPopoverPolicy='off';
function nativeSelectAllForKeyboard(){
 const active=document.activeElement;
 if(active===mf){mf.executeCommand('selectAll');return true;}
 if(active instanceof HTMLTextAreaElement||active instanceof HTMLInputElement){active.select();return true;}
 return false;
}
window.nativeSelectAllForKeyboard=nativeSelectAllForKeyboard;
const editorMacros={
 eltab:{def:'\\hspace{1em}',args:0,expand:false,captureSelection:true},
 sfrac:{def:'{}^{#1}\\! /\\! {}_{#2}',args:2,expand:false},
 sout:{def:'\\enclose{horizontalstrike}{#1}',args:1,expand:false},
 underbracket:{def:'\\underset{\\unicode{"23B5}}{#1}',args:1,expand:false},
 overbracket:{def:'\\overset{\\unicode{"23B4}}{#1}',args:1,expand:false}
 ,bra:{def:'\\left\\langle#1\\right|',args:1,expand:false}
 ,ket:{def:'\\left|#1\\right\\rangle',args:1,expand:false}
 ,braket:{def:'\\left\\langle#1\\right\\rangle',args:1,expand:false}
 ,eqqcolon:{def:'\\unicode{"2255}',args:0,expand:false}
 ,mtdoublearrow:{def:'\\overset{#2}{\\underset{#3}{\\rightleftarrows}}',args:3,expand:false}
 ,mtmatrix:{def:'#4',args:4,expand:false}
 ,underrightharpoon:{def:'\\underset{\\rightharpoonup}{#1}',args:1,expand:false}
 ,hline:{def:'\\hspace{0em}',args:0,expand:false}
};
mf.macros={...mf.macros,...window.prepareEquationMacros({...editorMacros,...window.equationCatalogMacros})};
window.installEquationMacroEditing(mf);
const pending=new Map();let sequence=0,revision=0,timer,valid=false,busy=false,source=null,selected=null,mode='rebuild';
var editorViewport;
let wordTicket=null,wordSaveQueued=false,wordOutcomeUnknown=false,wordNavigating=false,wordNavigationTimer;const idleWaiters=new Set();
let wordCommitRunning=null;
let editingRuler,editorHistory=[],editorHistoryIndex=-1,restoringHistory=false;
function rulerPatch(){return editingRuler===undefined?{}:{ruler:editingRuler};}
// MathLive 0.111.1 adapter: same matrix model used by its own context menu.
function matrixContext(){const env=mf._mathfield?.model?.parentEnvironment;if(!env||!['array','matrix','pmatrix','bmatrix','Bmatrix','vmatrix','Vmatrix','cases'].includes(env.environmentName))return null;return {rows:env.rows.length,columns:env.rows.reduce((n,row)=>Math.max(n,row.length),0)};}
function historySnapshot(){return {latex:mf.value,ruler:editingRuler===undefined?null:editingRuler.map(t=>({...t})),selection:mf.selection};}
function recordEditorHistory(){
 if(restoringHistory)return;const next=historySnapshot(),old=editorHistory[editorHistoryIndex];
 if(old&&old.latex===next.latex&&JSON.stringify(old.ruler)===JSON.stringify(next.ruler))return;
 editorHistory.splice(editorHistoryIndex+1);editorHistory.push(next);if(editorHistory.length>150)editorHistory.shift();editorHistoryIndex=editorHistory.length-1;
}
window.resetEditorHistory=()=>{editorHistory=[];editorHistoryIndex=-1;recordEditorHistory();};
function editorUndo(redo=false){const index=editorHistoryIndex+(redo?1:-1);if(index<0||index>=editorHistory.length)return;editorHistoryIndex=index;const saved=editorHistory[index];restoringHistory=true;try{editingRuler=saved.ruler===null?undefined:saved.ruler.map(t=>({...t}));mf.value=saved.latex;if(saved.selection)mf.selection=saved.selection;changed();}finally{restoringHistory=false;}mf.focus();}
window.nativeReply=({id,result})=>{const p=pending.get(id);if(!p)return;pending.delete(id);result.ok?p.resolve(result.data):result.cancelled?p.resolve(null):p.reject(Error(result.error));};
function native(action,payload={}){return new Promise((resolve,reject)=>{const id=String(++sequence);pending.set(id,{resolve,reject});window.webkit.messageHandlers.native.postMessage({id,action,payload});});}
function sourceEditMode(){return mode==='rebuild'&&selected&&mf.value===selected.editorBaseline?'characters':mode;}
function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error);requestWorkbenchSync();}
function status(title,detail,error=false,bytes=''){$('status-title').textContent=title;$('status-detail').textContent=detail;$('native-status').classList.toggle('error',error);$('native-bytes').textContent=bytes;requestWorkbenchSync();}
// A typography-only check must not flash the export controls off and on. A
// click can wait for that check, but may never submit the previous preferences.
let validationRunning=null,validationRequested=false,validationPending=false,validatedFormulaKey=null;
function formulaKey(){return JSON.stringify([mf.value,editingRuler,source?.path??null,selected?.index??null,selected?.nativeSha256??null,selected?.error??null,mode,[...$('character-editor').querySelectorAll('input')].map(e=>[e.dataset.offset,e.value])]);}
function exportAvailable(){return valid||validationPending&&validatedFormulaKey!==null&&formulaKey()===validatedFormulaKey;}
function controls(){const blocked=busy||wordNavigating||!exportAvailable();for(const id of ['export','save-edit','copy-png'])$(id).disabled=blocked;$('word-session-save').disabled=blocked||wordOutcomeUnknown;$('copy-latex').disabled=busy||wordNavigating||!mf.value.trim();document.querySelector('.editor-card').inert=busy||wordNavigating;requestWorkbenchSync();}
async function ensureValid(){clearTimeout(timer);if(!valid)await validate();if(!valid)throw Error('请先完成原生数据检查');}
async function validate(){
 if(wordNavigating)return;
 validationRequested=true;validationPending=true;
 if(validationRunning)return validationRunning;
 validationRunning=(async()=>{
  while(validationRequested){
   validationRequested=false;const rev=++revision,latex=mf.value,key=formulaKey();$('latex').value=latex;valid=false;controls();
   if(!latex.trim()){validationPending=false;validatedFormulaKey=null;window.desktopFontPreview?.(null);controls();status('公式为空','先输入公式或选择模板。');continue;}
   try{
    const patch=window.desktopTypographyPatch?.();
    const r=source&&selected?await native('editPreview',{input:source.path,index:selected.index,mode:sourceEditMode(),latex,replacements:Object.fromEntries([...$('character-editor').querySelectorAll('input')].map(e=>[e.dataset.offset,e.value])),typography:patch,...rulerPatch()}):await native('validate',{latex,typography:patch,...rulerPatch()});
    if(rev!==revision)continue;
    valid=true;validationPending=false;validatedFormulaKey=key;window.desktopFontPreview?.(r.svg);status('原生 MathType 数据检查通过','可导出 Equation.DSMT4 对象，包含 Equation Native 数据。',false,r.nativeBytes?r.nativeBytes+' B':'');
   }catch(e){if(rev!==revision)continue;validationPending=false;validatedFormulaKey=null;status('此结构暂不能写入原生 MathType','可以继续编辑；导出已阻止。'+e.message,true);window.desktopFontPreview?.(null);}
   controls();
  }
 })();
 try{await validationRunning;}finally{validationRunning=null;}
}
function changed(scheduleValidation=true){window.syncEquationMacros(mf);recordEditorHistory();editorViewport?.refresh();clearTimeout(timer);revision++;$('latex').value=mf.value;valid=false;validationPending=true;controls();status('正在检查原生数据…','检查通过后即可导出 MathType 对象。');if(scheduleValidation)timer=setTimeout(validate,90);}
mf.addEventListener('input',changed);$('latex').addEventListener('input',()=>{mf.value=$('latex').value;changed();});
const groups={
'常用结构':[['a/b','\\frac{#0}{#?}','分式'],['xⁿ','#0^{#?}','上标'],['xᵢ','#0_{#?}','下标'],['√x','\\sqrt{#0}','根号'],['ⁿ√x','\\sqrt[#?]{#0}','n次根'],['(x)','\\left(#0\\right)','圆括号'],['[x]','\\left[#0\\right]','方括号'],['{x}','\\left\\{#0\\right\\}','花括号'],['|x|','\\left|#0\\right|','绝对值'],['a/b','\\tfrac{#0}{#?}','小分式'],['a/b','\\sfrac{#0}{#?}','斜分式'],['xᵢⁿ','#0_{#?}^{#?}','上下标'],['⟨x⟩','\\left\\langle #0\\right\\rangle','尖括号'],['‖x‖','\\left\\|#0\\right\\|','范数'],['⌊x⌋','\\left\\lfloor #0\\right\\rfloor','向下取整'],['⌈x⌉','\\left\\lceil #0\\right\\rceil','向上取整']],
'积分与求和':[['∫','\\int_{#?}^{#?}#0','积分'],['∬','\\iint_{#?}^{#?}#0','二重积分'],['∑','\\sum_{i=1}^{n}#0','求和'],['∏','\\prod_{i=1}^{n}#0','乘积'],['lim','\\lim_{x\\to 0}#0','极限'],['∫','\\int #0','不定积分'],['∭','\\iiint_{#?}^{#?}#0','三重积分'],['∮','\\oint_{#?}#0','围道积分'],['∐','\\coprod_{i=1}^{n}#0','余积'],['⋃','\\bigcup_{i=1}^{n}#0','大并集'],['⋂','\\bigcap_{i=1}^{n}#0','大交集'],['limsup','\\limsup_{n\\to\\infty}#0','上极限']],
'矩阵':[['[aᵢⱼ]','\\begin{bmatrix}#?&#?\\\\#?&#?\\end{bmatrix}','2×2'],['(aᵢⱼ)','\\begin{pmatrix}#?&#?\\\\#?&#?\\end{pmatrix}','圆括号'],['|A|','\\begin{vmatrix}#?&#?\\\\#?&#?\\end{vmatrix}','行列式'],['{x','\\begin{cases}#?&#?\\\\#?&#?\\end{cases}','分段'],['a = b','\\begin{aligned}#?&=#?\\\\#?&=#?\\end{aligned}','对齐'],['[aᵢⱼ]','\\begin{bmatrix}#?&#?&#?\\\\#?&#?&#?\\\\#?&#?&#?\\end{bmatrix}','3×3'],['aᵢⱼ','\\begin{matrix}#?&#?\\\\#?&#?\\end{matrix}','无括号'],['{aᵢⱼ}','\\begin{Bmatrix}#?&#?\\\\#?&#?\\end{Bmatrix}','花括号'],['‖A‖','\\begin{Vmatrix}#?&#?\\\\#?&#?\\end{Vmatrix}','双竖线'],['[aᵢ]','\\begin{bmatrix}#?\\\\#?\\\\#?\\end{bmatrix}','列向量'],['[aⱼ]','\\begin{bmatrix}#?&#?&#?\\end{bmatrix}','行向量'],['[A|b]','\\left[\\begin{array}{cc|c}#?&#?&#?\\\\#?&#?&#?\\end{array}\\right]','增广矩阵']],
'希腊字母':[['α','\\alpha'],['β','\\beta'],['γ','\\gamma'],['δ','\\delta'],['θ','\\theta'],['λ','\\lambda'],['μ','\\mu'],['π','\\pi'],['ρ','\\rho'],['σ','\\sigma'],['φ','\\varphi'],['ω','\\omega'],['Δ','\\Delta'],['Ω','\\Omega']],
'运算与关系':[['±','\\pm'],['×','\\times'],['⋅','\\cdot'],['≤','\\leq'],['≥','\\geq'],['≠','\\neq'],['≈','\\approx'],['∈','\\in'],['∞','\\infty'],['∂','\\partial'],['∇','\\nabla'],['→','\\to'],['÷','\\div'],['⩽','\\leqslant'],['⩾','\\geqslant'],['∉','\\notin'],['⊆','\\subseteq'],['∩','\\cap'],['∪','\\cup'],['⇒','\\Rightarrow']],
'标记与函数':[['x̄','\\overline{#0}','上划线'],['x̂','\\hat{#0}','帽子'],['x⃗','\\vec{#0}','向量'],['ẋ','\\dot{#0}','点'],['sin','\\sin #0'],['cos','\\cos #0'],['log','\\log #0'],['ln','\\ln #0'],['abc','\\mathrm{#0}','正体'],['𝐱','\\mathbf{#0}','粗体'],['x̲','\\underline{#0}','下划线'],['ẍ','\\ddot{#0}','双点'],['x̂','\\widehat{#0}','宽帽符号'],['x̃','\\widetilde{#0}','宽波浪线'],['⏞','\\overbrace{#0}^{#?}','上花括注'],['⏟','\\underbrace{#0}_{#?}','下花括注'],['tan','\\tan #0'],['exp','\\exp #0']]
};
for(const name of Object.keys(groups)){const b=document.createElement('button');b.textContent=name;b.onclick=()=>palette(name);$('categories').append(b);}
function palette(name){[...$('categories').children].forEach(b=>b.classList.toggle('selected',b.textContent===name));$('palette').replaceChildren();for(const [label,latex,hint]of groups[name]){const b=document.createElement('button');b.textContent=label;b.title=hint||label;b.disabled=!!selected&&(mode==='characters'||!!selected.error);if(hint){const s=document.createElement('small');s.textContent=hint;b.append(s);}b.onclick=()=>{mf.focus();mf.insert(latex,{selectionMode:'placeholder'});changed();};$('palette').append(b);}}
palette('常用结构');$('undo').onclick=()=>editorUndo();$('redo').onclick=()=>editorUndo(true);$('keyboard').onclick=()=>{if(window.mathVirtualKeyboard.visible)window.mathVirtualKeyboard.hide();else{mf.focus();window.mathVirtualKeyboard.show();}};
async function perform(fn,acceptWordNavigation=false){if(busy||wordNavigating&&!acceptWordNavigation)return false;busy=true;controls();message('正在处理…');try{return await fn()!==false;}catch(e){message(e.message,true);return false;}finally{busy=false;controls();for(const wake of [...idleWaiters])wake();}}
async function waitForEditorIdle(timeoutMs=25000){
 while(busy)await new Promise((resolve,reject)=>{
  const wake=()=>{clearTimeout(timeout);idleWaiters.delete(wake);resolve();};
  const timeout=setTimeout(()=>{idleWaiters.delete(wake);reject(Error('编辑器仍在处理当前操作，请稍后重试。'));},timeoutMs);
  idleWaiters.add(wake);
 });
}
function resetNewFormula(){if(wordTicket){message('请先保存或取消当前 Word 编辑会话。',true);return false;}source=null;selected=null;loadObjectLayout({});editingRuler=undefined;$('source-panel').hidden=true;$('save-edit').hidden=true;$('arrange-source').hidden=true;$('title').textContent='新建公式';$('eyebrow').textContent='FORMULA EDITOR';$('subtitle').textContent='点击模板、输入内容，再导出可编辑的 Word 公式。';mf.readOnly=false;$('latex').readOnly=false;for(const b of $('palette').querySelectorAll('button'))b.disabled=false;mf.value='';window.resetEditorHistory?.();renderObjects();window.desktopTypographyNew?.();changed();}
window.nativeNew=()=>busy?false:resetNewFormula();
window.nativeOpen=()=>perform(async()=>{if(wordTicket)throw Error('请先保存或取消当前 Word 编辑会话');const r=await native('open');if(!r){message('');return;}source=r;message('已读取 '+r.objects.length+' 个 MathType 对象');renderObjects();$('subtitle').textContent=r.path;if(r.objects.length)selectObject(0);else message('这个文档未找到 MathType OLE 公式。Word 自带公式和纯图片不在此列表。');});
function renderObjects(){$('objects').replaceChildren();$('count').textContent=source?.objects.length||'';for(const o of source?.objects||[]){const b=document.createElement('button');b.className='object-row'+(selected?.index===o.index?' selected':'');b.textContent=`${o.index+1}. ${o.latex||'暂不支持的原生结构'}`;const s=document.createElement('small');s.textContent=o.error?'只读 · '+o.progId:'Equation Native · '+o.application;b.append(s);b.onclick=()=>window.nativeSelectObject(o.index);$('objects').append(b);}}
function selectObject(index,{scheduleValidation=true}={}){selected=source.objects[index];if(!selected)return;loadObjectLayout(selected);mode='rebuild';$('title').textContent='编辑文档中的公式';$('eyebrow').textContent='LEGACY MATHTYPE';$('source-panel').hidden=false;$('save-edit').hidden=false;$('arrange-source').hidden=false;$('source-class').textContent=selected.progId;mf.value=selected.latex||'';selected.editorBaseline=mf.value;editingRuler=selected.ruler??undefined;window.resetEditorHistory?.();window.desktopTypographyLoad?.(selected.typography);renderModes();const sidebarSync=renderObjects();$('original-preview').replaceChildren();if(selected.image){const image=document.createElement('img');image.src=selected.image;image.alt='原文档中的公式预览';$('original-preview').append(image);}if(selected.error){status('当前公式只读',selected.error,true);valid=false;controls();}else changed(scheduleValidation);return sidebarSync;}
function renderModes(){mf.readOnly=mode==='characters'||!!selected?.error;$('latex').readOnly=mode==='characters'||!!selected?.error;for(const b of $('palette').querySelectorAll('button'))b.disabled=mode==='characters'||!!selected?.error;$('mode-characters').classList.toggle('selected',mode==='characters');$('mode-rebuild').classList.toggle('selected',mode==='rebuild');$('character-editor').hidden=mode!=='characters';$('character-editor').replaceChildren();$('mode-note').textContent=mode==='characters'?'只修改字符字节，保留原生结构、样式和伴随数据。支持数字、英文字母及已确认编码的希腊字母。':'可编辑分式、根式和上下标等结构；修改结构可能重新排布局部样式。只替换字符时可用“保留结构”。';for(const c of (selected?.characters||[]).filter(c=>c.editable)){const label=document.createElement('label');label.textContent=c.char+' →';const input=document.createElement('input');input.value=c.char;input.maxLength=1;input.dataset.offset=c.offset;input.setAttribute('aria-label',`替换字符 ${c.char}，位置 ${c.offset}`);input.disabled=c.editable!==true||!!selected.error;if(c.editReason)input.title=c.editReason;input.oninput=previewCharacterEdit;label.append(input);$('character-editor').append(label);}if(selected?.error){mf.readOnly=true;valid=false;}if(window.workbenchEnglish!==undefined)window.setWorkbenchLanguage?.(window.workbenchEnglish?'en':'zh-Hans');}
async function previewCharacterEdit(){const rev=++revision;valid=false;validationPending=true;controls();const replacements=Object.fromEntries([...$('character-editor').querySelectorAll('input')].map(e=>[e.dataset.offset,e.value]));try{const r=await native('editPreview',{input:source.path,index:selected.index,replacements,typography:window.desktopTypographyPatch?.(),...rulerPatch()});if(rev!==revision)return;mf.value=r.latex;$('latex').value=r.latex;window.desktopFontPreview?.(r.svg);valid=true;validationPending=false;validatedFormulaKey=formulaKey();status('原生字符修改检查通过','保存时只替换对应字符字节，原公式结构和样式保留。');}catch(e){if(rev!==revision)return;validationPending=false;validatedFormulaKey=null;status('字符暂不能这样替换',e.message,true);}controls();}
$('mode-characters').onclick=()=>{if(!selected)return;mode='characters';mf.value=selected.latex||'';renderModes();changed();};$('mode-rebuild').onclick=()=>{if(!selected)return;mode='rebuild';renderModes();changed();};
window.nativeExport=()=>perform(async()=>{if(wordTicket)throw Error('请使用保存并返回 Word');await ensureValid();const exportSource=source&&selected?{path:source.path,index:selected.index,mode:sourceEditMode(),replacements:Object.fromEntries([...$('character-editor').querySelectorAll('input')].map(e=>[e.dataset.offset,e.value]))}:undefined;const r=await native('export',{equations:[{latex:mf.value,layout:wordLayout(),typography:window.desktopTypographyPatch?.(),...rulerPatch()}],fragment:true,source:exportSource});if(r)message('已导出原生 MathType Word：'+r.path);else message('');});
$('export').onclick=window.nativeExport;$('nav-new').onclick=window.nativeNew;$('nav-open').onclick=window.nativeOpen;
$('save-edit').onclick=()=>perform(async()=>{if(!source||!selected)throw Error('请先选择可编辑的原生公式');await ensureValid();const replacements=Object.fromEntries([...$('character-editor').querySelectorAll('input')].map(e=>[e.dataset.offset,e.value]));const r=await native('edit',{input:source.path,index:selected.index,mode:sourceEditMode(),latex:mf.value,replacements,typography:window.desktopTypographyPatch?.(),...rulerPatch()});if(r)message('已另存副本，原始文档保留：'+r.path);else message('');});
$('copy-latex').onclick=()=>perform(async()=>{await native('copyLatex',{latex:mf.value});message('已复制 LaTeX');});$('copy-png').onclick=()=>perform(async()=>{await ensureValid();const original=source&&selected?{path:source.path,index:selected.index,mode:sourceEditMode(),replacements:Object.fromEntries([...$('character-editor').querySelectorAll('input')].map(e=>[e.dataset.offset,e.value]))}:undefined;await native('copyPNG',{latex:mf.value,typography:window.desktopTypographyPatch?.(),...rulerPatch(),source:original});message('已复制当前原生偏好的预览图片；提交可编辑公式请使用“导出 MathType Word”。');});
let favorites;try{favorites=JSON.parse(localStorage.getItem('equationlab.favorites')||'[]');}catch{favorites=[];}
function renderFavorites(){$('favorites').replaceChildren();for(const value of favorites){const b=document.createElement('button');b.className='favorite';b.textContent=value;b.title=value;b.onclick=()=>{if(wordTicket){message('请先保存或取消当前 Word 编辑会话。',true);return;}window.nativeNew();mf.value=value;changed();};$('favorites').append(b);}}
$('add-favorite').onclick=()=>{if(!mf.value.trim())return;favorites=[mf.value,...favorites.filter(v=>v!==mf.value)].slice(0,20);localStorage.setItem('equationlab.favorites',JSON.stringify(favorites));renderFavorites();message('已收藏当前公式');};renderFavorites();validate();

function syncSidebar(ended=false,navigating=false,switching=false,endedWordTicket=null){const acknowledgement=native('state',{wordSession:!!wordTicket&&!wordNavigating,wordSessionIsInsertion:source?.insertion===true,wordTicket,wordSessionEnded:ended,wordSessionNavigating:navigating,wordSessionSwitching:switching,...endedWordTicket?{endedWordTicket}:{},objects:(source?.objects||[]).map(o=>({id:o.index,label:`${o.index+1}. ${o.latex||'暂不支持的结构'}`,detail:o.error?'只读 · '+o.progId:'原生 MathType · '+o.application})),favorites,selected:selected?.index??null}).catch(()=>{});requestWorkbenchSync();return acknowledgement;}
window.nativeSelectObject=async index=>{
 if(busy||wordNavigating||!source?.objects[index]||selected?.index===index)return;
 if(!wordTicket){selectObject(index);return;}
 if(source.insertion){message('请先完成或取消新公式，再切换文档中的公式。');return;}
 if(!source.hasDocumentContext){message('当前 Word 插件未提供文档列表，请更新插件后重新打开公式。',true);return;}
 if(wordSessionChanged()){message('当前公式有修改，请先保存回 Word，再打开其他公式。',true);return;}
 // Browse locally; bind to the selected object's Word client site on save.
 await selectObject(index);message('已打开文档中的第 '+(index+1)+' 个公式。');return true;
};window.nativeFavorite=index=>{if(busy)return;if(wordTicket){message('请先保存或取消当前 Word 编辑会话。',true);return;}window.nativeNew();mf.value=favorites[index];changed();};$('favorite-top').onclick=()=>$('add-favorite').click();
const originalRenderObjects=renderObjects;renderObjects=function(){originalRenderObjects();return syncSidebar();};const originalRenderFavorites=renderFavorites;renderFavorites=function(){originalRenderFavorites();return syncSidebar();};syncSidebar();

function loadObjectLayout(object){
 const layout=object.layout||{},unknown=!!wordTicket&&!source?.hasDocumentContext||layout.mode==='unknown';
 for(const [id,key] of [['layout-mode','mode'],['layout-format','numberFormat'],['layout-chapter','chapter'],['layout-section','section']]){
  const el=$(id);el.disabled=!!wordTicket;
  if(id==='layout-mode'){
   let option=[...el.options].find(o=>o.value==='unknown');
   if(unknown&&!option){option=document.createElement('option');option.value='unknown';option.textContent='未读取文档信息';el.append(option);}
   el.value=unknown?'unknown':layout.mode||'inline';
  }else el.value=unknown?'':layout[key]??(wordTicket?'':key==='numberFormat'?'(#E1)':'1');
 }
}
function wordLayout(){return {mode:$('layout-mode').value,numberFormat:$('layout-format').value,chapter:Number($('layout-chapter').value),section:Number($('layout-section').value)};}
$('arrange').onclick=()=>perform(async()=>{if(!source||!selected)throw Error('请先打开 Word 并选择公式');const r=await native('arrange',{input:source.path,indices:$('arrange-all').checked?source.objects.map(o=>o.index):[selected.index],layout:wordLayout()});if(r)message('已另存编排后的副本，公式原生数据保留：'+r.path);else message('');});

window.nativeOpenWordSession=async ticket=>{
 const timingStart=performance.now();
 if(!/^[a-f0-9]{64}$/.test(ticket))throw Error('无效的 Word 编辑会话');
 if(wordOutcomeUnknown){if(ticket!==wordTicket)await native('wordSessionCancel',{ticket}).catch(()=>{});message('上次 Word 结果仍未确认。请先结束当前会话并检查 Word，再打开新的编辑会话。',true);return false;}
 const generation=window.wordSessionGeneration??0;
 try{await waitForEditorIdle();}catch(error){await native('wordSessionCancel',{ticket}).catch(()=>{});message(error.message,true);return false;}
 if(generation!==(window.wordSessionGeneration??0)){await native('wordSessionCancel',{ticket}).catch(()=>{});return false;}
 if(wordTicket===ticket&&!wordNavigating){
  try{await native('wordSessionRead',{ticket});return generation===(window.wordSessionGeneration??0)&&wordTicket===ticket;}
  catch(error){if(generation===(window.wordSessionGeneration??0))message('这个 Word 编辑会话已经结束，请重新打开该公式。',true);return false;}
 }
 return perform(async()=>{
 try{
  if(wordSaveQueued){await native('wordSessionCancel',{ticket});message('上次保存仍在等待 Word 确认，请先完成保存后再打开其他公式。',true);return false;}
  // Read and validate the new binding before releasing the old one. A failed
  // open must leave both the displayed draft and its original ticket intact.
  const readStarted=performance.now();
  const r=await native('wordSessionRead',{ticket});
  const readFinished=performance.now();
  // A cancelled window must not be resurrected by a delayed Word read.
  if(generation!==(window.wordSessionGeneration??0)){await native('wordSessionCancel',{ticket}).catch(()=>{});return false;}
  const changedDraft=!wordNavigating&&(wordTicket?wordSessionChanged():selected?wordSessionChanged():!!mf.value.trim());
  const sameDraftTarget=changedDraft&&wordTicket&&source?.documentIdentity&&r.documentIdentity===source.documentIdentity&&source.documentSnapshot&&r.documentSnapshot===source.documentSnapshot&&r.activeIndex===selected?.index&&/^[a-f0-9]{64}$/.test(selected?.nativeSha256??'')&&r.objects[r.activeIndex]?.nativeSha256===selected.nativeSha256;
  const draft=sameDraftTarget?{latex:mf.value,mode,ruler:editingRuler,typography:window.desktopTypographyPatch?.(),replacements:Object.fromEntries([...$('character-editor').querySelectorAll('input')].map(e=>[e.dataset.offset,e.value]))}:null;
  if(changedDraft&&!sameDraftTarget){const answer=await native('confirmWordSessionSwitch');if(!answer.discard){await native('wordSessionCancel',{ticket});message('已保留当前编辑；刚才打开的 Word 公式未修改。');return false;}}
  if(generation!==(window.wordSessionGeneration??0)){await native('wordSessionCancel',{ticket}).catch(()=>{});return false;}
  if(wordTicket&&wordTicket!==ticket&&!wordNavigating)await native('wordSessionCancel',{ticket:wordTicket}).catch(error=>{if(!/Unknown or expired native session/.test(error.message))throw error;});
  if(generation!==(window.wordSessionGeneration??0)){await native('wordSessionCancel',{ticket}).catch(()=>{});return false;}
  clearTimeout(timer);revision++;validationRequested=false;clearTimeout(wordNavigationTimer);
  wordNavigating=false;wordSaveQueued=false;wordOutcomeUnknown=false;wordTicket=ticket;source=r;
  let sidebarSync;
  if(r.insertion){
   selected=null;mode='rebuild';editingRuler=undefined;mf.value='';mf.readOnly=false;$('latex').readOnly=false;
   loadObjectLayout({layout:r.insertionLayout});window.desktopTypographyNew?.();window.resetEditorHistory?.();renderModes();changed(false);sidebarSync=renderObjects();
  }else sidebarSync=r.objects.length?selectObject(r.activeIndex??0,{scheduleValidation:false}):renderObjects();
  if(draft){mf.value=draft.latex;mode=draft.mode;editingRuler=draft.ruler;renderModes();window.desktopTypographyRestorePatch?.(draft.typography);for(const input of $('character-editor').querySelectorAll('input'))if(Object.hasOwn(draft.replacements,input.dataset.offset))input.value=draft.replacements[input.dataset.offset];}
 $('word-session-actions').hidden=false;$('export').hidden=true;$('save-edit').hidden=true;$('arrange-source').hidden=true;
 $('title').textContent=r.insertion?'新建 Word 公式':'编辑 Word 中的原生公式';$('subtitle').textContent=r.insertion?'输入或粘贴公式，完成后插入 Word；取消不会修改文档。':'编辑后点击更新公式；也可以取消并保留 Word 原公式。';
 const prepareFinished=performance.now();await sidebarSync;const sidebarFinished=performance.now();await validate();const validatedAt=performance.now();
 if(generation!==(window.wordSessionGeneration??0))return false;
 try{window.webkit.messageHandlers.native.postMessage({action:'wordOpenTiming',payload:{readMs:readFinished-readStarted,prepareMs:prepareFinished-readFinished,sidebarMs:sidebarFinished-prepareFinished,validateMs:validatedAt-sidebarFinished,totalMs:validatedAt-timingStart}});}catch{}
 setTimeout(()=>loadWordThumbnails(ticket,r),0);message(r.insertion?'输入或粘贴公式，完成后插入 Word。':r.hasDocumentContext?'已载入 Word 文档中的 '+r.objects.length+' 个公式。':'已载入当前公式；未能读取文档列表，请回到 Word 重新打开。');
 }catch(e){await native('wordSessionCancel',{ticket}).catch(()=>{});throw e;}
 },true);
};
async function loadWordThumbnails(ticket,document){
 const missing=document.objects.filter(o=>!o.image&&!o.error).map(o=>o.index);
 for(let offset=0;offset<missing.length;){
  if(wordNavigating||wordTicket!==ticket||source!==document)return;
  if(busy||validationPending||validationRunning){await new Promise(resolve=>setTimeout(resolve,40));continue;}
  try{const result=await native('wordSessionThumbnails',{ticket,indices:missing.slice(offset,offset+3)});offset+=3;
   if(wordNavigating||wordTicket!==ticket||source!==document)return;
   for(const image of result.images)if(document.objects[image.index])document.objects[image.index].image=image.image;
   requestWorkbenchSync();
  }catch{return;}
 }
}
async function bindSelectedWordFormula(){
 // Kept as a validation boundary for callers. The original Word owner now
 // applies an explicitly identified document target without reopening the App.
 if(!wordTicket||!selected&&!source?.insertion)throw Error('Word 编辑会话已经结束，输入内容已保留。请重新打开目标公式。');
 if(source?.insertion)return;
 if(selected.index!==(source.activeIndex??selected.index)&&(!source.hasDocumentContext||!source.documentIdentity))throw Error('没有读取到可靠的 Word 文档信息。输入内容已保留，请从 Word 重新打开目标公式。');
}
window.nativeCommitWordSession=()=>{
 if(wordCommitRunning)return wordCommitRunning;
 if(wordOutcomeUnknown){message(source?.insertion?'Word 插入结果无法确认。请检查 Word 并结束当前会话后，再决定是否重新插入。':'Word 更新结果无法确认。请检查 Word 并结束当前会话后，再决定下一步。',true);return Promise.resolve(false);}
 const commitGeneration=window.wordSessionGeneration??0;
 wordCommitRunning=(async()=>{
 return perform(async()=>{
 const generation=window.wordSessionGeneration??0,ticket=wordTicket,target=selected;
 const current=()=>generation===(window.wordSessionGeneration??0)&&wordTicket===ticket&&selected===target;
 if(wordSaveQueued){const outcome=await waitForWordSave();if(outcome==='unconfirmed')return false;await finishWordSave();return;}
 await bindSelectedWordFormula();clearTimeout(timer);await ensureValid();
 if(!current())return false;
 if(!wordTicket||!valid||!source?.insertion&&(!selected||selected.error))throw Error('当前公式尚不能保存。请修正标出的内容，或点“取消”保留 Word 原公式。');
 const replacements=Object.fromEntries([...$('character-editor').querySelectorAll('input')].map(e=>[e.dataset.offset,e.value]));
 const destination=source.insertion||selected.index===(source.activeIndex??selected.index)?undefined:{index:selected.index,expectedNativeSha256:selected.nativeSha256,documentIdentity:source.documentIdentity};
 window.wordSaveInFlight=true;
 const result=source.insertion?await native('wordSessionInsert',{ticket,input:source.activePath??source.path,latex:mf.value,layout:{...source.insertionLayout,...wordLayout()},typography:window.desktopTypographyPatch?.(),...rulerPatch()}):await native('wordSessionSave',{ticket,input:source.activePath??source.path,target:destination,mode:sourceEditMode(),latex:mf.value,replacements,typography:window.desktopTypographyPatch?.(),...rulerPatch()});
 if(!current())return false;
 if(result.acknowledgement){wordSaveQueued=true;mf.readOnly=true;$('latex').readOnly=true;for(const input of $('character-editor').querySelectorAll('input'))input.disabled=true;const outcome=await waitForWordSave();if(outcome==='unconfirmed')return false;}
 if(!current())return false;
 await finishWordSave();
 });
 })().catch(error=>{if(commitGeneration===(window.wordSessionGeneration??0))message(error.message,true);return false;});
 return wordCommitRunning.finally(()=>{window.wordSaveInFlight=false;wordCommitRunning=null;});
};
async function finishWordSave(){const endedTicket=wordTicket;wordTicket=null;wordSaveQueued=false;wordOutcomeUnknown=false;await syncSidebar(true,false,false,endedTicket);if(wordTicket)return;resetNewFormula();$('word-session-actions').hidden=true;$('export').hidden=false;message('已保存回 Word 原生公式。');}
function releaseWordSaveLock(){wordSaveQueued=false;const readOnly=mode==='characters'||!!selected?.error;mf.readOnly=readOnly;$('latex').readOnly=readOnly;for(const input of $('character-editor').querySelectorAll('input'))input.disabled=!!selected?.error;}
function markWordOutcomeUnknown(ticket,generation){
 if(wordTicket!==ticket||generation!==(window.wordSessionGeneration??0))return;
 wordSaveQueued=false;wordOutcomeUnknown=true;mf.readOnly=true;$('latex').readOnly=true;for(const input of $('character-editor').querySelectorAll('input'))input.disabled=true;controls();
 message(source?.insertion?'Word 是否已插入无法确认。草稿已保留；请先检查 Word，结束此会话前不要再次插入。':'Word 是否已完成更新无法确认。草稿已保留；请先检查 Word，再决定下一步。',true);
}
async function waitForWordSave(){
 message('正在保存回 Word…');const ticket=wordTicket,generation=window.wordSessionGeneration??0,deadline=Date.now()+60000;let nextNotice=Date.now()+20000,pollDelay=250,timeoutId;const timedOut={timeout:true};
 const deadlineReached=new Promise(resolve=>{timeoutId=setTimeout(()=>resolve(timedOut),Math.max(0,deadline-Date.now()));});
 while(true){
  if(wordTicket!==ticket||generation!==(window.wordSessionGeneration??0)){clearTimeout(timeoutId);throw Error('本次编辑已结束。');}
  const pending=Promise.resolve().then(()=>native('wordSessionStatus',{ticket})).then(result=>({result}),error=>({error}));
  const response=await Promise.race([pending,deadlineReached]);
  if(response===timedOut){markWordOutcomeUnknown(ticket,generation);return 'unconfirmed';}
  if(wordTicket!==ticket||generation!==(window.wordSessionGeneration??0)){clearTimeout(timeoutId);throw Error('本次编辑已结束。');}
  if(response.result?.state==='committed'){clearTimeout(timeoutId);return 'committed';}
  if(response.result?.state==='failed'){clearTimeout(timeoutId);releaseWordSaveLock();throw Error('Word 未能完成保存，输入内容已保留。可复制后重新打开 Word 公式，或取消当前编辑。');}
  if(response.result?.state==='unconfirmed'){clearTimeout(timeoutId);markWordOutcomeUnknown(ticket,generation);return 'unconfirmed';}
  if(Date.now()>=nextNotice){message('仍在等待 Word 确认保存；编辑内容会继续保留。');nextNotice=Date.now()+20000;}
  const remaining=deadline-Date.now();if(remaining<=0){clearTimeout(timeoutId);markWordOutcomeUnknown(ticket,generation);return 'unconfirmed';}
  const pause=await Promise.race([new Promise(resolve=>setTimeout(resolve,Math.min(pollDelay,remaining))),deadlineReached]);
  if(pause===timedOut){markWordOutcomeUnknown(ticket,generation);return 'unconfirmed';}
  pollDelay=Math.min(1000,Math.ceil(pollDelay*1.5));
 }
}
function wordSessionChanged(){if(source?.insertion)return !!mf.value.trim();return !selected||mf.value!==selected.editorBaseline||!!window.desktopTypographyPatch?.()||JSON.stringify(editingRuler??[])!==JSON.stringify(selected.ruler??[])||[...$('character-editor').querySelectorAll('input')].some(input=>input.value!==(selected.characters.find(c=>String(c.offset)===input.dataset.offset)?.char));}
window.nativePrepareToClose=async()=>{
 if(wordOutcomeUnknown)return await window.nativeCancelWordSession();
 if(wordCommitRunning){const saved=await wordCommitRunning;if(saved||!wordTicket)return saved;if(wordOutcomeUnknown)return await window.nativeCancelWordSession();const answer=await native('confirmWordSessionSwitch',{closing:true});return answer.discard?await window.nativeCancelWordSession():false;}
 try{await waitForEditorIdle(3000);}catch(e){const answer=await native('confirmWordSessionSwitch',{closing:true});return answer.discard?await window.nativeCancelWordSession():false;}
 if(wordNavigating){const answer=await native('confirmWordSessionSwitch',{closing:true});return answer.discard?await window.nativeCancelWordSession():false;}
 if(!wordTicket)return true;
 if(!wordSaveQueued&&!wordSessionChanged())return await window.nativeCancelWordSession();
 const saved=await window.nativeCommitWordSession();
 if(!saved&&wordTicket){const answer=await native('confirmWordSessionSwitch',{closing:true});if(answer.discard)return await window.nativeCancelWordSession();}
 return saved;
};
window.nativeCancelWordSession=async()=>{
 if(wordOutcomeUnknown){
  const isInsertion=source?.insertion===true,ticket=wordTicket,generation=window.wordSessionGeneration=(window.wordSessionGeneration??0)+1;clearTimeout(wordNavigationTimer);wordNavigating=false;wordTicket=null;wordSaveQueued=false;wordOutcomeUnknown=false;source=null;selected=null;mode='rebuild';mf.readOnly=false;$('latex').readOnly=false;$('source-panel').hidden=true;$('save-edit').hidden=true;$('arrange-source').hidden=true;$('title').textContent='新建公式';$('eyebrow').textContent='FORMULA EDITOR';$('subtitle').textContent=isInsertion?'请先检查 Word 中的插入结果，再决定是否开始新的插入。':'请先检查 Word 中的更新结果，再决定下一步。';$('word-session-actions').hidden=true;$('export').hidden=false;
  await syncSidebar(true,false,false,ticket);
  if(generation===(window.wordSessionGeneration??0)&&!wordTicket){changed();message(isInsertion?'已结束未确认的 Word 会话；公式草稿仍保留。请先检查 Word，再决定是否重新插入。':'已结束未确认的 Word 会话；公式草稿仍保留。请先检查 Word 中的更新结果。');controls();}
  return true;
 }
 if(window.wordSaveInFlight||wordSaveQueued){message('Word 正在完成保存，请稍候。确认结果前会保留编辑内容。');return false;}
 const ticket=wordTicket;const generation=window.wordSessionGeneration=(window.wordSessionGeneration??0)+1;clearTimeout(wordNavigationTimer);wordNavigating=false;wordTicket=null;wordSaveQueued=false;if(ticket)native('wordSessionCancel',{ticket}).catch(()=>{});await syncSidebar(true,false,false,ticket);if(generation===(window.wordSessionGeneration??0)&&!wordTicket){resetNewFormula();$('word-session-actions').hidden=true;$('export').hidden=false;message('已结束本次编辑。');controls();}return true;
};
$('word-session-save').onclick=window.nativeCommitWordSession;$('word-session-cancel').onclick=window.nativeCancelWordSession;

// The native workbench owns navigation, palettes and inspectors. The existing
// editor and preference controls remain the source of truth for every action.
var workbenchScheduled=false,workbenchZoom=0;
editorViewport=window.createEquationViewport(mf,{getZoom:()=>workbenchZoom,onScaleChange:()=>requestWorkbenchSync()});
const workbenchLastFields=new Map();
const workbenchFavoriteImages=new Map();
let workbenchFavoriteRenderRunning=false;
function requestWorkbenchSync(){
 if(!window.workbenchAction||workbenchScheduled)return;
 workbenchScheduled=true;
 // A WKWebView may suspend animation frames while its native window is in
 // the background. Native controls still need current state in that case.
 setTimeout(()=>{workbenchScheduled=false;try{publishWorkbenchState();}catch(error){window.webkit.messageHandlers.native.postMessage({action:'workbenchError',payload:{error:error.message}});}},16);
}
function workbenchFields(container,kind){
 return [...$(container).children].map(row=>{
  const input=row.querySelector('input'),select=row.querySelector('select');
  if(!input)return null;
  return {id:kind+'-'+row.dataset.id,label:row.querySelector('span')?.textContent||'',value:input.value,options:[],disabled:input.disabled||busy,unit:kind==='font'?'':select?.value||'',units:kind==='font'?[]:[...select?.options||[]].map(o=>o.value),style:kind==='font'?select?.value||'0':'0'};
 }).filter(Boolean);
}
function publishWorkbenchState(){
 const layout=['layout-mode','layout-format','layout-chapter','layout-section'].map(id=>{
  const el=$(id);return {id,label:{'layout-mode':'公式位置','layout-format':'编号格式','layout-chapter':'章','layout-section':'节'}[id],value:el.value,options:[...el.options||[]].map(o=>({value:o.value,label:o.textContent})),disabled:el.disabled||busy,unit:'',units:[],style:'0'};
 });
 const state={
  documentName:source?.documentName||(wordTicket?'Word 中的公式':source?.path?.split(/[\\/]/).pop()||'新建公式'),documentPath:source?.path||'',latex:mf.value,
  selected:selected?.index??null,
  objects:(source?.objects||[]).map(o=>({id:o.index,label:'公式 '+(o.index+1),detail:o.error||'原生 MathType · '+o.application,latex:o.latex||'',image:o.image||null,readOnly:!!o.error})),
  favorites:favorites.map((latex,id)=>({id,label:'收藏 '+(id+1),detail:'收藏公式',latex,image:workbenchFavoriteImages.get(latex)||source?.objects?.find(o=>o.latex===latex)?.image||null,readOnly:false})),
  categories:Object.keys(groups),templates:Object.entries(groups).flatMap(([category,items])=>items.map(([label,latex,hint],index)=>({id:category+':'+index,category,label,latex,hint:hint||''}))),
  activeCategory:[...$('categories').children].find(b=>b.classList.contains('selected'))?.textContent||'常用结构',
  fonts:workbenchFields('desktop-fonts','font'),sizes:workbenchFields('desktop-sizes','sizes'),extraSizes:workbenchFields('desktop-extra-sizes','extraSizes'),spaces:workbenchFields('desktop-spaces','spaces'),layout,
  numbering:selected?{hasDocumentContext:!!source.hasDocumentContext||!wordTicket,actualNumber:selected.layout?.numberText||null,chapter:selected.layout?.chapter??null,section:selected.layout?.section??null,equation:selected.layout?.equation??null,bookmark:selected.layout?.bookmarkName??null,referenceCount:selected.layout?.referenceCount??null,position:selected.index+1,total:source.objects.length,format:selected.layout?.numberFormat??null,mode:selected.layout?.mode??'unknown'}:null,
  statusTitle:$('status-title').textContent,statusDetail:$('status-detail').textContent,statusError:$('native-status').classList.contains('error'),matrix:matrixContext(),
  message:$('message').textContent,messageError:$('message').classList.contains('error'),valid,canExport:!wordNavigating&&exportAvailable(),wordOutcomeUnknown,busy:busy||wordNavigating,mode:selected?mode:'rebuild',readOnly:!!mf.readOnly||busy||wordNavigating,
  canSaveEdit:!$('save-edit').hidden,canArrange:!$('arrange-source').hidden,canFactoryReset:!$('desktop-factory-fonts').disabled,arrangeAll:$('arrange-all').checked,zoom:workbenchZoom,effectiveZoom:editorViewport.effectiveZoom,keyboardVisible:!!window.mathVirtualKeyboard?.visible,ruler:editingRuler??[]
 };
 const delta={};for(const [key,value]of Object.entries(state)){const encoded=JSON.stringify(value);if(encoded!==workbenchLastFields.get(key)){workbenchLastFields.set(key,encoded);delta[key]=value;}}
 if(Object.keys(delta).length)window.webkit.messageHandlers.native.postMessage({action:'workbenchState',payload:delta});
 document.body.classList.toggle('character-mode',!!selected&&mode==='characters');
 document.body.classList.toggle('source-mode',!!selected);
 refreshFavoriteThumbnails();
}
async function refreshFavoriteThumbnails(){
 if(workbenchFavoriteRenderRunning)return;
 const missing=favorites.filter(latex=>!workbenchFavoriteImages.has(latex)&&!source?.objects?.some(o=>o.latex===latex&&o.image));
 if(!missing.length)return;
 workbenchFavoriteRenderRunning=true;
 try{
  for(const latex of missing){
   if(validationPending||validationRunning)break;
   await new Promise(resolve=>setTimeout(resolve,24));
   if(validationPending||validationRunning)break;
   // One preview process at a time; unsupported favorites get a stable fallback.
   try{const result=await native('preview',{latex});workbenchFavoriteImages.set(latex,result.png?'data:image/png;base64,'+result.png:'');}
   catch{workbenchFavoriteImages.set(latex,'');}
   requestWorkbenchSync();
  }
 }finally{workbenchFavoriteRenderRunning=false;}
}
function workbenchField(id){
 if(id.startsWith('layout-'))return $(id);
 const match=/^(font|sizes|extraSizes|spaces)-(\d+)$/.exec(id);if(!match)return null;
 const [_,kind,index]=match;
 return document.querySelector(kind==='font'?`.preference-font[data-id="${index}"]`:`.preference-dimension[data-kind="${kind}"][data-id="${index}"]`);
}
window.workbenchAction=async(action,payload={})=>{
 if((busy||wordNavigating)&&!['language','category','zoom'].includes(action))return false;
 if(action==='click'){
  const el=$(payload.id);if(!el)throw Error('此命令尚不可用');if(el.disabled)return false;el.click();
 }else if(action==='category'){
  if(!groups[payload.name])throw Error('未知的模板分类');palette(payload.name);
 }else if(action==='template'){
  if(mf.readOnly)return false;
  const split=payload.id.lastIndexOf(':'),category=payload.id.slice(0,split),index=Number(payload.id.slice(split+1)),item=groups[category]?.[index];
  if(!item)throw Error('未知的公式模板');mf.focus();mf.insert(item[1],{selectionMode:'placeholder'});changed();
 }else if(action==='preferencesImport'){
  await perform(()=>window.desktopImportPreferences());
 }else if(action==='preferencesExport'){
  await perform(()=>window.desktopExportPreferences());
 }else if(action==='exportGraphic'){
  await perform(async()=>{await ensureValid();const original=source&&selected?{path:source.path,index:selected.index,mode:sourceEditMode(),replacements:Object.fromEntries([...$('character-editor').querySelectorAll('input')].map(e=>[e.dataset.offset,e.value]))}:undefined;const result=await native('exportGraphic',{format:payload.format,latex:mf.value,typography:window.desktopTypographyPatch?.(),source:original,...rulerPatch()});if(result)message('已导出：'+result.path);});
 }else if(action==='insertCatalog'){
  if(mf.readOnly)return false;if(typeof payload.latex!=='string'||payload.latex.length>20000)throw Error('无效的模板');mf.insert(payload.latex,{selectionMode:'placeholder'});changed();
 }else if(action==='matrixInsert'){
  if(mf.readOnly)return false;const {rows,columns,environment,alignment,divider}=payload;
  if(!Number.isInteger(rows)||!Number.isInteger(columns)||rows<1||columns<1||rows>31||columns>31||!['matrix','pmatrix','bmatrix','Bmatrix','vmatrix','Vmatrix'].includes(environment)||!['l','c','r'].includes(alignment))throw Error('矩阵尺寸须为1至31，且使用有效的括号和对齐方式');
  const cells=Array.from({length:rows},()=>Array(columns).fill('#?').join('&')).join('\\\\');
  let latex;if(alignment==='c'&&!divider)latex='\\begin{'+environment+'}'+cells+'\\end{'+environment+'}';else{const spec=Array(columns).fill(alignment);if(divider&&columns>1)spec[columns-1]='|'+spec[columns-1];latex='\\begin{array}{'+spec.join('')+'}'+cells+'\\end{array}';const fences={pmatrix:['(',')'],bmatrix:['[',']'],Bmatrix:['\\{','\\}'],vmatrix:['|','|'],Vmatrix:['\\|','\\|']};if(fences[environment])latex='\\left'+fences[environment][0]+latex+'\\right'+fences[environment][1];}
  if(payload.equalColumns||payload.equalRows)latex='\\mtmatrix{'+(['l','c','r'].indexOf(alignment)+(payload.equalColumns?128:0))+'}{'+(1+(payload.equalRows?128:0))+'}{4}{'+latex+'}';
  mf.focus();mf.insert(latex,{selectionMode:'placeholder'});changed();
 }else if(action==='ruler'){
  if(mf.readOnly)return false;if(!Array.isArray(payload.tabs)||payload.tabs.length>100||payload.tabs.some(t=>!Number.isInteger(t.position)||t.position<0||t.position>32767||!Number.isInteger(t.type)||t.type<0||t.type>4)||new Set(payload.tabs.map(t=>t.position)).size!==payload.tabs.length)throw Error('无效的制表位');editingRuler=payload.tabs.map(t=>({...t})).sort((a,b)=>a.position-b.position);changed();
 }else if(action==='editorCommand'){
  if(payload.command==='undo')editorUndo();else if(payload.command==='redo')editorUndo(true);else{const allowed=['cutToClipboard','copyToClipboard','pasteFromClipboard','selectAll','addRowBefore','addRowAfter','addColumnBefore','addColumnAfter','removeRow','removeColumn','insertTab'];if(!allowed.includes(payload.command))throw Error('未知的编辑命令');if(mf.readOnly&&payload.command!=='copyToClipboard'&&payload.command!=='selectAll')return false;mf.focus();if(payload.command==='insertTab')mf.insert('\\eltab ',{selectionMode:'after'});else{const matrix=matrixContext();if(['addRowBefore','addRowAfter','addColumnBefore','addColumnAfter','removeRow','removeColumn'].includes(payload.command)){if(!matrix)throw Error('请先把光标放在矩阵单元格内');if(payload.command.startsWith('addRow')&&matrix.rows>=31||payload.command.startsWith('addColumn')&&matrix.columns>=31)throw Error('原版矩阵每维最多31');if(payload.command==='removeRow'&&matrix.rows<=1||payload.command==='removeColumn'&&matrix.columns<=1)throw Error('矩阵至少保留一行一列');}mf.executeCommand(payload.command);}if(!['copyToClipboard','selectAll'].includes(payload.command))changed();}
 }else if(action==='insertLetter'){
  if(mf.readOnly)return false;
  if(typeof payload.latex!=='string'||payload.latex.length>64)throw Error('无效的字母');
  if(payload.focus!==false)mf.focus();mf.insert(payload.latex,{selectionMode:'after'});changed();
 }else if(['field','unit','fontStyle'].includes(action)){
  const row=workbenchField(payload.id);if(!row)throw Error('此原生设置尚未载入');
  const el=payload.id.startsWith('layout-')?row:row.querySelector(action==='field'?'input':'select');
  if(!el||el.disabled)return false;el.value=String(payload.value);el.dispatchEvent(new Event(el.tagName==='SELECT'||action==='fontStyle'?'change':'input',{bubbles:true}));
  if(payload.id.startsWith('font-')&&action==='field')el.dispatchEvent(new Event('change',{bubbles:true}));
 }else if(action==='arrangeAll'){
  $('arrange-all').checked=!!payload.value;
 }else if(action==='language'){
  window.setWorkbenchLanguage?.(payload.value);
 }else if(action==='zoom'){
  const value=Number(payload.value);if(![0,50,75,100,125,150,200,250,300].includes(value))throw Error('未知缩放比例');
  workbenchZoom=value;editorViewport.refresh();
 }else throw Error('未知工作台命令');
 requestWorkbenchSync();return true;
};
document.body.classList.add('workbench-canvas');
$('word-preview').append($('desktop-font-preview'));
document.querySelector('.editor-card').prepend($('source-panel'));
$('latex-details').querySelector('summary').append($('copy-latex'));
$('copy-latex').setAttribute('aria-label','复制 LaTeX');
$('word-preview-zoom').addEventListener('click',event=>event.stopPropagation());
$('word-preview-zoom').addEventListener('change',event=>document.documentElement.style.setProperty('--word-preview-scale',event.target.value));
$('mode-characters').textContent='保留结构 · 替换字符';
$('mode-rebuild').textContent='编辑公式结构';
requestWorkbenchSync();
window.mathVirtualKeyboard?.addEventListener('virtual-keyboard-toggle',requestWorkbenchSync);

// Both entry points share the native menu; no web-menu animation or label rendering.
mf.menuItems=[];mf.addEventListener('contextmenu',event=>{event.preventDefault();event.stopImmediatePropagation();window.webkit.messageHandlers.native.postMessage({action:'editorMenu',payload:{matrix:matrixContext(),x:event.clientX,y:event.clientY}});},{capture:true});
mf.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'){event.preventDefault();event.stopImmediatePropagation();editorUndo(event.shiftKey);}},true);
window.resetEditorHistory();

mf.addEventListener('selection-change',requestWorkbenchSync);
