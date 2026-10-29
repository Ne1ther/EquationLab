import {readFile,writeFile,realpath,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {isMainModule} from './cli-entry.mjs';
import {createInterface} from 'node:readline';
import {inspectOle,oleLatex,characters,editCharacters,replaceOleLatex,patchRuler,readRuler} from './native.mjs';
import {makeNewOle,factoryTypography,MATHTYPE_FACTORY_SOURCE} from './new-formula.mjs';
import {createDocx,inspectDocx,editDocx,replaceDocxEquation,arrangeDocx,hash} from './document.mjs';
import {patchTypography,TYPOGRAPHY_SPACES,TYPOGRAPHY_EXTRA_SIZES} from './typography-native.mjs';
import {renderNative,nativePdf,warmNativeRenderer} from './font-renderer.mjs';
import {readEqp,writeEqp} from './eqp.mjs';
import {readTypography} from './typography-native.mjs';
import {previewNumberFormat} from './layout.mjs';
import {checkedWordNumbering} from './word-numbering.mjs';
import {createRenderScheduler} from './render-scheduler.mjs';
import {auditDocx,getReferenceTargets} from './document-audit.mjs';
import {preflightTypography,applyTypography,readTypographyPreset,readTypographyPresetFromPackage} from './document-typography.mjs';
import {preflightNumbering,applyNumbering} from './document-numbering-plan.mjs';

function applyRuler(ole,payload){return payload.ruler===undefined?ole:patchRuler(ole,payload.ruler);}
// Word stages immutable snapshots. Parse each snapshot once, including while
// individual sidebar thumbnails are arriving, and reuse identical snapshots
// across OLE activations. Recheck file identity before every reuse.
const documentCache=new Map(),documentFiles=new Map();let documentBytes=0;
async function readDocument(path){
 const info=await stat(path,{bigint:true}),identity=[info.ino,info.size,info.mtimeNs,info.ctimeNs].join(':');
 const previous=documentFiles.get(path);
 if(previous?.identity===identity&&documentCache.has(previous.key))return documentCache.get(previous.key).parsed;
 const bytes=await readFile(path),key=hash(bytes);
 let entry=documentCache.get(key);
 if(!entry){
  entry={bytes:bytes.length,parsed:inspectDocx(bytes).then(async document=>({...document,typographyPreset:await readTypographyPresetFromPackage(document).catch(()=>null)}))};documentCache.set(key,entry);documentBytes+=entry.bytes;
  try{await entry.parsed;}catch(error){documentCache.delete(key);documentBytes-=entry.bytes;throw error;}
 }
 documentFiles.delete(path);documentFiles.set(path,{identity,key});
 while(documentFiles.size>32)documentFiles.delete(documentFiles.keys().next().value);
 while(documentCache.size>4||documentBytes>32*1024*1024){const first=documentCache.keys().next().value;documentBytes-=documentCache.get(first).bytes;documentCache.delete(first);}
 return entry.parsed;
}
// A thumbnail is identified by ALL native bytes, including fonts, sizes,
// spacing and rulers. Never reuse Word's stale image or cache document paths.
const thumbnailCache=new Map();let thumbnailBytes=0;
function cacheThumbnail(key,image){
 const old=thumbnailCache.get(key);if(old)thumbnailBytes-=old.length;
 thumbnailCache.delete(key);thumbnailCache.set(key,image);thumbnailBytes+=image.length;
 while(thumbnailCache.size>256||thumbnailBytes>8_000_000){const first=thumbnailCache.keys().next().value;thumbnailBytes-=thumbnailCache.get(first).length;thumbnailCache.delete(first);}
 return image;
}

async function nativeWordRequest(path,payload){
 const response=await fetch('http://127.0.0.1:37952/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)}),result=await response.json();if(!response.ok)throw Error(result.error||'Word 会话服务不可用');return result;
}
async function wordSession(path,payload){
 if(!/^[a-f0-9]{64}$/.test(payload.ticket||''))throw Error('无效的 Word 编辑会话');
 return nativeWordRequest(path,payload);
}
function checkedWordSource(session,ticket){
 if(session.ticket!==ticket||typeof session.path!=='string'||typeof session.native!=='string'||typeof session.session!=='string')throw Error('Word 会话源数据无效');
}
async function checkedDocumentToolsInput(payload){
 if(typeof payload.input!=='string'||!payload.input)throw Error('请选择文档');
 const input=await realpath(payload.input);
 if(payload.ticket!==undefined){
  const session=await wordSession('native-read',{ticket:payload.ticket});checkedWordSource(session,payload.ticket);
  if(!session.document||session.document.scope||session.document.identity!==payload.documentIdentity||session.document.snapshot!==payload.documentSnapshot||await realpath(session.document.path)!==input)throw Error('Word 文档快照已变化或尚未载入完整，请重新读取');
 }
 return input;
}
async function readWordSession(ticket){
 const session=await wordSession('native-read',{ticket});checkedWordSource(session,ticket);
 const result=await desktopRequest({action:'inspect',payload:{path:session.document?.path??session.path,thumbnails:false}}),insertion=session.insertion===true,activeIndex=insertion?null:session.document?.index??0;
 if(insertion){
  if(session.document?.index!==-1||!session.layout)throw Error('Word 插入会话源数据无效');
 }else{
  const selected=result.objects[activeIndex],native=Buffer.from(session.native,'base64');
  try{if(!selected||selected.mainDocument!==true||native.length===0||native.toString('base64')!==session.native||selected.nativeSha256!==hash(native))throw Error('Word 文档快照与当前公式不一致，请重新打开公式');}finally{native.fill(0);}
 }
 const documentIdentity=session.document?.identity??null;
 return {...result,...insertion&&session.document?.scope==='insertion'?{objects:[]}: {},activePath:session.path,activeIndex,documentName:session.document?.name??null,documentIdentity,documentSnapshot:session.document?.snapshot??null,...['selection','insertion'].includes(session.document?.scope)?{documentLoading:true,documentPosition:session.document.position,documentTotal:session.document.count}:{},documentContext:session.documentContext??{state:session.document?'available':'missing',reason:session.document?'legacy-capture':'not-captured',identity:documentIdentity,snapshot:null,count:session.document?result.objects.filter(object=>object.mainDocument===true).length:0,index:session.document?activeIndex:null},hasDocumentContext:!!session.document,wordNumberingSupported:session.numberingSupport===true,wordNumberingContextSupported:session.numberingContextSupport===true,...insertion?{insertion:true,insertionLayout:session.layout}:{},wordTicket:ticket};
}

function insertionLayout(value,retained){
 const allowed=new Set(['mode','numberFormat','chapter','section','equation','contextEstablished']);
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.has(key)))throw Error('Word insertion layout is invalid');
 const modes={'inline':'inline','display':'display','right-numbered':'numbered-right','left-numbered':'numbered-left','numbered-right':'numbered-right','numbered-left':'numbered-left'};
 const mode=modes[value.mode];if(!mode)throw Error('Word insertion layout is invalid');
 if(value.contextEstablished!==undefined&&value.contextEstablished!==retained.contextEstablished)throw Error('Word counter context belongs to the captured insertion session');
 if(value.equation!==undefined&&value.equation!==retained.equation)throw Error('Word insertion layout must retain the captured numbering values');
 for(const key of ['chapter','section'])if(value[key]!==undefined&&(!Number.isSafeInteger(value[key])||value[key]<1||value[key]>32767))throw Error('Invalid Word chapter/section counter');
 const layout={mode,numberFormat:value.numberFormat??retained.numberFormat,chapter:value.chapter??retained.chapter,section:value.section??retained.section,equation:retained.equation};
 if(typeof layout.numberFormat!=='string'||layout.numberFormat.length>128)throw Error('Word insertion layout is invalid');
 previewNumberFormat(layout.numberFormat,layout);
 return layout;
}
async function insertWordEquation(payload){
 const allowed=new Set(['ticket','session','input','intent','insertion','latex','typography','ruler','layout']);
 if(Object.keys(payload).some(key=>!allowed.has(key))||payload.intent!==undefined&&payload.intent!=='insert'||payload.insertion!==undefined&&payload.insertion!==true)throw Error('Word insertion intent is invalid');
 if(payload.session!==undefined&&typeof payload.session!=='string'||typeof payload.input!=='string')throw Error('Word insertion source is invalid');
 if(typeof payload.latex!=='string'||!payload.latex.trim()||payload.latex.length>20000)throw Error('新公式 LaTeX 不能为空且不能超过 20000 个字符');
 const session=await wordSession('native-read',{ticket:payload.ticket});checkedWordSource(session,payload.ticket);
 if(session.insertion!==true||session.document?.index!==-1)throw Error('Word edit session cannot accept an insertion payload');
 if(payload.session!==undefined&&session.session!==payload.session)throw Error('Word insertion source session does not match');
 const layout=insertionLayout(payload.layout,session.layout);
 const changedContext=layout.chapter!==session.layout.chapter||layout.section!==session.layout.section||session.numberingContextSupport&&session.layout.contextEstablished===false&&layout.mode.startsWith('numbered-')&&/#[CS]/.test(layout.numberFormat);
 if(changedContext&&!session.numberingContextSupport)throw Error('Word insertion layout must retain the captured numbering values with this plugin; chapter/section changes require the updated plugin');
 if(changedContext&&!layout.mode.startsWith('numbered-'))throw Error('Chapter/section changes require a numbered equation');
 if(changedContext)layout.equation=1;
 const sourcePath=await realpath(session.path),inputPath=await realpath(payload.input);
 if(inputPath!==sourcePath)throw Error('Word 插入源文件不属于当前 Word 会话');
 const {objects}=await inspectDocx(await readFile(sourcePath));
 if(objects.length!==1||objects[0].mainDocument!==true||objects[0].parseError)throw Error('Word 插入源必须只包含一个原生公式');
 const expected=Buffer.from(session.native,'base64');let original,same;
 try{original=inspectOle(objects[0].ole).native;same=expected.length>0&&expected.toString('base64')===session.native&&original.equals(expected);}finally{original?.fill(0);expected.fill(0);objects[0].ole.fill(0);}
 if(!same)throw Error('Word 插入会话源公式已变化，已阻止提交');
 const base=makeNewOle(payload.latex,payload.typography);let ole=base,native,docx;
 try{
  ole=applyRuler(base,{ruler:payload.ruler});if(ole!==base)base.fill(0);
  native=inspectOle(ole).native;
  const pdf=await nativePdf(ole);
  docx=await createDocx([{ole,layout}],{fragment:true,initializeContext:changedContext});
  const result=await wordSession('native-complete',{ticket:payload.ticket,session:session.session,native:native.toString('base64'),...pdf,docx:docx.toString('base64')});
  return {...result,insertion:true,acknowledgement:session.acknowledgement===true};
 }finally{native?.fill(0);docx?.fill(0);ole.fill(0);if(ole!==base)base.fill(0);}
}

