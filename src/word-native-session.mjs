import {randomBytes,createHash} from 'node:crypto';
import {mkdtemp,chmod,writeFile,rm,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import JSZip from 'jszip';
import {parseNative,wrapNative,inspectOle} from './native.mjs';
import {fromFlatOpc,inspectDocx} from './document.mjs';

const MAX_BLOB=16*1024*1024,MAX_ENCODED=4*Math.ceil(MAX_BLOB/3);
const MAX_SESSIONS=16,TTL=20*60*1000,MAX_UINT64=18446744073709551615n;
const sessions=new Map();
// Small terminal receipts contain no formula, PDF or private file path.
const receipts=new Map();
const documentSnapshots=new Map();let snapshotBytes=0;
async function snapshot(value){
 const key=createHash('sha256').update(value.ooxml).digest('hex');
 let cached=documentSnapshots.get(key);
 if(!cached){
  const bytes=await fromFlatOpc(value.ooxml);
  try{
   const {objects}=await inspectDocx(bytes);
   cached={bytes,objects:objects.map(o=>({part:o.part,error:o.parseError,nativeSha256:o.nativeSha256})),count:objects.filter(o=>o.part==='word/document.xml').length};
  }catch(error){bytes.fill(0);throw error;}
  documentSnapshots.set(key,cached);snapshotBytes+=bytes.length;
  while(documentSnapshots.size>4||snapshotBytes>32*1024*1024){const oldest=documentSnapshots.keys().next().value,item=documentSnapshots.get(oldest);documentSnapshots.delete(oldest);snapshotBytes-=item.bytes.length;if(item!==cached)item.bytes.fill(0);}
 }
 return cached;
}
let sequence=Promise.resolve(),queued=0;
const operations=new Set(['native-open','native-poll','native-read','native-complete','native-cancel','native-ack','native-status','native-navigate']);

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
 for(const key of ['document','target'])if(body[key]&&typeof body[key]==='object'&&!Array.isArray(body[key]))body[key]={...body[key]};
 const allowed=operation==='native-open'?['session','native','acknowledgement','document']:operation==='native-complete'?['ticket','session','native','pdf','width','height','target']:operation==='native-ack'?['ticket','session','ok']:operation==='native-navigate'?['ticket','index']:['ticket','session'];
 if(Object.keys(body).some(key=>!allowed.includes(key)))throw Error('Invalid native session request fields');
 if(operation==='native-open')uint64(body.session);
 else{
  if(typeof body.ticket!=='string'||!/^[a-f0-9]{64}$/.test(body.ticket))throw Error('Invalid native session ticket');
  if(body.session!==undefined)uint64(body.session);
 }
 return body;
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
function wipe(entry){
 entry.document?.bytes.fill(0);entry.document=null;
 entry.native?.fill(0);entry.result?.native.fill(0);entry.result?.pdf.fill(0);
 entry.native=null;entry.result=null;
}
async function discard(entry){
 // Keep the entry until filesystem cleanup succeeds, so a subsequent request
 // can retry instead of abandoning an untracked private staging directory.
 await removeStage(entry);clearTimeout(entry.timer);wipe(entry);sessions.delete(entry.ticket);
}
async function expireEntry(entry){
 // Expiration wipes owned payloads even if filesystem deletion must be retried.
 wipe(entry);entry.state='expired';await discard(entry);
}
async function expire(){
 for(const [ticket,receipt]of receipts)if(receipt.expires<=Date.now())receipts.delete(ticket);
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
 if(entry.path){
  const [directory,file]=await Promise.all([lstat(entry.directory),lstat(entry.path)]).catch(()=>{throw Error('Native session staging file is unavailable');});
  if(!directory.isDirectory()||directory.isSymbolicLink()||(directory.mode&0o777)!==0o700||!file.isFile()||file.isSymbolicLink()||(file.mode&0o777)!==0o600)throw Error('Native session staging file is unsafe');
  return entry.path;
 }
 const document=await sessionSource(entry.native);
 try{
  entry.directory=await mkdtemp(join(tmpdir(),'equationlab-word-native-'));
  await chmod(entry.directory,0o700);
  entry.path=join(entry.directory,'equation.docx');
  await writeFile(entry.path,document,{mode:0o600,flag:'wx'});
  if(entry.document){entry.document.path=join(entry.directory,'document.docx');await writeFile(entry.document.path,entry.document.bytes,{mode:0o600,flag:'wx'});entry.document.bytes.fill(0);}
  return entry.path;
 }catch{await removeStage(entry);throw Error('Native session staging failed');}
 finally{document.fill(0);}
}

async function documentContext(value,native){
 if(value===undefined)return null;
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['ooxml','index','name','identity','snapshot'].includes(k))||typeof value.ooxml!=='string'||value.ooxml.length>30_000_000||!Number.isInteger(value.index)||value.index<0||value.index>10000||typeof value.name!=='string'||value.name.length>512)throw Error('Invalid Word document context');
 if(value.identity!==undefined&&(typeof value.identity!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value.identity)))throw Error('Invalid Word document identity');
 if(value.snapshot!==undefined&&!(Number.isSafeInteger(value.snapshot)&&value.snapshot>0)&&!(typeof value.snapshot==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value.snapshot)))throw Error('Invalid Word document snapshot');
 const cached=await snapshot(value),selected=cached.objects[value.index];
 if(!selected||selected.part!=='word/document.xml'||selected.error||selected.nativeSha256!==createHash('sha256').update(native).digest('hex'))throw Error('Word document context does not match the activated equation');
 return {bytes:Buffer.from(cached.bytes),objects:cached.objects,index:value.index,name:value.name,count:cached.count,identity:value.identity??null,snapshot:value.snapshot??null,path:null};
}

