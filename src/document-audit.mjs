import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import JSZip from 'jszip';
import {DOMParser} from '@xmldom/xmldom';
import {inspectOle} from './native.mjs';

const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const O='urn:schemas-microsoft-com:office:office';
const REL='http://schemas.openxmlformats.org/package/2006/relationships';
const sequenceKinds={EQUATIONLAB:['equationlab','equation'],ELCHAPTER:['equationlab','chapter'],ELSECTION:['equationlab','section'],MTEQN:['mathtype','equation'],MTCHAP:['mathtype','chapter'],MTSEC:['mathtype','section']};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const enabled=value=>value!==null&&!['false','0','off'].includes(value.toLowerCase());

/** Shared byte reader: no mutation, host activation or network access. */
export async function readDocxInput(input){
 const bytes=typeof input==='string'?await readFile(input):Buffer.isBuffer(input)||input instanceof Uint8Array?Buffer.from(input):null;
 if(!bytes)throw Error('DOCX input must be a file path or byte buffer');
 if(bytes.length>128*1024*1024)throw Error('DOCX input exceeds 128 MiB');
 return bytes;
}
export function parseDocxXml(text){
 if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('DOCX XML declarations are not supported');
 const errors=[];
 const doc=new DOMParser({onError:(level,message)=>{if(level==='error'||level==='fatalError')errors.push(message);}}).parseFromString(text.replace(/^\uFEFF/,''),'application/xml');
 if(errors.length)throw Error('Invalid DOCX XML: '+errors.join('; '));
 return doc;
}
export function resolveDocxPart(target,part){
 if(!target||/^[a-z][a-z\d+.-]*:/i.test(target)||target.startsWith('//')||target.includes('\\'))throw Error('DOCX relationship target must be an internal package part');
 const result=new URL(target,'https://local/'+part).pathname.slice(1);
 if(!result||result.includes('%')||result.split('/').includes('..'))throw Error('Invalid DOCX relationship target');
 return result;
}
export async function openDocxPackage(input){
 const bytes=await readDocxInput(input),zip=await JSZip.loadAsync(bytes);
 const root=zip.file('_rels/.rels');if(!root)throw Error('DOCX package relationships are missing');
 const matches=Array.from(parseDocxXml(await root.async('string')).getElementsByTagNameNS(REL,'Relationship')).filter(n=>n.getAttribute('Type')===R+'/officeDocument');
 if(matches.length!==1||matches[0].getAttribute('TargetMode')==='External')throw Error('DOCX main document relationship is invalid');
 const mainPart=resolveDocxPart(matches[0].getAttribute('Target'),'_root.xml');
 if(!zip.file(mainPart))throw Error('DOCX main document part is missing');
 return {bytes,zip,mainPart,sourceSha256:digest(bytes)};
}

function instruction(code){
 const tokens=code.match(/"[^"]*"|[^\s]+/g)??[],type=(tokens.shift()??'').toUpperCase();
 const unquote=t=>t?.startsWith('"')?t.slice(1,-1):t;
 if(type==='REF'||type==='PAGEREF')return {type,target:unquote(tokens[0])??null};
 if(type!=='SEQ')return {type};
 const name=unquote(tokens.shift())??'',known=sequenceKinds[name.toUpperCase()];
 if(!known)return {type,name,family:'other',role:null};
 const [family,role]=known,result={type,name,family,role,reset:null,repeat:false,hidden:false,format:'ARABIC',unknownSwitches:[]};
 for(let i=0;i<tokens.length;i++){
  const token=tokens[i];
  if(token==='\\r'){
   const value=tokens[i+1];
   if(/^\d+$/.test(value??'')&&Number.isSafeInteger(Number(value))){i++;result.reset=Number(value);}
   else {if(value&&!value.startsWith('\\'))i++;result.unknownSwitches.push('invalid-reset');}
  }
  else if(token==='\\c')result.repeat=true;
  else if(token==='\\h')result.hidden=true;
  else if(token==='\\n'){}
  else if(token==='\\*'){
   const value=tokens[++i];
   if(['ARABIC','Arabic','arabic','ALPHABETIC','alphabetic','ROMAN','roman'].includes(value))result.format=value.toLowerCase()==='arabic'?'ARABIC':value;
   else if(!['MERGEFORMAT','CHARFORMAT'].includes((value??'').toUpperCase()))result.unknownSwitches.push(value??'missing-format');
  }else result.unknownSwitches.push(token);
 }
 return result;
}

