import {parentPort,workerData} from 'node:worker_threads';
import {inflateRaw} from 'node:zlib';
import {promisify} from 'node:util';
import {performance} from 'node:perf_hooks';
import {inspectDocx,MAX_FLAT_OPC_BYTES} from './document.mjs';
import {combineWordSnapshotParts} from './word-snapshot-parts.mjs';

const inflate=promisify(inflateRaw);

async function readParts(encoded){
 const packed=Buffer.from(encoded,'base64');
 let expanded;
 try{
  if(!packed.length||packed.length>34_000_000||packed.toString('base64')!==encoded)throw Error('Invalid compressed Word document context');
  let json;
  try{
   expanded=await inflate(packed,{maxOutputLength:MAX_FLAT_OPC_BYTES});
   json=new TextDecoder('utf-8',{fatal:true}).decode(expanded);
  }catch{throw Error('Invalid or oversized compressed Word document context');}
  try{return JSON.parse(json);}catch{throw Error('Invalid Word snapshot parts');}
 }finally{packed.fill(0);expanded?.fill(0);}
}

async function build(){
 const parts=await readParts(workerData);
 const started=performance.now();
 const bytes=await combineWordSnapshotParts(parts);
 const inspectStarted=performance.now();
 try{
  const {objects}=await inspectDocx(bytes,{nativeIndexOnly:true});
  const index=objects.map(({part,mainDocument,parseError,nativeSha256})=>({part,mainDocument:mainDocument===true,error:parseError,nativeSha256}));
  const buffer=Buffer.allocUnsafeSlow(bytes.length);
  bytes.copy(buffer);
  parentPort.postMessage({bytes:buffer,objects:index,count:index.filter(row=>row.mainDocument).length,conversionMs:inspectStarted-started,inspectMs:performance.now()-inspectStarted},[buffer.buffer]);
 }finally{bytes.fill(0);}
}

await build().catch(error=>parentPort.postMessage({error:error.message}));