// This status is deliberately limited to protocol state and counters. It has no
// document title, path, formula bytes or ticket and can be retained in QA logs.
function contextStatus(document){
 return document?{state:'available',reason:document.identity?'captured':'legacy-capture',identity:document.identity,snapshot:document.snapshot,count:document.count,index:document.index}:{state:'missing',reason:'not-captured',identity:null,snapshot:null,count:0,index:null};
}
function saveTarget(value,document){
 if(value===undefined)return null;
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['index','expectedNativeSha256','documentIdentity'].includes(k))||!Number.isInteger(value.index)||value.index<0||typeof value.expectedNativeSha256!=='string'||!/^[a-f0-9]{64}$/.test(value.expectedNativeSha256)||typeof value.documentIdentity!=='string')throw Error('Invalid Word save target');
 if(!document?.identity||value.documentIdentity!==document.identity)throw Error('Word save target document does not match the editing session');
 const selected=document.objects[value.index];
 if(value.index>=document.count||!selected||selected.part!=='word/document.xml'||selected.error||selected.nativeSha256!==value.expectedNativeSha256)throw Error('Word save target equation does not match the document snapshot');
 return {index:value.index,expectedNativeSha256:value.expectedNativeSha256,documentIdentity:document.identity};
}

/** In-memory, local native editing sessions. No networking or logging occurs.
 * path is native-open/poll/read/complete/cancel, optionally prefixed /api/.
 * Native and PDF payloads use canonical standard base64, at most 16 MiB each.
 * PDF validation checks its header, not the full document structure.
 * Optional session on ticket operations must match the original uint64 string.
 * A final poll consumes complete/cancelled state once and clears owned buffers.
 * Only Equation Native is staged/replaced; the native Word core is responsible
 * for preserving the source object's other storage streams during its commit.
 */
