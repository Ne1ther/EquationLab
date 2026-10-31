import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { createHash } from 'node:crypto';
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';
import { inspectOle, oleLatex, characters, editCharacters, replaceOleLatex,patchRuler,readRuler } from './native.mjs';
import {makeNewOle} from './new-formula.mjs';
import {equationLayout, equationReference, chapterBreak, standaloneNumber,previewNumberFormat} from './layout.mjs';
import {readTypography,patchTypography} from './typography-native.mjs';
import {renderNative,rasterizeNativeSvg} from './font-renderer.mjs';
import {scanWordNumberingPart} from './document-audit.mjs';

let genericPreviewContext;
function previewContext(){if(!genericPreviewContext){const adaptor=liteAdaptor();RegisterHTMLHandler(adaptor);genericPreviewContext={adaptor,math:mathjax.document('',{InputJax:new TeX({packages:AllPackages}),OutputJax:new SVG({fontCache:'local'})})};}return genericPreviewContext;}
export const NS = {w:'http://schemas.openxmlformats.org/wordprocessingml/2006/main',r:'http://schemas.openxmlformats.org/officeDocument/2006/relationships',v:'urn:schemas-microsoft-com:vml',o:'urn:schemas-microsoft-com:office:office',pkg:'http://schemas.microsoft.com/office/2006/xmlPackage',rels:'http://schemas.openxmlformats.org/package/2006/relationships'};
const esc = t => String(t).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
export const hash = b => createHash('sha256').update(b).digest('hex');

export async function preview(latex, {fontSize = 12} = {}) {
  if (latex.length > 20000) throw Error('Formula length limit');
  if (!Number.isFinite(fontSize) || fontSize < 6 || fontSize > 96) throw Error('Font size must be between 6 and 96 pt');
  const {adaptor,math}=previewContext();
  let svg = adaptor.outerHTML(math.convert(latex,{display:false}));
  if (svg.includes('data-mjx-error')) throw Error('Formula rendering failed');
  svg = svg.slice(svg.indexOf('<svg'),svg.indexOf('</svg>') + 6);
  const [x,y,w,h] = /viewBox="([^"]+)"/.exec(svg)[1].split(/\s+/).map(Number);
  const width = Math.max(2,w * fontSize / 1000), height = Math.max(2,h * fontSize / 1000), depth = Math.max(0,(y+h)*fontSize/1000);
  svg = svg.replace(/width="[^"]+"/,`width="${width}pt"`).replace(/height="[^"]+"/,`height="${height}pt"`);
  const png = await rasterizeNativeSvg(svg,width,height);
  return {svg,png,width,height,depth};
}

// Complete picture-template geometry from the Microsoft Open XML example:
// https://learn.microsoft.com/dotnet/api/documentformat.openxml.wordprocessing.picture
const pictureFormulas = ['if lineDrawn pixelLineWidth 0','sum @0 1 0','sum 0 0 @1','prod @2 1 2','prod @3 21600 pixelWidth','prod @3 21600 pixelHeight','sum @0 0 1','prod @6 1 2','prod @7 21600 pixelWidth','sum @8 21600 0','prod @7 21600 pixelHeight','sum @10 21600 0'];
export function equationPictureShapeType(id) {
  if(!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(id))throw Error('Invalid picture shape type ID');
  return `<v:shapetype id="${id}" coordsize="21600,21600" o:spt="75" o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f"><v:stroke joinstyle="miter"/><v:formulas>${pictureFormulas.map(eqn=>`<v:f eqn="${eqn}"/>`).join('')}</v:formulas><v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/><o:lock v:ext="edit" aspectratio="t"/></v:shapetype>`;
}
function objectRun(n,p) {
  // Keep each object self-contained when Word moves or deletes other objects.
  const typeId=`_EquationLab_t75_${n}`;
  return `<w:r><w:rPr><w:position w:val="${-Math.round(p.depth*2)}"/></w:rPr><w:object w:dxaOrig="${Math.round(p.width*20)}" w:dyaOrig="${Math.round(p.height*20)}">${equationPictureShapeType(typeId)}<v:shape id="_x0000_i${1024+n}" type="#${typeId}" style="width:${p.width.toFixed(3)}pt;height:${p.height.toFixed(3)}pt" o:ole=""><v:imagedata r:id="rImg${n}" o:title=""/></v:shape><o:OLEObject Type="Embed" ProgID="Equation.DSMT4" ShapeID="_x0000_i${1024+n}" DrawAspect="Content" ObjectID="_${1700000000+n}" r:id="rOle${n}"/></w:object></w:r>`;
}

