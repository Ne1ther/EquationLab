import {randomBytes,createHash} from 'node:crypto';
import {mkdtemp,chmod,writeFile,rm,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import JSZip from 'jszip';
import {inflateRaw} from 'node:zlib';
import {promisify} from 'node:util';
import {Worker} from 'node:worker_threads';
import {parseNative,wrapNative,inspectOle} from './native.mjs';
import {makeNewOle} from './new-formula.mjs';
import {fromFlatOpc,inspectDocx,MAX_FLAT_OPC_BYTES} from './document.mjs';
import {previewNumberFormat} from './layout.mjs';
import {checkedWordSnapshotZip} from './word-snapshot.mjs';
import {checkedWordNumbering} from './word-numbering.mjs';
import {wordCatalogProof} from './word-document-requests.mjs';
import {performance} from 'node:perf_hooks';

const MAX_BLOB=16*1024*1024,MAX_ENCODED=4*Math.ceil(MAX_BLOB/3);
const MAX_SESSIONS=16,TTL=20*60*1000,MAX_UINT64=18446744073709551615n;
const sessions=new Map();
// Small acknowledgement receipts contain no formula, PDF or private file path.
const receipts=new Map();
const documentSnapshots=new Map();let snapshotBytes=0;
const inflateContext=promisify(inflateRaw),MAX_COMPRESSED_CONTEXT=34_000_000;
// Opt-in, content-free timings. Never emit document names, paths, tickets,
// identities or formula data, and never let diagnostics affect a session.
function timing(event){
 if(process.env.EQUATIONLAB_HOST_TRACE!=='1')return;
 try{process.stderr.write(JSON.stringify({event:'word-native-timing',...event})+'\n');}catch{}
}
let activeSnapshotWorkers=0;
function segmentedSnapshot(encoded,signal){
 if(signal?.aborted)throw Error('Word document loading request is no longer current');
 if(activeSnapshotWorkers>=2)throw Error('Word document loading is busy');
 const worker=new Worker(new URL('./word-snapshot-worker.mjs',import.meta.url),{workerData:encoded,execArgv:[]});
 activeSnapshotWorkers++;
 // Keep a slot until the worker has stopped, even after cancellation.
 worker.once('exit',()=>{activeSnapshotWorkers--;});
 return new Promise((resolve,reject)=>{
  const abort=()=>{void worker.terminate();reject(Error('Word document loading request is no longer current'));};
  const cleanup=()=>signal?.removeEventListener('abort',abort);
  signal?.addEventListener('abort',abort,{once:true});
  worker.once('message',result=>{
   cleanup();
   if(result.error)reject(Error(result.error));
   else resolve({...result,bytes:Buffer.from(result.bytes.buffer,result.bytes.byteOffset,result.bytes.byteLength)});
  });
  worker.once('error',error=>{cleanup();reject(error);});
  worker.once('exit',()=>{cleanup();reject(Error('Word document loading worker exited'));});
 });
}
async function snapshot(value,signal){
 const started=performance.now();let conversionMs=0,inspectMs=0;
 const key=createHash('sha256').update(value.encoding??'xml').update('\0').update(value.ooxml).digest('hex');
 let cached=documentSnapshots.get(key);
 const cacheHit=!!cached;
 if(!cached&&value.encoding==='parts-deflate-base64'){
  const {conversionMs:converted,inspectMs:inspected,...result}=await segmentedSnapshot(value.ooxml,signal);
  conversionMs=converted;inspectMs=inspected;cached=result;
 }else if(!cached){
  let xml=value.ooxml;
  if(value.encoding==='deflate-base64'){
   const packed=Buffer.from(xml,'base64');
   if(!packed.length||packed.length>MAX_COMPRESSED_CONTEXT||packed.toString('base64')!==xml)throw Error('Invalid compressed Word document context');
   let expanded;
   try{expanded=await inflateContext(packed,{maxOutputLength:MAX_FLAT_OPC_BYTES});xml=new TextDecoder('utf-8',{fatal:true}).decode(expanded);}
   catch{throw Error('Invalid or oversized compressed Word document context');}
   finally{packed.fill(0);expanded?.fill(0);}
  }
  // Private equation snapshots never export Word's cached pictures. Discard
  // their Flat OPC parts before DOM parsing/base64 decoding/ZIP compression.
  // Keep XML, relationships and OLE bytes; a nonstandard prefix simply uses
  // the ordinary checked parser without this optimization.
  if(value.encoding!=='docx-base64')xml=xml.replace(/<pkg:part\b[^>]*\bpkg:name="\/[^"]+\.(?:png|jpe?g|emf|wmf|gif|tiff?|bmp|svg)"[^>]*>[\s\S]*?<\/pkg:part\s*>/gi,'');
  const conversionStart=performance.now();
  const bytes=value.encoding==='docx-base64'?await checkedWordSnapshotZip(value.ooxml):await fromFlatOpc(xml);
  conversionMs=performance.now()-conversionStart;
  try{
   const inspectStart=performance.now();
   const {objects}=await inspectDocx(bytes,{nativeIndexOnly:true});
   inspectMs=performance.now()-inspectStart;
   cached={bytes,objects:objects.map(o=>({part:o.part,mainDocument:o.mainDocument===true,error:o.parseError,nativeSha256:o.nativeSha256})),count:objects.filter(o=>o.mainDocument===true).length};
  }catch(error){bytes.fill(0);throw error;}
 }
 if(!cacheHit){
  if(signal?.aborted){cached.bytes.fill(0);throw Error('Word document loading request is no longer current');}
  const shared=documentSnapshots.get(key);
  if(shared){cached.bytes.fill(0);cached=shared;}
  else{
   documentSnapshots.set(key,cached);snapshotBytes+=cached.bytes.length;
   while(documentSnapshots.size>4||snapshotBytes>32*1024*1024){const oldest=documentSnapshots.keys().next().value,item=documentSnapshots.get(oldest);documentSnapshots.delete(oldest);snapshotBytes-=item.bytes.length;if(item!==cached)item.bytes.fill(0);}
  }
 }
 timing({phase:'snapshot',cacheHit,encoding:value.encoding??'xml',conversionMs,inspectMs,totalMs:performance.now()-started,objects:cached.count,bytes:cached.bytes.length});
 // Another session can evict and wipe this cache entry while the caller awaits.
 return {...cached,bytes:Buffer.from(cached.bytes)};
}
let sequence=Promise.resolve(),queued=0;
const operations=new Set(['native-open','native-insert-open','native-poll','native-read','native-complete','native-cancel','native-ack','native-status','native-navigate','native-enrich','native-enrich-request']);
const ACK_CONFIRMATION_TIMEOUT=60_000;

// Serialization also covers async staging/deletion. A cancel cannot overtake a
// read and leave a newly-created file behind after the cancellation cleanup.
function serial(task){
 if(queued>=32)return Promise.reject(Error('Native session service is busy'));
 queued++;
 const result=sequence.then(task);sequence=result.catch(()=>{});
 return result.finally(()=>{queued--;});
}
function uint64(value){
 if(typeof value!=='string'||!/^(?:0|[1-9]\d{0,19})$/.test(value)||BigInt(value)>MAX_UINT64)throw Error('Invalid native session identifier');
 return value;
}
function request(operation,body){
 if(!operations.has(operation))throw Error('Unknown native session operation');
 if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Invalid native session request');
 body={...body};
 for(const key of ['document','target','layout','numbering'])if(body[key]&&typeof body[key]==='object'&&!Array.isArray(body[key]))body[key]={...body[key]};
 if(body.document?.insertionAfter&&typeof body.document.insertionAfter==='object')body.document.insertionAfter={...body.document.insertionAfter};
 if(body.numbering?.context&&typeof body.numbering.context==='object')body.numbering.context={...body.numbering.context};
 const allowed=operation==='native-open'?['session','native','acknowledgement','numberingSupport','numberingContextSupport','document']:operation==='native-insert-open'?['session','acknowledgement','numberingContextSupport','document','layout']:operation==='native-complete'?['ticket','session','native','pdf','width','height','target','docx','numbering']:operation==='native-enrich'?['ticket','session','document','initialSnapshot','failed']:operation==='native-ack'?['ticket','session','ok','uncertain']:operation==='native-navigate'?['ticket','index']:['ticket','session'];
 if(Object.keys(body).some(key=>!allowed.includes(key)))throw Error('Invalid native session request fields');
 if(operation==='native-open'||operation==='native-insert-open')uint64(body.session);
 else{
  if(typeof body.ticket!=='string'||!/^[a-f0-9]{64}$/.test(body.ticket))throw Error('Invalid native session ticket');
  if(body.session!==undefined)uint64(body.session);
 }
 return body;
}
function refreshReceipt(receipt){
 if(receipt.state==='delivered'&&Number.isFinite(receipt.deliveredAt)&&Date.now()-receipt.deliveredAt>=ACK_CONFIRMATION_TIMEOUT){
  receipt.state='unconfirmed';receipt.expires=Date.now()+TTL;
 }
}
function blob(value){
 if(typeof value!=='string'||!value.length||value.length>MAX_ENCODED||value.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw Error('Invalid or oversized base64 payload');
 const bytes=Buffer.from(value,'base64');
 if(!bytes.length||bytes.length>MAX_BLOB||bytes.toString('base64')!==value){bytes.fill(0);throw Error('Invalid or oversized base64 payload');}
 return bytes;
}
function nativeBlob(value){
 const bytes=blob(value);let parsed;
 try{parsed=parseNative(bytes);return bytes;}catch{bytes.fill(0);throw Error('Invalid Equation Native payload');}
 finally{if(parsed){parsed.header.fill(0);parsed.data.fill(0);}}
}
function pdfBlob(value){
 const bytes=blob(value);
 if(!/^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(bytes.subarray(0,10).toString('ascii'))){bytes.fill(0);throw Error('Invalid PDF header');}
 return bytes;
}
function extent(value){
 if(!Number.isInteger(value)||value<=0||value>2147483647)throw Error('Invalid HIMETRIC extent');
 return value;
}
async function removeStage(entry){
 if(!entry.directory)return;
 try{await rm(entry.directory,{recursive:true,force:true});}catch{throw Error('Native session staging cleanup failed');}
 entry.directory=null;entry.path=null;
}
function stopEnrichment(entry){
 entry.enrichment?.abort();
 entry.enrichment=null;
}
function wipe(entry){
 stopEnrichment(entry);
 entry.document?.bytes.fill(0);entry.document=null;
 entry.native?.fill(0);entry.result?.native.fill(0);entry.result?.pdf.fill(0);entry.result?.docx?.fill(0);
 entry.native=null;entry.result=null;
}
async function discard(entry){
 // Keep the entry until filesystem cleanup succeeds, so a subsequent request
 // can retry instead of abandoning an untracked private staging directory.
 await removeStage(entry);clearTimeout(entry.timer);wipe(entry);sessions.delete(entry.ticket);
}
async function expireEntry(entry){
 const receipt=receipts.get(entry.ticket);
 if(receipt?.state==='queued'){receipt.state='failed';receipt.expires=Date.now()+TTL;}
 // Expiration wipes owned payloads even if filesystem deletion must be retried.
 wipe(entry);entry.state='expired';await discard(entry);
}
async function expire(){
 // Unresolved receipts remain queryable while Word may still mutate the host document.
 for(const [ticket,receipt]of receipts)if(receipt.expires!==null&&receipt.expires<=Date.now())receipts.delete(ticket);
 const now=Date.now();for(const entry of sessions.values())if(entry.expires<=now){try{await expireEntry(entry);}catch{/* The per-entry timer retries; other sessions stay isolated. */}}
}
function arm(entry){
 const delay=Math.max(1,entry.expires-Date.now());
 entry.timer=setTimeout(()=>{serial(async()=>{
  if(sessions.get(entry.ticket)!==entry)return;
  if(entry.expires<=Date.now())await expireEntry(entry);else arm(entry);
 }).catch(()=>{
  // No payload, ticket or path is logged. Retry failed private-file cleanup;
  // ordinary requests also retry expiration cleanup before accessing sessions.
  if(sessions.get(entry.ticket)===entry){entry.timer=setTimeout(()=>arm(entry),1000);entry.timer.unref();}
 });},delay);
 entry.timer.unref();
}
function current(body){
 const entry=sessions.get(body.ticket);
 if(!entry||entry.expires<=Date.now()||body.session!==undefined&&body.session!==entry.session)throw Error('Unknown or expired native session');
 return entry;
}
function editing(entry){if(entry.state!=='editing')throw Error('Native session is no longer editing');}
async function sessionSource(native){
 // This private edit source is never exported to Word. A placeholder lets the
 // normal save path replace the preview without rendering once just to stage it.
 const zip=new JSZip(),r='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
 zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
 zip.file('_rels/.rels',`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rDocument" Type="${r}/officeDocument" Target="word/document.xml"/></Relationships>`);
 zip.file('word/document.xml',`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="${r}" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:v="urn:schemas-microsoft-com:vml"><w:body><w:p><w:r><w:object><v:shape style="width:1pt;height:1pt"><v:imagedata r:id="rPreview"/></v:shape><o:OLEObject ProgID="Equation.DSMT4" r:id="rNative"/></w:object></w:r></w:p></w:body></w:document>`);
 zip.file('word/_rels/document.xml.rels',`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rNative" Type="${r}/oleObject" Target="embeddings/equation.bin"/><Relationship Id="rPreview" Type="${r}/image" Target="media/placeholder.png"/></Relationships>`);
 zip.file('word/embeddings/equation.bin',wrapNative(native));
 zip.file('word/media/placeholder.png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'));
 return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
async function stage(entry){
 const started=performance.now();
 if(entry.path){
  const [directory,file]=await Promise.all([lstat(entry.directory),lstat(entry.path)]).catch(()=>{throw Error('Native session staging file is unavailable');});
  if(!directory.isDirectory()||directory.isSymbolicLink()||(directory.mode&0o777)!==0o700||!file.isFile()||file.isSymbolicLink()||(file.mode&0o777)!==0o600)throw Error('Native session staging file is unsafe');
  timing({phase:'stage',reused:true,totalMs:performance.now()-started});return entry.path;
 }
 const document=await sessionSource(entry.native);
 try{
  entry.directory=await mkdtemp(join(tmpdir(),'equationlab-word-native-'));
  await chmod(entry.directory,0o700);
  entry.path=join(entry.directory,'equation.docx');
  await writeFile(entry.path,document,{mode:0o600,flag:'wx'});
  if(entry.document){entry.document.path=join(entry.directory,'document.docx');await writeFile(entry.document.path,entry.document.bytes,{mode:0o600,flag:'wx'});entry.document.bytes.fill(0);}
  timing({phase:'stage',reused:false,totalMs:performance.now()-started});return entry.path;
 }catch{await removeStage(entry);throw Error('Native session staging failed');}
 finally{document.fill(0);}
}

async function documentContext(value,native,insertion=false,signal){
 if(value===undefined)return null;
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['ooxml','encoding','index','name','identity','snapshot','count','scope','insertionAfter','numberingRevision'].includes(k))||value.scope!==undefined&&!['selection','insertion'].includes(value.scope)||value.encoding!==undefined&&!['deflate-base64','docx-base64','parts-deflate-base64'].includes(value.encoding)||typeof value.ooxml!=='string'||value.ooxml.length>(value.encoding?4*Math.ceil(MAX_COMPRESSED_CONTEXT/3):30_000_000)||!Number.isInteger(value.index)||value.index<(insertion?-1:0)||value.index>10000||typeof value.name!=='string'||value.name.length>512||value.count!==undefined&&(!Number.isSafeInteger(value.count)||value.count<0||value.count>10000))throw Error('Invalid Word document context');
 if(value.identity!==undefined&&(typeof value.identity!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value.identity)))throw Error('Invalid Word document identity');
 if(value.snapshot!==undefined&&!(Number.isSafeInteger(value.snapshot)&&value.snapshot>0)&&!(typeof value.snapshot==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value.snapshot)))throw Error('Invalid Word document snapshot');
 if(value.numberingRevision!==undefined&&(!value.identity||!value.snapshot||!Number.isSafeInteger(value.numberingRevision)||value.numberingRevision<0||value.numberingRevision>2147483646))throw Error('Invalid Word document numbering revision');
 const partial=value.scope!==undefined,insertionPartial=value.scope==='insertion';
 if(partial&&(!value.identity||!value.snapshot||!Number.isSafeInteger(value.count)||insertionPartial!==insertion||(!insertionPartial&&(!value.count||value.index>=value.count))||insertionPartial&&value.index!==-1))throw Error('Invalid partial Word document context');
 const nativeDigest=insertion?null:createHash('sha256').update(native).digest('hex');
 const cached=await snapshot(value,signal);
 try{
 const selected=insertion&&value.index===-1?null:cached.objects[partial?0:value.index];
 if(value.insertionAfter!==undefined){
  const target=value.insertionAfter,object=cached.objects[insertionPartial?0:target?.index];
  if(!insertion||!target||Object.keys(target).length!==2||!Number.isInteger(target.index)||target.index<0||target.index>=(value.count??cached.count)||!/^[a-f0-9]{64}$/.test(target.nativeSha256||'')||!object?.mainDocument||object.error||object.nativeSha256!==target.nativeSha256)throw Error('Word insertion anchor no longer matches the selected equation');
 }
 const fragmentCount=insertionPartial?(value.insertionAfter?1:0):1;
 if(partial?(cached.count!==fragmentCount||cached.objects.length!==fragmentCount):value.count!==undefined&&value.count!==cached.count)throw Error('Saved Word snapshot equation count does not match the live document');
 if(insertion){if(value.index!==-1)throw Error('Invalid insertion document index');}
 else if(!selected||selected.mainDocument!==true||selected.error||selected.nativeSha256!==nativeDigest)throw Error('Word document context does not match the activated equation');
 return {bytes:cached.bytes,objects:cached.objects,index:partial&&!insertion?0:value.index,position:value.index,partial,scope:value.scope??null,loadState:partial?'pending':'available',name:value.name,count:partial?value.count:cached.count,identity:value.identity??null,snapshot:value.snapshot??null,insertionAfter:value.insertionAfter?{...value.insertionAfter}:null,path:null,numberingRevision:value.numberingRevision,mainStoryOnly:value.encoding==='parts-deflate-base64'};
 }catch(error){cached.bytes.fill(0);throw error;}
}

