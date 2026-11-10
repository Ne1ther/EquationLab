import {createHash} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';

const OBJECT_FIELDS=['index','path','part','mainDocument','progId','ole','latex','previewError','parseError','layout','typography','typographyError','ruler','nativeSha256','characters','application','imagePath'];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const identity=info=>[info.dev,info.ino,info.size,info.mtimeNs,info.ctimeNs].join(':');
const fileIdentity=async path=>identity(await stat(path,{bigint:true}));

// Copy only data, never nodes, ZIP objects or references to their backing buffers.
function copyData(value){
 if(value===null||value===undefined||typeof value==='string'||typeof value==='boolean'||typeof value==='number')return value;
 if(Buffer.isBuffer(value))return Buffer.from(value);
 if(Array.isArray(value))return value.map(copyData);
 if(typeof value==='object'&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null)){
  return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,copyData(item)]));
 }
 throw Error('Document snapshot contains unsupported data');
}

export function projectDocumentSnapshot(document,typographyPreset){
 return {
  objects:document.objects.map(object=>Object.fromEntries(OBJECT_FIELDS.filter(key=>object[key]!==undefined).map(key=>[key,copyData(object[key])]))),
  numberFormat:copyData(document.numberFormat),numberingRevision:copyData(document.numberingRevision),
  typographyPreset:copyData(typographyPreset),
 };
}

// This is an accounting estimate for retained data, not a V8 heap measurement.
// Includes approximate per-object/array/key overhead and UTF-16 string storage.
export function estimateSnapshotBytes(value){
 if(value===null||value===undefined)return 0;
 if(Buffer.isBuffer(value))return 64+value.length;
 if(typeof value==='string')return 16+2*value.length;
 if(typeof value==='number'||typeof value==='boolean')return 8;
 if(Array.isArray(value))return 32+value.reduce((sum,item)=>sum+8+estimateSnapshotBytes(item),0);
 if(typeof value==='object')return 48+Object.entries(value).reduce((sum,[key,item])=>sum+16+estimateSnapshotBytes(key)+estimateSnapshotBytes(item),0);
 throw Error('Cannot account for snapshot data');
}