export async function createDocx(equations,{fragment=false,references=[],initializeContext=true,numberingFamily='equationlab'}={}) {
  if(!['equationlab','mathtype'].includes(numberingFamily))throw Error('Invalid numbering family');
  if(!Array.isArray(equations)||equations.length>500)throw Error('需要最多 500 条公式');
  const zip = new JSZip(), paragraphs = [], relationships = [], anchors=[];
  let count=0,context=null;
  for(let i=0;i<equations.length;i++) {
    const n=i+1,e=equations[i],originalOle=e.ole?(e.typography?patchTypography(e.ole,e.typography):e.ole):makeNewOle(e.latex,e.typography),ole=e.ruler===undefined?originalOle:patchRuler(originalOle,e.ruler),latex=oleLatex(ole),p=await renderNative(ole);
    zip.file(`word/embeddings/oleObject${n}.bin`,ole); zip.file(`word/media/image${n}.png`,p.png);
    relationships.push(`<Relationship Id="rOle${n}" Type="${NS.r}/oleObject" Target="embeddings/oleObject${n}.bin"/>`,`<Relationship Id="rImg${n}" Type="${NS.r}/image" Target="media/image${n}.png"/>`);
    if(!fragment || e.label) paragraphs.push(`<w:p><w:r><w:t>${esc(e.label || `Formula ${n}`)}</w:t></w:r></w:p>`);
    const layout={mode:'inline',numberingFamily,...e.layout};
    if(layout.numberingFamily!==numberingFamily)throw Error('A Word document must use one numbering family');
    if(layout.mode.startsWith('numbered-')) {
      const nextContext=`${layout.chapter??1}:${layout.section??1}`;
      if(context!==nextContext) {
        if(initializeContext)paragraphs.push(chapterBreak({chapter:layout.chapter??1,section:layout.section??1,numberingFamily:layout.numberingFamily}));count=0;context=nextContext;
      }
      if(layout.resetEquation)count=(layout.equation??1)-1;
      layout.equation=layout.equation??++count;
      count=layout.equation;
    }
    const result=equationLayout(objectRun(n,p),layout);
    anchors.push(result);paragraphs.push(result.xml);
  }
  for(const ref of references){const a=anchors[ref.target];if(!a?.bookmarkName)throw Error('引用目标必须是带编号的公式');paragraphs.push(`<w:p>${equationReference(a.bookmarkName,{cachedText:a.numberText,prefix:ref.prefix??'式 '})}</w:p>`);}
  // Keep the format used by the generated document as the default for later
  // Word Ribbon insertions. A live insertion fragment must not import or
  // replace preferences in its destination document.
  const formats=new Set(equations.filter(e=>e.layout?.mode?.startsWith('numbered-')).map(e=>e.layout.numberFormat??'(#E1)'));
  const numberingFormat=initializeContext&&formats.size===1?[...formats][0]:null;
  return packageDocument(zip,paragraphs,relationships,{fragment,numberingFormat,numberingFamily});
}