export async function desktopRequest(request) {
 const {action,payload={}}=request;
 if(action==='documentAudit')return auditDocx(await checkedDocumentToolsInput(payload));
 if(action==='documentReferenceTargets')return getReferenceTargets(await auditDocx(await checkedDocumentToolsInput(payload)),{query:payload.query});
 if(action==='documentTypographyPreset')return {preset:await readTypographyPreset(await checkedDocumentToolsInput(payload))};
 if(action==='documentTypographyPreflight')return preflightTypography(await checkedDocumentToolsInput(payload),payload.options);
 if(action==='documentNumberingPreflight')return preflightNumbering(await checkedDocumentToolsInput(payload),payload.options);
 if(action==='documentTypographyApply'||action==='documentNumberingApply'){
  const input=await checkedDocumentToolsInput(payload);
  if(typeof payload.output!=='string'||!payload.output)throw Error('请选择新的副本文件');
  const result=await (action==='documentTypographyApply'?applyTypography:applyNumbering)(input,payload.plan,{output:payload.output});
  return result.report;
 }
 if(action==='wordDocumentOpen')return nativeWordRequest('native-document-request',payload);
 if(action==='wordDocumentStatus')return nativeWordRequest('native-document-status',payload);
 if(action==='wordDocumentCancel')return nativeWordRequest('native-document-cancel',payload);
 if(action==='wordWorkspaceStatus')return nativeWordRequest('native-document-workspace-status',payload);
 if(action==='numberingPreview')return {text:previewNumberFormat(payload.pattern,payload.values)};
 if(action==='typography-default')return {profile:factoryTypography(),spaces:TYPOGRAPHY_SPACES,extraSizes:TYPOGRAPHY_EXTRA_SIZES,factorySource:MATHTYPE_FACTORY_SOURCE};
 if(action==='preferencesImport'){
  const text=await readFile(payload.path,'utf8'),parsed=readEqp(text);
  const profile=readTypography(makeNewOle('x',{...parsed.typography,spaces:parsed.spaces,extraSizes:parsed.extraSizes}));
  return {profile,originalText:text,unsupported:parsed.unsupported};
 }
 if(action==='preferencesExport'){
  const text=writeEqp(payload.typography,payload.originalText);await writeFile(payload.output,text);return {path:payload.output};
 }
 if(action==='exportGraphic'){
  let ole;
  if(payload.source){const {objects}=await inspectDocx(await readFile(payload.source.path)),o=objects[payload.source.index];if(!o||o.parseError)throw Error(o?.parseError||'原公式不存在');const changed=payload.source.mode==='characters'?editCharacters(o.ole,payload.source.replacements):replaceOleLatex(o.ole,payload.latex);ole=payload.typography?patchTypography(changed,payload.typography):changed;}
  else ole=makeNewOle(payload.latex,payload.typography);
  ole=applyRuler(ole,payload);let bytes;
  if(payload.format==='pdf')bytes=Buffer.from((await nativePdf(ole)).pdf,'base64');
  else if(payload.format==='svg')bytes=Buffer.from((await renderNative(ole,{raster:false})).svg);
  else if(payload.format==='png')bytes=(await renderNative(ole)).png;
  else throw Error('未知图像格式');
  await writeFile(payload.output,bytes);return {path:payload.output,bytes:bytes.length};
 }
 if(action==='wordSessionRead')return readWordSession(payload.ticket);
 if(action==='wordSessionDocument'){
  const status=await wordSession('native-enrich-request',{ticket:payload.ticket});
  return status.state==='available'?{state:'available',document:await readWordSession(payload.ticket)}:status;
 }
 if(action==='wordSessionInsert')return insertWordEquation(payload);
 if(action==='wordSessionNavigate')return wordSession('native-navigate',{ticket:payload.ticket,index:payload.index});
 if(action==='wordSessionThumbnails'){
  if(!Array.isArray(payload.indices)||payload.indices.length>4||payload.indices.some(i=>!Number.isInteger(i)||i<0))throw Error('Invalid thumbnail batch');
  const session=await wordSession('native-read',{ticket:payload.ticket});
  if(payload.documentIdentity!==undefined&&payload.documentIdentity!==session.document?.identity||payload.documentSnapshot!==undefined&&payload.documentSnapshot!==session.document?.snapshot)throw Error('Word thumbnail snapshot is no longer current');
  const result=await desktopRequest({action:'inspect',payload:{path:session.document?.path??session.path,thumbnailIndices:payload.indices,onlyIndices:payload.indices}});
  return {images:result.objects.map(o=>({index:o.index,image:o.image}))};
 }
 if(action==='wordSessionCancel')return wordSession('native-cancel',{ticket:payload.ticket});
 if(action==='wordSessionStatus')return wordSession('native-status',{ticket:payload.ticket});
 if(action==='wordSessionSave'){
  const session=await wordSession('native-read',{ticket:payload.ticket});
  checkedWordSource(session,payload.ticket);
  if(session.insertion===true)throw Error('Word insertion sessions cannot save over an existing equation');
  const sourcePath=await realpath(session.path),inputPath=await realpath(payload.input);
  if(inputPath!==sourcePath)throw Error('编辑源文件不属于当前 Word 会话');
  if(!['characters','rebuild'].includes(payload.mode))throw Error('未知的 Word 原生编辑模式');
  const {objects}=await inspectDocx(await readFile(sourcePath));
  if(objects.length!==1||payload.index!==undefined&&payload.index!==0)throw Error('Word 编辑会话必须只包含一个原生公式');
  const owner=objects[0];if(owner.parseError)throw Error(owner.parseError);
  const original=inspectOle(owner.ole).native,expected=Buffer.from(session.native,'base64');
  let same;try{same=expected.length>0&&expected.toString('base64')===session.native&&original.equals(expected);}finally{original.fill(0);expected.fill(0);}
  if(!same)throw Error('Word 会话源公式已变化，已阻止写回');
  let o=owner,target;
  if(payload.target!==undefined){
   const value=payload.target;
   if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['index','expectedNativeSha256','documentIdentity'].includes(k))||!Number.isInteger(value.index)||value.index<0||typeof value.expectedNativeSha256!=='string'||!/^[a-f0-9]{64}$/.test(value.expectedNativeSha256)||typeof value.documentIdentity!=='string')throw Error('Word 保存目标无效');
   if(!session.document?.identity||session.document.identity!==value.documentIdentity)throw Error('Word 保存目标不属于当前文档');
   const document=await readDocument(session.document.path);o=document.objects[value.index];
   if(!o||o.mainDocument!==true||o.parseError||o.nativeSha256!==value.expectedNativeSha256)throw Error('Word 保存目标已变化，已阻止写回');
   target={index:value.index,expectedNativeSha256:value.expectedNativeSha256,documentIdentity:session.document.identity};
  }
  let numbering;
  if(payload.numbering!==undefined){
   const value=payload.numbering;
   if(!session.numberingSupport||!target)throw Error('Word 编号目标或插件能力无效');
   numbering=checkedWordNumbering(value,{supported:session.numberingSupport,contextSupported:session.numberingContextSupport,target});
  }
  const changed=payload.mode==='characters'?editCharacters(o.ole,payload.replacements):replaceOleLatex(o.ole,payload.latex),ole=applyRuler(payload.typography?patchTypography(changed,payload.typography):changed,payload),p=await nativePdf(ole);
  const result=await wordSession('native-complete',{ticket:payload.ticket,session:session.session,native:inspectOle(ole).native.toString('base64'),...p,...target?{target}:{},...numbering?{numbering}:{}});
  return {...result,...session.acknowledgement?{acknowledgement:true}:{}};
 }
 if(action==='validate') {
  const ole=applyRuler(makeNewOle(payload.latex,payload.typography),payload),o=inspectOle(ole),latex=oleLatex(ole);
  const p=await renderNative(ole,{raster:false});
  return {latex,nativeSha256:hash(o.native),nativeBytes:o.native.length,characters:characters(o.parsed).length,svg:p.svg,warnings:p.warnings};
 }
 if(action==='inspect') {
  const {objects,zip,numberFormat,numberingRevision,typographyPreset}=await readDocument(payload.path);
  // Old Word documents commonly carry EMF/WMF previews. Render their real
  // native equation instead of showing LaTeX in the macOS formula sidebar.
  // Serialize CoreText work and reuse identical formula thumbnails per scan.
  const thumbnails=new Map();let thumbnailQueue=Promise.resolve();
  const thumbnail=o=>{
   if(thumbnailCache.has(o.nativeSha256))return Promise.resolve(thumbnailCache.get(o.nativeSha256));
   if(thumbnails.has(o.nativeSha256))return thumbnails.get(o.nativeSha256);
   const pending=thumbnailQueue.then(async()=>{
    const rendered=await renderNative(o.ole,{maxWidth:640,maxHeight:240});
    const png=rendered.png;
    return cacheThumbnail(o.nativeSha256,'data:image/png;base64,'+png.toString('base64'));
   });
   thumbnailQueue=pending.catch(()=>{});thumbnails.set(o.nativeSha256,pending);return pending;
  };
  let chosen=objects;
  if(payload.onlyIndices!==undefined){
   if(!Array.isArray(payload.onlyIndices)||payload.onlyIndices.length>4||payload.onlyIndices.some(i=>!Number.isInteger(i)||i<0||!objects[i]))throw Error('Invalid thumbnail indices');
   chosen=[...new Set(payload.onlyIndices)].map(index=>objects[index]);
  }
  const entries=await Promise.all(chosen.map(async o=>{
   let image=null;
   if(o.imagePath&&/\.(png|jpe?g|gif)$/i.test(o.imagePath)&&zip.file(o.imagePath))image=`data:image/${o.imagePath.toLowerCase().endsWith('.png')?'png':o.imagePath.toLowerCase().endsWith('.gif')?'gif':'jpeg'};base64,${await zip.file(o.imagePath).async('base64')}`;
   // Word's cached OLE image can be tiny or retain an old layout. Supported
   // formulas get a fresh native thumbnail; defer that work on session open.
   if(!o.parseError&&!o.previewError&&o.nativeSha256){
    if(payload.thumbnails===false)image=thumbnailCache.get(o.nativeSha256)??null;
    else if(!payload.thumbnailIndices||payload.thumbnailIndices.includes(o.index)){try{image=await thumbnail(o);}catch{/* Preserve the stored preview if the native renderer cannot display it. */}}
   }
   return {index:o.index,part:o.part,mainDocument:o.mainDocument===true,path:o.path,progId:o.progId,latex:o.latex??null,error:o.parseError||o.previewError||null,nativeSha256:o.nativeSha256,application:o.application,characters:o.characters,typography:o.typography,layout:o.layout,ruler:o.nativeSha256?readRuler(o.ole):[],image};
  }));
  return {path:payload.path,objects:entries,documentNumberFormat:numberFormat,documentNumberingRevision:numberingRevision,documentTypographyPreset:typographyPreset};
 }
 if(action==='export') {
  if(!Array.isArray(payload.equations)||payload.equations.length<1||payload.equations.length>500)throw Error('需要 1–500 条公式');
  const equations=payload.equations.map(e=>({latex:e.latex,label:e.label||'',typography:e.typography,layout:e.layout,ruler:e.ruler}));
  if(payload.source){
   const {objects}=await inspectDocx(await readFile(payload.source.path)),o=objects[payload.source.index];
   if(!o||o.parseError)throw Error(o?.parseError||'原公式不存在');
   equations[0].ole=payload.source.mode==='characters'?editCharacters(o.ole,payload.source.replacements):replaceOleLatex(o.ole,equations[0].latex);
  }
  const bytes=await createDocx(equations,{fragment:payload.fragment??true});
  await writeFile(payload.output,bytes); return {path:payload.output,bytes:bytes.length};
 }
 if(action==='editPreview') {
  const {objects}=await readDocument(payload.input),o=objects[payload.index];
  if(!o||o.parseError)throw Error(o?.parseError||'公式不存在');
  const changed=payload.mode==='rebuild'?replaceOleLatex(o.ole,payload.latex):editCharacters(o.ole,payload.replacements),updated=applyRuler(payload.typography?patchTypography(changed,payload.typography):changed,payload),latex=oleLatex(updated),p=await renderNative(updated,{raster:false});
  return {latex,nativeSha256:hash(inspectOle(updated).native),svg:p.svg,warnings:p.warnings};
 }
 if(action==='edit') {
  const input=await realpath(payload.input),output=await realpath(payload.output).catch(()=>resolve(payload.output));
  if(input===output)throw Error('请另存为副本，保留原始 Word 文档');
  const buffer=await readFile(input);
  const bytes=payload.mode==='characters'?await editDocx(buffer,payload.index,payload.replacements,{typography:payload.typography,ruler:payload.ruler}):await replaceDocxEquation(buffer,payload.index,payload.latex,{typography:payload.typography,ruler:payload.ruler});
  const checked=await inspectDocx(bytes),o=checked.objects[payload.index];
  if(!o?.nativeSha256||o.parseError)throw Error('原生公式写回校验失败，未保存');
  await writeFile(output,bytes);return {path:output,bytes:bytes.length,latex:o.latex,nativeSha256:o.nativeSha256};
 }
 if(action==='arrange') {
  const input=await realpath(payload.input),output=await realpath(payload.output).catch(()=>resolve(payload.output));
  if(input===output)throw Error('请另存为副本，保留原始 Word 文档');
  const bytes=await arrangeDocx(await readFile(input),{indices:payload.indices,layout:payload.layout});
  await writeFile(output,bytes);return {path:output,bytes:bytes.length};
 }
 if(action==='preview') {
  let ole;
  if(payload.source){const {objects}=await inspectDocx(await readFile(payload.source.path)),o=objects[payload.source.index];if(!o||o.parseError)throw Error(o?.parseError||'原公式不存在');const changed=payload.source.mode==='characters'?editCharacters(o.ole,payload.source.replacements):replaceOleLatex(o.ole,payload.latex);ole=payload.typography?patchTypography(changed,payload.typography):changed;}
  else ole=makeNewOle(payload.latex,payload.typography);
  ole=applyRuler(ole,payload);const p=await renderNative(ole);return {svg:p.svg,png:p.png.toString('base64'),nativeSha256:hash(inspectOle(ole).native)};
 }
 throw Error('未知操作：'+action);
}