// inspect(bytes) returns inspectDocx's result; readTypographyPreset receives it.
// extractPreviews(bytes, paths) returns caller-defined previews and must not retain bytes.
export function createDocumentSnapshotCache({inspect,readTypographyPreset=async()=>null,extractPreviews,maxBytes=64*1024*1024,maxEntries=4,maxFiles=32,maxPreviewBytes=8*1024*1024,maxPreviewEntries=128}={}){
 if(typeof inspect!=='function')throw TypeError('inspect is required');
 if([maxBytes,maxEntries,maxFiles,maxPreviewBytes,maxPreviewEntries].some(value=>!Number.isSafeInteger(value)||value<0))throw TypeError('Invalid cache limits');
 const entries=new Map(),files=new Map(),pendingPaths=new Map(),pendingContent=new Map(),previews=new Map();
 let retainedBytes=0,hits=0,misses=0,previewRetainedBytes=0,previewHits=0,previewMisses=0;
 const touch=(key,entry)=>{entries.delete(key);entries.set(key,entry);};
 const rememberFile=(path,id,key)=>{
  files.delete(path);files.set(path,{id,key});
  while(files.size>maxFiles)files.delete(files.keys().next().value);
 };
 const evict=()=>{
  while(entries.size>maxEntries||retainedBytes>maxBytes){const key=entries.keys().next().value;retainedBytes-=entries.get(key).size;entries.delete(key);}
 };
 async function readStable(path,id){
  const bytes=await readFile(path);
  if(await fileIdentity(path)!==id)throw Error('Document changed while reading');
  return bytes;
 }
 async function parse(bytes,key){
  let entry=entries.get(key);
  if(entry){hits++;touch(key,entry);return entry.document;}
  let promise=pendingContent.get(key);
  if(!promise){
   misses++;
   promise=(async()=>{
    const inspected=await inspect(bytes);
    let preset;try{preset=await readTypographyPreset(inspected);}catch{preset=null;}
    const document=projectDocumentSnapshot(inspected,preset),size=estimateSnapshotBytes(document);
    if(size<=maxBytes&&maxEntries>0){entry={document,size};entries.set(key,entry);retainedBytes+=size;evict();}
    return document;
   })();
   pendingContent.set(key,promise);
   promise.finally(()=>{if(pendingContent.get(key)===promise)pendingContent.delete(key);}).catch(()=>{});
  }
  const document=await promise;
  entry=entries.get(key);if(entry)touch(key,entry);
  return document;
 }
 async function get(path){
  const id=await fileIdentity(path),previous=files.get(path);
  if(previous?.id===id){
   const entry=entries.get(previous.key);
   if(entry){hits++;touch(previous.key,entry);rememberFile(path,id,previous.key);return {document:entry.document,contentHash:previous.key};}
  }
  const inflightKey=JSON.stringify([path,id]);
  let promise=pendingPaths.get(inflightKey);
  if(!promise){
   promise=(async()=>{
    const bytes=await readStable(path,id),key=digest(bytes),document=await parse(bytes,key);
    if(await fileIdentity(path)!==id)throw Error('Document changed while inspecting');
    rememberFile(path,id,key);
    return {document,contentHash:key};
   })();
   pendingPaths.set(inflightKey,promise);
   promise.finally(()=>{if(pendingPaths.get(inflightKey)===promise)pendingPaths.delete(inflightKey);}).catch(()=>{});
  }
  return promise;
 }
 // Ordered paths form the key: extractors may return positional results, and
 // changing order or removing duplicates would change the caller's contract.
 const previewKey=(hash,paths)=>typeof hash==='string'&&paths.every(path=>typeof path==='string')?JSON.stringify([hash,paths]):null;
 const previewHit=key=>{
  const entry=key===null?undefined:previews.get(key);
  if(!entry)return null;
  previews.delete(key);previews.set(key,entry);previewHits++;
  return {value:copyData(entry.value)};
 };
 const rememberPreview=(key,value)=>{
  if(key===null||maxPreviewEntries===0)return;
  let copy,size;
  // Unknown/custom return types retain their original contract and simply do
  // not enter this cache. Only independently copyable data can be retained.
  try{copy=copyData(value);size=estimateSnapshotBytes(key)+estimateSnapshotBytes(copy);}catch{return;}
  if(size>maxPreviewBytes)return;
  const old=previews.get(key);if(old){previewRetainedBytes-=old.size;previews.delete(key);}
  previews.set(key,{value:copy,size});previewRetainedBytes+=size;
  while(previews.size>maxPreviewEntries||previewRetainedBytes>maxPreviewBytes){const first=previews.keys().next().value;previewRetainedBytes-=previews.get(first).size;previews.delete(first);}
 };
 async function getStoredPreviews(path,contentHash,imagePaths){
  if(typeof extractPreviews!=='function')throw Error('Preview extraction is unavailable');
  if(!Array.isArray(imagePaths))throw TypeError('imagePaths must be an array');
  const paths=imagePaths.slice();
  const id=await fileIdentity(path),key=previewKey(contentHash,paths),known=files.get(path);
  // Cached results are usable only when this exact path identity was already
  // bound to the content hash by a stable, hashed read.
  if(known?.id===id&&known.key===contentHash){const cached=previewHit(key);if(cached)return cached.value;}
  const bytes=await readStable(path,id);
  if(digest(bytes)!==contentHash)throw Error('Document changed before reading previews');
  rememberFile(path,id,contentHash);
  // A new path may contain identical bytes and safely reuse an existing batch.
  const cached=previewHit(key);if(cached)return cached.value;
  previewMisses++;
  const result=await extractPreviews(bytes,paths);
  if(await fileIdentity(path)!==id)throw Error('Document changed while reading previews');
  rememberPreview(key,result);
  return result;
 }
 return {get,getStoredPreviews,stats:()=>({entries:entries.size,files:files.size,retainedBytes,hits,misses,pendingPaths:pendingPaths.size,pendingContent:pendingContent.size,previewEntries:previews.size,previewRetainedBytes,previewHits,previewMisses})};
}
