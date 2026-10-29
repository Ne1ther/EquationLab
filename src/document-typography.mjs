import {open,unlink,realpath} from 'node:fs/promises';
import {resolve,posix} from 'node:path';
import {createHash} from 'node:crypto';
import {XMLSerializer} from '@xmldom/xmldom';
import {inspectDocx,NS} from './document.mjs';
import {inspectOle} from './native.mjs';
import {readTypography,patchTypography} from './typography-native.mjs';
import {renderNative} from './font-renderer.mjs';
import {makeNewOle} from './new-formula.mjs';
import {openDocxPackage,parseDocxXml,readDocxInput,resolveDocxPart} from './document-audit.mjs';

const PRESET='EquationLabTypographyPreset';
const PRESET_SCHEMA='equationlab.document-typography-preset.v1';
const PLAN_SCHEMA='equationlab.document-typography-plan.v1';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const stable=value=>JSON.stringify(canonical(value));
function canonical(value){return Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;}
function plain(value,label){if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('Invalid '+label);return value;}
function keys(value,allowed,label){plain(value,label);for(const key of Object.keys(value))if(!allowed.includes(key))throw Error(`Unknown ${label} property: ${key}`);}
function dimensions(value,kind){
 plain(value,kind);const result={},limit={sizes:5,spaces:30,extraSizes:3}[kind];
 for(const [id,edit]of Object.entries(value)){
  if(!/^(0|[1-9]\d*)$/.test(id)||Number(id)>=limit)throw Error('Invalid '+kind+' index');
  keys(edit,['unit','value'],kind+' edit');
  const units=kind==='sizes'?['pt','%']:['in','cm','pt','pc','%'];
  if(!units.includes(edit.unit)||kind==='sizes'&&id==='0'&&edit.unit!=='pt'||kind==='spaces'&&[16,17,22].includes(Number(id))&&edit.unit!=='%')throw Error('Invalid '+kind+' unit');
  const raw=typeof edit.value==='number'?String(edit.value):edit.value;
  if(typeof raw!=='string'||raw.length>24||!/^\-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)||!Number.isFinite(Number(raw)))throw Error('Invalid '+kind+' decimal');
  const number=Number(raw);
  if(kind==='sizes'&&(number<(edit.unit==='%'?1:2)||number>(edit.unit==='%'?1000:127)))throw Error('Invalid size range');
  if(kind==='extraSizes'&&(number<=0||Number(id)<2&&edit.unit!=='%'&&(number*({in:72,cm:72/2.54,pt:1,pc:12}[edit.unit])<2||number*({in:72,cm:72/2.54,pt:1,pc:12}[edit.unit])>127)))throw Error('Invalid extra size range');
  result[id]={unit:edit.unit,value:edit.value};
 }
 return result;
}

/** A declared, inspectable patch; omitted keys retain each equation's settings. */
export function normalizeTypographyPatch(value){
 keys(value,['styles','sizes','spaces','extraSizes','fullSize'],'typography patch');const result={};
 if(value.styles!==undefined){
  plain(value.styles,'styles');const styles={};
  for(const [id,edit]of Object.entries(value.styles)){
   if(!/^(?:[1-9]|1[0-2])$/.test(id))throw Error('Invalid typography style index');
   keys(edit,['font','style'],'style');if(!Object.keys(edit).length)throw Error('Empty style edit');
   if(edit.font!==undefined&&(typeof edit.font!=='string'||edit.font.length<1||edit.font.length>128||/[\x00-\x1f]/.test(edit.font)))throw Error('Invalid typography font');
   if(edit.style!==undefined&&(!Number.isInteger(edit.style)||edit.style<0||edit.style>3))throw Error('Invalid typography style');
   styles[id]={...edit};
  }if(Object.keys(styles).length)result.styles=styles;
 }
 for(const kind of ['sizes','spaces','extraSizes'])if(value[kind]!==undefined){const edits=dimensions(value[kind],kind);if(Object.keys(edits).length)result[kind]=edits;}
 if(value.fullSize!==undefined){if(typeof value.fullSize!=='number'||result.sizes?.[0])throw Error('Invalid or duplicate Full size');result.sizes={...result.sizes,...dimensions({0:{unit:'pt',value:value.fullSize}},'sizes')};}
 if(!Object.keys(result).length)throw Error('Typography patch is empty');
 return canonical(result);
}
export function normalizeTypographyPreset(value){
 keys(value,['schema','name','scope','typography'],'typography preset');
 if(value.schema!==undefined&&value.schema!==PRESET_SCHEMA)throw Error('Unknown typography preset schema');
 if(value.scope!==undefined&&value.scope!=='new-equations')throw Error('A document preset applies only to future equations');
 const name=value.name??'Document preset';if(typeof name!=='string'||!name.trim()||name.length>128||/[\x00-\x1f]/.test(name))throw Error('Invalid typography preset name');
 return {schema:PRESET_SCHEMA,name,scope:'new-equations',typography:normalizeTypographyPatch(value.typography)};
}

