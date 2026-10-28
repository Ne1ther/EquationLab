import {randomBytes} from 'node:crypto';
import {previewNumberFormat} from './layout.mjs';

const terminalStates=new Set(['opened','empty','no-document','failed','cancelled','superseded','expired']);
const outcomes=new Set(['opened','empty','no-document','failed','cancelled']);
const idPattern=/^[0-9a-f]{64}$/;
const retiredHostLimit=64;
const retiredHostLifetimeMs=10*60_000;
const workspaceHeartbeatMs=45_000;

function protocolError(message,status=400){
 const error=new Error(message);error.statusCode=status;return error;
}

function isRecord(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}

function validDocumentIdentity(value,label='document identity'){
 if(typeof value!=='string'||value.length<3||value.length>256||!value.includes(':'))throw protocolError(`Invalid ${label}`);
 return value;
}
function copyWorkspace(body){
 if(!isRecord(body)||!Object.hasOwn(body,'hostId')||!Object.hasOwn(body,'active')||Object.keys(body).some(key=>!['hostId','active','documents','retiredIdentities','insertionRequestSupport'].includes(key)))throw protocolError('Expected {hostId,active[,documents,retiredIdentities]}');
 if(body.insertionRequestSupport!==undefined&&typeof body.insertionRequestSupport!=='boolean')throw protocolError('Invalid insertion request capability');
 const hostId=requireHostId(body.hostId);
 let activeValue=null;
 if(body.active!==null){
  const active=body.active;
  if(!isRecord(active)||Object.keys(active).length!==2||!Object.hasOwn(active,'identity')||!Object.hasOwn(active,'name'))throw protocolError('Invalid active document metadata');
  validDocumentIdentity(active.identity,'active document identity');
  if(typeof active.name!=='string'||Array.from(active.name).length>512||Buffer.byteLength(active.name,'utf8')>2048||/[\u0000-\u001f\u007f-\u009f]/.test(active.name))throw protocolError('Invalid active document name');
  activeValue={identity:active.identity,name:active.name};
 }
 let documents=null;
 if(Object.hasOwn(body,'documents')){
  if(!Array.isArray(body.documents)||body.documents.length>128)throw protocolError('Invalid workspace documents');
  const seen=new Set();documents=body.documents.map(document=>{
   if(!isRecord(document)||Object.keys(document).some(key=>!['identity','name','readOnly','numberFormat','numberingRevision'].includes(key))||!Object.hasOwn(document,'identity')||!Object.hasOwn(document,'name')||!Object.hasOwn(document,'readOnly'))throw protocolError('Invalid workspace document metadata');
   validDocumentIdentity(document.identity);
   if(seen.has(document.identity))throw protocolError('Duplicate workspace document identity');seen.add(document.identity);
   if(typeof document.name!=='string'||Array.from(document.name).length>512||Buffer.byteLength(document.name,'utf8')>2048||/[\u0000-\u001f\u007f-\u009f]/.test(document.name))throw protocolError('Invalid workspace document name');
   if(typeof document.readOnly!=='boolean')throw protocolError('Invalid workspace document readOnly flag');
   if(document.numberFormat!==undefined){try{previewNumberFormat(document.numberFormat);}catch{throw protocolError('Invalid workspace number format');}}
   if(document.numberingRevision!==undefined&&(!Number.isSafeInteger(document.numberingRevision)||document.numberingRevision<0||document.numberingRevision>2147483646))throw protocolError('Invalid numbering revision');
   return {identity:document.identity,name:document.name,readOnly:document.readOnly,...document.numberFormat!==undefined?{numberFormat:document.numberFormat}:{},...document.numberingRevision!==undefined?{numberingRevision:document.numberingRevision}:{}};
  });
  if(activeValue&&!documents.some(document=>document.identity===activeValue.identity&&document.name===activeValue.name))throw protocolError('Active document must match workspace metadata');
 }
 let retiredIdentities=null;
 if(Object.hasOwn(body,'retiredIdentities')){
  if(!Array.isArray(body.retiredIdentities)||body.retiredIdentities.length>128)throw protocolError('Invalid retired document identities');
  const unique=new Set();
  for(const identity of body.retiredIdentities){validDocumentIdentity(identity);if(unique.has(identity))throw protocolError('Duplicate retired document identity');unique.add(identity);}
  retiredIdentities=[...unique];
 }
 return {hostId,active:activeValue,documents,retiredIdentities,insertionRequestSupport:body.insertionRequestSupport===true};
}

