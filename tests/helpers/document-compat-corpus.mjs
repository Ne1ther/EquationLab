// Original synthetic equations and document markup. No thesis, captured user
// document, vendor binary or private QA material is read by this corpus.
import JSZip from 'jszip';
import {createDocx,NS} from '../../src/document.mjs';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';

const parse=xml=>new DOMParser().parseFromString(xml,'application/xml');
const serialize=doc=>new XMLSerializer().serializeToString(doc);
export async function mutateDocument(bytes,change){
 const zip=await JSZip.loadAsync(bytes),doc=parse(await zip.file('word/document.xml').async('string'));
 await change(doc,zip);zip.file('word/document.xml',serialize(doc));
 for(const file of Object.values(zip.files))file.date=new Date('2000-01-01T00:00:00Z');
 return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
export function appendXml(doc,xml){
 const node=parse(`<root xmlns:w="${NS.w}" xmlns:r="${NS.r}" xmlns:o="${NS.o}" xmlns:v="${NS.v}">${xml}</root>`).documentElement;
 const body=doc.getElementsByTagNameNS(NS.w,'body')[0],section=Array.from(body.childNodes).find(n=>n.namespaceURI===NS.w&&n.localName==='sectPr');
 for(const child of Array.from(node.childNodes))body.insertBefore(doc.importNode(child,true),section??null);
}
export async function baseCompatibilityDocument(){
 const bytes=await createDocx([
  {latex:String.raw`x_1=\frac{a+b}{2}`,layout:{mode:'numbered-right',numberFormat:'(#C1.#E1)',chapter:1,bookmarkName:'EL_CORPUS_1',bookmarkId:701}},
  {latex:String.raw`y=\sqrt{x^2+1}`,layout:{mode:'numbered-left',numberFormat:'(#C1.#E1)',chapter:1,bookmarkName:'EL_CORPUS_2',bookmarkId:702}},
  {latex:String.raw`z=\sum_{k=1}^{n}k`,layout:{mode:'numbered-right',numberFormat:'(#C1.#E1)',chapter:2,bookmarkName:'EL_CORPUS_3',bookmarkId:703}}
 ],{fragment:true,references:[{target:0,prefix:'Synthetic reference '},{target:2,prefix:'Synthetic reference '}]});
 return mutateDocument(bytes,()=>{});
}
export async function buildDocumentCompatibilityCorpus(){
 const baseline=await baseCompatibilityDocument();
 const legacy=await mutateDocument(baseline,doc=>{
  const fields=Array.from(doc.getElementsByTagNameNS(NS.w,'fldSimple'));
  for(const field of fields){
   const code=field.getAttributeNS(NS.w,'instr').replace(/EquationLab/g,'MTEqn').replace(/ELChapter/g,'MTChap').replace(/ELSection/g,'MTSec').replace(/EL_CORPUS_/g,'_RefCorpus');
   field.setAttributeNS(NS.w,'w:instr',code);
  }
  for(const node of Array.from(doc.getElementsByTagNameNS(NS.w,'bookmarkStart')))node.setAttributeNS(NS.w,'w:name',node.getAttributeNS(NS.w,'name').replace('EL_CORPUS_','_RefCorpus'));
  for(const node of Array.from(doc.getElementsByTagNameNS(NS.w,'pStyle')))node.setAttributeNS(NS.w,'w:val','LegacyEquation');
  // Realistic nested complex outer field. The SEQ remains a field in the CODE;
  // the outer cached result is deliberately separate from nested instructions.
  const field=fields.find(f=>/^SEQ MTEqn/.test(f.getAttributeNS(NS.w,'instr'))),parent=field.parentNode;
  const fragment=parse(`<root xmlns:w="${NS.w}"><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>MACROBUTTON MTPlaceRef </w:instrText></w:r></root>`).documentElement;
  for(const node of Array.from(fragment.childNodes))parent.insertBefore(doc.importNode(node,true),field);
  const tail=parse(`<root xmlns:w="${NS.w}"><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></root>`).documentElement;
  const after=field.nextSibling;for(const node of Array.from(tail.childNodes))parent.insertBefore(doc.importNode(node,true),after);
 });
 const problems=await mutateDocument(baseline,doc=>{
  const equation=Array.from(doc.getElementsByTagNameNS(NS.w,'fldSimple')).find(f=>/^SEQ EquationLab/.test(f.getAttributeNS(NS.w,'instr')));
  equation.setAttributeNS(NS.w,'w:fldLock','true');
  appendXml(doc,'<w:p><w:fldSimple w:instr="REF EL_MISSING \\h"><w:r><w:t>?</w:t></w:r></w:fldSimple></w:p><w:p><w:fldSimple w:instr="SEQ Figure \\r 99"><w:r><w:t>99</w:t></w:r></w:fldSimple></w:p><w:p><w:bookmarkStart w:id="999" w:name="EL_UNKNOWN"/><w:r><w:t>(manual)</w:t></w:r><w:bookmarkEnd w:id="999"/></w:p>');
 });
 const crossStory=await mutateDocument(baseline,async(doc,zip)=>{
  zip.file('word/footnotes.xml',`<w:footnotes xmlns:w="${NS.w}"><w:footnote w:id="1"><w:p><w:fldSimple w:instr="REF EL_CORPUS_1 \\h"><w:r><w:t>(1.1)</w:t></w:r></w:fldSimple></w:p></w:footnote></w:footnotes>`);
 });
 const mixed=await mutateDocument(baseline,doc=>{
  const fields=Array.from(doc.getElementsByTagNameNS(NS.w,'fldSimple')).filter(f=>/^SEQ EquationLab/.test(f.getAttributeNS(NS.w,'instr')));
  fields[1].setAttributeNS(NS.w,'w:instr','SEQ EquationLab \\n \\* ROMAN');
  fields[2].setAttributeNS(NS.w,'w:instr','SEQ EquationLab \\s 1 \\* ARABIC');
 });
 return {schema:'equationlab.synthetic-document-corpus.v1',origin:'original-generated',cases:[
  {id:'el-chapters-reset',bytes:baseline,features:['numbering','references','legal-resets','native-equations']},
  {id:'legacy-nested-fields',bytes:legacy,features:['legacy-numbering','nested-fields','hidden-bookmark']},
  {id:'broken-locked-manual',bytes:problems,features:['broken-reference','locked-field','unknown-target','unrelated-figure']},
  {id:'cross-story-reference',bytes:crossStory,features:['footnote-reference']},
  {id:'mixed-and-heading-reset',bytes:mixed,features:['mixed-format','host-owned-heading-reset']}
 ]};
}