async function settingsInfo(zip,mainPart){
 const relPart=mainPart.replace(/([^/]+)$/,'_rels/$1.rels'),file=zip.file(relPart);
 const rels=file?parseDocxXml(await file.async('string')):parseDocxXml(`<Relationships xmlns="${NS.rels}"/>`);
 const entries=Array.from(rels.getElementsByTagNameNS(NS.rels,'Relationship')).filter(r=>r.getAttribute('Type')===NS.r+'/settings');
 if(entries.length>1||entries[0]?.getAttribute('TargetMode')==='External')throw Error('Ambiguous or external DOCX settings relationship');
 const path=entries.length?resolveDocxPart(entries[0].getAttribute('Target'),mainPart):posix.join(posix.dirname(mainPart),'settings.xml');
 if(entries.length&&!zip.file(path))throw Error('DOCX settings part is missing');
 if(!entries.length&&zip.file(path))throw Error('Unrelated settings part exists without a main-document relationship');
 const doc=zip.file(path)?parseDocxXml(await zip.file(path).async('string')):null;
 const vars=doc?Array.from(doc.getElementsByTagNameNS(NS.w,'docVar')).filter(n=>n.getAttributeNS(NS.w,'name')===PRESET):[];
 if(vars.length>1)throw Error('Duplicate document typography presets');
 return {path,relPart,rels,related:entries.length>0,doc,node:vars[0]??null};
}
function decodePreset(node){
 if(!node)return null;
 const text=node.getAttributeNS(NS.w,'val');if(typeof text!=='string'||text.length>32768)throw Error('Invalid document typography preset');
 try{return normalizeTypographyPreset(JSON.parse(text));}catch(error){throw Error('Invalid document typography preset: '+error.message);}
}
export async function readTypographyPreset(input){
 const {zip,mainPart}=await openDocxPackage(input);return readTypographyPresetFromPackage({zip,mainPart});
}
export async function readTypographyPresetFromPackage({zip,mainPart}){return decodePreset((await settingsInfo(zip,mainPart)).node);}