function requireHostId(value){if(typeof value!=='string'||!idPattern.test(value))throw protocolError('Invalid host id');return value;}

function copyRequest(body){
 if(!isRecord(body))throw protocolError('JSON object required');
 if(Object.hasOwn(body,'insertionMode')){
  const {insertionMode,...destination}=body;
  if(!['inline','display','numbered-left','numbered-right'].includes(insertionMode))throw protocolError('Invalid insertion mode');
  const request=copyRequest(destination);
  if(!request.target&&!request.documentIdentity)throw protocolError('Insertion requires an explicit Word destination');
  return {...request,insertionMode};
 }
 const keys=Object.keys(body);
 if(keys.length===0)return {target:null,documentIdentity:null};
 if(keys.length===1&&keys[0]==='documentIdentity')return {target:null,documentIdentity:validDocumentIdentity(body.documentIdentity,'document identity')};
 if(keys.length!==1||keys[0]!=='target'||!isRecord(body.target))throw protocolError('Expected {}, {documentIdentity}, or {target}');
 const target=body.target;
 if(Object.keys(target).length!==4||!Object.hasOwn(target,'identity')||!Object.hasOwn(target,'snapshot')||!Object.hasOwn(target,'index')||!Object.hasOwn(target,'nativeSha256'))throw protocolError('Invalid document target');
 validDocumentIdentity(target.identity,'target identity');
 if(!Number.isSafeInteger(target.snapshot)||target.snapshot<1||target.snapshot>0x7fffffff)throw protocolError('Invalid target snapshot');
 if(!Number.isSafeInteger(target.index)||target.index<0||target.index>10000)throw protocolError('Invalid target index');
 if(typeof target.nativeSha256!=='string'||!/^[0-9a-f]{64}$/.test(target.nativeSha256))throw protocolError('Invalid target native SHA-256');
 return {target:Object.freeze({identity:target.identity,snapshot:target.snapshot,index:target.index,nativeSha256:target.nativeSha256}),documentIdentity:null};
}

