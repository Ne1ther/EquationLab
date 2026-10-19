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
import {equationLayout, equationReference, chapterBreak, standaloneNumber} from './layout.mjs';
import {readTypography,patchTypography} from './typography-native.mjs';
import {renderNative,rasterizeNativeSvg} from './font-renderer.mjs';

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

export async function createDocx(equations,{fragment=false,references=[],initializeContext=true}={}) {
  if(!Array.isArray(equations)||equations.length>500)throw Error('需要最多 500 条公式');
  const zip = new JSZip(), paragraphs = [], relationships = [], anchors=[];
  let count=0,context=null;
  for(let i=0;i<equations.length;i++) {
    const n=i+1,e=equations[i],originalOle=e.ole?(e.typography?patchTypography(e.ole,e.typography):e.ole):makeNewOle(e.latex,e.typography),ole=e.ruler===undefined?originalOle:patchRuler(originalOle,e.ruler),latex=oleLatex(ole),p=await renderNative(ole);
    zip.file(`word/embeddings/oleObject${n}.bin`,ole); zip.file(`word/media/image${n}.png`,p.png);
    relationships.push(`<Relationship Id="rOle${n}" Type="${NS.r}/oleObject" Target="embeddings/oleObject${n}.bin"/>`,`<Relationship Id="rImg${n}" Type="${NS.r}/image" Target="media/image${n}.png"/>`);
    if(!fragment || e.label) paragraphs.push(`<w:p><w:r><w:t>${esc(e.label || `Formula ${n}`)}</w:t></w:r></w:p>`);
    const layout={mode:'inline',...e.layout};
    if(layout.mode.startsWith('numbered-')) {
      const nextContext=`${layout.chapter??1}:${layout.section??1}`;
      if(context!==nextContext) {
        if(initializeContext)paragraphs.push(chapterBreak({chapter:layout.chapter??1,section:layout.section??1}));count=0;context=nextContext;
      }
      if(layout.resetEquation)count=(layout.equation??1)-1;
      layout.equation=layout.equation??++count;
      count=layout.equation;
    }
    const result=equationLayout(objectRun(n,p),layout);
    anchors.push(result);paragraphs.push(result.xml);
  }
  for(const ref of references){const a=anchors[ref.target];if(!a?.bookmarkName)throw Error('引用目标必须是带编号的公式');paragraphs.push(`<w:p>${equationReference(a.bookmarkName,{cachedText:a.numberText,prefix:ref.prefix??'式 '})}</w:p>`);}
  return packageDocument(zip,paragraphs,relationships,{fragment});
}