function packageDocument(zip,paragraphs,relationships,{fragment=true,numberingFormat=null,numberingFamily='equationlab'}={}) {
  zip.file('[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>${numberingFamily==='mathtype'&&numberingFormat!==null?'<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>':''}</Types>`);
  zip.file('_rels/.rels',`<Relationships xmlns="${NS.rels}"><Relationship Id="rDoc" Type="${NS.r}/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file('word/styles.xml',`<w:styles xmlns:w="${NS.w}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>${equationStyle}</w:styles>`);
  const variables=numberingFormat===null?'':`<w:docVars><w:docVar w:name="EquationLabNumberFormat" w:val="${esc(numberingFormat)}"/></w:docVars>`;
  zip.file('word/settings.xml',`<w:settings xmlns:w="${NS.w}"><w:updateFields w:val="true"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>${variables}</w:settings>`);
  zip.file('word/_rels/document.xml.rels',`<Relationships xmlns="${NS.rels}"><Relationship Id="rStyles" Type="${NS.r}/styles" Target="styles.xml"/><Relationship Id="rSettings" Type="${NS.r}/settings" Target="settings.xml"/>${relationships.join('')}</Relationships>`);
  zip.file('word/document.xml',`<w:document xmlns:w="${NS.w}" xmlns:r="${NS.r}" xmlns:v="${NS.v}" xmlns:o="${NS.o}"><w:body>${fragment?'':'<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Mac native MathType compatibility prototype</w:t></w:r></w:p>'}${paragraphs.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`);
  if(numberingFamily==='mathtype'&&numberingFormat!==null){
    zip.file('_rels/.rels',`<Relationships xmlns="${NS.rels}"><Relationship Id="rDoc" Type="${NS.r}/officeDocument" Target="word/document.xml"/><Relationship Id="rCustom" Type="${NS.r}/custom-properties" Target="docProps/custom.xml"/></Relationships>`);
    zip.file('docProps/custom.xml',`<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="MTEquationNumber2"><vt:lpwstr>${esc(numberingFormat)}</vt:lpwstr></property><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="3" name="MTWinEqns"><vt:bool>true</vt:bool></property><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="4" name="MTEquationSection"><vt:lpwstr>1</vt:lpwstr></property></Properties>`);
  }
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}

const equationStyle='<w:style w:type="paragraph" w:styleId="EquationLab"><w:name w:val="Equation Lab"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepLines/><w:spacing w:before="120" w:after="120"/></w:pPr></w:style>';
function emptyHiddenShapeRun(run){
  if(run.namespaceURI!==NS.w||run.localName!=='r')return false;
  const elements=Array.from(run.childNodes).filter(n=>n.nodeType===1),pict=elements.find(n=>n.namespaceURI===NS.w&&n.localName==='pict');
  if(!pict||elements.some(n=>n!==pict&&!(n.namespaceURI===NS.w&&n.localName==='rPr')))return false;
  const children=Array.from(pict.childNodes).filter(n=>n.nodeType===1);
  if(children.length!==1||children[0].namespaceURI!==NS.v||children[0].localName!=='shape')return false;
  const shape=children[0];if(!/(?:^|;)\s*visibility\s*:\s*hidden\s*(?:;|$)/i.test(shape.getAttribute('style'))||shape.textContent.trim())return false;
  return Array.from(shape.getElementsByTagName('*')).every(n=>['stroke','formulas','f','path','lock'].includes(n.localName)&&[NS.v,NS.o].includes(n.namespaceURI)&&!Array.from(n.attributes).some(a=>a.namespaceURI===NS.r));
}
export function referenceDocx(bookmarkName,options={}) {return packageDocument(new JSZip(),[`<w:p>${equationReference(bookmarkName,options)}</w:p>`],[]);}
export function chapterDocx(options={}) {return packageDocument(new JSZip(),[chapterBreak(options)],[]);}
export function numberDocx(options={},initializeContext=false) {
 const paragraphs=[];if(initializeContext)paragraphs.push(chapterBreak({chapter:options.chapter??1,section:options.section??1,resetEquation:false,numberingFamily:options.numberingFamily??'equationlab'}));
 const number=standaloneNumber(options);paragraphs.push(number.xml);
 return packageDocument(new JSZip(),paragraphs,[]);
}

function parseXml(text) {
  text=text.replace(/^\uFEFF/,'');
  const errors=[];
  const doc = new DOMParser({onError:(level,msg)=>{if(level==='error'||level==='fatalError') errors.push(msg);}}).parseFromString(text,'application/xml');
  if(errors.length) throw Error(errors.join('; ')); return doc;
}
function partPath(target, source='word/document.xml') { const p = new URL(target,'https://local/'+source).pathname.slice(1); if(p.includes('..')) throw Error('Invalid relationship'); return p; }
function fieldCodes(paragraph){
  const result=Array.from(paragraph.getElementsByTagNameNS(NS.w,'fldSimple')).map(f=>f.getAttributeNS(NS.w,'instr'));
  let code='',open=false;
  for(const run of Array.from(paragraph.getElementsByTagNameNS(NS.w,'r')))for(const n of Array.from(run.childNodes)){
    if(n.localName==='fldChar'&&n.getAttributeNS(NS.w,'fldCharType')==='begin'){open=true;code='';}
    if(n.localName==='instrText'&&open)code+=n.textContent;
    if(n.localName==='fldChar'&&['separate','end'].includes(n.getAttributeNS(NS.w,'fldCharType'))&&open){result.push(code);open=false;}
  }return result;
}
// Read Word's current content without accepting or rejecting tracked changes.
// Number bookmarks and complex fields can span multiple insertion wrappers.
function currentNodes(root){
 const nodes=[];function visit(node){if(node.nodeType!==1)return;if(node.namespaceURI===NS.w&&['del','moveFrom','rPrChange','pPrChange','sectPrChange'].includes(node.localName))return;nodes.push(node);for(const c of Array.from(node.childNodes))visit(c);}visit(root);return nodes;
}
function currentFieldCodes(root){
 const result=[],stack=[];
 for(const n of currentNodes(root)){
  if(n.namespaceURI!==NS.w)continue;
  if(n.localName==='fldSimple')result.push(n.getAttributeNS(NS.w,'instr'));
  else if(n.localName==='fldChar'){
   const kind=n.getAttributeNS(NS.w,'fldCharType');
   if(kind==='begin')stack.push({code:'',result:false});
   else if(kind==='separate'&&stack.length){const f=stack.at(-1);result.push(f.code);f.result=true;}
   else if(kind==='end'&&stack.length){const f=stack.pop();if(!f.result)result.push(f.code);}
  }else if(n.localName==='instrText'&&stack.length&&!stack.at(-1).result)stack.at(-1).code+=n.textContent;
 }
 return result;
}
function numberBookmarkNodes(bookmark){
 let p=bookmark;while(p&&!(p.namespaceURI===NS.w&&p.localName==='p'))p=p.parentNode;
 if(!p)return [];
 const nodes=currentNodes(p),start=nodes.indexOf(bookmark),id=bookmark.getAttributeNS(NS.w,'id');
 const end=nodes.findIndex((n,i)=>i>start&&n.namespaceURI===NS.w&&n.localName==='bookmarkEnd'&&n.getAttributeNS(NS.w,'id')===id);
 return start>=0&&end>start?nodes.slice(start+1,end):[];
}
const counterIndexes=new WeakMap();
function priorCounters(doc,paragraph){
 if(!counterIndexes.has(doc)){
  const index=new WeakMap(),values={EquationLab:0,ELChapter:null,ELSection:null};
  for(const p of currentNodes(doc.documentElement).filter(n=>n.namespaceURI===NS.w&&n.localName==='p')){index.set(p,{...values});for(const code of currentFieldCodes(p)){
    const m=/^\s*SEQ (EquationLab|ELChapter|ELSection|MTEqn|MTChap|MTSec)\b([\s\S]*)/i.exec(code);if(!m||/\\c\b/i.test(m[2]))continue;
    const name={EQUATIONLAB:'EquationLab',ELCHAPTER:'ELChapter',ELSECTION:'ELSection',MTEQN:'EquationLab',MTCHAP:'ELChapter',MTSEC:'ELSection'}[m[1].toUpperCase()];
    const reset=/\\r\s+(\d+)/i.exec(m[2]);values[name]=reset?Number(reset[1]):(values[name]??0)+1;
  }}counterIndexes.set(doc,index);
 }
 return counterIndexes.get(doc).get(paragraph)??{EquationLab:0,ELChapter:null,ELSection:null};
}

// Reconstruct the format from live fields, not their cached numeric text.
function bookmarkNumberFormat(bookmark){
 const counters={EquationLab:'E',ELChapter:'C',ELSection:'S'},formats={ARABIC:'1',ALPHABETIC:'A',alphabetic:'a',ROMAN:'I',roman:'i'};
 const token=code=>{const m=/^\s*SEQ\s+(EquationLab|ELChapter|ELSection)\b[\s\S]*?\\\*\s+(ARABIC|ALPHABETIC|alphabetic|ROMAN|roman)\b/.exec(code);return m?'#'+counters[m[1]]+formats[m[2]]:null;};
 const nodes=numberBookmarkNodes(bookmark);let result='',depth=0,code='',failed=false;
 for(let i=0;i<nodes.length;i++){
  const n=nodes[i];if(n.namespaceURI!==NS.w)continue;
  if(n.localName==='fldSimple'){
   const value=token(n.getAttributeNS(NS.w,'instr'));if(value)result+=value;else failed=true;
   while(i+1<nodes.length){let p=nodes[i+1].parentNode;while(p&&p!==n)p=p.parentNode;if(p!==n)break;i++;}continue;
  }
  if(n.localName==='fldChar'){const kind=n.getAttributeNS(NS.w,'fldCharType');if(kind==='begin'){if(depth)failed=true;depth++;code='';}else if(kind==='separate'){const value=token(code);if(value)result+=value;else failed=true;}else if(kind==='end'){depth--;if(depth<0)failed=true;}continue;}
  if(n.localName==='instrText'){code+=n.textContent;continue;}
  if(n.localName==='t'&&!depth)result+=n.textContent;
 }
 return !failed&&!depth&&result.includes('#E')?result:null;
}

function mathTypeNumberLayout(scan,element){
 const object=scan.objects.find(item=>item.node===element);if(!object)return null;
 const candidates=scan.bookmarks.filter(bookmark=>bookmark.end!==null&&bookmark.location.paragraph===object.location.paragraph&&bookmark.endParagraph===object.location.paragraph&&bookmark.numberFormat?.includes('#E')&&!scan.objects.some(o=>o.order>bookmark.start&&o.order<bookmark.end));
 if(candidates.length>1)return null;
 let bookmark=candidates[0];
 if(!bookmark){
  const envelopes=scan.fields.filter(f=>/^\s*MACROBUTTON\s+MTPlaceRef\b/i.test(f.code)&&f.location.paragraph===object.location.paragraph);
  if(envelopes.length!==1||!envelopes[0].numberFormat?.includes('#E')||scan.objects.filter(o=>o.location.paragraph===object.location.paragraph).length!==1)return null;
  const envelope=envelopes[0];
  bookmark={start:envelope.start,end:envelope.end,name:null,numberFormat:envelope.numberFormat,cachedText:envelope.numberCache};
 }
 const fields=scan.fields.filter(f=>f.start>bookmark.start&&f.end!==null&&f.end<bookmark.end&&f.instruction.type==='SEQ'&&f.instruction.family==='mathtype');
 try{previewNumberFormat(bookmark.numberFormat);}catch{return null;}
 const equation=fields.filter(f=>f.instruction.role==='equation'&&!f.instruction.hidden);
 if(equation.length!==1||fields.some(f=>f.instruction.unknownSwitches.length||f.reviewState!=='unchanged'))return null;
 const context={chapter:null,section:null};
 for(const field of scan.fields){
  if(field.start>=object.order||field.reviewState!=='unchanged')continue;
  const parsed=field.instruction;if(parsed.type!=='SEQ'||parsed.family!=='mathtype'||!(parsed.role in context)||parsed.repeat)continue;
  context[parsed.role]=parsed.unknownSwitches.length?null:parsed.reset??(context[parsed.role]??0)+1;
 }
 const cached=equation[0].cachedText.trim();
 const increments=scan.fields.filter(f=>f.parent===equation[0].parent&&f.instruction.role==='equation'&&f.instruction.hidden&&!f.instruction.repeat);
 return {bookmarkName:bookmark.name,numberText:bookmark.cachedText,numberFormat:bookmark.numberFormat,numberingFamily:'mathtype',mode:bookmark.start<object.order?'numbered-left':'numbered-right',...context,equation:/^\d+$/.test(cached)&&Number.isSafeInteger(Number(cached))?Number(cached):null,...increments.length===1&&increments[0].instruction.reset!==null?{equationReset:increments[0].instruction.reset}:{}};
}

export async function inspectDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const rootRelationships=zip.file('_rels/.rels');
  if(!rootRelationships)throw Error('Word document is missing its package relationships');
  const root=parseXml(await rootRelationships.async('string'));
  const documentRelationships=Array.from(root.getElementsByTagNameNS(NS.rels,'Relationship')).filter(r=>r.getAttribute('Type')===`${NS.r}/officeDocument`);
  if(documentRelationships.length!==1||documentRelationships[0].getAttribute('TargetMode')==='External')throw Error('Word document has an invalid main document relationship');
  const mainTarget=documentRelationships[0].getAttribute('Target');
  if(!mainTarget||/^[a-z][a-z\d+.-]*:/i.test(mainTarget)||mainTarget.startsWith('//'))throw Error('Word document main part must be an internal package path');
  const mainPart=partPath(mainTarget,'_root.xml');
  if(!zip.file(mainPart))throw Error('Word document main part is missing');
  const doc=parseXml(await zip.file(mainPart).async('string'));
  const objects = [];
  const parts=[mainPart,...Object.keys(zip.files).filter(p=>p!==mainPart&&/^word\/(header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(p))];
  for (const part of parts) {
  const partDoc=part===mainPart?doc:parseXml(await zip.file(part).async('string'));
  const relPart=part.replace(/([^/]+)$/, '_rels/$1.rels');
  if(!zip.file(relPart)) continue;
  const rels = parseXml(await zip.file(relPart).async('string'));
  const numberingScan=scanWordNumberingPart(partDoc,part);
  const references=new Map();for(const code of currentFieldCodes(partDoc.documentElement)){const match=/^\s*REF\s+(\S+)/i.exec(code);if(match)references.set(match[1],(references.get(match[1])??0)+1);}
  const byId = new Map(Array.from(rels.documentElement.childNodes).filter(n=>n.nodeType===1).map(n=>[n.getAttribute('Id'),n]));
  for(const e of Array.from(partDoc.getElementsByTagNameNS(NS.o,'OLEObject'))) {
    const progId = e.getAttribute('ProgID'); if(!['Equation.DSMT4','Equation.3'].includes(progId)) continue;
    const id=e.getAttributeNS(NS.r,'id'), rel=byId.get(id); if(!rel || rel.getAttribute('TargetMode')==='External') throw Error('Missing embedded relationship');
    const path=partPath(rel.getAttribute('Target'),part); if(!zip.file(path)) throw Error('Missing embedded object part');
    const ole=await zip.file(path).async('nodebuffer'); let inspected,parseError;
    try {inspected=inspectOle(ole);}catch(error){parseError=error.message;}
    const shape=e.parentNode.getElementsByTagNameNS(NS.v,'shape')[0], image=shape?.getElementsByTagNameNS(NS.v,'imagedata')[0], imageRel=image ? byId.get(image.getAttributeNS(NS.r,'id')) : null;
    let latex,previewError;try {latex=oleLatex(ole);}catch(error){previewError=error.message;}
    let paragraph=e;while(paragraph&&!(paragraph.namespaceURI===NS.w&&paragraph.localName==='p'))paragraph=paragraph.parentNode;
    const owned=paragraph?.getElementsByTagNameNS(NS.w,'pStyle')[0]?.getAttributeNS(NS.w,'val')==='EquationLab';
    const visible=paragraph?currentNodes(paragraph):[];
    const bookmark=owned?visible.find(b=>b.namespaceURI===NS.w&&b.localName==='bookmarkStart'&&/^EL_/.test(b.getAttributeNS(NS.w,'name'))):null;
    const fields=owned?currentFieldCodes(paragraph):[];
    const numberText=bookmark?numberBookmarkNodes(bookmark).filter(n=>n.namespaceURI===NS.w&&n.localName==='t').map(n=>n.textContent).join(''):null;
    const context=priorCounters(partDoc,paragraph);
    const layout={owned,bookmarkName:bookmark?.getAttributeNS(NS.w,'name')??null,numberText,chapter:context.ELChapter,section:context.ELSection};
    layout.mode=fields.some(code=>/SEQ EquationLab/.test(code))?(visible.indexOf(bookmark)<visible.indexOf(e)?'numbered-left':'numbered-right'):owned&&paragraph.getElementsByTagNameNS(NS.w,'jc')[0]?.getAttributeNS(NS.w,'val')==='center'?'display':'inline';
    if(!owned)layout.mode='unknown';
    if(bookmark){
      layout.numberFormat=bookmarkNumberFormat(bookmark);
      const code=fields.find(code=>/^\s*SEQ\s+EquationLab\b/i.test(code)&&!/\\c\b/.test(code));
      const reset=code&&/\\r\s+(\d+)/.exec(code);layout.equation=code?(reset?Number(reset[1]):context.EquationLab+1):null;
      if(reset)layout.equationReset=Number(reset[1]);
      layout.referenceCount=references.get(layout.bookmarkName)??0;
    }
    const mathTypeLayout=mathTypeNumberLayout(numberingScan,e);
    if(mathTypeLayout){Object.assign(layout,mathTypeLayout);layout.referenceCount=references.get(layout.bookmarkName)??0;}
    let typography,typographyError;try{typography=readTypography(ole);}catch(error){typographyError=error.message;}
    objects.push({index:objects.length,path,part,mainDocument:part===mainPart,progId,ole,latex,previewError,parseError,layout,typography,typographyError,ruler:inspected?readRuler(ole):[],nativeSha256:inspected?hash(inspected.native):null,characters:inspected?characters(inspected.parsed):[],application:inspected?.parsed.application,element:e,shape,image,imagePath:imageRel?partPath(imageRel.getAttribute('Target'),part):null,partDoc,rels,relPart});
  }
  }
  let numberFormat=null,numberingRevision=0;
  if(zip.file('word/settings.xml')){
    const settings=parseXml(await zip.file('word/settings.xml').async('string'));
    const variables=Array.from(settings.getElementsByTagNameNS(NS.w,'docVar'));
    const revision=variables.find(node=>node.getAttributeNS(NS.w,'name')==='EquationLabNumberingRevision')?.getAttributeNS(NS.w,'val');
    if(revision&&/^\d+$/.test(revision)&&Number(revision)<=2147483646)numberingRevision=Number(revision);
    const variable=variables.find(node=>node.getAttributeNS(NS.w,'name')==='EquationLabNumberFormat');
    if(variable){const value=variable.getAttributeNS(NS.w,'val');try{previewNumberFormat(value);numberFormat=value;}catch{/* Unknown document settings never become a write instruction. */}}
  }
  const legacyNumbers=objects.some(object=>object.layout?.bookmarkName&&object.layout.numberingFamily!=='mathtype');
  if((numberFormat===null||!legacyNumbers)&&zip.file('docProps/custom.xml')){
   const custom=parseXml(await zip.file('docProps/custom.xml').async('string'));
   const property=Array.from(custom.getElementsByTagName('*')).find(n=>n.localName==='property'&&n.getAttribute('name')==='MTEquationNumber2');
   if(property){const value=property.textContent;try{previewNumberFormat(value);numberFormat=value;}catch{/* Unsupported MathType tokens remain host-owned. */}}
  }
  return {zip,doc,mainPart,objects,numberFormat,numberingRevision};
}

export async function editDocx(buffer,index,replacements,options={}) {
  return updateDocx(buffer,index,ole=>editCharacters(ole,replacements),options);
}

export async function replaceDocxEquation(buffer,index,latex,options={}) {
  return updateDocx(buffer,index,ole=>replaceOleLatex(ole,latex),options);
}

export function sharedNumberRangeNodes(object,paragraph,scan){
 const bookmark=scan.bookmarks.find(b=>b.name===object.layout.bookmarkName);
 const envelope=bookmark&&scan.fields.find(f=>f.start<bookmark.start&&f.end>bookmark.end&&/^\s*MACROBUTTON\s+MTPlaceRef\b/i.test(f.code));
 if(!envelope||envelope.locked||envelope.reviewState!=='unchanged'||scan.structural.length)throw Error('编号域结构需要在 Word 中处理');
 const prefix=envelope.codeParts.filter(p=>p.text!==undefined&&p.position<bookmark.start).map(p=>p.text).join('');
 const suffix=envelope.codeParts.filter(p=>p.text!==undefined&&p.position>bookmark.end).map(p=>p.text).join('');
 if(!/^\s*MACROBUTTON\s+MTPlaceRef(?:\s+\\\*\s+(?:MERGEFORMAT|CHARFORMAT))*\s*$/i.test(prefix)||suffix.trim())throw Error('编号域包含自定义文字，请在 Word 中保留处理');
 const fields=scan.fields.filter(f=>f.start>envelope.start&&f.end<envelope.end),increments=fields.filter(f=>f.start<bookmark.start);
 if(increments.length!==1||increments[0].instruction.role!=='equation'||!increments[0].instruction.hidden||increments[0].instruction.repeat)throw Error('编号的隐藏计数器不完整');
 if(fields.some(f=>f.instruction.type!=='SEQ'||f.instruction.family!=='mathtype'||f.instruction.unknownSwitches.length||f.locked||f.reviewState!=='unchanged'||f.start>bookmark.start&&f.end>bookmark.end))throw Error('编号域包含不支持的字段');
 const bookmarks=scan.bookmarks.filter(b=>b.start>envelope.start&&b.start<envelope.end);
 if(bookmarks.length!==1||bookmarks[0]!==bookmark)throw Error('编号域包含其他引用书签，请在 Word 中保留处理');
 let first=envelope.node;while(first&&first.parentNode!==paragraph)first=first.parentNode;
 if(!first)throw Error('编号域跨越了段落边界');
 const result=new Set();let depth=0,done=false;
 for(let node=first;node;node=node.nextSibling){
  result.add(node);
  for(const field of currentNodes(node).filter(n=>n.namespaceURI===NS.w&&n.localName==='fldChar')){
   const kind=field.getAttributeNS(NS.w,'fldCharType');if(kind==='begin')depth++;else if(kind==='end')depth--;
  }
  if(depth===0){done=true;break;}
 }
 if(!done||result.has(object.element.parentNode.parentNode))throw Error('编号域与公式对象边界重叠');
 return result;
}

/** Change standalone equation paragraphs without touching their native OLE bytes.
 * Existing prose, revision markup, custom fields and bookmarks require a host
 * range operation and are rejected here rather than discarded. */
export async function arrangeDocx(buffer,{indices,layout={},defaultNumberingFamily='equationlab'}={}) {
  if(!['equationlab','mathtype'].includes(defaultNumberingFamily))throw Error('Invalid numbering family');
  const {zip,objects}=await inspectDocx(buffer),targets=indices??objects.map(o=>o.index);
  const documentFamily=objects.some(o=>o.layout.bookmarkName&&o.layout.numberingFamily!=='mathtype')?'equationlab':objects.some(o=>o.layout.numberingFamily==='mathtype')?'mathtype':defaultNumberingFamily;
  if(!Array.isArray(targets)||!targets.length||new Set(targets).size!==targets.length)throw Error('请选择互不重复的公式');
  const serializer=new XMLSerializer(),changedParts=new Map();
  const existingBookmarks=new Set(),existingBookmarkIds=new Set();
  for(const o of objects)for(const b of Array.from(o.partDoc.getElementsByTagNameNS(NS.w,'bookmarkStart'))){existingBookmarks.add(b.getAttributeNS(NS.w,'name'));existingBookmarkIds.add(b.getAttributeNS(NS.w,'id'));}
  const numberingScans=new WeakMap();
  let first=true;
  for(const index of [...targets].sort((a,b)=>a-b)) {
    const o=objects[index];if(!o)throw Error('公式不存在');
    if(layout.mode?.startsWith('numbered-')&&!o.mainDocument)throw Error('章节编号目前只支持正文，脚注、尾注和页眉页脚请单独设置');
    const run=o.element.parentNode.parentNode,p=run.parentNode;
    if(run.localName!=='r'||p.localName!=='p')throw Error('此公式包含特殊包装，暂不能更改段落编排');
    if(Array.from(run.childNodes).some(n=>n.nodeType===1&&!['rPr','object'].includes(n.localName)))throw Error('公式与正文处于同一段落，请先在 Word 中分段，以保留正文');
    if(['sectPr','pPrChange','framePr','numPr'].some(tag=>p.getElementsByTagNameNS(NS.w,tag).length))throw Error('段落包含节设置、修订或特殊版式，请在 Word 中单独编排');
    if(p.getElementsByTagNameNS(NS.o,'OLEObject').length!==1)throw Error('一个段落中有多个公式，请在 Word 中分段后编排');
    const owned=o.layout.owned,shared=o.layout.numberingFamily==='mathtype';
    let sharedNodes=new Set();
    if(shared){
      if(!numberingScans.has(o.partDoc))numberingScans.set(o.partDoc,scanWordNumberingPart(o.partDoc,o.part));
      sharedNodes=sharedNumberRangeNodes(o,p,numberingScans.get(o.partDoc));
    }
    if(owned&&!shared&&fieldCodes(p).some(code=>!/^\s*SEQ (EquationLab|ELChapter|ELSection)\b/.test(code)))throw Error('段落含其他编号域，暂不能替换');
    const allowed=owned?['pPr','r','bookmarkStart','bookmarkEnd','fldSimple']:['pPr','r'];
    let inNumber=false;const hiddenShapes=[];
    for(const node of Array.from(p.childNodes).filter(n=>n.nodeType===1)) {
      if(sharedNodes.has(node))continue;
      if(node!==run&&emptyHiddenShapeRun(node)){hiddenShapes.push(node);continue;}
      if(node.localName==='bookmarkStart'&&/^EL_/.test(node.getAttributeNS(NS.w,'name')))inNumber=true;
      if(node.namespaceURI!==NS.w||!allowed.includes(node.localName))throw Error('段落包含自定义内容，请在 Word 中选中独立公式');
      if(node.localName==='r'&&node!==run&&((!inNumber&&node.textContent.trim())||Array.from(node.childNodes).some(n=>n.nodeType===1&&!(inNumber?['rPr','tab','t','fldChar','instrText']:['rPr','tab','t']).includes(n.localName))))throw Error('公式与正文处于同一段落，请先在 Word 中分段，以保留正文');
      if(node.localName==='fldSimple'&&!/^SEQ (EquationLab|ELChapter|ELSection)\b/.test(node.getAttributeNS(NS.w,'instr')))throw Error('段落含其他编号域，暂不能替换');
      if(node.localName==='bookmarkStart'&&!/^EL_/.test(node.getAttributeNS(NS.w,'name')))throw Error('段落含其他引用书签，暂不能替换');
      if(node.localName==='bookmarkEnd')inNumber=false;
    }
    let name=o.layout.bookmarkName,id;
    if(name){const b=Array.from(p.getElementsByTagNameNS(NS.w,'bookmarkStart')).find(b=>b.getAttributeNS(NS.w,'name')===name);id=Number(b.getAttributeNS(NS.w,'id'));existingBookmarks.delete(name);existingBookmarkIds.delete(String(id));}
    const opts={numberingFamily:o.layout.bookmarkName?(shared?'mathtype':'equationlab'):documentFamily,...layout,existingBookmarks,existingBookmarkIds};
    if(o.layout.bookmarkName&&opts.numberingFamily!==(shared?'mathtype':'equationlab'))throw Error('编号计数链需要在 Word 中统一后再更改');
    if(layout.mode?.startsWith('numbered-')){
      counterIndexes.delete(o.partDoc);
      let context=priorCounters(o.partDoc,p);
      if(/#[CS]/.test(layout.numberFormat??'')&&(context.ELChapter===null||context.ELSection===null)){
        const marker=parseXml(`<root xmlns:w="${NS.w}">${chapterBreak({chapter:layout.chapter??1,section:layout.section??1,resetEquation:false,numberingFamily:opts.numberingFamily})}</root>`).documentElement.firstChild;
        p.parentNode.insertBefore(o.partDoc.importNode(marker,true),p);counterIndexes.delete(o.partDoc);context=priorCounters(o.partDoc,p);
      }
      const retainedReset=layout.resetEquation!==false&&Number.isSafeInteger(o.layout.equationReset)?o.layout.equationReset:null;
      opts.equation=first&&layout.resetEquation?(layout.equation??1):retainedReset??context.EquationLab+1;
      opts.chapter=context.ELChapter??layout.chapter??1;opts.section=context.ELSection??layout.section??1;
      if(name){opts.bookmarkName=name;opts.bookmarkId=id;}opts.resetEquation=first&&!!layout.resetEquation||retainedReset!==null;
    }
    else if(name)throw Error('此公式已带引用书签；取消编号会使引用失效，请保留编号');
    const result=equationLayout(hiddenShapes.map(n=>serializer.serializeToString(n)).join('')+serializer.serializeToString(run),opts),replacement=parseXml(`<root xmlns:w="${NS.w}" xmlns:r="${NS.r}" xmlns:v="${NS.v}" xmlns:o="${NS.o}">${result.xml}</root>`).documentElement.firstChild;
    p.parentNode.replaceChild(o.partDoc.importNode(replacement,true),p);changedParts.set(o.part,o.partDoc);first=false;
  }
  for(const [name,doc]of changedParts)zip.file(name,serializer.serializeToString(doc));
  // Ensure the style exists without replacing any of the user's other styles.
  const stylePath='word/styles.xml';
  if(zip.file(stylePath)){const styles=parseXml(await zip.file(stylePath).async('string'));if(!Array.from(styles.getElementsByTagNameNS(NS.w,'style')).some(n=>n.getAttributeNS(NS.w,'styleId')==='EquationLab')){styles.documentElement.appendChild(styles.importNode(parseXml(`<root xmlns:w="${NS.w}">${equationStyle}</root>`).documentElement.firstChild,true));zip.file(stylePath,serializer.serializeToString(styles));}}
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}

async function updateDocx(buffer,index,transform,{fontSize=12,typography,ruler}={}) {
  const {zip,objects}=await inspectDocx(buffer), obj=objects[index]; if(!obj) throw Error('Equation index not found');
  if(obj.parseError) throw Error(obj.parseError);
  if(!obj.shape || !obj.image) throw Error('This object preview layout is not supported; source unchanged');
  const changed=transform(obj.ole),styled=typography?patchTypography(changed,typography):changed,ole=ruler===undefined?styled:patchRuler(styled,ruler), latex=oleLatex(ole), p=await renderNative(ole);
  // Give this object its own preview and binary part: existing parts can be shared.
  let k=1;while(zip.file(`word/media/nativeBridge${k}.png`)||zip.file(`word/embeddings/nativeBridge${k}.bin`))k++;
  const newImage=`word/media/nativeBridge${k}.png`,newOle=`word/embeddings/nativeBridge${k}.bin`;
  zip.file(newOle,ole); zip.file(newImage,p.png);
  const ids=new Set(Array.from(obj.rels.documentElement.childNodes).filter(n=>n.nodeType===1).map(n=>n.getAttribute('Id')));
  function relation(type,target){let n=1;while(ids.has(`rNativeBridge${n}`))n++;const id=`rNativeBridge${n}`;ids.add(id);const e=obj.rels.createElementNS(NS.rels,'Relationship');e.setAttribute('Id',id);e.setAttribute('Type',NS.r+'/'+type);e.setAttribute('Target',target);obj.rels.documentElement.appendChild(e);return id;}
  obj.image.setAttributeNS(NS.r,'r:id',relation('image',newImage.replace('word/','')));
  obj.element.setAttributeNS(NS.r,'r:id',relation('oleObject',newOle.replace('word/','')));
  const contentTypes=parseXml(await zip.file('[Content_Types].xml').async('string'));
  for(const [name,type]of [[newImage,'image/png'],[newOle,'application/vnd.openxmlformats-officedocument.oleObject']]){const d=contentTypes.createElementNS(contentTypes.documentElement.namespaceURI,'Override');d.setAttribute('PartName','/'+name);d.setAttribute('ContentType',type);contentTypes.documentElement.appendChild(d);}
  zip.file('[Content_Types].xml',new XMLSerializer().serializeToString(contentTypes));
  obj.shape.setAttribute('style',`width:${p.width.toFixed(3)}pt;height:${p.height.toFixed(3)}pt`);
  const container=obj.element.parentNode; container.setAttributeNS(NS.w,'w:dxaOrig',String(Math.round(p.width*20)));container.setAttributeNS(NS.w,'w:dyaOrig',String(Math.round(p.height*20)));
  const run=container.parentNode, props=run.getElementsByTagNameNS(NS.w,'rPr')[0], position=props?.getElementsByTagNameNS(NS.w,'position')[0]; if(position) position.setAttributeNS(NS.w,'w:val',String(-Math.round(p.depth*2)));
  zip.file(obj.part,new XMLSerializer().serializeToString(obj.partDoc));
  zip.file(obj.relPart,new XMLSerializer().serializeToString(obj.rels));
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}

export async function flatOpc(buffer) {
  const zip=await JSZip.loadAsync(buffer), parts=[];
  const types=parseXml(await zip.file('[Content_Types].xml').async('string'));
  const overrides=new Map(Array.from(types.getElementsByTagName('Override')).map(n=>[n.getAttribute('PartName'),n.getAttribute('ContentType')]));
  const defaults=new Map(Array.from(types.getElementsByTagName('Default')).map(n=>[n.getAttribute('Extension').toLowerCase(),n.getAttribute('ContentType')]));
  for(const [name,entry] of Object.entries(zip.files)) {
    if(entry.dir || name==='[Content_Types].xml') continue;
    const xml=name.endsWith('.xml')||name.endsWith('.rels');
    const contentType=overrides.get('/'+name)||defaults.get(name.split('.').at(-1).toLowerCase());
    if(!contentType)throw Error('Missing package content type: '+name);
    const data=xml?`<pkg:xmlData>${(await entry.async('string')).replace(/^<\?xml[^>]*\?>/,'')}</pkg:xmlData>`:`<pkg:binaryData>${await entry.async('base64')}</pkg:binaryData>`;
    parts.push(`<pkg:part pkg:name="/${esc(name)}" pkg:contentType="${contentType}">${data}</pkg:part>`);
  }
  return `<pkg:package xmlns:pkg="${NS.pkg}">${parts.join('')}</pkg:package>`;
}

export const MAX_FLAT_OPC_BYTES=128*1024*1024;
export async function fromFlatOpc(xml) {
  if(typeof xml!=='string'||xml.length>MAX_FLAT_OPC_BYTES||Buffer.byteLength(xml,'utf8')>MAX_FLAT_OPC_BYTES || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error('Invalid or oversized OOXML');
  const doc=parseXml(xml),zip=new JSZip(),types=[];
  for(const part of Array.from(doc.getElementsByTagNameNS(NS.pkg,'part'))) {
    const name=part.getAttributeNS(NS.pkg,'name').replace(/^\//,''),type=part.getAttributeNS(NS.pkg,'contentType');
    if(!name||name.split('/').includes('..'))throw Error('Invalid package part name');
    const xmlData=part.getElementsByTagNameNS(NS.pkg,'xmlData')[0],binData=part.getElementsByTagNameNS(NS.pkg,'binaryData')[0];
    if(xmlData) zip.file(name,Array.from(xmlData.childNodes).map(n=>new XMLSerializer().serializeToString(n)).join(''));
    else if(binData) zip.file(name,Buffer.from(binData.textContent.replace(/\s/g,''),'base64'));
    else throw Error('Missing part payload');
    types.push(`<Override PartName="/${esc(name)}" ContentType="${esc(type)}"/>`);
  }
  zip.file('[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${types.join('')}</Types>`);
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
