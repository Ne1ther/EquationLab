const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const attr=(node,key)=>node.getAttributeNS(W,key);
function codes(nodes){
 const elements=nodes.filter(n=>n.nodeType===1).flatMap(node=>[node,...Array.from(node.getElementsByTagName('*'))]);
 const result=elements.filter(f=>f.namespaceURI===W&&f.localName==='fldSimple').map(f=>attr(f,'instr'));let active=false,code='';
 for(const element of elements){
  if(element.namespaceURI!==W)continue;
  if(element.localName==='fldChar'&&attr(element,'fldCharType')==='begin'){active=true;code='';}
  else if(element.localName==='instrText'&&active)code+=element.textContent;
  else if(element.localName==='fldChar'&&['separate','end'].includes(attr(element,'fldCharType'))&&active){result.push(code);active=false;}
 }
 return result;
}
/** Read only our actual bookmarked SEQ numbers, including standalone numbers.
 * Original MathType fields and coincidental bookmarks are deliberately excluded. */
export function equationNumberTargets(doc){
 const result=[];
 for(const paragraph of Array.from(doc.getElementsByTagNameNS(W,'p'))){
  const children=Array.from(paragraph.childNodes);
  for(const start of children.filter(n=>n.nodeType===1&&n.namespaceURI===W&&n.localName==='bookmarkStart')){
   const name=attr(start,'name');if(!/^EL_[A-Za-z0-9_]{1,37}$/.test(name))continue;
   const begin=children.indexOf(start),end=children.findIndex((node,index)=>index>begin&&node.namespaceURI===W&&node.localName==='bookmarkEnd'&&attr(node,'id')===attr(start,'id'));
   if(end<0)continue;
   const nodes=children.slice(begin+1,end),fields=codes(nodes);
   if(!fields.some(code=>/^\s*SEQ\s+EquationLab\s+(?:\\n|\\r\s+\d+)\b/i.test(code)))continue;
   const text=nodes.filter(n=>n.nodeType===1).flatMap(n=>Array.from(n.getElementsByTagNameNS(W,'t'))).map(n=>n.textContent).join('');
   result.push({bookmarkName:name,numberText:text});
  }
 }
 return result;
}

/** Presence of actual context fields, including instructions split by Word. */
export function equationNumberingContext(doc){
 const fields=codes([doc.documentElement]);
 return {chapter:fields.some(code=>/^\s*SEQ\s+ELChapter\b/i.test(code)),section:fields.some(code=>/^\s*SEQ\s+ELSection\b/i.test(code)),equation:fields.some(code=>/^\s*SEQ\s+EquationLab\b/i.test(code))};
}