export async function nativeSessionOperation(path,body){
 const operation=typeof path==='string'?path.replace(/^\/api\//,''):path;body=request(operation,body);
 return serial(async()=>{
  await expire();
  if(operation==='native-status'||operation==='native-ack'){
   const receipt=receipts.get(body.ticket);
   if(!receipt||body.session!==undefined&&body.session!==receipt.session)throw Error('Unknown or expired native receipt');
   if(operation==='native-ack'){
    if(body.session!==receipt.session||typeof body.ok!=='boolean'||!['delivered','committed','failed'].includes(receipt.state))throw Error('Invalid native acknowledgement');
    const next=body.ok?'committed':'failed';
    if(receipt.state!=='delivered'&&receipt.state!==next)throw Error('Conflicting native acknowledgement');
    receipt.state=next;
   }
   return {state:receipt.state};
  }
  if(operation==='native-open'){
   if(sessions.size>=MAX_SESSIONS)throw Error('Too many native editing sessions');
   if([...sessions.values()].some(entry=>entry.session===body.session))throw Error('Native session already exists');
   if(body.acknowledgement!==undefined&&body.acknowledgement!==true)throw Error('Invalid native acknowledgement capability');
   if(body.acknowledgement&&receipts.size>=64)throw Error('Too many native receipts');
   const native=nativeBlob(body.native);let document;try{document=await documentContext(body.document,native);}catch(error){native.fill(0);throw error;}let ticket;
   do{ticket=randomBytes(32).toString('hex');}while(sessions.has(ticket));
   const entry={ticket,session:body.session,document,acknowledgement:body.acknowledgement===true,native,result:null,state:'editing',expires:Date.now()+TTL,directory:null,path:null,timer:null};
   sessions.set(ticket,entry);arm(entry);
   return {ticket,editorUrl:'equationlab://word-edit/'+ticket,documentContext:contextStatus(document)};
  }
  const entry=current(body);
  if(operation==='native-poll'){
   if(entry.state==='editing')return {state:'editing'};
   const result=entry.state==='complete'?{state:'complete',native:entry.result.native.toString('base64'),pdf:entry.result.pdf.toString('base64'),width:entry.result.width,height:entry.result.height,...entry.result.target?{target:entry.result.target}:{}}:entry.state==='navigate'?{state:'navigate',index:entry.navigateIndex}:{state:'cancelled'};
   await discard(entry);if(receipts.has(body.ticket))receipts.get(body.ticket).state='delivered';return result;
  }
  editing(entry);
  if(operation==='native-read'){
   const path=await stage(entry);
   if(entry.expires<=Date.now()){await expireEntry(entry);throw Error('Unknown or expired native session');}
   return {native:entry.native.toString('base64'),session:entry.session,ticket:entry.ticket,path,documentContext:contextStatus(entry.document),...entry.document?{document:{path:entry.document.path,index:entry.document.index,name:entry.document.name,identity:entry.document.identity,snapshot:entry.document.snapshot}}:{},...entry.acknowledgement?{acknowledgement:true}:{}};
  }
  if(operation==='native-navigate'){
   if(!entry.document||!Number.isInteger(body.index)||body.index<0||body.index>=entry.document.count||body.index===entry.document.index)throw Error('Invalid Word navigation target');
   entry.navigateIndex=body.index;await removeStage(entry);wipe(entry);entry.state='navigate';return {ok:true};
  }
  if(operation==='native-cancel'){
   await removeStage(entry);entry.native.fill(0);entry.native=null;entry.state='cancelled';
   return {ok:true,state:'cancelled'};
  }
  let native,pdf;
  try{
   const width=extent(body.width),height=extent(body.height),target=saveTarget(body.target,entry.document);
   native=nativeBlob(body.native);pdf=pdfBlob(body.pdf);
   await removeStage(entry);
   if(entry.expires<=Date.now()){await expireEntry(entry);throw Error('Unknown or expired native session');}
   entry.native.fill(0);entry.native=null;entry.result={native,pdf,width,height,target};entry.state='complete';
   if(entry.acknowledgement)receipts.set(entry.ticket,{session:entry.session,state:'queued',expires:Date.now()+60000});
   native=null;pdf=null;return {ok:true,checked:true,state:'complete'};
  }finally{native?.fill(0);pdf?.fill(0);}
 });
}