export function createWordDocumentRequests({now=Date.now,makeId=()=>randomBytes(32).toString('hex'),ttlMs=60_000,recordLimit=128,maxWaiters=1}={}){
 if(!Number.isSafeInteger(ttlMs)||ttlMs<1000)throw new TypeError('ttlMs must be at least 1000');
 if(!Number.isSafeInteger(recordLimit)||recordLimit<4)throw new TypeError('recordLimit must be at least 4');
 if(maxWaiters!==1)throw new TypeError('the native document protocol supports exactly one long-poll waiter');
 const records=new Map();
 const retiredHosts=new Map();
 let activeId=null,hostId=null,waiter=null,hostLastSeenAt=null,workspaceRevision=0,activeWorkspace=null,workspaceDocuments=[],retiredIdentities=[],insertionRequestSupport=false;

 function touchHost(id){hostId=id;hostLastSeenAt=now();}
 function setWorkspace(value,documents=null,retired=[]){
  const nextRetired=[...new Set(retired)].filter(identity=>identity!==value?.identity).sort();
  const nextDocuments=documents===null?workspaceDocuments.map(document=>({...document})):documents.map(document=>({...document}));
  const same=JSON.stringify(activeWorkspace)===JSON.stringify(value)&&JSON.stringify(workspaceDocuments)===JSON.stringify(nextDocuments)&&JSON.stringify(retiredIdentities)===JSON.stringify(nextRetired);
  if(same)return false;
  activeWorkspace=value?{identity:value.identity,name:value.name}:null;workspaceDocuments=nextDocuments;retiredIdentities=nextRetired;workspaceRevision++;return true;
 }
 function expireWorkspace(){
  if(hostId&&hostLastSeenAt!==null&&now()-hostLastSeenAt>=workspaceHeartbeatMs)setWorkspace(null,[]);
 }
 function workspaceStatus(){
  expireWorkspace();
  const connected=!!hostId&&hostLastSeenAt!==null&&now()-hostLastSeenAt<workspaceHeartbeatMs;
  return {connected,revision:workspaceRevision,active:connected&&activeWorkspace?{...activeWorkspace}:null,documents:connected?workspaceDocuments.map(document=>({...document})):[],retiredIdentities:connected?[...retiredIdentities]:[],...connected&&insertionRequestSupport?{insertionRequestSupport:true}:{}};
 }
 function publishWorkspace(body){
  const update=copyWorkspace(body);trimRetiredHosts();expireWorkspace();
  if(!hostId||hostId!==update.hostId||retiredHosts.has(update.hostId))throw protocolError('Workspace publisher is not the current native host',409);
  touchHost(update.hostId);
  if(insertionRequestSupport!==update.insertionRequestSupport){insertionRequestSupport=update.insertionRequestSupport;workspaceRevision++;}
  const retirements=update.retiredIdentities??retiredIdentities;
  setWorkspace(update.active,update.documents,retirements);
  return workspaceStatus();
 }
 function readWorkspaceStatus(body){
  if(!isRecord(body)||Object.keys(body).length!==0)throw protocolError('Expected {}');
  return workspaceStatus();
 }

 function terminal(record,state,reason){
  if(!record||terminalStates.has(record.state))return record?.state??state;
  record.state=state;record.reason=reason||undefined;record.finishedAt=now();
  if(activeId===record.requestId)activeId=null;
  return state;
 }
 function trim(){
  const cutoff=now()-Math.max(ttlMs*2,120_000);
  for(const [id,record] of records){
   if(terminalStates.has(record.state)&&record.finishedAt<cutoff)records.delete(id);
  }
  while(records.size>recordLimit){
   const first=records.keys().next().value;
   if(first===activeId)break;
   records.delete(first);
  }
 }
 function deliver(){
  if(!waiter||!activeId)return false;
  const record=records.get(activeId);
  if(!record||record.state!=='queued')return false;
  const current=waiter;waiter=null;clearTimeout(current.timer);
  record.state='delivered';record.claimedBy=current.hostId;record.deliveredAt=now();
  current.resolve({state:'delivered',requestId:record.requestId,...record.target?{target:record.target}:{},...record.documentIdentity?{documentIdentity:record.documentIdentity}:{},...record.insertionMode?{insertionMode:record.insertionMode}:{}});
  return true;
 }
 function expire(){
  const time=now();
  for(const record of records.values()){
   if((record.state==='queued'||record.state==='delivered')&&record.expiresAt<=time)terminal(record,'expired','request-ttl');
  }
  trim();
 }
 function requireId(value,label){if(typeof value!=='string'||!idPattern.test(value))throw protocolError(`Invalid ${label}`);return value;}
 function trimRetiredHosts(){
  const cutoff=now()-retiredHostLifetimeMs;
  for(const [id,retiredAt] of retiredHosts)if(retiredAt<=cutoff)retiredHosts.delete(id);
 }

 function request(body){
  expire();const requestData=copyRequest(body);
  if(requestData.documentIdentity||requestData.insertionMode){
   const workspace=workspaceStatus();
   const identity=requestData.documentIdentity||requestData.target.identity,document=workspaceDocuments.find(document=>document.identity===identity);
   if(!workspace.connected||retiredIdentities.includes(identity)||!document)throw protocolError('Requested Word document is not open in the current host',409);
   if(requestData.insertionMode&&!insertionRequestSupport)throw protocolError('Update the Word add-in to insert from the App',409);
   if(requestData.insertionMode&&document.readOnly)throw protocolError('Requested Word document is read only',409);
  }
  const {target,documentIdentity,insertionMode}=requestData;
  if(records.size>=recordLimit&&!Array.from(records.values()).some(record=>terminalStates.has(record.state)))trim();
  if(records.size>=recordLimit)throw protocolError('Too many retained document requests',429);
  const previous=activeId&&records.get(activeId);
  if(previous)terminal(previous,'superseded','new-request');
  let requestId;
  for(let attempt=0;attempt<4;attempt++){requestId=makeId();if(idPattern.test(requestId)&&!records.has(requestId))break;requestId=null;}
  if(!requestId)throw protocolError('Could not allocate request id',503);
  const record={requestId,state:'queued',target,documentIdentity,insertionMode,createdAt:now(),expiresAt:now()+ttlMs};
  records.set(requestId,record);activeId=requestId;deliver();trim();
  return {requestId,state:'queued'};
 }

 function status(body){
  expire();if(!isRecord(body))throw protocolError('JSON object required');
  const requestId=requireId(body.requestId,'request id');const record=records.get(requestId);
  if(!record)return {requestId,state:'expired',reason:'unknown-or-pruned'};
  return {requestId,state:record.state,...record.reason?{reason:record.reason}:{},...record.target?{identity:record.target.identity,index:record.target.index}:{},...record.documentIdentity?{documentIdentity:record.documentIdentity}:{}};
 }

 function take(body){
  expire();if(!isRecord(body))throw protocolError('JSON object required');
  const nextHost=requireId(body.hostId,'host id');
  const waitMs=body.waitMs;
  if(!Number.isSafeInteger(waitMs)||waitMs<0||waitMs>20_000)throw protocolError('waitMs must be an integer from 0 through 20000');
  trimRetiredHosts();
  expireWorkspace();
  if(retiredHosts.has(nextHost))throw protocolError('This native host instance has been retired',409);
  if(hostId!==nextHost){
   if(hostId&&retiredHosts.size>=retiredHostLimit)throw protocolError('Too many recent native host restarts',429);
   if(hostId)retiredHosts.set(hostId,now());
   if(waiter){const prior=waiter;waiter=null;clearTimeout(prior.timer);prior.resolve({state:'empty',reason:'host-restarted'});}
   const claimed=activeId&&records.get(activeId);
   if(claimed?.state==='delivered'&&claimed.claimedBy!==nextHost)terminal(claimed,'failed','host-restarted');
   touchHost(nextHost);insertionRequestSupport=false;setWorkspace(null,[]);
  }else{
   touchHost(nextHost);
  }
  if(waiter)throw protocolError('A native document long poll is already active',429);
  const current=activeId&&records.get(activeId);
  if(current?.state==='queued'){
   current.state='delivered';current.claimedBy=nextHost;current.deliveredAt=now();
   return Promise.resolve({state:'delivered',requestId:current.requestId,...current.target?{target:current.target}:{},...current.documentIdentity?{documentIdentity:current.documentIdentity}:{},...current.insertionMode?{insertionMode:current.insertionMode}:{}});
  }
  if(waitMs===0)return Promise.resolve({state:'empty'});
  return new Promise(resolve=>{
   const entry={hostId:nextHost,resolve,timer:null};waiter=entry;
   entry.timer=setTimeout(()=>{if(waiter===entry)waiter=null;resolve({state:'empty'});},waitMs);
   entry.timer.unref?.();
   deliver();
  });
 }

 function finish(body){
  expire();if(!isRecord(body))throw protocolError('JSON object required');
  const nextHost=requireId(body.hostId,'host id'),requestId=requireId(body.requestId,'request id');
  if(typeof body.state!=='string'||!outcomes.has(body.state))throw protocolError('Invalid terminal outcome');
  const record=records.get(requestId);if(!record)return {requestId,state:'expired',reason:'unknown-or-pruned'};
  if(terminalStates.has(record.state))return {requestId,state:record.state,...record.reason?{reason:record.reason}:{},...record.documentIdentity?{documentIdentity:record.documentIdentity}:{}};
  if(hostId!==nextHost||record.claimedBy!==nextHost||record.state!=='delivered')throw protocolError('Request is not claimed by this host',409);
  terminal(record,body.state,typeof body.reason==='string'?body.reason.slice(0,160):undefined);trim();
  return {requestId,state:record.state,...record.documentIdentity?{documentIdentity:record.documentIdentity}:{}};
 }

 function cancel(body){
  expire();if(!isRecord(body))throw protocolError('JSON object required');
  const requestId=requireId(body.requestId,'request id');const record=records.get(requestId);
  if(record&&!['cancelled','superseded','expired'].includes(record.state)){
   record.state='cancelled';record.reason='client-cancelled';record.finishedAt=now();
   if(activeId===record.requestId)activeId=null;
  }
  trim();return {requestId,state:record?.state??'cancelled'};
 }

 function handle(path,body){
  switch(path){
   case 'native-document-request': return request(body);
   case 'native-document-status': return status(body);
   case 'native-document-take': return take(body);
   case 'native-document-finish': return finish(body);
   case 'native-document-cancel': return cancel(body);
   case 'native-document-workspace': return publishWorkspace(body);
   case 'native-document-workspace-status': return readWorkspaceStatus(body);
   default: throw protocolError('Unknown document request operation',404);
  }
 }

 return {handle,request,status,take,finish,cancel};
}

export const wordDocumentRequests=createWordDocumentRequests();