function insertionLayout(value){
 const allowed=new Set(['mode','numberFormat','chapter','section','equation','contextEstablished']);
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.has(k))||typeof value.mode!=='string')throw Error('Invalid insertion layout');
 const modes={'inline':'inline','display':'display','right-numbered':'numbered-right','left-numbered':'numbered-left','numbered-right':'numbered-right','numbered-left':'numbered-left'};
 const mode=modes[value.mode];if(!mode)throw Error('Invalid insertion layout mode');
 const numberFormat=value.numberFormat??'(#E1)',chapter=value.chapter??1,section=value.section??1,equation=value.equation??1;
 if(typeof numberFormat!=='string'||numberFormat.length>128)throw Error('Invalid insertion number format');
 for(const [name,n] of Object.entries({chapter,section,equation}))if(!Number.isSafeInteger(n)||n<1||n>32767)throw Error(`Invalid insertion ${name}`);
 // Use the same number-format grammar as DOCX generation.
 previewNumberFormat(numberFormat,{chapter,section,equation});
 if(value.contextEstablished!==undefined&&typeof value.contextEstablished!=='boolean')throw Error('Invalid insertion counter context');
 return {mode,numberFormat,chapter,section,equation,...value.contextEstablished!==undefined?{contextEstablished:value.contextEstablished}:{}};
}