if(await isMainModule(import.meta.url)){
 if(process.argv.includes('--stdio-worker')){
  const rendering=createRenderScheduler(warmNativeRenderer().catch(error=>process.stderr.write('Renderer warmup: '+error.message+'\n')));
  const control=new Set(['wordSessionRead','wordSessionCancel','wordSessionStatus','wordSessionNavigate','wordDocumentOpen','wordDocumentStatus','wordDocumentCancel','wordWorkspaceStatus','typography-default','numberingPreview']),inflight=new Set();
  // One app-owned process, no socket/listener. Preserve the existing one-shot
  // protocol for installers and tooling. A rejected request never poisons the
  // next request, and all writes/exports retain the same validation path.
  for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})){
   if(inflight.size>=32)await Promise.race(inflight);
   let id,request;const start=performance.now();
   try{if(Buffer.byteLength(line)>5_000_000)throw Error('请求过大');request=JSON.parse(line);id=request.id;if(typeof id!=='string'||id.length>100)throw Error('无效的请求标识');}
   catch(error){process.stdout.write(JSON.stringify({id,ok:false,error:error.message,elapsedMs:performance.now()-start})+'\n');continue;}
   const run=async()=>{try{return {ok:true,data:await desktopRequest(request)};}catch(error){return {ok:false,error:error.message};}};
   // Status/cancel/open must not wait behind font warmup or thumbnail drawing.
   // Rendering and filesystem mutations retain their original serial order.
   const isPreview=['validate','editPreview'].includes(request.action);
   const key=isPreview&&request.coalescePreview===true&&request.payload?.previewOnly===true?'editor-preview':null;
   const execution=control.has(request.action)?run():rendering.enqueue(run,{priority:request.action==='wordSessionThumbnails'?2:isPreview?1:0,key});
   const task=execution.then(result=>{if(result.superseded)result={ok:false,cancelled:true,superseded:true};process.stdout.write(JSON.stringify({id,...result,elapsedMs:performance.now()-start})+'\n');});
   inflight.add(task);task.finally(()=>inflight.delete(task));
  }
  await Promise.all(inflight);
 }else try{let s='';for await(const c of process.stdin){s+=c;if(s.length>5_000_000)throw Error('请求过大');}const data=await desktopRequest(JSON.parse(s));process.stdout.write(JSON.stringify({ok:true,data}));}
 catch(error){process.stdout.write(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;}
}
