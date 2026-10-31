// Read-only structure adapter for the pinned MathLive 0.111.1 tree. Content
// changes use the public selection/insert API, so no display-only state leaks
// into LaTeX or Equation Native records.
(function (host) {
 'use strict';
 const operators = new Map([['\\sum',['求和','Sum']],['\\prod',['乘积','Product']],['\\coprod',['余积','Coproduct']],['\\bigcup',['大并集','Union']],['\\bigcap',['大交集','Intersection']]]);
 const structures = {surd:['根号','Root'],genfrac:['分式','Fraction'],array:['矩阵','Matrix'],leftright:['括号','Fence']};
 const placements = {'above-below':'\\limits',adjacent:'\\nolimits'};
 function atomRange(model,atom) {
  const start=model.offsetOf(atom.leftSibling),end=model.offsetOf(atom);
  return start>=0&&end>start?[start,end]:null;
 }
 function branchLabel(parent,branch,english) {
  const text=(zh,en)=>english?en:zh;
  if(parent.type==='genfrac')return branch==='above'?text('分子','Numerator'):branch==='below'?text('分母','Denominator'):null;
  if(parent.type==='surd')return branch==='body'?text('根号内','Inside root'):branch==='above'?text('根指数','Root index'):null;
  if(branch==='subscript')return operators.has(parent.command)?text('下限','Lower limit'):text('下标','Subscript');
  if(branch==='superscript')return operators.has(parent.command)?text('上限','Upper limit'):text('上标','Superscript');
  if(parent.type==='array'&&Array.isArray(branch))return text(`单元格 ${branch[0]+1}, ${branch[1]+1}`,`Cell ${branch[0]+1}, ${branch[1]+1}`);
  if(parent.type==='leftright')return text('括号内','Inside fence');
  return null;
 }
 function inspect(mathfield,english=false) {
  const model=mathfield?._mathfield?.model;
  if(!model||typeof model.at!=='function'||typeof model.offsetOf!=='function')return {context:{path:[],canExit:false,canSelect:false,operator:null},model:null};
  const atom=model.at(model.position);if(!atom)return {context:{path:[],canExit:false,canSelect:false,operator:null},model};
  const path=[],ancestors=[];let cursor=atom,region=null,operator=null,insideRoot=false;
  while(cursor?.parent){
   const parent=cursor.parent,label=branchLabel(parent,cursor.parentBranch,english);
   if(label)path.unshift(label);
   if(parent.type==='surd'&&cursor.parentBranch==='body')insideRoot=true;
   if(label&&!region&&parent.parent)region={atom:parent,branch:cursor.parentBranch,label};
   ancestors.push(cursor);cursor=parent;
  }
  for(const candidate of [...ancestors,atom.rightSibling])if(candidate&&operators.has(candidate.command)){operator=candidate;break;}
  const range=mathfield.selection?.ranges?.[0],collapsed=!range||range[0]===range[1];
  // An explicit whole-structure selection continues to act on that structure.
  const ownRange=atom.parent&&(structures[atom.type]||operators.has(atom.command))?atomRange(model,atom):null;
  const selectedStructure=!collapsed&&ownRange&&Math.min(...range)===ownRange[0]&&Math.max(...range)===ownRange[1];
  if(selectedStructure)region={atom,branch:null,label:(structures[atom.type]||operators.get(atom.command))[english?1:0]};
  const target=region?.atom,scope=target&&region.branch?target.branch(region.branch):null;
  const scopeRange=scope?.length?[model.offsetOf(scope[0]),model.offsetOf(scope[scope.length-1])]:null;
  const operatorRange=operator?atomRange(model,operator):null;
  const context={path:[english?'Equation':'整条公式',...path],rootScope:model.atoms.some(a=>a.type==='surd')?(insideRoot?'inside':'outside'):null,
   placeholder:!!model.selectionIsPlaceholder||atom.type==='placeholder',selectedStructure:!!selectedStructure,structureType:target?.type||null,structureLabel:target?(structures[target.type]||operators.get(target.command)||['上下标结构','Scripted expression'])[english?1:0]:null,
   canExit:!!target,canSelect:!!target&&!!atomRange(model,target),scopeRange,
   operator:operatorRange?{command:operator.command,label:operators.get(operator.command)[english?1:0],placement:operator.explicitSubsupPlacement?(operator.subsupPlacement==='over-under'?'above-below':operator.subsupPlacement==='adjacent'?'adjacent':null):null}:null};
  return {context,model,region,operator,operatorRange,collapsed};
 }
 host.equationEditorContext=(mathfield,english=false)=>inspect(mathfield,english).context;
 host.setEquationOperatorLimits=function(mathfield,placement) {
  if(!Object.hasOwn(placements,placement))throw Error('Unknown operator limits placement');
  if(mathfield.readOnly)return false;
  const {operator,operatorRange}=inspect(mathfield);if(!operatorRange)return false;
  // Re-serialize the operator atom only. Its complete, potentially nested
  // limits and styles are retained; the summand and every other sum stay put.
  const latex=mathfield.getValue(operatorRange,'latex');
  const command=operator.command,at=latex.indexOf(command);
  if(at<0)return false;
  const after=at+command.length;
  const rest=latex.slice(after).replace(/^(?:\s*\\(?:limits|nolimits|displaylimits)(?![A-Za-z]))+\s*/, '');
  const updated=latex.slice(0,after)+placements[placement]+rest;
  const selection=mathfield.selection;
  mathfield.selection={ranges:[operatorRange]};
  try {mathfield.insert(updated,{format:'latex',selectionMode:'after'});}
  catch(error){mathfield.selection=selection;throw error;}
  // Placement changes do not change the atom count. Keep the caret/selection
  // in the same limit so repeated edits do not jump to a different sum.
  if(selection)mathfield.selection=selection;
  return true;
 };
 host.navigateEquationStructure=function(mathfield,action) {
  const {model,region}=inspect(mathfield);if(!region)return false;
  if(action==='exit')mathfield.selection=model.offsetOf(region.atom);
  else if(action==='select'){const range=atomRange(model,region.atom);if(!range)return false;mathfield.selection={ranges:[range]};}
  else throw Error('Unknown equation structure action');
  mathfield.focus();return true;
 };
 host.installEquationStructureControls=function(mathfield,{onChange=()=>{},onSelection=()=>{}}={}) {
  const panel=document.getElementById('editor-structure');if(!panel)return null;
  const path=panel.querySelector('.editor-structure-path'),hint=panel.querySelector('.editor-structure-hint'),exit=panel.querySelector('[data-structure="exit"]'),select=panel.querySelector('[data-structure="select"]'),picker=panel.querySelector('select'),label=panel.querySelector('.editor-structure-placement-label');
  const viewport=mathfield.closest('.math-viewport'),boundary=document.createElement('div');boundary.className='editor-structure-boundary';boundary.hidden=true;viewport?.append(boundary);
  let frame=null,retries=0,content=null;
  function paint(){
   frame=null;const {context,model,region}=inspect(mathfield,!!host.workbenchEnglish);
   boundary.hidden=true;if(!viewport||!region||mathfield.readOnly)return;
   const branch=region.branch?region.atom.branch(region.branch):[region.atom],rects=[];
   for(const atom of branch||[]){if(atom.type==='first')continue;const rect=mathfield.getElementInfo(model.offsetOf(atom))?.bounds;if(rect&&rect.width>0&&rect.height>0)rects.push(rect);}
   if(!rects.length){if(retries++<3)frame=setTimeout(paint,32);return;}retries=0;
   const outer=viewport.getBoundingClientRect(),left=Math.min(...rects.map(r=>r.left))-3,top=Math.min(...rects.map(r=>r.top))-3,right=Math.max(...rects.map(r=>r.right))+3,bottom=Math.max(...rects.map(r=>r.bottom))+3;
   Object.assign(boundary.style,{left:(left-outer.left-viewport.clientLeft)+'px',top:(top-outer.top-viewport.clientTop)+'px',width:(right-left)+'px',height:(bottom-top)+'px'});boundary.hidden=false;
   boundary.setAttribute('aria-label',context.path.join(' › '));
  }
  function refresh(){
   const nextContent=mathfield.shadowRoot?.querySelector('[part=content]');
   if(nextContent!==content){content=nextContent;content?.addEventListener('scroll',refresh,{passive:true});}
   const english=!!host.workbenchEnglish,text=(zh,en)=>english?en:zh,{context}=inspect(mathfield,english);
   path.textContent=context.path.join(' › ')||text('编辑范围','Editing scope');
   hint.textContent=context.placeholder?text('占位框是当前输入范围，输入会替换它。','Typing replaces the selected placeholder.'):
    context.selectedStructure?text('已选中'+context.structureLabel+'；输入会替换整个结构。',context.structureLabel+' selected. Typing replaces the whole structure.'):
    context.rootScope==='inside'?(context.structureType==='surd'?text('当前在根号内；“移出根号”后继续输入根号外的内容。','Inside the root. Exit the root to type outside it.'):text('当前在根号内；先移出'+context.structureLabel+'，再移出根号。','Inside the root. Exit '+context.structureLabel+' first, then exit the root.')):
    context.rootScope==='outside'?text('当前在根号外，输入不会扩大根号范围。','Outside the root. Typing will not extend its contents.'):
    text('蓝色虚线标出当前输入范围。','The blue outline marks the current input scope.');
   exit.textContent=context.structureLabel?text('移出'+context.structureLabel,'Exit '+context.structureLabel):text('移出结构','Exit structure');select.textContent=context.structureLabel?text('选中'+context.structureLabel,'Select '+context.structureLabel):text('选中结构','Select structure');
   exit.disabled=mathfield.readOnly||!context.canExit;select.disabled=!context.canSelect;
   label.textContent=text('上下限位置','Limits position');picker.setAttribute('aria-label',text('求和上下限位置','Sum limits position'));
   for(const option of picker.options)option.textContent=({'':text('选择位置','Choose position'),'above-below':text('上下','Above / below'),adjacent:text('右侧','Right side')})[option.value];
   picker.value=context.operator?.placement||'';picker.disabled=mathfield.readOnly||!context.operator;picker.title=context.operator?(context.operator.placement?context.operator.label:text('选择后只修改当前运算符的上下限位置。','Choose a position to change this operator only.')):text('点击求和符号或它的上下限后设置。','Click a sum or one of its limits to set placement.');
   // MathLive renders on its next frame. Paint the independent scope outline
   // afterwards, including when WebKit suspends rAF in a background window.
   if(frame===null)frame=setTimeout(paint,32);return context;
  }
  for(const button of [exit,select]){button.addEventListener('mousedown',event=>event.preventDefault());button.addEventListener('click',()=>{host.navigateEquationStructure(mathfield,button.dataset.structure);refresh();onSelection();});}
  picker.addEventListener('change',()=>{if(host.setEquationOperatorLimits(mathfield,picker.value)){mathfield.focus();onChange();}refresh();onSelection();});
  for(const event of ['input','selection-change','focus','blur'])mathfield.addEventListener(event,refresh);
  mathfield.closest('.math-wrap')?.addEventListener('scroll',refresh,{passive:true});
  const observer=typeof ResizeObserver==='function'?new ResizeObserver(refresh):null;observer?.observe(mathfield);if(viewport)observer?.observe(viewport);
  if(mathfield.shadowRoot&&typeof MutationObserver==='function')new MutationObserver(refresh).observe(mathfield.shadowRoot,{childList:true,subtree:true});
  document.fonts?.ready.then(refresh);
  refresh();return {refresh,context:()=>inspect(mathfield,!!host.workbenchEnglish).context};
 };
})(window);