// This status is deliberately limited to protocol state and counters. It has no
// document title, path, formula bytes or ticket and can be retained in QA logs.
function contextStatus(document){
 return document?{state:document.partial?'loading':'available',reason:document.partial?(document.scope==='insertion'?'insertion-captured':'selection-captured'):document.identity?'captured':'legacy-capture',identity:document.identity,snapshot:document.snapshot,count:document.count,index:document.position}:{state:'missing',reason:'not-captured',identity:null,snapshot:null,count:0,index:null};
}
function saveTarget(value,document){
 if(value===undefined)return null;
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['index','expectedNativeSha256','documentIdentity'].includes(k))||!Number.isInteger(value.index)||value.index<0||typeof value.expectedNativeSha256!=='string'||!/^[a-f0-9]{64}$/.test(value.expectedNativeSha256)||typeof value.documentIdentity!=='string')throw Error('Invalid Word save target');
 if(!document?.identity||document.partial||value.documentIdentity!==document.identity)throw Error('Word save target document does not match the editing session');
 const selected=document.objects[value.index];
 if(value.index>=document.count||!selected||selected.mainDocument!==true||selected.error||selected.nativeSha256!==value.expectedNativeSha256)throw Error('Word save target equation does not match the document snapshot');
 return {index:value.index,expectedNativeSha256:value.expectedNativeSha256,documentIdentity:document.identity};
}
function saveNumbering(value,target,entry){
 return checkedWordNumbering(value,{supported:!entry.insertion&&entry.numberingSupport,contextSupported:entry.numberingContextSupport,target});
}