function scanPart(doc,part){
 let ordinal=0,paragraph=-1,fieldOrdinal=0,bookmarkOrdinal=0;
 const fields=[],bookmarks=[],openBookmarks=new Map(),texts=[],objects=[],structural=[],stack=[];
 const location=()=>({part,paragraph});
 const reviewState=node=>{for(let n=node;n;n=n.parentNode)if(n.namespaceURI===W&&['ins','del','moveFrom','moveTo'].includes(n.localName))return n.localName;return 'unchanged';};
 function fieldStart(node,simple){
  const record={id:`${part}#field-${fieldOrdinal}`,location:{...location(),fieldOrdinal:fieldOrdinal++},start:ordinal,end:null,endParagraph:null,code:simple?node.getAttributeNS(W,'instr')??'':'',codeParts:[],cachedText:'',locked:enabled(node.getAttributeNS(W,'fldLock'))||stack.some(f=>f.locked),reviewState:reviewState(node),mode:simple?'result':'code',parent:stack.at(-1)?.id??null,simple};
  if(stack.at(-1)?.mode==='code')stack.at(-1).codeParts.push({field:record.id});
  fields.push(record);stack.push(record);return record;
 }
 function visit(node,hidden=false){
  if(node.nodeType!==1)return;
  ordinal++;
  if(node.namespaceURI===W&&node.localName==='p')paragraph++;
  if(node.namespaceURI===W&&node.localName==='r'){
   const props=Array.from(node.childNodes).find(n=>n.namespaceURI===W&&n.localName==='rPr');
   hidden=hidden||!!props&&Array.from(props.childNodes).some(n=>n.namespaceURI===W&&['vanish','specVanish'].includes(n.localName)&&(!n.hasAttributeNS(W,'val')||enabled(n.getAttributeNS(W,'val'))));
  }
  let simple=null;
  if(node.namespaceURI===W){
   if(node.localName==='bookmarkStart'){
    const key=node.getAttributeNS(W,'id'),record={id:`${part}#bookmark-${bookmarkOrdinal++}`,name:node.getAttributeNS(W,'name')??'',key,start:ordinal,end:null,location:location(),reviewState:reviewState(node)};
    if(openBookmarks.has(key))structural.push({code:'duplicate-bookmark-id',location:location(),bookmark:record.name});
    else openBookmarks.set(key,record);
    bookmarks.push(record);
   }else if(node.localName==='bookmarkEnd'){
    const key=node.getAttributeNS(W,'id'),record=openBookmarks.get(key);
    if(record){record.end=ordinal;record.endParagraph=paragraph;openBookmarks.delete(key);}else structural.push({code:'unmatched-bookmark-end',location:location()});
   }else if(node.localName==='fldSimple')simple=fieldStart(node,true);
   else if(node.localName==='fldChar'){
    const kind=node.getAttributeNS(W,'fldCharType');
    if(kind==='begin')fieldStart(node,false);
    else if(kind==='separate'){
     if(stack.length&&!stack.at(-1).simple)stack.at(-1).mode='result';else structural.push({code:'unmatched-field-separator',location:location()});
    }else if(kind==='end'){
     if(stack.length&&!stack.at(-1).simple){const field=stack.pop();field.end=ordinal;field.endParagraph=paragraph;}else structural.push({code:'unmatched-field-end',location:location()});
    }
   }else if(node.localName==='instrText'){
    if(stack.at(-1)?.mode==='code'){stack.at(-1).code+=node.textContent;stack.at(-1).codeParts.push({text:node.textContent});}
    else if(stack.at(-1)?.simple){
     // Some Word files store a simple field's saved result as instrText.
     // It is a cache, not another executable instruction or a recalculation.
     for(const field of stack)if(field.mode==='result')field.cachedText+=node.textContent;
     if(!hidden&&!stack.some(f=>f.mode==='code'))texts.push({position:ordinal,text:node.textContent});
    }
   }else if(node.localName==='t'){
    for(const field of stack)if(field.mode==='result')field.cachedText+=node.textContent;
    if(!hidden&&!stack.some(f=>f.mode==='code'))texts.push({position:ordinal,text:node.textContent});
   }
  }
  if(node.namespaceURI===O&&node.localName==='OLEObject')objects.push({node,location:location(),order:ordinal,progId:node.getAttribute('ProgID'),reviewState:reviewState(node)});
  for(const child of Array.from(node.childNodes))visit(child,hidden);
  if(simple){if(stack.at(-1)===simple){stack.pop();simple.end=ordinal;simple.endParagraph=paragraph;}else structural.push({code:'unclosed-nested-field',location:simple.location});}
 }
 visit(doc.documentElement);
 for(const field of fields){field.instruction=instruction(field.code);if(field.end===null)structural.push({code:'unclosed-field',location:field.location});}
 const byId=new Map(fields.map(field=>[field.id,field]));
 for(const field of fields.filter(f=>/^\s*MACROBUTTON\s+MTPlaceRef\b/i.test(f.code))){
  if(field.cachedText.trim()){field.numberCache=field.cachedText.trim().length<=128?field.cachedText.trim():null;continue;}
  let complete=true;
  const text=field.codeParts.map(part=>{
   if(part.text!==undefined)return part.text;
   const child=byId.get(part.field),parsed=child?.instruction;
   if(parsed?.type!=='SEQ'||parsed.family!=='mathtype'){complete=false;return '';}
   if(parsed.hidden)return '';
   if(!child.cachedText.trim()){complete=false;return '';}
   return child.cachedText;
  }).join('').replace(/^\s*MACROBUTTON\s+MTPlaceRef\s*/i,'').trim()
   .replace(/^(?:\\\*\s+(?:MERGEFORMAT|CHARFORMAT)\s+)+/i,'')
   .replace(/(?:\s+\\\*\s+(?:MERGEFORMAT|CHARFORMAT))+\s*$/i,'').trim();
  // Only known outer formatting switches around the display are syntax.
  // Any remaining switch
  // makes this display projection unknown; never expose it as a saved number.
  field.numberCache=complete&&!text.includes('\\')&&text.length>0&&text.length<=128?text:null;
 }
 for(const bookmark of bookmarks){bookmark.cachedText=texts.filter(t=>t.position>bookmark.start&&bookmark.end!==null&&t.position<bookmark.end).map(t=>t.text).join('');if(bookmark.end===null)structural.push({code:'unclosed-bookmark',location:bookmark.location,bookmark:bookmark.name});}
 return {part,doc,fields,bookmarks,objects,structural};
}