function safetyReason(object){
 if(object.parseError)return object.parseError;
 if(!object.shape||!object.image||!object.imagePath)return 'The object has no supported internal preview layout';
 const container=object.element.parentNode,run=container.parentNode;
 if(container.namespaceURI!==NS.w||container.localName!=='object'||run.namespaceURI!==NS.w||run.localName!=='r'||container.getElementsByTagNameNS(NS.o,'OLEObject').length!==1||container.getElementsByTagNameNS(NS.v,'shape').length!==1)return 'The object has an ambiguous or unsupported wrapper';
 if(Array.from(run.childNodes).some(node=>node.nodeType===1&&node!==container&&!(node.namespaceURI===NS.w&&node.localName==='rPr')))return 'The equation shares a text run with other content; its baseline requires a Word host operation';
 for(let n=container;n;n=n.parentNode)if(n.namespaceURI===NS.w&&['ins','del','moveFrom','moveTo','sdt'].includes(n.localName))return 'Tracked or content-controlled equations require a Word host operation';
 return null;
}
function projection(plan){const {planSha256,...body}=plan;return body;}
async function makePlan(bytes,options){
 keys(options,['indices','typography','preset'],'batch typography options');
 const patch=options.typography===undefined?(options.preset?normalizeTypographyPreset(options.preset).typography:null):normalizeTypographyPatch(options.typography);
 const preset=options.preset===undefined?undefined:options.preset===null?null:normalizeTypographyPreset(options.preset);
 if(preset)patchTypography(makeNewOle('x'),preset.typography);
 if(!patch&&preset===undefined)throw Error('A typography patch or document preset is required');
 const document=await inspectDocx(bytes),indices=options.indices??(patch?document.objects.map(o=>o.index):[]);
 if(Object.keys(document.zip.files).some(p=>/^_xmlsignatures\//.test(p)))throw Error('Signed documents cannot be changed by the copy engine');
 const settings=await settingsInfo(document.zip,document.mainPart);
 if(settings.doc&&Array.from(settings.doc.getElementsByTagNameNS(NS.w,'documentProtection')).some(n=>['1','true','on'].includes(n.getAttributeNS(NS.w,'enforcement'))))throw Error('Protected documents require an authorized Word host operation');
 if(!Array.isArray(indices)||indices.length>500||new Set(indices).size!==indices.length||indices.some(i=>!Number.isSafeInteger(i)||i<0||i>=document.objects.length))throw Error('Invalid or duplicate equation indices');
 if(indices.length&&!patch)throw Error('Selected equations require a typography patch');
 let presetChanged=false;
 if(preset!==undefined){const existing=decodePreset(settings.node);presetChanged=stable(existing)!==stable(preset);}
 const targets=[],prepared=new Map();
 for(const index of [...indices].sort((a,b)=>a-b)){
  const object=document.objects[index],target={index,part:object.part,olePart:object.path,beforeNativeSha256:object.nativeSha256??null,afterNativeSha256:null,status:'skipped',reason:null};
  try{
   const reason=safetyReason(object);if(reason)throw Error(reason);
   const before=readTypography(object.ole),ole=patchTypography(object.ole,patch),afterNativeSha256=hash(inspectOle(ole).native);
   target.afterNativeSha256=afterNativeSha256;target.preservedLocalFormatting={explicitStyles:before.explicitStyleCount,localSizes:before.localSizeCount};
   target.warnings=before.warnings??[];
   if(ole.equals(object.ole)){target.status='unchanged';target.reason='Requested preferences already match';}
   else {
    const preview=await renderNative(ole);
    if(preview.warnings?.length)throw Error('Preview has unresolved glyphs: '+preview.warnings.join(' '));
    if(!preview.png?.length||![preview.width,preview.height,preview.depth].every(Number.isFinite)||preview.width<=0||preview.height<=0)throw Error('Invalid regenerated equation preview');
    target.status='ready';target.preview={pngSha256:hash(preview.png),width:preview.width,height:preview.height,depth:preview.depth};prepared.set(index,{ole,preview});
   }
  }catch(error){target.status='skipped';target.reason=error.message;target.afterNativeSha256=null;}
  targets.push(target);
 }
 const normalizedOptions={indices:[...indices].sort((a,b)=>a-b),...(patch?{typography:patch}:{}),...(preset!==undefined?{preset}:{})};
 const plan={schema:PLAN_SCHEMA,sourceSha256:hash(bytes),options:normalizedOptions,targets,presetChanged,
  summary:{selected:targets.length,ready:targets.filter(t=>t.status==='ready').length,unchanged:targets.filter(t=>t.status==='unchanged').length,skipped:targets.filter(t=>t.status==='skipped').length},
  scope:{existingEquations:'explicit-indices',preset:'future-equations-only',preserveLocalStyles:true,writeMode:'new-copy-only',hostVerified:false}};
 plan.planSha256=hash(stable(plan));return {plan,document,prepared};
}

/** Validates every selected object and its regenerated preview without writing. */
export async function preflightTypography(input,options={}){return (await makePlan(await readDocxInput(input),options)).plan;}

function relation(rels,type,target){
 const ids=new Set(Array.from(rels.documentElement.childNodes).filter(n=>n.nodeType===1).map(n=>n.getAttribute('Id')));let n=1;while(ids.has('rELTypography'+n))n++;
 const id='rELTypography'+n,node=rels.createElementNS(NS.rels,'Relationship');node.setAttribute('Id',id);node.setAttribute('Type',NS.r+'/'+type);node.setAttribute('Target',target);rels.documentElement.appendChild(node);return id;
}
function contentType(types,path,type){
 const existing=Array.from(types.documentElement.childNodes).find(n=>n.nodeType===1&&n.localName==='Override'&&n.getAttribute('PartName')==='/'+path);
 if(existing){if(existing.getAttribute('ContentType')!==type)throw Error('Conflicting package content type');return;}
 const node=types.createElementNS(types.documentElement.namespaceURI,'Override');node.setAttribute('PartName','/'+path);node.setAttribute('ContentType',type);types.documentElement.appendChild(node);
}
async function writePreset(document,preset,types,serializer){
 const info=await settingsInfo(document.zip,document.mainPart);
 const settings=info.doc??parseDocxXml(`<w:settings xmlns:w="${NS.w}"/>`);
 if(info.node)info.node.parentNode.removeChild(info.node);
 if(preset!==null){
  let vars=Array.from(settings.documentElement.childNodes).find(n=>n.namespaceURI===NS.w&&n.localName==='docVars');
  if(!vars){
   vars=settings.createElementNS(NS.w,'w:docVars');
   const successors=new Set(['rsids','mathPr','uiCompat97To2003','attachedSchema','themeFontLang','clrSchemeMapping','doNotIncludeSubdocsInStats','doNotAutoCompressPictures','forceUpgrade','captions','readModeInkLockDown','smartTagType','schemaLibrary','shapeDefaults','doNotEmbedSmartTags','decimalSymbol','listSeparator']);
   settings.documentElement.insertBefore(vars,Array.from(settings.documentElement.childNodes).find(n=>n.namespaceURI===NS.w&&successors.has(n.localName))??null);
  }
  const node=settings.createElementNS(NS.w,'w:docVar');node.setAttributeNS(NS.w,'w:name',PRESET);node.setAttributeNS(NS.w,'w:val',stable(preset));vars.appendChild(node);
 }
 document.zip.file(info.path,serializer.serializeToString(settings));
 contentType(types,info.path,'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml');
 if(!info.related){relation(info.rels,'settings',posix.relative(posix.dirname(document.mainPart),info.path));document.zip.file(info.relPart,serializer.serializeToString(info.rels));}
}
function shapeDimensions(shape,preview){
 const properties=(shape.getAttribute('style')??'').split(';').map(s=>s.trim()).filter(Boolean).filter(s=>!/^(?:width|height)\s*:/i.test(s));
 shape.setAttribute('style',[...properties,`width:${preview.width.toFixed(3)}pt`,`height:${preview.height.toFixed(3)}pt`].join(';'));
}

/** Applies a previously inspected plan to exactly those input bytes. A new file
 * is created only with output, using exclusive creation: no existing path, hard
 * link or symlink is replaced. Without output the caller receives copy bytes.
 */
export async function applyTypography(input,plan,{output}={}){
 plain(plan,'typography plan');if(plan.schema!==PLAN_SCHEMA||typeof plan.planSha256!=='string'||hash(stable(projection(plan)))!==plan.planSha256)throw Error('Typography plan has been modified');
 const bytes=await readDocxInput(input);if(hash(bytes)!==plan.sourceSha256)throw Error('DOCX changed since typography preflight; inspect it again');
 const fresh=await makePlan(bytes,plan.options);if(fresh.plan.planSha256!==plan.planSha256)throw Error('Typography preflight no longer matches; no output was written');
 const {document,prepared}=fresh,serializer=new XMLSerializer(),changedParts=new Map(),changedRels=new Map();
 let buffer=bytes;
 if(plan.summary.ready||plan.presetChanged){
  const typeEntry=document.zip.file('[Content_Types].xml');if(!typeEntry)throw Error('DOCX content types are missing');
  const types=parseDocxXml(await typeEntry.async('string'));
  for(const target of plan.targets.filter(t=>t.status==='ready')){
   const object=document.objects[target.index],{ole,preview}=prepared.get(target.index);let k=1;
   while(document.zip.file(`word/media/elTypography${k}.png`)||document.zip.file(`word/embeddings/elTypography${k}.bin`))k++;
   const imagePart=`word/media/elTypography${k}.png`,olePart=`word/embeddings/elTypography${k}.bin`;
   document.zip.file(imagePart,preview.png);document.zip.file(olePart,ole);
   // inspectDocx shares DOMs per part, but not relationship DOMs per object.
   // Reuse the first mutated relationship DOM so later targets cannot replace it.
   const rels=changedRels.get(object.relPart)??object.rels;changedRels.set(object.relPart,rels);
   object.image.setAttributeNS(NS.r,'r:id',relation(rels,'image',posix.relative(posix.dirname(object.part),imagePart)));
   object.element.setAttributeNS(NS.r,'r:id',relation(rels,'oleObject',posix.relative(posix.dirname(object.part),olePart)));
   shapeDimensions(object.shape,preview);
   const container=object.element.parentNode,run=container.parentNode;
   container.setAttributeNS(NS.w,'w:dxaOrig',String(Math.round(preview.width*20)));container.setAttributeNS(NS.w,'w:dyaOrig',String(Math.round(preview.height*20)));
   const props=Array.from(run.childNodes).find(n=>n.namespaceURI===NS.w&&n.localName==='rPr'),position=props&&Array.from(props.childNodes).find(n=>n.namespaceURI===NS.w&&n.localName==='position');
   if(position)position.setAttributeNS(NS.w,'w:val',String(-Math.round(preview.depth*2)));
   contentType(types,imagePart,'image/png');contentType(types,olePart,'application/vnd.openxmlformats-officedocument.oleObject');changedParts.set(object.part,object.partDoc);
  }
  for(const [part,doc]of changedParts)document.zip.file(part,serializer.serializeToString(doc));
  for(const [part,rels]of changedRels)document.zip.file(part,serializer.serializeToString(rels));
  if(plan.presetChanged)await writePreset(document,plan.options.preset,types,serializer);
  document.zip.file('[Content_Types].xml',serializer.serializeToString(types));
  buffer=await document.zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
  const checked=await inspectDocx(buffer);if(checked.objects.length!==document.objects.length)throw Error('Typography output changed the equation count');
  for(const object of checked.objects){const target=plan.targets.find(t=>t.index===object.index),expected=target?.status==='ready'?target.afterNativeSha256:document.objects[object.index].nativeSha256;if(object.nativeSha256!==expected)throw Error('Typography output failed native identity verification');}
 }
 let path=null;
 if(output!==undefined){
  if(typeof output!=='string'||!output.trim())throw Error('Invalid typography output path');
  path=resolve(output);
  if(typeof input==='string'&&await realpath(input)===await realpath(path).catch(()=>path))throw Error('Typography output must be a new copy, not the original document');
  const file=await open(path,'wx');
  try{await file.writeFile(buffer);await file.sync();}catch(error){await file.close();await unlink(path).catch(()=>{});throw error;}
  await file.close();
 }
 return {buffer,report:{schema:'equationlab.document-typography-result.v1',sourceSha256:plan.sourceSha256,outputSha256:hash(buffer),planSha256:plan.planSha256,...plan.summary,targets:plan.targets.map(({index,status,reason,beforeNativeSha256,afterNativeSha256})=>({index,status,reason,beforeNativeSha256,afterNativeSha256})),presetChanged:plan.presetChanged,changed:!buffer.equals(bytes),path,hostVerified:false}};
}

export const batchTypography={preflight:preflightTypography,apply:applyTypography};