async function enrichDocument(body){
 // Reserve the existing session before conversion, then release the queue so
 // save, cancellation and other Word sessions can proceed while we build it.
 const job=await serial(async()=>{
  await expire();
  const entry=current(body),old=entry.document;
  editing(entry);
  if(!old?.partial||body.session!==entry.session||body.initialSnapshot!==old.snapshot)throw Error('Word document loading request is no longer current');
  if(body.failed===true&&body.document===undefined){
   stopEnrichment(entry);old.loadState='failed';entry.documentRequested=false;return null;
  }
  if(old.loadState!=='pending'||entry.enrichment)throw Error('Word document loading request is no longer current');
  if(body.failed!==undefined||!body.document||body.document.scope!==undefined||body.document.identity!==old.identity||body.document.index!==old.position||body.document.snapshot===old.snapshot)throw Error('Word document loading target does not match the editing session');
  if(entry.insertion){
   const after=body.document.insertionAfter,previous=old.insertionAfter;
   if(!!after!==!!previous||previous&&(after.index!==previous.index||after.nativeSha256!==previous.nativeSha256))throw Error('Word insertion loading anchor does not match the editing session');
  }
  const controller=new AbortController();
  entry.enrichment=controller;
  // Start validation before leaving the reserved slot so the original Native
  // hash is taken before a queued cancellation can wipe the formula bytes.
  const full=documentContext(body.document,entry.native,entry.insertion,controller.signal);
  void full.catch(()=>{});
  return {entry,old,controller,full};
 });
 if(!job)return {ok:true};
 const {entry,old,controller}=job;
 let full;
 try{
  full=await job.full;
  if(full.count!==old.count)throw Error('Word document changed while loading the formula list');
  return await serial(async()=>{
   if(current(body)!==entry||entry.state!=='editing'||entry.document!==old||entry.enrichment!==controller)throw Error('Word document loading request is no longer current');
   await stage(entry);full.path=join(entry.directory,'document-full.docx');
   await writeFile(full.path,full.bytes,{mode:0o600,flag:'wx'});
   old.bytes.fill(0);entry.document=full;entry.documentRequested=false;
   return {ok:true};
  });
 }finally{
  full?.bytes.fill(0);
  if(entry.enrichment===controller)entry.enrichment=null;
 }
}