function singleNumberChain(sequences){
 const visible=sequences.filter(f=>f.instruction.role==='equation'&&!f.instruction.hidden);
 const hidden=sequences.filter(f=>f.instruction.role==='equation'&&f.instruction.hidden);
 if(visible.length!==1||hidden.length>1)return false;
 if(hidden.length&&(!visible[0].instruction.repeat||hidden[0].instruction.family!==visible[0].instruction.family))return false;
 return ['chapter','section'].every(role=>sequences.filter(f=>f.instruction.role===role&&!f.instruction.hidden).length<=1);
}

/** Read-only saved-package audit. Positions are XML ordinals, never live Word Ranges.
 * Cached text is reported, not recalculated. Legal resets and mixed formats are
 * informational; headings, manually typed numbering and field evaluation remain
 * host-owned. No macros, OLE verbs, fields or external relationships are executed.
 */
export async function auditDocx(input){
 const {zip,mainPart,sourceSha256}=await openDocxPackage(input);
 // Match inspectDocx's object enumeration for exact same-snapshot index use.
 const parts=[mainPart,...Object.keys(zip.files).filter(p=>p!==mainPart&&/^word\/(?:header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(p))];
 const scans=[];
 for(const part of parts)scans.push(scanPart(parseDocxXml(await zip.file(part).async('string')),part));
 const fields=scans.flatMap(s=>s.fields),bookmarks=scans.flatMap(s=>s.bookmarks),issues=[],targets=[],equations=[],references=[];
 const issue=(code,severity,location,detail={})=>issues.push({id:`issue-${issues.length}`,code,severity,location,...detail});
 const names=new Map();for(const b of bookmarks){const name=b.name.toLowerCase();if(!names.has(name))names.set(name,[]);names.get(name).push(b);}
 for(const [name,all]of names){const items=all.filter(b=>b.reviewState==='unchanged');if(name&&items.length>1)issue('duplicate-bookmark-name','warning',items[0].location,{bookmark:items[0].name,locations:items.map(b=>b.location)});}
 let index=0;
 for(const scan of scans){
  for(const problem of scan.structural)issue(problem.code,'warning',problem.location,problem.bookmark?{bookmark:problem.bookmark}:{});
  const relPart=scan.part.replace(/([^/]+)$/,'_rels/$1.rels'),relFile=zip.file(relPart);
  const rels=relFile?new Map(Array.from(parseDocxXml(await relFile.async('string')).getElementsByTagNameNS(REL,'Relationship')).map(n=>[n.getAttribute('Id'),n])):new Map();
  for(const object of scan.objects){
   if(!['Equation.DSMT4','Equation.3'].includes(object.progId))continue;
   const equation={index:index++,id:`${scan.part}#equation-${equations.length}`,location:object.location,progId:object.progId,nativeSha256:null,reviewState:object.reviewState,numberTargetIds:[]};
   try{
    const rel=rels.get(object.node.getAttributeNS(R,'id'));if(!rel||rel.getAttribute('TargetMode')==='External')throw Error('Missing internal OLE relationship');
    const path=resolveDocxPart(rel.getAttribute('Target'),scan.part),entry=zip.file(path);if(!entry)throw Error('Missing embedded OLE part');
    equation.nativeSha256=digest(inspectOle(await entry.async('nodebuffer')).native);
   }catch(error){issue('unreadable-equation','warning',equation.location,{equationIndex:equation.index,reason:error.message});}
   equations.push(equation);
  }
  for(const bookmark of scan.bookmarks){
   if(bookmark.end===null)continue;
   const inside=scan.fields.filter(f=>f.start>bookmark.start&&f.end!==null&&f.end<bookmark.end),sequences=inside.filter(f=>f.instruction.type==='SEQ'&&sequenceKinds[f.instruction.name.toUpperCase()]);
   if(!sequences.some(f=>f.instruction.role==='equation')&&!/^EL_/i.test(bookmark.name))continue;
   const bounded=bookmark.location.paragraph===bookmark.endParagraph&&!scan.objects.some(o=>o.order>bookmark.start&&o.order<bookmark.end);
   if(!bounded||sequences.length&&!singleNumberChain(sequences)){
    // A chapter/body bookmark can contain many valid number fields. It stays
    // a general REF target and must not become a selectable equation number.
    if(/^EL_/i.test(bookmark.name))issue('ambiguous-numbering-bookmark','info',bookmark.location,{bookmark:bookmark.name,reason:'The bookmark is not a bounded single equation number.'});
    continue;
   }
   const macros=inside.filter(f=>/^\s*MACROBUTTON\s+MTPlaceRef\b/i.test(f.code));
   const cachedText=bookmark.cachedText.trim()||(macros.length===1?macros[0].numberCache??'':'');
   if(cachedText.length>128){if(/^EL_/i.test(bookmark.name))issue('ambiguous-numbering-bookmark','info',bookmark.location,{bookmark:bookmark.name,reason:'The bookmark contains more than a bounded number display.'});continue;}
   const families=[...new Set(sequences.map(f=>f.instruction.family))],family=families.length===1?families[0]:families.length?'mixed':'unknown';
   const related=equations.filter(e=>e.location.part===scan.part&&e.location.paragraph===bookmark.location.paragraph);
   const target={id:bookmark.id,bookmark:bookmark.name,family,location:bookmark.location,cachedText,equationIndices:related.map(e=>e.index),equationAssociation:related.length===1?'same-paragraph-single':related.length?'ambiguous-multiple':'number-only',fieldIds:sequences.map(f=>f.id),formatSignature:sequences.filter(f=>!f.instruction.hidden).map(f=>`${f.instruction.role}:${f.instruction.format}`).join('|')||null,referenceIds:[],locked:sequences.some(f=>f.locked),reviewState:bookmark.reviewState,referenceable:bookmark.reviewState==='unchanged'&&names.get(bookmark.name.toLowerCase()).filter(b=>b.reviewState==='unchanged').length===1&&family!=='unknown'&&cachedText.length>0};
   targets.push(target);for(const equation of related)equation.numberTargetIds.push(target.id);
   if(family==='unknown')issue('unknown-numbering-target','info',target.location,{targetId:target.id,reason:'Equation Lab bookmark has no recognized equation sequence.'});
   if(family==='mixed')issue('mixed-numbering-families','info',target.location,{targetId:target.id,families});
  }
  for(const macro of scan.fields.filter(f=>/^\s*MACROBUTTON\s+MTPlaceRef\b/i.test(f.code)&&f.end!==null&&f.location.paragraph===f.endParagraph)){
   const sequences=scan.fields.filter(f=>f.start>macro.start&&f.end!==null&&f.end<macro.end&&f.instruction.type==='SEQ'&&f.instruction.family==='mathtype');
   if(!singleNumberChain(sequences)||targets.some(t=>t.fieldIds.some(id=>sequences.some(f=>f.id===id))))continue;
   const related=equations.filter(e=>e.location.part===scan.part&&e.location.paragraph===macro.location.paragraph);
   const target={id:macro.id+':number',bookmark:null,family:'mathtype',location:macro.location,cachedText:macro.numberCache??'',equationIndices:related.map(e=>e.index),equationAssociation:related.length===1?'same-paragraph-single':related.length?'ambiguous-multiple':'number-only',fieldIds:sequences.map(f=>f.id),formatSignature:sequences.filter(f=>!f.instruction.hidden).map(f=>`${f.instruction.role}:${f.instruction.format}`).join('|')||null,referenceIds:[],locked:macro.locked||sequences.some(f=>f.locked),reviewState:macro.reviewState,referenceable:false};
   targets.push(target);for(const equation of related)equation.numberTargetIds.push(target.id);
   issue('number-without-reference-target','info',macro.location,{targetId:target.id,family:'mathtype',reason:'The saved MathType number has no exact number bookmark; no new reference can be inserted from this snapshot.'});
   if(!macro.numberCache)issue('number-cache-unavailable','info',macro.location,{targetId:target.id,reason:'No bounded saved number display is available; Word must evaluate the field.'});
  }
  for(const field of scan.fields){
   const parsed=field.instruction;
   if(parsed.type!=='SEQ'||!sequenceKinds[parsed.name.toUpperCase()])continue;
   if(field.reviewState!=='unchanged'){issue('tracked-numbering-field','info',field.location,{fieldId:field.id,reviewState:field.reviewState,reason:'Accept or reject tracked edits in Word before interpreting this field.'});continue;}
   if(field.locked)issue('locked-numbering-field','info',field.location,{fieldId:field.id,family:parsed.family,reason:'Word deliberately skips locked fields during update.'});
   if(parsed.reset!==null)issue('explicit-sequence-reset','info',field.location,{fieldId:field.id,family:parsed.family,role:parsed.role,value:parsed.reset,reason:'Explicit reset is allowed and is not a numbering error.'});
   if(parsed.unknownSwitches.length)issue('unknown-numbering-semantics','info',field.location,{fieldId:field.id,switches:parsed.unknownSwitches,reason:'Requires Word evaluation; no sequence value was inferred.'});
   if(parsed.role==='equation'&&!parsed.hidden&&!targets.some(t=>t.fieldIds.includes(field.id)))issue('number-without-reference-target','info',field.location,{fieldId:field.id,family:parsed.family,reason:'No containing number bookmark; the field itself may still be valid.'});
  }
 }
 const targetByBookmark=new Map(targets.map(t=>[t.id,t]));
 for(const field of fields){
  if(!['REF','PAGEREF'].includes(field.instruction.type))continue;
  const name=field.instruction.target??'',allMatches=names.get(name.toLowerCase())??[],matches=allMatches.filter(b=>b.reviewState==='unchanged'),target=matches.length===1?targetByBookmark.get(matches[0].id):null;
  const dependent=field.reviewState!=='unchanged'||!matches.length&&allMatches.length>0;
  const reference={id:field.id,type:field.instruction.type,bookmark:name,location:field.location,cachedText:field.cachedText,locked:field.locked,reviewState:field.reviewState,targetId:dependent?null:target?.id??null,family:target?.family??(matches.length===1?'other':'unknown'),state:dependent?'review-dependent':matches.length===1?'resolved':matches.length?'ambiguous':'missing'};
  references.push(reference);if(target&&!dependent)target.referenceIds.push(reference.id);
  if(reference.state==='review-dependent')issue('tracked-reference','info',field.location,{referenceId:reference.id,bookmark:name,reason:'Tracked changes determine whether this reference or target exists.'});
  else if(reference.state!=='resolved')issue(reference.state==='missing'?'broken-reference':'ambiguous-reference','warning',field.location,{referenceId:reference.id,bookmark:name,scope:target||/^EL_/i.test(name)?'equation-reference':'document-reference'});
  if(reference.locked&&target)issue('locked-equation-reference','info',field.location,{referenceId:reference.id,targetId:target.id});
 }
 for(const family of ['equationlab','mathtype']){
  const formatted=targets.filter(t=>t.family===family&&t.reviewState==='unchanged'&&t.formatSignature),formats=[...new Set(formatted.map(t=>t.formatSignature))];
  if(formats.length>1)issue('mixed-number-formats','info',formatted[0].location,{family,formats,targetIds:formatted.map(t=>t.id),reason:'Different formats can be intentional; no rewrite is proposed.'});
 }
 return {schema:'equationlab.document-audit.v1',sourceSha256,mainPart,targets,references,equations,issues,
  summary:{equations:equations.length,numberedTargets:targets.length,equationReferences:references.filter(r=>r.targetId).length,warnings:issues.filter(i=>i.severity==='warning').length,information:issues.filter(i=>i.severity==='info').length},
  coverage:{parts,positionKind:'zero-based-xml-ordinal',liveWordPositions:false,fieldResults:'cached-not-evaluated',readOnly:true,limitations:['This is a saved DOCX snapshot, not the current unsaved Word state.','Paragraph/field ordinals are not Word Range positions.','Headings, manually typed numbers, text boxes and other story-specific counters are not evaluated.','Legacy MathType and Equation Lab fields are reported separately; no migration or automatic repair is performed.']}};
}

export function getReferenceTargets(audit,{query=''}={}){
 if(audit?.schema!=='equationlab.document-audit.v1'||typeof query!=='string')throw Error('Invalid document audit or query');
 const term=query.trim().toLocaleLowerCase();
 return audit.targets.filter(t=>t.referenceable&&(!term||`${t.bookmark} ${t.cachedText} ${t.equationIndices.map(i=>i+1).join(' ')}`.toLocaleLowerCase().includes(term)));
}