function packageDocument(zip,paragraphs,relationships,{fragment=true}={}) {
  zip.file('[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>`);
  zip.file('_rels/.rels',`<Relationships xmlns="${NS.rels}"><Relationship Id="rDoc" Type="${NS.r}/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file('word/styles.xml',`<w:styles xmlns:w="${NS.w}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>${equationStyle}</w:styles>`);
  zip.file('word/settings.xml',`<w:settings xmlns:w="${NS.w}"><w:updateFields w:val="true"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`);
  zip.file('word/_rels/document.xml.rels',`<Relationships xmlns="${NS.rels}"><Relationship Id="rStyles" Type="${NS.r}/styles" Target="styles.xml"/><Relationship Id="rSettings" Type="${NS.r}/settings" Target="settings.xml"/>${relationships.join('')}</Relationships>`);
  zip.file('word/document.xml',`<w:document xmlns:w="${NS.w}" xmlns:r="${NS.r}" xmlns:v="${NS.v}" xmlns:o="${NS.o}"><w:body>${fragment?'':'<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Mac native MathType compatibility prototype</w:t></w:r></w:p>'}${paragraphs.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`);
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
 const paragraphs=[];if(initializeContext)paragraphs.push(chapterBreak({chapter:options.chapter??1,section:options.section??1,resetEquation:false}));
 const number=standaloneNumber(options);paragraphs.push(number.xml);
 return packageDocument(new JSZip(),paragraphs,[]);
}

function parseXml(text) {
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
function priorCounters(doc,paragraph){
  const values={EquationLab:0,ELChapter:null,ELSection:null};
  for(const p of Array.from(doc.getElementsByTagNameNS(NS.w,'p'))){if(p===paragraph)break;for(const code of fieldCodes(p)){
    const m=/^\s*SEQ (EquationLab|ELChapter|ELSection)\b([\s\S]*)/i.exec(code);if(!m||/\\c\b/.test(m[2]))continue;
    const reset=/\\r\s+(\d+)/.exec(m[2]);values[m[1]]=reset?Number(reset[1]):(values[m[1]]??0)+1;
  }}return values;
}

// Reconstruct the format from live fields, not their cached numeric text.
function bookmarkNumberFormat(bookmark){
  const counters={EquationLab:'E',ELChapter:'C',ELSection:'S'},formats={ARABIC:'1',ALPHABETIC:'A',alphabetic:'a',ROMAN:'I',roman:'i'};
  const token=code=>{const m=/^\s*SEQ\s+(EquationLab|ELChapter|ELSection)\b[\s\S]*?\\\*\s+(ARABIC|ALPHABETIC|alphabetic|ROMAN|roman)\b/.exec(code);return m?'#'+counters[m[1]]+formats[m[2]]:null;};
  let result='',depth=0,code='',failed=false;
  const visit=node=>{
    if(node.nodeType!==1)return;
    if(node.namespaceURI===NS.w){
      if(node.localName==='fldSimple'){const value=token(node.getAttributeNS(NS.w,'instr'));if(value)result+=value;else failed=true;return;}
      if(node.localName==='fldChar'){const kind=node.getAttributeNS(NS.w,'fldCharType');if(kind==='begin'){depth++;code='';}else if(kind==='separate'){const value=token(code);if(value)result+=value;else failed=true;}else if(kind==='end')depth--;return;}
      if(node.localName==='instrText'){code+=node.textContent;return;}
      if(node.localName==='t'){if(!depth)result+=node.textContent;return;}
    }
    for(const child of Array.from(node.childNodes))visit(child);
  };
  for(let n=bookmark.nextSibling;n;n=n.nextSibling){if(n.localName==='bookmarkEnd'&&n.getAttributeNS(NS.w,'id')===bookmark.getAttributeNS(NS.w,'id'))break;visit(n);}
  return !failed&&result.includes('#E')?result:null;
}

export async function inspectDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer), doc = parseXml(await zip.file('word/document.xml').async('string'));
  const objects = [];
  const parts=Object.keys(zip.files).filter(p=>/^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(p)).sort((a,b)=>a==='word/document.xml'?-1:b==='word/document.xml'?1:0);
  for (const part of parts) {
  const partDoc=part==='word/document.xml'?doc:parseXml(await zip.file(part).async('string'));
  const relPart=part.replace(/([^/]+)$/, '_rels/$1.rels');
  if(!zip.file(relPart)) continue;
  const rels = parseXml(await zip.file(relPart).async('string'));
  const references=new Map();for(const code of fieldCodes(partDoc.documentElement)){const match=/^\s*REF\s+(\S+)/i.exec(code);if(match)references.set(match[1],(references.get(match[1])??0)+1);}
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
    const bookmark=owned?Array.from(paragraph.getElementsByTagNameNS(NS.w,'bookmarkStart')).find(b=>/^EL_/.test(b.getAttributeNS(NS.w,'name'))):null;
    const fields=owned?fieldCodes(paragraph):[];
    let numberText=null;if(bookmark){numberText='';let within=false;for(const node of Array.from(paragraph.childNodes)){if(node===bookmark){within=true;continue;}if(node.localName==='bookmarkEnd'&&node.getAttributeNS(NS.w,'id')===bookmark.getAttributeNS(NS.w,'id'))break;if(within&&node.nodeType===1)numberText+=Array.from(node.getElementsByTagNameNS(NS.w,'t')).map(n=>n.textContent).join('');}}
    const layout={owned,bookmarkName:bookmark?.getAttributeNS(NS.w,'name')??null,numberText};
    layout.mode=fields.some(code=>/SEQ EquationLab/.test(code))?(Array.from(paragraph.childNodes).indexOf(bookmark)<Array.from(paragraph.childNodes).indexOf(e.parentNode.parentNode)?'numbered-left':'numbered-right'):owned&&paragraph.getElementsByTagNameNS(NS.w,'jc')[0]?.getAttributeNS(NS.w,'val')==='center'?'display':'inline';
    if(!owned)layout.mode='unknown';
    if(bookmark){
      const context=priorCounters(partDoc,paragraph);layout.numberFormat=bookmarkNumberFormat(bookmark);layout.chapter=context.ELChapter;layout.section=context.ELSection;
      const code=fields.find(code=>/^\s*SEQ\s+EquationLab\b/i.test(code)&&!/\\c\b/.test(code));
      const reset=code&&/\\r\s+(\d+)/.exec(code);layout.equation=code?(reset?Number(reset[1]):context.EquationLab+1):null;
      layout.referenceCount=references.get(layout.bookmarkName)??0;
    }
    let typography,typographyError;try{typography=readTypography(ole);}catch(error){typographyError=error.message;}
    objects.push({index:objects.length,path,part,progId,ole,latex,previewError,parseError,layout,typography,typographyError,ruler:inspected?readRuler(ole):[],nativeSha256:inspected?hash(inspected.native):null,characters:inspected?characters(inspected.parsed):[],application:inspected?.parsed.application,element:e,shape,image,imagePath:imageRel?partPath(imageRel.getAttribute('Target'),part):null,partDoc,rels,relPart});
  }
  }
  return {zip,doc,objects};
}

