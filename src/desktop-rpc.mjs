import {readFile,writeFile,realpath} from 'node:fs/promises';
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

function applyRuler(ole,payload){return payload.ruler===undefined?ole:patchRuler(ole,payload.ruler);}

async function wordSession(path,payload){
 if(!/^[a-f0-9]{64}$/.test(payload.ticket||''))throw Error('无效的 Word 编辑会话');
 const response=await fetch('http://127.0.0.1:37952/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)}),result=await response.json();if(!response.ok)throw Error(result.error||'Word 会话服务不可用');return result;
}

export async function desktopRequest(request) {
 const {action,payload={}}=request;
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
 if(action==='wordSessionRead'){const session=await wordSession('native-read',{ticket:payload.ticket});const result=await desktopRequest({action:'inspect',payload:{path:session.document?.path??session.path,thumbnails:false}});return {...result,activePath:session.path,activeIndex:session.document?.index??0,documentName:session.document?.name??null,hasDocumentContext:!!session.document,wordTicket:payload.ticket};}
 if(action==='wordSessionNavigate')return wordSession('native-navigate',{ticket:payload.ticket,index:payload.index});
 if(action==='wordSessionThumbnails'){
  if(!Array.isArray(payload.indices)||payload.indices.length>4||payload.indices.some(i=>!Number.isInteger(i)||i<0))throw Error('Invalid thumbnail batch');
  const session=await wordSession('native-read',{ticket:payload.ticket});
  const result=await desktopRequest({action:'inspect',payload:{path:session.document?.path??session.path,thumbnailIndices:payload.indices}});
  return {images:result.objects.filter(o=>payload.indices.includes(o.index)).map(o=>({index:o.index,image:o.image}))};
 }
 if(action==='wordSessionCancel')return wordSession('native-cancel',{ticket:payload.ticket});
 if(action==='wordSessionStatus')return wordSession('native-status',{ticket:payload.ticket});
 if(action==='wordSessionSave'){
  const session=await wordSession('native-read',{ticket:payload.ticket});
  if(session.ticket!==payload.ticket||typeof session.path!=='string'||typeof session.native!=='string'||typeof session.session!=='string')throw Error('Word 会话源数据无效');
  const sourcePath=await realpath(session.path),inputPath=await realpath(payload.input);
  if(inputPath!==sourcePath)throw Error('编辑源文件不属于当前 Word 会话');
  if(!['characters','rebuild'].includes(payload.mode))throw Error('未知的 Word 原生编辑模式');
  const {objects}=await inspectDocx(await readFile(sourcePath));
  if(objects.length!==1||payload.index!==undefined&&payload.index!==0)throw Error('Word 编辑会话必须只包含一个原生公式');
  const o=objects[0];if(o.parseError)throw Error(o.parseError);
  const original=inspectOle(o.ole).native,expected=Buffer.from(session.native,'base64');
  let same;try{same=expected.length>0&&expected.toString('base64')===session.native&&original.equals(expected);}finally{original.fill(0);expected.fill(0);}
  if(!same)throw Error('Word 会话源公式已变化，已阻止写回');
  const changed=payload.mode==='characters'?editCharacters(o.ole,payload.replacements):replaceOleLatex(o.ole,payload.latex),ole=applyRuler(payload.typography?patchTypography(changed,payload.typography):changed,payload),p=await nativePdf(ole);
  const result=await wordSession('native-complete',{ticket:payload.ticket,session:session.session,native:inspectOle(ole).native.toString('base64'),...p});
  return {...result,...session.acknowledgement?{acknowledgement:true}:{}};
 }
 if(action==='validate') {
  const ole=applyRuler(makeNewOle(payload.latex,payload.typography),payload),o=inspectOle(ole),latex=oleLatex(ole);
  const p=await renderNative(ole,{raster:false});
  return {latex,nativeSha256:hash(o.native),nativeBytes:o.native.length,characters:characters(o.parsed).length,svg:p.svg};
 }
 if(action==='inspect') {
  const buffer=await readFile(payload.path),{objects,zip}=await inspectDocx(buffer);
  // Old Word documents commonly carry EMF/WMF previews. Render their real
  // native equation instead of showing LaTeX in the macOS formula sidebar.
  // Serialize CoreText work and reuse identical formula thumbnails per scan.
  const thumbnails=new Map();let thumbnailQueue=Promise.resolve();
  const thumbnail=o=>{
   if(thumbnails.has(o.nativeSha256))return thumbnails.get(o.nativeSha256);
   const pending=thumbnailQueue.then(async()=>{
    const rendered=await renderNative(o.ole,{maxWidth:640,maxHeight:240});
    const png=rendered.png;
    return 'data:image/png;base64,'+png.toString('base64');
   });
   thumbnailQueue=pending.catch(()=>{});thumbnails.set(o.nativeSha256,pending);return pending;
  };
  const entries=await Promise.all(objects.map(async o=>{
   let image=null;
   if(o.imagePath&&/\.(png|jpe?g|gif)$/i.test(o.imagePath)&&zip.file(o.imagePath))image=`data:image/${o.imagePath.toLowerCase().endsWith('.png')?'png':o.imagePath.toLowerCase().endsWith('.gif')?'gif':'jpeg'};base64,${await zip.file(o.imagePath).async('base64')}`;
   // Word's cached OLE image can be tiny or retain an old layout. Supported
   // formulas get a fresh native thumbnail; defer that work on session open.
   if(!o.parseError&&!o.previewError&&o.nativeSha256){
    if(payload.thumbnails===false)image=null;
    else if(!payload.thumbnailIndices||payload.thumbnailIndices.includes(o.index)){try{image=await thumbnail(o);}catch{/* Preserve the stored preview if the native renderer cannot display it. */}}
   }
   return {index:o.index,part:o.part,path:o.path,progId:o.progId,latex:o.latex??null,error:o.parseError||o.previewError||null,nativeSha256:o.nativeSha256,application:o.application,characters:o.characters,typography:o.typography,layout:o.layout,ruler:o.nativeSha256?readRuler(o.ole):[],image};
  }));
  return {path:payload.path,objects:entries};
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
  const {objects}=await inspectDocx(await readFile(payload.input)),o=objects[payload.index];
  if(!o||o.parseError)throw Error(o?.parseError||'公式不存在');
  const changed=payload.mode==='rebuild'?replaceOleLatex(o.ole,payload.latex):editCharacters(o.ole,payload.replacements),updated=applyRuler(payload.typography?patchTypography(changed,payload.typography):changed,payload),latex=oleLatex(updated),p=await renderNative(updated,{raster:false});
  return {latex,nativeSha256:hash(inspectOle(updated).native),svg:p.svg};
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
  await warmNativeRenderer().catch(error=>process.stderr.write('Renderer warmup: '+error.message+'\n'));
  // One app-owned process, no socket/listener. Preserve the existing one-shot
  // protocol for installers and tooling. A rejected request never poisons the
  // next request, and all writes/exports retain the same validation path.
  for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})){
   let id;const start=performance.now();let result;
   try{if(Buffer.byteLength(line)>5_000_000)throw Error('请求过大');const request=JSON.parse(line);id=request.id;if(typeof id!=='string'||id.length>100)throw Error('无效的请求标识');result={ok:true,data:await desktopRequest(request)};}
   catch(error){result={ok:false,error:error.message};}
   process.stdout.write(JSON.stringify({id,...result,elapsedMs:performance.now()-start})+'\n');
  }
 }else try{let s='';for await(const c of process.stdin){s+=c;if(s.length>5_000_000)throw Error('请求过大');}const data=await desktopRequest(JSON.parse(s));process.stdout.write(JSON.stringify({ok:true,data}));}
 catch(error){process.stdout.write(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;}
}