/** In-memory, local native editing sessions. No networking occurs here; opt-in
 * diagnostics emit content-free stage timings only.
 * path is native-open/native-insert-open/poll/read/complete/cancel, optionally prefixed /api/.
 * Native, PDF and insertion DOCX payloads use canonical standard base64, at most 16 MiB each.
 * PDF validation checks its header, not the full document structure.
 * Optional session on ticket operations must match the original uint64 string.
 * A final poll consumes complete/cancelled state once and clears owned buffers.
 * Existing-formula edits stage/replace only Equation Native; insertion sessions
 * return one checked DOCX fragment for the native Word core to insert at its live range.
 */
export async function nativeSessionOperation(path,body){
 const operation=typeof path==='string'?path.replace(/^\/api\//,''):path;body=request(operation,body);
 if(operation==='native-enrich')return enrichDocument(body);
 const receivedAt=performance.now();
 return serial(async()=>{
  if(operation==='native-open'||operation==='native-insert-open')timing({phase:'open-queue',operation,queueMs:performance.now()-receivedAt});
  await expire();
  if(operation==='native-status'||operation==='native-ack'){
   const receipt=receipts.get(body.ticket);
   if(!receipt||body.session!==undefined&&body.session!==receipt.session)throw Error('Unknown or expired native receipt');
   refreshReceipt(receipt);
   if(operation==='native-ack'){
    const hasUncertain=Object.hasOwn(body,'uncertain');
    if(body.session!==receipt.session||typeof body.ok!=='boolean'||hasUncertain&&(body.uncertain!==true||body.ok!==false))throw Error('Invalid native acknowledgement');
    if(hasUncertain){
     if(!['delivered','unconfirmed','committed','failed'].includes(receipt.state))throw Error('Invalid native acknowledgement');
     if(receipt.state==='delivered'||receipt.state==='unconfirmed'){receipt.state='unconfirmed';receipt.expires=Date.now()+TTL;}
    }else{
     if(!['delivered','unconfirmed','committed','failed'].includes(receipt.state))throw Error('Invalid native acknowledgement');
     const next=body.ok?'committed':'failed';
     if(['committed','failed'].includes(receipt.state)&&receipt.state!==next)throw Error('Conflicting native acknowledgement');
     receipt.state=next;receipt.expires=Date.now()+TTL;
    }
   }
   return {state:receipt.state,...operation==='native-status'&&receipt.state==='committed'&&receipt.change?{change:receipt.change}:{}};
  }
  if(operation==='native-open'||operation==='native-insert-open'){
   if(sessions.size>=MAX_SESSIONS)throw Error('Too many native editing sessions');
   if([...sessions.values()].some(entry=>entry.session===body.session))throw Error('Native session already exists');
   const insertion=operation==='native-insert-open';
   if(insertion&&body.acknowledgement!==true)throw Error('Insertion sessions require native acknowledgement');
   if(!insertion&&body.acknowledgement!==undefined&&body.acknowledgement!==true)throw Error('Invalid native acknowledgement capability');
   if(!insertion&&body.numberingSupport!==undefined&&body.numberingSupport!==true)throw Error('Invalid native numbering capability');
   if(body.numberingContextSupport!==undefined&&(body.numberingContextSupport!==true||!insertion&&!body.numberingSupport))throw Error('Invalid native numbering context capability');
   if(body.acknowledgement&&receipts.size>=64)throw Error('Too many native receipts');
   let native,document,layout;
   try{
    if(insertion){
     if(!body.document)throw Error('Insertion sessions require a Word document snapshot');
     if(body.document.identity===undefined||body.document.snapshot===undefined)throw Error('Insertion sessions require a Word document identity and snapshot');
     layout=insertionLayout(body.layout);
     const seed=makeNewOle('x');try{native=inspectOle(seed).native;}finally{seed.fill(0);}
     document=await documentContext(body.document,native,true);
     if(!document)throw Error('Insertion sessions require a Word document snapshot');
    }else{
     native=nativeBlob(body.native);
     document=await documentContext(body.document,native);
    }
   }catch(error){native?.fill(0);throw error;}
   let ticket;
   do{ticket=randomBytes(32).toString('hex');}while(sessions.has(ticket));
   const entry={ticket,session:body.session,document,layout,insertion,numberingSupport:body.numberingSupport===true,numberingContextSupport:body.numberingContextSupport===true,acknowledgement:body.acknowledgement===true,native,result:null,state:'editing',expires:Date.now()+TTL,directory:null,path:null,timer:null};
   sessions.set(ticket,entry);arm(entry);
   return {ticket,editorUrl:'equationlab://word-edit/'+ticket,documentContext:contextStatus(document)};
  }
  const entry=current(body);
  if(operation==='native-cancel'&&entry.insertion&&entry.state==='complete')throw Error('Cannot cancel a completed Word insertion before host acknowledgement');
  if(operation==='native-poll'){
   if(entry.state==='editing')return {state:'editing',...entry.documentRequested?{loadDocument:true}:{}};
   const result=entry.state==='complete'?{state:'complete',native:entry.result.native.toString('base64'),pdf:entry.result.pdf.toString('base64'),width:entry.result.width,height:entry.result.height,...entry.insertion?{docx:entry.result.docx.toString('base64'),insertionMode:entry.result.insertionMode,insertionNumberFormat:entry.result.insertionNumberFormat}:{},...entry.result.target?{target:entry.result.target}:{},...entry.result.numbering?{numbering:entry.result.numbering}:{}}:entry.state==='navigate'?{state:'navigate',index:entry.navigateIndex}:{state:'cancelled'};
   await discard(entry);
   const receipt=receipts.get(body.ticket);
   if(receipt?.state==='queued'){receipt.state='delivered';receipt.deliveredAt=Date.now();}
   return result;
  }
  editing(entry);
  if(operation==='native-enrich-request'){
   if(entry.document?.partial&&entry.document.loadState==='pending')entry.documentRequested=true;
   return {state:entry.document?.loadState??'missing'};
  }
  if(operation==='native-read'){
   const path=await stage(entry);
   if(entry.expires<=Date.now()){await expireEntry(entry);throw Error('Unknown or expired native session');}
   const snapshot=entry.document;
   const catalogProof=snapshot?.scope==='selection'&&snapshot.count>1&&Number.isSafeInteger(snapshot.snapshot)&&snapshot.snapshot<=0x7fffffff
    ?wordCatalogProof(snapshot.identity,snapshot.snapshot,snapshot.count,entry.expires):null;
   return {native:entry.native.toString('base64'),session:entry.session,ticket:entry.ticket,path,documentContext:contextStatus(snapshot),...catalogProof?{catalogProof}:{},...snapshot?{document:{path:snapshot.path,index:snapshot.index,name:snapshot.name,identity:snapshot.identity,snapshot:snapshot.snapshot,...snapshot.numberingRevision!==undefined?{numberingRevision:snapshot.numberingRevision}:{},...snapshot.mainStoryOnly?{mainStoryOnly:true}:{},...snapshot.partial?{scope:snapshot.scope,position:snapshot.position,count:snapshot.count}:{}}}:{},...entry.insertion?{insertion:true,layout:{...entry.layout}}:{},...entry.numberingSupport?{numberingSupport:true}:{},...entry.numberingContextSupport?{numberingContextSupport:true}:{},...entry.acknowledgement?{acknowledgement:true}:{}};
  }
  if(operation==='native-navigate'){
   if(entry.insertion||!entry.document||entry.document.partial||!Number.isInteger(body.index)||body.index<0||body.index>=entry.document.count||body.index===entry.document.index)throw Error('Invalid Word navigation target');
   entry.navigateIndex=body.index;await removeStage(entry);wipe(entry);entry.state='navigate';return {ok:true};
  }
  if(operation==='native-cancel'){
   await removeStage(entry);stopEnrichment(entry);entry.native.fill(0);entry.native=null;entry.state='cancelled';
   return {ok:true,state:'cancelled'};
  }
  let native,pdf,docx,insertionMode,insertionNumberFormat=null;
  try{
   const width=extent(body.width),height=extent(body.height);
   if(entry.insertion){
    if(body.target!==undefined)throw Error('Insertion completion cannot target an existing equation');
    if(body.docx===undefined)throw Error('Insertion completion requires a DOCX fragment');
   }else if(body.docx!==undefined)throw Error('DOCX fragments are only valid for insertion sessions');
   const target=entry.insertion?null:saveTarget(body.target,entry.document);
   const numbering=saveNumbering(body.numbering,target,entry);
   native=nativeBlob(body.native);pdf=pdfBlob(body.pdf);
   if(entry.insertion){
    docx=blob(body.docx);
    const fragment=await inspectDocx(docx),equations=fragment.objects;
    try{
     if(equations.length!==1||equations[0].mainDocument!==true||equations[0].parseError)throw Error('Insertion DOCX must contain exactly one valid equation');
     insertionMode=equations[0].layout.mode;
     if(!['inline','display','numbered-left','numbered-right'].includes(insertionMode))throw Error('Insertion DOCX has an invalid layout');
     if(insertionMode.startsWith('numbered-')){
      insertionNumberFormat=equations[0].layout.numberFormat;
      previewNumberFormat(insertionNumberFormat,{chapter:1,section:1,equation:1});
     }
     const equationNative=inspectOle(equations[0].ole).native;
     try{if(!equationNative.equals(native))throw Error('Insertion DOCX equation does not match submitted native data');}finally{equationNative.fill(0);}
    }finally{for(const equation of equations)equation.ole.fill(0);}
   }
   await removeStage(entry);
   if(entry.expires<=Date.now()){await expireEntry(entry);throw Error('Unknown or expired native session');}
   const document=entry.document;
   const change=!entry.insertion&&document?.identity&&document.snapshot!=null&&!document.partial?{
    documentIdentity:document.identity,documentSnapshot:document.snapshot,index:target?.index??document.position,
    previousNativeSha256:target?.expectedNativeSha256??createHash('sha256').update(entry.native).digest('hex'),
    nativeSha256:createHash('sha256').update(native).digest('hex'),numberingChanged:!!numbering
   }:null;
   stopEnrichment(entry);entry.native.fill(0);entry.native=null;entry.result={native,pdf,width,height,target,numbering,docx,insertionMode,insertionNumberFormat};entry.state='complete';
   // Keep an unresolved acknowledgement until Word reports a terminal result.
   if(entry.acknowledgement)receipts.set(entry.ticket,{session:entry.session,state:'queued',deliveredAt:null,expires:null,change});
   native=null;pdf=null;docx=null;return {ok:true,checked:true,state:'complete'};
  }finally{native?.fill(0);pdf?.fill(0);docx?.fill(0);}
 });
}