export async function editDocx(buffer,index,replacements,options={}) {
  return updateDocx(buffer,index,ole=>editCharacters(ole,replacements),options);
}

export async function replaceDocxEquation(buffer,index,latex,options={}) {
  return updateDocx(buffer,index,ole=>replaceOleLatex(ole,latex),options);
}

/** Change standalone equation paragraphs without touching their native OLE bytes.
 * Existing prose, revision markup, custom fields and bookmarks require a host
 * range operation and are rejected here rather than discarded. */
export async function arrangeDocx(buffer,{indices,layout={}}={}) {
  const {zip,objects}=await inspectDocx(buffer),targets=indices??objects.map(o=>o.index);
  if(!Array.isArray(targets)||!targets.length||new Set(targets).size!==targets.length)throw Error('请选择互不重复的公式');
  const serializer=new XMLSerializer(),changedParts=new Map();
  const existingBookmarks=new Set(),existingBookmarkIds=new Set();
  for(const o of objects)for(const b of Array.from(o.partDoc.getElementsByTagNameNS(NS.w,'bookmarkStart'))){existingBookmarks.add(b.getAttributeNS(NS.w,'name'));existingBookmarkIds.add(b.getAttributeNS(NS.w,'id'));}
  let first=true;
  for(const index of [...targets].sort((a,b)=>a-b)) {
    const o=objects[index];if(!o)throw Error('公式不存在');
    if(layout.mode?.startsWith('numbered-')&&o.part!=='word/document.xml')throw Error('章节编号目前只支持正文，脚注、尾注和页眉页脚请单独设置');
    const run=o.element.parentNode.parentNode,p=run.parentNode;
    if(run.localName!=='r'||p.localName!=='p')throw Error('此公式包含特殊包装，暂不能更改段落编排');
    if(Array.from(run.childNodes).some(n=>n.nodeType===1&&!['rPr','object'].includes(n.localName)))throw Error('公式与正文处于同一段落，请先在 Word 中分段，以保留正文');
    if(['sectPr','pPrChange','framePr','numPr'].some(tag=>p.getElementsByTagNameNS(NS.w,tag).length))throw Error('段落包含节设置、修订或特殊版式，请在 Word 中单独编排');
    if(p.getElementsByTagNameNS(NS.o,'OLEObject').length!==1)throw Error('一个段落中有多个公式，请在 Word 中分段后编排');
    const owned=o.layout.owned;
    if(owned&&fieldCodes(p).some(code=>!/^\s*SEQ (EquationLab|ELChapter|ELSection)\b/.test(code)))throw Error('段落含其他编号域，暂不能替换');
    const allowed=owned?['pPr','r','bookmarkStart','bookmarkEnd','fldSimple']:['pPr','r'];
    let inNumber=false;const hiddenShapes=[];
    for(const node of Array.from(p.childNodes).filter(n=>n.nodeType===1)) {
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
    const opts={...layout,existingBookmarks,existingBookmarkIds};
    if(layout.mode?.startsWith('numbered-')){
      let context=priorCounters(o.partDoc,p);
      if(/#[CS]/.test(layout.numberFormat??'')&&(context.ELChapter===null||context.ELSection===null)){
        const marker=parseXml(`<root xmlns:w="${NS.w}">${chapterBreak({chapter:layout.chapter??1,section:layout.section??1,resetEquation:false})}</root>`).documentElement.firstChild;
        p.parentNode.insertBefore(o.partDoc.importNode(marker,true),p);context=priorCounters(o.partDoc,p);
      }
      opts.equation=first&&layout.resetEquation?(layout.equation??1):context.EquationLab+1;
      opts.chapter=context.ELChapter??layout.chapter??1;opts.section=context.ELSection??layout.section??1;
      if(name){opts.bookmarkName=name;opts.bookmarkId=id;}opts.resetEquation=first&&!!layout.resetEquation;
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

export async function fromFlatOpc(xml) {
  if(xml.length>30_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error('Invalid or oversized OOXML');
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
