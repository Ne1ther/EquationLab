const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const elements=node=>Array.from(node?.childNodes??[]).filter(n=>n.nodeType===1);
const children=(node,name)=>elements(node).filter(n=>n.namespaceURI===W&&n.localName===name);
const child=(node,name)=>children(node,name)[0];
const attr=(node,name)=>node?.hasAttributeNS(W,name)?node.getAttributeNS(W,name):null;
const fail=reason=>{throw Error(`无法确定公式可用宽度（${reason}），请在 Word 中处理此段落`);};
function integer(value,label,{min=0,max=31680,fallback}={}){
 if(value===null&&fallback!==undefined)return fallback;
 if(value===null||!/^[-+]?\d+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)<min||Number(value)>max)fail(`${label}无效`);
 return Number(value);
}
function on(node,fallback=false){
 if(!node)return fallback;
 return flag(attr(node,'val'),true);
}
function flag(value,fallback){
 if(value===null)return fallback;
 if(['1','true','on'].includes(value))return true;
 if(['0','false','off'].includes(value))return false;
 fail('布尔版式属性无效');
}

/** Resolve only geometry that is independent of Word pagination. Units are
 * integer twips (20 per point). sectPr terminates its section, rather than
 * starting the following one. Continuous sections may omit page properties
 * inherited from the FOLLOWING section (ISO 29500-1 17.6.22); other missing
 * page dimensions are not guessed from a printer or an earlier section.
 * https://learn.microsoft.com/dotnet/api/documentformat.openxml.wordprocessing.sectiontype
 */
export function documentGeometry(doc,{styles=null,settings=null}={}){
 const body=child(doc.documentElement,'body');
 if(!body)return ()=>fail('不是正文容器');
 const blocks=elements(body),sections=[];let first=0;
 for(let i=0;i<blocks.length;i++){
  const block=blocks[i],section=block.namespaceURI===W&&block.localName==='sectPr'?block:child(child(block,'pPr'),'sectPr');
  if(section){sections.push({first,last:i,section});first=i+1;}
 }
 const setting=name=>on(child(settings?.documentElement,name));
 const styleMap=new Map(children(styles?.documentElement,'style').filter(s=>attr(s,'type')==='paragraph').map(s=>[attr(s,'styleId'),s]));
 const defaultStyle=[...styleMap.values()].find(s=>flag(attr(s,'default'),false));
 const defaults=child(child(styles?.documentElement,'docDefaults'),'pPrDefault');
 function styleProperties(id,seen=new Set()){
  if(!id)return [];
  if(seen.has(id))fail('段落样式循环继承');seen.add(id);
  // Word ignores references to absent styles (our minimal generated package
  // can reference the built-in Normal without storing its definition).
  const style=styleMap.get(id);if(!style)return [];
  return [...styleProperties(attr(child(style,'basedOn'),'val'),seen),child(style,'pPr')].filter(Boolean);
 }
 function properties(p){
  const pPr=child(p,'pPr'),id=attr(child(pPr,'pStyle'),'val')??attr(defaultStyle,'styleId');
  return [child(defaults,'pPr'),...styleProperties(id),pPr].filter(Boolean);
 }
 function pageProperty(index,name){
  const section=sections[index]?.section,value=child(section,name);
  if(value)return value;
  if(attr(child(section,'type'),'val')==='continuous')return pageProperty(index+1,name);
  fail(`节缺少 ${name}`);
 }
 return (paragraph,{style='EquationLab'}={})=>{
  if(paragraph?.namespaceURI!==W||paragraph.localName!=='p'||paragraph.parentNode!==body)fail('表格、文本框或其他嵌套容器');
  const blockIndex=blocks.indexOf(paragraph),index=sections.findIndex(s=>blockIndex>=s.first&&blockIndex<=s.last);
  if(index<0)fail('缺少所属节');
  const section=sections[index].section;
  if(child(section,'sectPrChange'))fail('节属性修订');
  if(setting('bookFoldPrinting')||setting('bookFoldRevPrinting')||setting('printTwoOnOne'))fail('书籍折页或拼页');
  const direction=attr(child(section,'textDirection'),'val');
  if(direction!==null&&direction!=='lrTb')fail('竖排节');
  if(on(child(section,'bidi')))fail('从右向左的节');
  const page=pageProperty(index,'pgSz'),margin=pageProperty(index,'pgMar');
  const pageWidth=integer(attr(page,'w'),'纸张宽度',{min:1});
  const left=integer(attr(margin,'left'),'左页边距'),right=integer(attr(margin,'right'),'右页边距');
  const gutter=integer(attr(margin,'gutter'),'装订线',{fallback:0});
  // Mirrored margins swap inside/outside, preserving the same usable width.
  // A top gutter reduces height, except mirrorMargins overrides gutterAtTop
  // (ISO 29500-1 17.15.1.50). rtlGutter only changes the horizontal side.
  const topGutter=setting('gutterAtTop')&&!setting('mirrorMargins');
  const textWidth=pageWidth-left-right-(topGutter?0:gutter);
  const cols=child(section,'cols'),count=integer(attr(cols,'num'),'栏数',{min:1,max:2,fallback:1});
  if(cols&&!flag(attr(cols,'equalWidth'),true))fail('非等宽栏');
  const gap=count===1?0:integer(attr(cols,'space'),'栏间距');
  const columnWidth=Math.floor((textWidth-gap*(count-1))/count);
  let leftIndent=0,rightIndent=0;
  for(const props of properties(paragraph)){
   if(['framePr','numPr','pPrChange'].some(name=>child(props,name)))fail('浮动、列表或修订段落');
   if(on(child(props,'bidi'))||on(child(props,'mirrorIndents')))fail('双向或镜像段落缩进');
   const textDirection=attr(child(props,'textDirection'),'val');if(textDirection!==null&&textDirection!=='lrTb')fail('竖排段落');
   const ind=child(props,'ind');if(!ind)continue;
   if(['leftChars','rightChars','startChars','endChars'].some(name=>attr(ind,name)!==null))fail('按字符计量的左右缩进');
   const start=attr(ind,'start')??attr(ind,'left'),end=attr(ind,'end')??attr(ind,'right');
   if(start!==null)leftIndent=integer(start,'左缩进',{min:-31680});
   if(end!==null)rightIndent=integer(end,'右缩进',{min:-31680});
  }
  // Arrangement has already verified this is an isolated equation paragraph.
  // Its replacement explicitly clears inherited first-line/hanging indents,
  // as the existing standalone-equation layout has always done.
  const widthTwips=columnWidth-leftIndent-rightIndent;
  if(!Number.isSafeInteger(widthTwips)||widthTwips<1440||widthTwips>31680)fail('可用区域过窄或超出支持范围');
  // Clear custom tabs inherited by the replacement style; otherwise an
  // earlier inherited stop can consume the leading equation tab.
  const replacementProps=[child(defaults,'pPr'),...styleProperties(styleMap.has(style)?style:attr(defaultStyle,'styleId'))].filter(Boolean);
  const clearTabPositions=[...new Set(replacementProps.flatMap(props=>children(child(props,'tabs'),'tab').map(tab=>integer(attr(tab,'pos'),'制表位',{min:-31680}))))];
  return {widthTwips,leftIndentTwips:leftIndent,rightIndentTwips:rightIndent,clearTabPositions};
 };
}
