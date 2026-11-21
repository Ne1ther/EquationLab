import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const code=await readFile(new URL('../desktop/word-document-workspace.js',import.meta.url),'utf8');
const requestId='a'.repeat(64),ticket='b'.repeat(64),digest='c'.repeat(64);
const document=()=>({hasDocumentContext:true,documentIdentity:'word:1:2',documentSnapshot:17,documentName:'测试.docx',path:'/expired/snapshot.docx',activePath:'/expired/owner.docx',wordTicket:ticket,insertion:true,objects:[{index:0,latex:'x+1',nativeSha256:digest},{index:1,latex:'y+2',nativeSha256:'d'.repeat(64)}]});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function setup(){
 const context=vm.createContext({window:{}});vm.runInContext(code,context);const calls=[],messages=[];let discard=false,behavior=null;
 const state={source:null,wordTicket:null,busy:false,outcomeUnknown:false,draftChanged:false};
 const api={state:()=>state,changed(){},message:(text,error)=>messages.push({text,error}),now:()=>0,pause:()=>new Promise(()=>{}),detach:async(options)=>{calls.push({action:'detach',options});state.wordTicket=null;state.source=null;return true;},native:async(action,payload)=>{
  calls.push({action,payload});if(behavior){const result=await behavior(action,payload);if(result!==undefined)return result;}
  if(action==='confirmWordSessionSwitch')return {discard};if(action==='wordDocumentOpen')return {requestId,state:'queued'};if(action==='wordDocumentStatus')return {state:'queued'};return {};
 }};
 const workspace=context.window.createWordDocumentWorkspace(api);return {workspace,api,state,calls,messages,discard:()=>{discard=true;},behavior:fn=>{behavior=fn;}};
}

test('A loading Word directory can open a far-away row and rejects wrong or unverifiable replies',async()=>{
 for(const variant of ['correct','position','identity','digest','insertion']){
  const e=setup(),partial={...document(),insertion:false,activeIndex:0,documentPosition:1,documentLoading:true,documentTotal:112,catalogProof:'receipt',objects:[{index:0,nativeSha256:digest}]};
  e.state.source=partial;e.state.wordTicket=ticket;e.state.draftChanged=true;
  assert.equal(await e.workspace.select(79),false);
  assert.equal(e.calls.length,0,'dirty drafts block catalog navigation before detaching');
  e.state.draftChanged=false;
  assert.equal(await e.workspace.select(112),false);
  assert.equal(await e.workspace.select(1),false);
  assert.equal(await e.workspace.select(79),true);
  const request=e.calls.find(call=>call.action==='wordDocumentOpen').payload;
  assert.deepEqual({...request.catalogTarget},{identity:partial.documentIdentity,snapshot:17,index:79,count:112,proof:'receipt'});
  assert.equal(e.workspace.visibleSource(null),partial,'in-flight navigation keeps the scroll positions visible');
  assert.equal(await e.workspace.select(80),false);
  const incoming={...partial,documentSnapshot:18,documentPosition:variant==='position'?78:79,
   documentIdentity:variant==='identity'?'word:other':partial.documentIdentity,insertion:variant==='insertion',
   objects:[{index:0,nativeSha256:variant==='digest'?undefined:digest}]};
  if(variant==='correct')assert.equal(await e.workspace.prepareIncoming(incoming,requestId),true);
  else await assert.rejects(e.workspace.prepareIncoming(incoming,requestId),/不一致|已变化/);
  assert.equal(e.workspace.pending,false);
 }
});

test('Automatic metadata sync preserves an exact OLE edit without document metadata',async()=>{
 const e=setup(),owner={hasDocumentContext:false,activeIndex:0,objects:[{index:0,latex:'x',nativeSha256:digest}]};
 e.state.source=owner;e.state.wordTicket=ticket;e.workspace.accepted(owner);
 e.behavior(async action=>action==='wordWorkspaceStatus'?{connected:true,revision:5,active:{identity:'word:another',name:'B.docx'},documents:[{identity:'word:another',name:'B.docx',readOnly:false}]}:undefined);
 assert.equal(await e.workspace.syncCurrent(),false);
 assert.equal(e.state.source,owner);assert.equal(e.state.wordTicket,ticket);
 assert.equal(e.calls.some(call=>call.action==='detach'||call.action==='wordDocumentOpen'),false);
});

test('reload keeps the cached rows visible while reading an independently bound new snapshot',()=>{
 const {workspace}=setup(),cached=document();
 workspace.remember(cached);
 const partial={...cached,documentSnapshot:18,documentLoading:true,documentTotal:2,documentPosition:1,objects:[{index:0,latex:'y+2'}]};
 const presentation=workspace.visibleSource(partial);
 assert.equal(presentation.objects.length,2);
 assert.equal(presentation.numberingRefreshNeeded,true);
 assert.equal(presentation.documentLoading,true);
 assert.equal(workspace.visibleSource(partial),presentation);
 assert.equal(partial.objects.length,1);
 const other={...partial,documentIdentity:'unrelated'};
 assert.equal(workspace.visibleSource(other),other);
 const fresh={...cached,documentSnapshot:19};
 assert.equal(workspace.visibleSource(fresh),fresh);
});

test('Retrying a failed full capture reopens the current owner by its actual Word position',async()=>{
 const e=setup(),partial={...document(),insertion:false,activeIndex:0,documentPosition:2,
  documentTotal:112,documentLoadFailed:true,objects:[{index:0,nativeSha256:digest}]};
 e.state.source=partial;e.state.wordTicket=ticket;
 e.state.draftChanged=true;
 assert.equal(await e.workspace.select(0,{reload:true}),false);
 assert.equal(e.calls.length,0);
 e.state.draftChanged=false;
 assert.equal(await e.workspace.select(0,{reload:true}),true);
 assert.deepEqual({...e.calls.find(call=>call.action==='wordDocumentOpen').payload.target},
  {identity:partial.documentIdentity,snapshot:17,index:2,nativeSha256:digest});
 const wrongOwner={...partial,documentSnapshot:18,documentPosition:0};
 await assert.rejects(e.workspace.prepareIncoming(wrongOwner,requestId),/内容或位置已经变化/);
});

test('A fresh capture of the same Word document reuses only previews with matching native content',()=>{
 const {workspace}=setup(),cached=document();
 cached.objects[0].image='first preview';
 cached.objects[1].image='second preview';
 workspace.remember(cached);
 const incoming={...cached,documentSnapshot:18,objects:[{index:0,nativeSha256:'e'.repeat(64)},
  {index:1,nativeSha256:digest},{index:2,nativeSha256:cached.objects[1].nativeSha256,error:'unreadable'}]};
 workspace.remember(incoming);
 assert.equal(incoming.objects[0].image,undefined);
 assert.equal(incoming.objects[1].image,'first preview');
 assert.equal(incoming.objects[2].image,undefined);
 const other={...incoming,documentIdentity:'word:other',objects:[{index:0,nativeSha256:digest}]};
 workspace.remember(other);
 assert.equal(other.objects[0].image,undefined);
});

test('Dock reuses a confirmed content-only save and reopens the changed row by exact target',async()=>{
 const e=setup(),source={...document(),insertion:false,documentNumberingRevision:3};
 source.objects[0].image='stale thumbnail';
 source.objects[1].image='current thumbnail';
 const change={documentIdentity:source.documentIdentity,documentSnapshot:source.documentSnapshot,index:0,previousNativeSha256:digest,nativeSha256:'e'.repeat(64),numberingChanged:false};
 e.workspace.rememberAfterSave(source,0,change,'new formula',false);
 const cached=e.workspace.visibleSource(null);
 assert.equal(cached.objects[0].nativeSha256,change.nativeSha256);
 assert.equal(cached.objects[0].latex,'new formula');
 assert.equal(cached.objects[0].image,null);
 assert.equal(cached.objects[1].image,'current thumbnail');
 assert.equal(cached.numberingRefreshNeeded,false);
 assert.equal(source.objects[0].nativeSha256,digest,'retain the original editor binding');
 e.behavior(action=>action==='wordWorkspaceStatus'?{
  connected:true,active:{identity:source.documentIdentity,name:source.documentName},
  documents:[{identity:source.documentIdentity,name:source.documentName,readOnly:false,numberingRevision:3}]
 }:undefined);
 assert.equal(await e.workspace.resume(),true);
 assert.equal(e.workspace.pending,false);
 assert.equal(e.workspace.visibleSource(null),cached);
 assert.equal(e.calls.some(call=>call.action==='wordDocumentOpen'),false);
 assert.equal(await e.workspace.select(0),true);
 const target=e.calls.find(call=>call.action==='wordDocumentOpen').payload.target;
 assert.equal(target.identity,source.documentIdentity);
 assert.equal(target.snapshot,source.documentSnapshot);
 assert.equal(target.index,0);
 assert.equal(target.nativeSha256,change.nativeSha256);
 const incoming={...source,documentSnapshot:18,activeIndex:0,objects:cached.objects};
 await e.workspace.prepareIncoming(incoming,requestId);
 assert.equal(await e.workspace.select(0),true);
 const editedAgain={...incoming,objects:[{...cached.objects[0],nativeSha256:digest},cached.objects[1]]};
 await assert.rejects(e.workspace.prepareIncoming(editedAgain,requestId),/内容或位置已经变化/);
 assert.equal(e.workspace.pending,false);
 assert.equal(await e.workspace.resume(),true);
 assert.equal(e.calls.filter(call=>call.action==='wordDocumentOpen').at(-1).payload.target,undefined);
});

test('Dock still requests a fresh capture when the content acknowledgement or live metadata cannot verify the cache',async()=>{
 for(const variant of ['different identity','changed revision','missing revision','read-only','missing catalog','disconnected','stale','numbering change','insertion','unknown acknowledgement']){
  const e=setup(),source={...document(),insertion:variant==='insertion',numberingRefreshNeeded:variant==='stale',documentNumberingRevision:3};
  const change={documentIdentity:source.documentIdentity,documentSnapshot:source.documentSnapshot,index:0,previousNativeSha256:digest,nativeSha256:'e'.repeat(64),numberingChanged:variant==='numbering change'};
  e.workspace.rememberAfterSave(source,0,variant==='unknown acknowledgement'?null:change,'new formula',false);
  const identity=variant==='different identity'?'same-named-other-document':source.documentIdentity;
  const entry={identity,name:source.documentName,readOnly:variant==='read-only'};
  if(variant!=='missing revision')entry.numberingRevision=variant==='changed revision'?4:3;
  e.behavior(action=>action==='wordWorkspaceStatus'?{
   connected:variant!=='disconnected',active:{identity,name:source.documentName},documents:variant==='missing catalog'?[]:[entry]
  }:undefined);
  assert.equal(await e.workspace.resume(),true,variant);
  assert.equal(e.workspace.pending,true,variant);
  assert.equal(e.calls.filter(call=>call.action==='wordDocumentOpen').length,1,variant);
  assert.equal(e.calls.find(call=>call.action==='wordDocumentOpen').payload.target,undefined,variant);
 }
});

test('A confirmed same-side number format save keeps all 112 rows fresh and skips automatic recapture',async()=>{
 for(const [revision,published,publicationArrived] of [[3,3,false],[3,4,false],[3,4,true],[2147483646,1,false]]){
  const e=setup(),source={...document(),insertion:false,documentNumberingRevision:revision,
   objects:Array.from({length:112},(_,index)=>({index,nativeSha256:digest,latex:`x_${index}`,image:`image-${index}`,
    layout:{mode:'numbered-right',chapter:2,equation:index+1,numberFormat:'(#C1.#E1)',numberText:`(2.${index+1})`}}))};
  const ack={documentIdentity:source.documentIdentity,documentSnapshot:source.documentSnapshot,index:2,previousNativeSha256:digest,nativeSha256:digest,numberingChanged:true,numberingLocal:true};
  if(publicationArrived){source.numberingRefreshNeeded=true;source.liveNumberingRevision=published;}
  e.workspace.rememberAfterSave(source,2,ack,'x_2',{format:'(#C1-#E1)',side:'right',previewText:'(2-3)',verifiedStartRevision:revision});
  const cached=e.workspace.visibleSource(null);
  assert.equal(cached.objects.length,112);
  assert.equal(cached.objects[2].layout.numberText,'(2-3)');
  assert.equal(source.objects[2].layout.numberText,'(2.3)');
  assert.equal(cached.objects[111].layout.numberText,'(2.112)');
  assert.ok(cached.objects.every((row,index)=>row.image===`image-${index}`));
  assert.equal(cached.numberingRefreshNeeded,false);
  e.behavior(action=>action==='wordWorkspaceStatus'?{connected:true,revision:1,active:{identity:source.documentIdentity,name:source.documentName},
   documents:[{identity:source.documentIdentity,name:source.documentName,readOnly:false,numberingRevision:published}]}:undefined);
  assert.equal(await e.workspace.resume(),true);
  assert.equal(e.workspace.pending,false);
  assert.equal(e.calls.some(call=>call.action==='wordDocumentOpen'),false);
  await e.workspace.syncCurrent();
  assert.equal(e.calls.some(call=>call.action==='wordDocumentOpen'),false);
  assert.equal(await e.workspace.select(2),true);
  assert.deepEqual({...e.calls.find(call=>call.action==='wordDocumentOpen').payload.target},
   {identity:source.documentIdentity,snapshot:source.documentSnapshot,index:2,nativeSha256:digest});
  const partial={...source,documentLoading:true,catalogProof:'proof',documentTotal:112,documentPosition:2,activeIndex:0,
   documentNumberingRevision:revision===2147483646?1:revision+1,numberingRefreshNeeded:false,objects:[source.objects[2]]};
  const duringLoad=e.workspace.visibleSource(partial);
  assert.equal(duringLoad.objects.length,112);
  assert.equal(duringLoad.objects[2].layout.numberText,'(2-3)');
  assert.ok(duringLoad.objects.every((row,index)=>row.image===`image-${index}`));
  assert.equal(duringLoad.documentLoading,true);
  assert.equal(duringLoad.numberingRefreshNeeded,false);
  const changedCount={...partial,documentTotal:113};
  assert.equal(e.workspace.visibleSource(changedCount),changedCount);
 }
});

test('Returning after cancellation keeps verified numbers and rejects a changed Word revision',async()=>{
 for(const updated of [false,true]){
  const e=setup(),source={...document(),insertion:false,documentNumberingRevision:3};
  e.workspace.rememberAfterCancel(source);
  const partial={...source,documentPosition:1,activeIndex:0,documentTotal:2,documentLoading:true,objects:[source.objects[1]]};
  assert.equal(e.workspace.visibleSource(partial).numberingRefreshNeeded,false);
  assert.equal(e.workspace.visibleSource({...partial,objects:[source.objects[0]]}).numberingRefreshNeeded,true);
  const {documentIdentity:identity,documentName:name}=source;
  e.behavior(action=>action==='wordWorkspaceStatus'?{connected:true,active:{identity,name},
   documents:[{identity,name,readOnly:false,numberingRevision:updated?4:3}]}:undefined);
  assert.equal(await e.workspace.resume(),true);
  assert.equal(e.calls.some(c=>c.action==='wordDocumentOpen'),updated);
 }
});

test('Counter changes, an unbound save, or newer Word numbering still require a fresh document',async()=>{
 for(const variant of ['context','bad receipt','newer revision','writing side','missing locality']){
  const e=setup(),source={...document(),insertion:false,documentNumberingRevision:3};
  source.objects[0].layout={mode:'numbered-right',numberText:'(2.1)'};
  const ack={documentIdentity:source.documentIdentity,documentSnapshot:source.documentSnapshot,index:0,
   previousNativeSha256:variant==='bad receipt'?'e'.repeat(64):digest,nativeSha256:digest,numberingChanged:true,
   ...variant==='missing locality'?{}:{numberingLocal:true}};
  const numbering={format:'(#C1-#E1)',side:variant==='writing side'?'left':'right',previewText:'(2-1)',context:variant==='context'?{chapter:3,section:1}:undefined};
  e.workspace.rememberAfterSave(source,0,ack,'x+1',numbering);
  e.behavior(action=>action==='wordWorkspaceStatus'?{connected:true,active:{identity:source.documentIdentity,name:source.documentName},
   documents:[{identity:source.documentIdentity,name:source.documentName,readOnly:false,numberingRevision:variant==='newer revision'?5:4}]}:undefined);
  assert.equal(await e.workspace.resume(),true,variant);
  assert.equal(e.workspace.pending,true,variant);
  assert.equal(e.calls.filter(call=>call.action==='wordDocumentOpen').length,1,variant);
 }
});

test('Only an exact reopen of a confirmed format save can offer the saved format before full capture',async()=>{
 for(const variant of ['matched','old revision','different row','different count']){
  const e=setup(),source={...document(),insertion:false,documentNumberingRevision:3};
  source.objects[0].layout={mode:'numbered-right',numberFormat:'(#C1.#E1)',numberText:'(2.1)'};
  const ack={documentIdentity:source.documentIdentity,documentSnapshot:17,index:0,previousNativeSha256:digest,nativeSha256:digest,numberingChanged:true};
  e.workspace.rememberAfterSave(source,0,ack,'x+1',{format:'(#C1-#E1)',side:'right',previewText:'(2-1)'});
  const index=variant==='different row'?1:0;
  assert.equal(await e.workspace.select(index),true);
  const incoming={...source,documentSnapshot:18,activeIndex:0,documentPosition:index,
   documentTotal:variant==='different count'?3:2,documentNumberingRevision:variant==='old revision'?3:4,
   documentLoading:true,wordNumberingSupported:true,objects:[{index:0,nativeSha256:source.objects[index].nativeSha256}]};
  await e.workspace.prepareIncoming(incoming,requestId);
  assert.equal(incoming.savedNumberingLayout?.numberFormat,variant==='matched'?'(#C1-#E1)':undefined,variant);
  if(variant==='matched')assert.equal(incoming.objects[0].layout.numberText,'(2-1)');
 }
});

test('Direct Word opens reuse a confirmed format only for the same live owner',async()=>{
 for(const variant of ['matched','another digest','another revision','another document']){
  const e=setup(),source={...document(),insertion:false,documentNumberingRevision:3};
  source.objects[0].layout={mode:'numbered-right',numberFormat:'(#C1.#E1)',numberText:'(2.1)'};
  const ack={documentIdentity:source.documentIdentity,documentSnapshot:17,index:0,previousNativeSha256:digest,nativeSha256:digest,numberingChanged:true};
  e.workspace.rememberAfterSave(source,0,ack,'x+1',{format:'(#C1-#E1)',side:'right',previewText:'(2-1)'});
  const incoming={...source,documentSnapshot:18,activeIndex:0,documentPosition:0,documentTotal:2,
   documentIdentity:variant==='another document'?'word:other':source.documentIdentity,
   documentNumberingRevision:variant==='another revision'?5:4,documentLoading:true,wordNumberingSupported:true,
   objects:[{index:0,nativeSha256:variant==='another digest'?'f'.repeat(64):digest}]};
  await e.workspace.prepareIncoming(incoming);
  assert.equal(incoming.savedNumberingLayout?.numberFormat,variant==='matched'?'(#C1-#E1)':undefined,variant);
 }
});

test('A scoped numbering receipt rebinds only the same cached row with unchanged Native',async()=>{
 for(const variant of ['verified','success published before receipt','wrong snapshot','wrong ordinal','changed bytes','another revision']){
  const e=setup(),source={...document(),insertion:false,documentNumberingRevision:3};
  const index=1,ownerDigest=source.objects[index].nativeSha256;
  source.objects[index].layout={mode:'numbered-right',numberFormat:'(#C1.#E1)',numberText:'(2.2)',chapter:2,equation:2};
  const before={documentIdentity:source.documentIdentity,documentSnapshot:17,index,previousNativeSha256:ownerDigest,nativeSha256:ownerDigest,numberingChanged:true,numberingLocal:true};
  e.workspace.rememberAfterSave(source,index,before,'y+2',{format:'(#C1-#E1)',side:'right',previewText:'(2-2)'});
  assert.equal(await e.workspace.select(index),true);
  const incoming={...source,documentSnapshot:18,activeIndex:0,documentPosition:index,documentTotal:2,
   documentNumberingRevision:4,documentLoading:true,wordNumberingSupported:true,wordNumberingExistingSupported:true,
   objects:[{index:0,nativeSha256:ownerDigest}]};
  await e.workspace.prepareIncoming(incoming,requestId);
  e.workspace.accepted(incoming);
  const success=variant==='verified'||variant==='success published before receipt';
  if(variant==='success published before receipt'||variant==='another revision'){
   incoming.liveNumberingRevision=variant==='another revision'?6:5;
   incoming.numberingRefreshNeeded=true;
   e.behavior(action=>action==='wordWorkspaceStatus'?{connected:true,documents:[{
    identity:source.documentIdentity,name:source.documentName,numberingRevision:incoming.liveNumberingRevision
   }]}:undefined);
   await e.workspace.refreshList();
  }
  const change={...before,documentSnapshot:variant==='wrong snapshot'?19:18,index:variant==='wrong ordinal'?0:index,
   nativeSha256:variant==='changed bytes'?'e'.repeat(64):ownerDigest};
  e.workspace.rememberAfterSave(incoming,0,change,'y+2',{format:'(#C1.#E1)',side:'right',previewText:'(2.2)',existingRevision:4});
  const cached=e.workspace.visibleSource(null);
  assert.equal(cached.objects[0].nativeSha256,source.objects[0].nativeSha256);
  assert.equal(cached.documentSnapshot,17,'other rows retain their full snapshot');
  assert.equal(cached.objects[index].nativeSha256,success?ownerDigest:null,variant);
  assert.equal(await e.workspace.select(index),success,variant);
  if(success){
   assert.equal(cached.objects[index].layout.numberText,'(2.2)');
   assert.equal(cached.numberingRefreshNeeded,false);
   assert.equal(e.calls.filter(call=>call.action==='wordDocumentOpen').at(-1).payload.target.snapshot,18);
   const reopened={...incoming,documentSnapshot:19,documentNumberingRevision:5,objects:[{index:0,nativeSha256:ownerDigest}]};
   await e.workspace.prepareIncoming(reopened,requestId);
   assert.equal(reopened.savedNumberingLayout.numberFormat,'(#C1.#E1)');
   assert.equal(reopened.savedNumberingSnapshot,18);
  }
 }
});

test('Dock discards a retired cache even after a confirmed content-only save',async()=>{
 const e=setup(),source={...document(),insertion:false,documentNumberingRevision:3};
 const change={documentIdentity:source.documentIdentity,documentSnapshot:source.documentSnapshot,index:0,previousNativeSha256:digest,nativeSha256:'e'.repeat(64),numberingChanged:false};
 e.workspace.rememberAfterSave(source,0,change,'new formula',false);
 e.behavior(action=>action==='wordWorkspaceStatus'?{
  connected:true,active:{identity:source.documentIdentity,name:source.documentName},retiredIdentities:[source.documentIdentity],
  documents:[{identity:source.documentIdentity,name:source.documentName,readOnly:false,numberingRevision:3}]
 }:undefined);
 assert.equal(await e.workspace.resume(),false);
 assert.equal(e.workspace.hasDocument,false);
 assert.equal(e.workspace.wordDocumentUnavailable,true);
 assert.equal(e.calls.some(call=>call.action==='wordDocumentOpen'),false);
});

async function cachedSaveReopen({index=0,warm=true}={}){
 const e=setup(),source={...document(),insertion:false,documentNumberingRevision:3};
 const changedRow={...source.objects[0],latex:'x^{4}',nativeSha256:'e'.repeat(64)};
 const change={documentIdentity:source.documentIdentity,documentSnapshot:source.documentSnapshot,index:0,previousNativeSha256:digest,nativeSha256:changedRow.nativeSha256,numberingChanged:false};
 const retryId='f'.repeat(64),firstResult=deferred(),retryResult=deferred();
 e.workspace.rememberAfterSave(source,0,change,changedRow.latex,false);
 e.behavior((action,payload)=>{
  if(action==='wordWorkspaceStatus')return {connected:true,active:{identity:source.documentIdentity,name:source.documentName},documents:[{identity:source.documentIdentity,name:source.documentName,readOnly:false,numberingRevision:3}]};
  if(action==='wordDocumentOpen'&&payload.documentIdentity)return {requestId:retryId,state:'queued'};
  if(action==='wordDocumentStatus')return payload.requestId===requestId?firstResult.promise:retryResult.promise;
 });
 if(warm)assert.equal(await e.workspace.resume(),true);
 assert.equal(await e.workspace.select(index),true);
 return {e,source,changedRow,retryId,retryResult,
  async finishFirst(result={state:'failed'}){firstResult.resolve({requestId,identity:source.documentIdentity,index,...result});await new Promise(resolve=>setImmediate(resolve));}
 };
}

test('An unavailable retained Word range can retry once by document identity while keeping the changed row bound',async()=>{
 const {e,source,changedRow,retryId,finishFirst}=await cachedSaveReopen();
 await finishFirst();
 const opens=e.calls.filter(call=>call.action==='wordDocumentOpen');
 assert.equal(opens.length,2);
 assert.equal(opens[0].payload.target.nativeSha256,changedRow.nativeSha256);
 assert.equal(JSON.stringify(opens[1].payload),JSON.stringify({documentIdentity:source.documentIdentity}));
 assert.equal(e.workspace.pending,true);
 assert.equal(e.messages.some(message=>message.error),false);
 const incoming={...source,documentSnapshot:18,activeIndex:0,objects:[changedRow,source.objects[1]]};
 assert.equal(await e.workspace.prepareIncoming(incoming,retryId),false);
 assert.equal(e.workspace.pending,false);
});

test('A document-scoped recovery cannot open a different formula and never retries twice',async()=>{
 for(const mismatch of ['identity','index','digest','second failure']){
  const {e,source,changedRow,retryId,retryResult,finishFirst}=await cachedSaveReopen();
  await finishFirst();
  assert.equal(e.calls.filter(call=>call.action==='wordDocumentOpen').length,2,mismatch);
  if(mismatch==='second failure'){
   retryResult.resolve({requestId:retryId,state:'failed'});
   await new Promise(resolve=>setImmediate(resolve));
  }else{
   const incoming={...source,documentSnapshot:18,activeIndex:mismatch==='index'?1:0,
    documentIdentity:mismatch==='identity'?'same-named-other-document':source.documentIdentity,
    objects:[mismatch==='digest'?source.objects[0]:changedRow,source.objects[1]]};
   await assert.rejects(e.workspace.prepareIncoming(incoming,retryId),/当前文档已变化|内容或位置已经变化/);
  }
  assert.equal(e.workspace.pending,false,mismatch);
  assert.equal(e.calls.filter(call=>call.action==='wordDocumentOpen').length,2,mismatch);
 }
});

test('A targeted read cannot retry after a newer state, a foreign result, or a different sidebar action',async()=>{
 for(const variant of ['draft','busy','new Word session','generation','cancelled','superseded','expired','foreign','specific failure','other row','unverified cache']){
  const {e,finishFirst}=await cachedSaveReopen({index:variant==='other row'?1:0,warm:variant!=='unverified cache'});
  if(variant==='draft')e.state.draftChanged=true;
  if(variant==='busy')e.state.busy=true;
  if(variant==='new Word session')e.state.wordTicket=ticket;
  if(variant==='generation')await e.workspace.cancelPending();
  const result={state:['cancelled','superseded','expired'].includes(variant)?variant:'failed'};
  if(variant==='foreign')result.identity='different-document';
  if(variant==='specific failure')result.reason='document-process-mismatch';
  await finishFirst(result);
  assert.equal(e.workspace.pending,false,variant);
  assert.equal(e.calls.filter(call=>call.action==='wordDocumentOpen').length,1,variant);
 }
});

test('Cancelling while a recovery delivery is being verified leaves it superseded',async()=>{
 const {e,source,changedRow,retryId,finishFirst}=await cachedSaveReopen();
 await finishFirst();
 const incoming={...source,documentSnapshot:18,activeIndex:0,objects:[changedRow,source.objects[1]]};
 const rejected=assert.rejects(e.workspace.prepareIncoming(incoming,retryId),/请求已经结束/);
 await e.workspace.cancelPending();
 await rejected;
 assert.equal(e.workspace.pending,false);
});

test('Unbound results retire only the changed cached target, and a number update cannot clear freshness on an old status',async()=>{
 const e=setup(),source={...document(),insertion:false,documentNumberingRevision:3};
 const change={documentIdentity:source.documentIdentity,documentSnapshot:4,index:0,previousNativeSha256:digest,nativeSha256:'e'.repeat(64),numberingChanged:true};
 e.workspace.rememberAfterSave(source,0,change,'unexpected',true);
 e.behavior(action=>action==='wordWorkspaceStatus'?{connected:true,documents:[{identity:source.documentIdentity,name:source.documentName,numberingRevision:3}]}:undefined);
 await e.workspace.refreshList();
 const cached=e.workspace.visibleSource(null);
 assert.equal(cached.objects[0].nativeSha256,null);
 assert.equal(cached.objects[1].nativeSha256,source.objects[1].nativeSha256);
 assert.equal(cached.numberingRefreshNeeded,true);
 assert.equal(await e.workspace.select(0),false);
 assert.equal(e.calls.some(call=>call.action==='wordDocumentOpen'),false);
});

test('App insert binds the selected document and carries a standalone draft without clearing it',async()=>{
 for(const mode of ['inline','display','numbered-left','numbered-right']){
  const e=setup(),draft={latex:'x^2+1',ruler:[{position:40,type:0}],typography:{fonts:[{font:'Times New Roman'}]}};
  e.api.captureInsertionDraft=()=>draft;e.state.draftChanged=true;
  e.workspace.accepted(document());e.state.source=null;e.state.wordTicket=null;
  e.behavior(async action=>action==='wordWorkspaceStatus'?{connected:true,insertionRequestSupport:true,revision:1,active:{identity:'word:other',name:'B.docx'},documents:[{identity:'word:1:2',name:'A.docx',readOnly:false},{identity:'word:other',name:'B.docx',readOnly:false}]}:undefined);
  assert.equal(await e.workspace.insert(mode),true);
  assert.equal(e.calls.some(call=>call.action==='detach'||call.action==='confirmWordSessionSwitch'),false);
  const opening=e.calls.find(call=>call.action==='wordDocumentOpen');assert.equal(opening.payload.documentIdentity,'word:1:2');assert.equal(opening.payload.insertionMode,mode);
  assert.equal(await e.workspace.prepareIncoming({...document(),insertionLayout:{mode}},requestId),true);
  assert.equal(e.workspace.takeInsertionDraft(requestId),draft);assert.equal(e.workspace.takeInsertionDraft(requestId),null);
 }
});

test('A Word insertion failure reports its host reason and retains the draft for each mode',async()=>{
 for(const mode of ['inline','display','numbered-left','numbered-right']){
  const e=setup(),draft={latex:'x^2+1'};
  e.api.captureInsertionDraft=()=>draft;e.state.draftChanged=true;e.workspace.accepted(document());
  e.behavior(async action=>action==='wordWorkspaceStatus'?{connected:true,insertionRequestSupport:true,revision:1,active:{identity:'word:1:2',name:'A.docx'},documents:[{identity:'word:1:2',name:'A.docx',readOnly:false}]}:action==='wordDocumentStatus'?{state:'failed',reason:'Another reference bookmark overlaps the number.'}:undefined);
  assert.equal(await e.workspace.insert(mode),true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(e.workspace.pending,false);assert.equal(e.state.draftChanged,true);
  assert.ok(e.messages.some(m=>m.error&&m.text.includes('Another reference bookmark overlaps the number.')&&m.text.includes('草稿仍保留')));
  assert.equal(e.calls.some(c=>['wordSessionInsert','wordSessionSave'].includes(c.action)),false);
 }
});

test('App insert after a selected equation uses the retained range and rejects changed native data',async()=>{
 const e=setup();e.state.source={...document(),insertion:false};e.state.wordTicket=ticket;e.state.selectedIndex=1;
 e.workspace.accepted(e.state.source);
 e.behavior(async action=>action==='wordWorkspaceStatus'?{connected:true,insertionRequestSupport:true,documents:[{identity:'word:1:2',name:'A.docx',readOnly:false}]}:undefined);
 assert.equal(await e.workspace.insert('numbered-right'),true);
 const opening=e.calls.find(c=>c.action==='wordDocumentOpen');assert.equal(opening.payload.target.index,1);assert.equal(opening.payload.target.nativeSha256,'d'.repeat(64));
 assert.equal(e.calls.find(c=>c.action==='detach').options.preserveDraft,true);
 const changed={...document(),insertionLayout:{mode:'numbered-right'},objects:[{index:0,nativeSha256:digest},{index:1,nativeSha256:'e'.repeat(64)}]};
 await assert.rejects(e.workspace.prepareIncoming(changed,requestId),/内容或位置已经变化/);
 assert.equal(e.workspace.pending,false);
});

test('App insert rejects readonly, closed, stale, pending and unconfirmed destinations without losing a draft',async()=>{
 for(const variant of ['closed','readOnly','busy','unknown','declined']){
  const e=setup();e.state.source={...document(),insertion:false};e.state.wordTicket=ticket;e.state.draftChanged=true;e.workspace.accepted(e.state.source);
  e.state.busy=variant==='busy';e.state.outcomeUnknown=variant==='unknown';
  e.behavior(async action=>action==='wordWorkspaceStatus'?{connected:true,insertionRequestSupport:true,documents:variant==='closed'?[]:[{identity:'word:1:2',name:'A.docx',readOnly:variant==='readOnly'}]}:undefined);
  assert.equal(await e.workspace.insert('display'),false,variant);assert.equal(e.state.wordTicket,ticket,variant);
  assert.equal(e.calls.some(c=>['detach','wordDocumentOpen'].includes(c.action)),false,variant);
 }
 const e=setup();e.workspace.accepted(document());e.behavior(async action=>action==='wordWorkspaceStatus'?{connected:true,insertionRequestSupport:true,documents:[{identity:'word:1:2',name:'A.docx',readOnly:false}]}:undefined);
 assert.equal(await e.workspace.insert('inline'),true);assert.equal(await e.workspace.insert('display'),false);
 await e.workspace.cancelPending();await assert.rejects(e.workspace.prepareIncoming({...document(),insertionLayout:{mode:'inline'}},requestId),/请求已经结束/);
});

test('A large cold Word capture stays valid past 25 seconds and still has a bounded cancellation deadline',async()=>{
 for(const elapsed of [30000,60001]){
  const e=setup();let now=0,wake;
  e.api.now=()=>now;e.api.pause=()=>new Promise(resolve=>{wake=resolve;});
  assert.equal(await e.workspace.resume(),true);await new Promise(resolve=>setImmediate(resolve));
  now=elapsed;wake();await new Promise(resolve=>setImmediate(resolve));
  if(elapsed===30000){
   assert.equal(e.workspace.pending,true);assert.equal(e.calls.some(c=>c.action==='wordDocumentCancel'),false);
   assert.equal(await e.workspace.prepareIncoming({...document(),insertion:false,activeIndex:0},requestId),false);
  }else{
   assert.equal(e.workspace.pending,false);assert.ok(e.calls.some(c=>c.action==='wordDocumentCancel'));
   await assert.rejects(e.workspace.prepareIncoming({...document(),activeIndex:0},requestId),/请求已经结束/);
  }
 }
});

test('Ended insertion keeps display metadata, then Dock refresh accepts a new N+1 Word capture',async()=>{
 const e=setup(),before=document();e.workspace.remember(before);
 const display=e.workspace.visibleSource(null);assert.equal(display.objects.length,2);assert.equal(display.path,undefined);assert.equal(display.activePath,undefined);assert.equal(display.wordTicket,undefined);assert.equal(display.insertion,undefined);
 assert.equal(await e.workspace.resume(),true);assert.equal(e.workspace.pending,true);assert.equal(JSON.stringify(e.calls.find(c=>c.action==='wordDocumentOpen').payload),'{}');
 const after={...document(),insertion:false,activeIndex:2,documentSnapshot:18,objects:[...before.objects,{index:2,latex:'z+3',nativeSha256:'e'.repeat(64)}]};
 assert.equal(await e.workspace.prepareIncoming(after,requestId),false);e.workspace.accepted(after);assert.equal(e.workspace.pending,false);assert.equal(e.workspace.visibleSource(null).objects.length,3);assert.equal(e.workspace.visibleSource(null).documentSnapshot,18);
});

test('A default number format does not stale cached rows, but a new numbering revision does',async()=>{
 const e=setup(),before={...document(),documentNumberingRevision:3};
 e.workspace.remember(before);
 const displayed=e.workspace.visibleSource(null);
 const status=(revision,numberFormat,numberingRevision)=>({connected:true,revision,active:{identity:before.documentIdentity,name:'A.docx'},documents:[{identity:before.documentIdentity,name:'A.docx',readOnly:false,numberFormat,numberingRevision}]});
 let current=status(1,'(#C1-#E1)',3);
 e.behavior(async action=>action==='wordWorkspaceStatus'?current:undefined);
 assert.equal(await e.workspace.refreshList(),true);
 assert.equal(displayed.numberingRefreshNeeded,false);
 current=status(2,'(#E1)',4);
 assert.equal(await e.workspace.refreshList(),true);
 assert.equal(e.workspace.visibleSource(null),displayed);
 assert.equal(displayed.numberingRefreshNeeded,true);
 e.workspace.remember({...before,documentNumberingRevision:4,documentSnapshot:18});
 assert.equal(e.workspace.visibleSource(null).numberingRefreshNeeded,false);
 assert.equal(e.calls.some(call=>call.action==='wordDocumentOpen'),false);
});

test('Blank insertion can request an exact existing formula without inserting a placeholder',async()=>{
 const e=setup();e.state.source=document();e.state.wordTicket=ticket;
 assert.equal(await e.workspace.select(1),true);assert.equal(e.calls.filter(c=>c.action==='detach').length,1);
 const target=e.calls.find(c=>c.action==='wordDocumentOpen').payload.target;
 assert.equal(target.identity,'word:1:2');assert.equal(target.snapshot,17);assert.equal(target.index,1);assert.equal(target.nativeSha256,'d'.repeat(64));
 assert.equal(e.calls.some(c=>['wordSessionInsert','wordSessionSave'].includes(c.action)),false);
 assert.equal(await e.workspace.prepareIncoming({...document(),insertion:false,activeIndex:1},requestId),false);
});

test('A nonempty insertion draft is preserved when switching is declined',async()=>{
 const e=setup();e.state.source=document();e.state.wordTicket=ticket;e.state.draftChanged=true;
 assert.equal(await e.workspace.select(0),false);assert.equal(e.state.wordTicket,ticket);assert.equal(e.state.source.insertion,true);assert.equal(e.workspace.pending,false);
 assert.equal(e.calls.some(c=>['detach','wordDocumentOpen'].includes(c.action)),false);
});

test('A late sidebar switch approval cannot detach a newer Word session',async()=>{
 const e=setup(),confirmation=deferred(),confirmationStarted=deferred();
 const original=document(),replacement={...document(),documentIdentity:'word:1:3',wordTicket:'e'.repeat(64)};
 e.api.state=()=>({...e.state});
 Object.assign(e.state,{source:original,wordTicket:ticket,draftChanged:true});
 e.workspace.accepted(original);
 e.behavior(async action=>{
  if(action==='confirmWordSessionSwitch'){confirmationStarted.resolve();return confirmation.promise;}
 });
 const switching=e.workspace.select(0);
 await confirmationStarted.promise;
 Object.assign(e.state,{source:replacement,wordTicket:replacement.wordTicket,draftChanged:true});
 e.workspace.accepted(replacement);
 confirmation.resolve({discard:true});
 assert.equal(await switching,false);
 assert.equal(e.state.source,replacement);
 assert.equal(e.state.wordTicket,replacement.wordTicket);
 assert.equal(e.state.draftChanged,true);
 assert.equal(e.calls.some(call=>['detach','wordDocumentOpen'].includes(call.action)),false);
});

test('New detaches a clean Word session and preserves a draft unless the user confirms',async()=>{
 for(const [dirty,approved] of [[false,false],[true,false],[true,true]]){
  const e=setup();e.state.source=document();e.state.wordTicket=ticket;e.state.draftChanged=dirty;
  let cleared=0;e.api.empty=()=>{cleared++;};if(approved)e.discard();
  assert.equal(await e.workspace.newFormula(),!dirty||approved);
  assert.equal(e.calls.filter(c=>c.action==='confirmWordSessionSwitch').length,dirty?1:0);
  assert.equal(e.calls.filter(c=>c.action==='detach').length,!dirty||approved?1:0);
  assert.equal(cleared,!dirty||approved?1:0);
  if(dirty&&!approved)assert.equal(e.state.wordTicket,ticket);
 }
 for(const key of ['busy','outcomeUnknown']){
  const e=setup();e.state.source=document();e.state.wordTicket=ticket;e.state[key]=true;
  assert.equal(await e.workspace.newFormula(),false);assert.equal(e.calls.length,0);
 }
});

test('New cannot detach a replacement session after a delayed confirmation',async()=>{
 const e=setup(),reply=deferred();e.state.source=document();e.state.wordTicket=ticket;e.state.draftChanged=true;
 e.behavior(async action=>action==='confirmWordSessionSwitch'?reply.promise:undefined);
 const request=e.workspace.newFormula();e.state.wordTicket='e'.repeat(64);reply.resolve({discard:true});
 assert.equal(await request,false);assert.equal(e.calls.some(c=>c.action==='detach'),false);
});

test('An approved switch is tied to the exact document, formula index and original native hash',async()=>{
 const e=setup();e.state.source=document();e.state.wordTicket=ticket;e.state.draftChanged=true;e.discard();
 assert.equal(await e.workspace.select(0),true);assert.equal(await e.workspace.prepareIncoming({...document(),insertion:false,activeIndex:0},requestId),true);
 assert.equal(e.calls.filter(c=>c.action==='confirmWordSessionSwitch').length,1);assert.equal(e.workspace.pending,false);
});

test('A stale or changed requested target is rejected without authorizing a write',async()=>{
 const e=setup();e.workspace.remember(document());await e.workspace.select(0);
 const changed={...document(),insertion:false,activeIndex:0,objects:[{index:0,latex:'changed',nativeSha256:'f'.repeat(64)}]};
 await assert.rejects(e.workspace.prepareIncoming(changed,requestId),/内容或位置已经变化/);assert.equal(e.workspace.pending,false);
 assert.equal(e.calls.filter(c=>c.action==='wordDocumentCancel').length,1);
});

test('Closing while a request is being queued cancels its late ID and rejects its late editor delivery',async()=>{
 const e=setup(),response=deferred(),started=deferred();e.behavior(async action=>{if(action==='wordDocumentOpen'){started.resolve();return response.promise;}});
 const opening=e.workspace.resume();await started.promise;await e.workspace.cancelPending();response.resolve({requestId,state:'queued'});assert.equal(await opening,false);
 assert.equal(e.calls.filter(c=>c.action==='wordDocumentCancel').length,1);
 await assert.rejects(e.workspace.prepareIncoming({...document(),activeIndex:0},requestId),/请求已经结束/);
});

test('An independent Word double-click supersedes a pending Dock request',async()=>{
 const e=setup();e.workspace.remember(document());await e.workspace.resume();
 assert.equal(await e.workspace.prepareIncoming({...document(),activeIndex:0}),false);assert.equal(e.workspace.pending,false);
 await assert.rejects(e.workspace.prepareIncoming({...document(),activeIndex:0},requestId),/请求已经结束/);
});

test('Dock does not replace an active session, standalone draft or unresolved Word outcome',async()=>{
 for(const key of ['wordTicket','draftChanged','outcomeUnknown','busy']){const e=setup();e.state[key]=key==='wordTicket'?ticket:true;assert.equal(await e.workspace.resume(),false,key);assert.equal(e.calls.length,0,key);}
});

test('No running Word clears only the cached document, and keeps standalone draft ownership',async()=>{
 const e=setup();e.workspace.remember(document());assert.equal(await e.workspace.resume(false),false);assert.equal(e.workspace.visibleSource(null),null);assert.equal(e.calls.length,0);
});

const workspaceStatus=(revision,identity,name='同名.docx',connected=true,retiredIdentities=[])=>({connected,revision,active:identity?{identity,name}:null,retiredIdentities});
async function confirmPublished(e,doc){e.behavior(async action=>action==='wordWorkspaceStatus'?workspaceStatus(1,doc.documentIdentity,doc.documentName):undefined);await e.workspace.syncCurrent();}
test('a fresh Word delivery is not detached by a workspace status from before its publication',async()=>{
 for(const stale of [workspaceStatus(4,null,'old',true,['A']),workspaceStatus(4,'B','old',true,['A'])]){
  const e=setup(),owner={...document(),documentIdentity:'A',documentName:'new.docx',insertion:false};
  e.state.source=owner;e.state.wordTicket=ticket;e.workspace.accepted(owner);
  let current=stale;e.behavior(async action=>action==='wordWorkspaceStatus'?current:undefined);
  await e.workspace.refreshList();assert.equal(await e.workspace.syncCurrent(),false);
  assert.equal(e.state.source,owner);assert.equal(e.state.wordTicket,ticket);assert.equal(e.workspace.wordDocumentUnavailable,false);
  assert.equal(e.calls.some(c=>['detach','wordDocumentOpen'].includes(c.action)),false);
  current=workspaceStatus(5,'A','new.docx');assert.equal(await e.workspace.syncCurrent(),false);
  current=workspaceStatus(6,null,'old',true,['A']);assert.equal(await e.workspace.syncCurrent(),true);
  assert.equal(e.calls.filter(c=>c.action==='detach').length,1,'a retirement published after the accepted identity remains effective');
 }
});
test('Switching between documents with identical formulas and names opens a fresh empty Word session',async()=>{
 const e=setup(),old={...document(),documentIdentity:'A',documentName:'same.docx',insertion:false};e.state.source=old;e.state.wordTicket=ticket;e.workspace.accepted(old);
 await confirmPublished(e,old);
 e.behavior(async action=>action==='wordWorkspaceStatus'?workspaceStatus(1,'B','same.docx'):undefined);
 assert.equal(await e.workspace.syncCurrent(),true);
 assert.deepEqual(e.calls.filter(c=>c.action==='detach').length,1);
 const opening=e.calls.find(c=>c.action==='wordDocumentOpen');assert.deepEqual(JSON.parse(JSON.stringify(opening.payload)),{});
 assert.equal(e.workspace.visibleSource(null),null,'the old formula list is hidden while the new Word document is being read');
});

test('A Word draft stays visible and offers a confirmed switch to the other document',async()=>{
 const e=setup(),old={...document(),documentIdentity:'A',documentName:'A.docx',insertion:false};e.state.source=old;e.state.wordTicket=ticket;e.state.draftChanged=true;e.workspace.accepted(old);let discard=false;
 await confirmPublished(e,old);
 e.behavior(async action=>action==='wordWorkspaceStatus'?workspaceStatus(2,'B','B.docx'):action==='confirmWordSessionSwitch'?{discard}:undefined);
 assert.equal(await e.workspace.syncCurrent(),false);assert.equal(e.workspace.otherWordDocumentName,'B.docx');assert.equal(e.state.source,old);assert.equal(e.state.wordTicket,ticket);
 assert.equal(await e.workspace.switchToCurrent(),false);assert.equal(e.state.source,old);assert.equal(e.calls.some(c=>c.action==='wordDocumentOpen'),false);
 discard=true;assert.equal(await e.workspace.switchToCurrent(),true);assert.equal(e.calls.filter(c=>c.action==='confirmWordSessionSwitch').length,2);
 const request=e.calls.find(c=>c.action==='wordDocumentOpen');assert.deepEqual(JSON.parse(JSON.stringify(request.payload)),{});
 assert.equal(await e.workspace.prepareIncoming({...old,documentIdentity:'B',documentName:'B.docx',insertion:false},requestId),true);
});

test('Standalone drafts are not taken over automatically by another open Word document',async()=>{
 const e=setup();e.state.draftChanged=true;e.workspace.remember({...document(),documentIdentity:'A'});
 e.behavior(async action=>action==='wordWorkspaceStatus'?workspaceStatus(4,'B','B.docx'):undefined);
 assert.equal(await e.workspace.syncCurrent(),false);assert.equal(e.workspace.otherWordDocumentName,'B.docx');
 assert.equal(e.calls.some(c=>['detach','wordDocumentOpen'].includes(c.action)),false);
});

test('Busy Word sessions skip a document change and retry it on the next status poll',async()=>{
 const e=setup(),old={...document(),documentIdentity:'A',insertion:false};e.state.source=old;e.state.wordTicket=ticket;e.workspace.accepted(old);e.state.busy=true;
 await confirmPublished(e,old);
 e.behavior(async action=>action==='wordWorkspaceStatus'?workspaceStatus(5,'B','B.docx'):undefined);
 assert.equal(await e.workspace.syncCurrent(),false);assert.equal(e.calls.some(c=>c.action==='wordDocumentOpen'),false);
 e.state.busy=false;assert.equal(await e.workspace.syncCurrent(),true);assert.equal(e.calls.filter(c=>c.action==='wordDocumentOpen').length,1);
});

test('Pending requests and unknown Word outcomes keep the current document binding unchanged',async()=>{
 for(const blocked of ['outcomeUnknown','pendingRequest']){
  const e=setup(),old={...document(),documentIdentity:'A',insertion:false};e.workspace.remember(old);
  e.behavior(async action=>action==='wordWorkspaceStatus'?workspaceStatus(9,'B','B.docx'):undefined);
  if(blocked==='outcomeUnknown'){e.state.source=old;e.state.wordTicket=ticket;e.workspace.accepted(old);e.state.outcomeUnknown=true;}
  else await e.workspace.resume();
  const opensBefore=e.calls.filter(c=>c.action==='wordDocumentOpen').length;
  assert.equal(await e.workspace.syncCurrent(),false,blocked);
  assert.equal(e.state.source,blocked==='outcomeUnknown'?old:null);assert.equal(e.state.wordTicket,blocked==='outcomeUnknown'?ticket:null);
  assert.equal(e.calls.filter(c=>c.action==='detach').length,0,blocked);assert.equal(e.calls.filter(c=>c.action==='wordDocumentOpen').length,opensBefore,blocked);
 }
});

test('Late status metadata cannot detach a newer Word ticket accepted while the read was pending',async()=>{
 const e=setup(),oldStatus=deferred(),a={...document(),documentIdentity:'A',insertion:false},b={...document(),documentIdentity:'B',documentName:'B.docx',insertion:false};e.state.source=a;e.state.wordTicket=ticket;e.workspace.accepted(a);
 e.behavior(async action=>action==='wordWorkspaceStatus'?oldStatus.promise:undefined);
 const syncing=e.workspace.syncCurrent();await Promise.resolve();await Promise.resolve();e.state.source=b;e.state.wordTicket='e'.repeat(64);e.workspace.accepted(b);
 oldStatus.resolve(workspaceStatus(6,'C','C.docx'));assert.equal(await syncing,false);
 assert.equal(e.state.wordTicket,'e'.repeat(64));assert.equal(e.state.source,b);assert.equal(e.calls.some(c=>c.action==='detach'),false);
});

test('An empty new Word document clears the old cached list and repeated polling does not reopen it',async()=>{
 const e=setup();e.workspace.remember({...document(),documentIdentity:'A'});let statusCalls=0;
 e.behavior(async action=>{
  if(action==='wordWorkspaceStatus'){statusCalls++;return workspaceStatus(7,'B','B.docx');}
  if(action==='wordDocumentStatus')return {state:'empty'};
  return undefined;
 });
 assert.equal(await e.workspace.syncCurrent(),true);
 await Promise.resolve();await Promise.resolve();
 assert.equal(e.workspace.pending,false);assert.equal(e.workspace.visibleSource(null),null);
 assert.equal(await e.workspace.syncCurrent(),false);assert.equal(e.calls.filter(c=>c.action==='wordDocumentOpen').length,1);assert.equal(statusCalls,3);
});

test('Closing the active Word document drops a clean cached list and records the closed identity',async()=>{
 const e=setup();e.workspace.remember({...document(),documentIdentity:'A'});e.workspace.accepted({...document(),documentIdentity:'A'});
 e.behavior(async action=>action==='wordWorkspaceStatus'?workspaceStatus(8,null,'',true):undefined);
 assert.equal(await e.workspace.syncCurrent(),true);assert.equal(e.workspace.visibleSource(null),null);
 assert.equal(await e.workspace.syncCurrent(),false);assert.equal(e.calls.filter(c=>c.action==='wordDocumentOpen').length,0);
});

 test('A disconnected Word heartbeat preserves the ticket, document and draft',async()=>{const e=setup(),old={...document(),documentIdentity:'A',insertion:false};e.state.source=old;e.state.wordTicket=ticket;e.workspace.accepted(old);e.behavior(async action=>action==='wordWorkspaceStatus'?workspaceStatus(8,null,'',false):undefined);assert.equal(await e.workspace.syncCurrent(),false);assert.equal(e.state.wordTicket,ticket);assert.equal(e.state.source,old);assert.equal(e.calls.some(c=>c.action==='detach'),false);});

test('Retiring a clean source detaches it and follows the unchanged active document',async()=>{
 const e=setup(),old={...document(),documentIdentity:'A',documentName:'A.docx',insertion:false};e.state.source=old;e.state.wordTicket=ticket;e.workspace.accepted(old);
 await confirmPublished(e,old);
 e.behavior(async action=>action==='wordWorkspaceStatus'?workspaceStatus(20,'B','B.docx',true,['A']):undefined);
 assert.equal(await e.workspace.syncCurrent(),true);
 assert.equal(e.calls.filter(c=>c.action==='detach').length,1);assert.equal(e.state.wordTicket,null);assert.equal(e.state.source,null);
 assert.equal(e.calls.filter(c=>c.action==='wordDocumentOpen').length,1);assert.equal(e.workspace.pending,true);
 assert.equal(e.workspace.visibleSource(null),null);assert.equal(e.workspace.wordDocumentUnavailable,false);
 await assert.rejects(e.workspace.prepareIncoming({...old,documentIdentity:'A'},requestId),/当前文档已变化|连接已结束/);
 assert.equal(e.workspace.pending,false);
});

test('Retirement is checked before a same-active-identity no-op',async()=>{
 const e=setup(),old={...document(),documentIdentity:'A',documentName:'A.docx',insertion:false},current={...document(),documentIdentity:'B',documentName:'B.docx',insertion:false};
 e.workspace.accepted(current);e.state.source=old;e.state.wordTicket=ticket;
 e.behavior(async action=>action==='wordWorkspaceStatus'?workspaceStatus(24,'B','B.docx',true,['A']):undefined);
 assert.equal(await e.workspace.syncCurrent(),true);
 assert.equal(e.calls.filter(c=>c.action==='detach').length,1);assert.equal(e.calls.filter(c=>c.action==='wordDocumentOpen').length,1);
});

test('Retiring a dirty source preserves an editable orphan draft and offers the remaining document',async()=>{
 const e=setup(),old={...document(),documentIdentity:'A',documentName:'A.docx',insertion:false};e.state.source=old;e.state.wordTicket=ticket;e.state.draftChanged=true;e.workspace.accepted(old);e.workspace.remember(old);
 await confirmPublished(e,old);
 let status=workspaceStatus(21,'B','B.docx',true,['A']);e.behavior(async action=>action==='wordWorkspaceStatus'?status:undefined);
 assert.equal(await e.workspace.syncCurrent(),true);
 assert.equal(e.state.wordTicket,null);assert.equal(e.state.source,null);assert.equal(e.state.draftChanged,true);
 assert.deepEqual(JSON.parse(JSON.stringify(e.calls.find(c=>c.action==='detach').options)),{preserveDraft:true});
 assert.equal(e.workspace.visibleSource(null),null);assert.equal(e.workspace.wordDocumentUnavailable,true);
 assert.equal(e.workspace.documentName,'A.docx');assert.equal(e.workspace.otherWordDocumentName,'B.docx');
 assert.equal(e.calls.some(c=>c.action==='wordDocumentOpen'),false);
 assert.ok(e.messages.some(m=>m.text==='文档连接已结束，草稿已保留。'));
 const fresh={...old,documentIdentity:'A',documentName:'A.docx'};status=workspaceStatus(22,'B','B.docx');
 assert.equal(await e.workspace.prepareIncoming(fresh),false);e.state.wordTicket='d'.repeat(64);e.state.source=fresh;e.workspace.accepted(fresh);
 assert.equal(e.workspace.wordDocumentUnavailable,false);assert.equal(e.workspace.documentName,'A.docx');
});

test('A re-observed identity stays an orphan until the user confirms a fresh identity-bound switch',async()=>{
 const e=setup(),old={...document(),documentIdentity:'A',documentName:'A.docx',insertion:false};e.state.source=old;e.state.wordTicket=ticket;e.state.draftChanged=true;e.workspace.accepted(old);
 await confirmPublished(e,old);
 let status=workspaceStatus(25,'B','B.docx',true,['A']);e.behavior(async action=>action==='wordWorkspaceStatus'?status:undefined);
 assert.equal(await e.workspace.syncCurrent(),true);assert.equal(e.workspace.wordDocumentUnavailable,true);
 status=workspaceStatus(26,'A','A.docx');assert.equal(await e.workspace.syncCurrent(),false);
 assert.equal(e.workspace.wordDocumentUnavailable,true);assert.equal(e.workspace.otherWordDocumentName,'A.docx');
 assert.equal(e.calls.some(c=>c.action==='wordDocumentOpen'),false);
 e.discard();assert.equal(await e.workspace.switchToCurrent(),true);
 assert.deepEqual(JSON.parse(JSON.stringify(e.calls.find(c=>c.action==='wordDocumentOpen').payload)),{});
 assert.equal(await e.workspace.prepareIncoming({...old,documentIdentity:'A'},requestId),true);
});

test('Retirement clears stale cached rows while a busy session is preserved until retry',async()=>{
 const e=setup(),old={...document(),documentIdentity:'A',insertion:false};e.state.source=old;e.state.wordTicket=ticket;e.workspace.accepted(old);e.workspace.remember(old);e.state.busy=true;
 await confirmPublished(e,old);
 e.behavior(async action=>action==='wordWorkspaceStatus'?workspaceStatus(22,'B','B.docx',true,['A']):undefined);
 assert.equal(await e.workspace.syncCurrent(),false);assert.equal(e.workspace.wordDocumentUnavailable,true);
 assert.equal(e.workspace.visibleSource(old),null);assert.equal(e.state.wordTicket,ticket);assert.equal(e.state.source,old);
 assert.equal(e.calls.some(c=>c.action==='detach'||c.action==='wordDocumentCancel'),false);
 e.state.busy=false;assert.equal(await e.workspace.syncCurrent(),true);
 assert.equal(e.state.wordTicket,null);assert.equal(e.calls.filter(c=>c.action==='detach').length,1);
});

test('A pending Word request is not cancelled when a known cached source retires',async()=>{
 const e=setup(),old={...document(),documentIdentity:'A',insertion:false};e.workspace.remember(old);
 let statusCalls=0;e.behavior(async action=>action==='wordWorkspaceStatus'?++statusCalls===1?workspaceStatus(23,'A','A.docx'):workspaceStatus(24,'B','B.docx',true,['A']):undefined);
 assert.equal(await e.workspace.resume(),true);const request=e.calls.find(c=>c.action==='wordDocumentOpen');
 assert.equal(await e.workspace.syncCurrent(),false);assert.equal(e.workspace.wordDocumentUnavailable,true);
 assert.equal(e.workspace.pending,true);assert.equal(e.workspace.visibleSource(null),null);
 assert.equal(e.calls.some(c=>c.action==='wordDocumentCancel'),false);
 await assert.rejects(e.workspace.prepareIncoming(old,requestId),/连接已结束/);
 assert.equal(e.workspace.pending,false);assert.equal(e.calls.some(c=>c.action==='wordDocumentCancel'),false);
 assert.equal(request.payload.target,undefined);
});
 test('A restarted metadata service can use a lower revision without hiding a new document',async()=>{const e=setup(),old={...document(),documentIdentity:'A',insertion:false};e.state.source=old;e.state.wordTicket=ticket;e.workspace.accepted(old);let value=workspaceStatus(100,'A');e.behavior(async action=>action==='wordWorkspaceStatus'?value:undefined);await e.workspace.syncCurrent();value=workspaceStatus(1,'B');assert.equal(await e.workspace.syncCurrent(),true);await assert.rejects(e.workspace.prepareIncoming({...old,documentIdentity:'C'},requestId),/当前文档已变化/);});

test('Dock resume reads the current document name before an empty result replaces the cached list',async()=>{const e=setup();e.workspace.remember({...document(),documentIdentity:'A',documentName:'A.docx'});e.behavior(async action=>action==='wordWorkspaceStatus'?workspaceStatus(2,'C','C.docx'):action==='wordDocumentStatus'?{state:'empty'}:undefined);assert.equal(await e.workspace.resume(),true);await new Promise(resolve=>setImmediate(resolve));assert.equal(e.workspace.visibleSource(null),null);assert.equal(e.workspace.documentName,'C.docx');assert.equal(e.workspace.otherWordDocumentName,null);});

test('Automatic same-identity sync remains a no-op',async()=>{
 const e=setup(),old={...document(),documentIdentity:'A',documentName:'A.docx',insertion:false};
 e.state.source=old;e.state.wordTicket=ticket;e.workspace.accepted(old);
 e.behavior(async action=>action==='wordWorkspaceStatus'?workspaceStatus(11,'A','A.docx'):undefined);
 assert.equal(await e.workspace.syncCurrent(),false);
 assert.equal(e.state.wordTicket,ticket);assert.strictEqual(e.state.source,old);
 assert.equal(e.calls.filter(c=>c.action==='detach'||c.action==='wordDocumentOpen').length,0);
});

test('Manual same-identity refresh detaches a clean ticket and binds the fresh capture to that identity',async()=>{
 const e=setup(),old={...document(),documentIdentity:'A',documentName:'A.docx',insertion:false},freshRequest='f'.repeat(64);
 e.state.source=old;e.state.wordTicket=ticket;e.workspace.accepted(old);
 e.behavior(async(action)=>action==='wordWorkspaceStatus'?workspaceStatus(12,'A','A.docx'):action==='wordDocumentOpen'?{requestId:freshRequest}:undefined);
 assert.equal(await e.workspace.refreshCurrent(),true);
 assert.equal(e.calls.filter(c=>c.action==='detach').length,1);
 assert.equal(e.calls.filter(c=>c.action==='wordDocumentOpen').length,1);
 assert.equal(e.state.wordTicket,null);
 const display=e.workspace.visibleSource(null);
 assert.deepEqual(Array.from(display.objects,object=>object.index),[0,1]);
 assert.equal(display.documentLoading,true);
 assert.equal(display.numberingRefreshNeeded,true);
 await assert.rejects(e.workspace.prepareIncoming({...old,documentIdentity:'B'},freshRequest),/Word 当前文档已变化/);
 assert.equal(e.workspace.pending,false);
});

test('Manual refresh declines a dirty draft with a message and keeps the Word binding',async()=>{
 const e=setup(),old={...document(),documentIdentity:'A',documentName:'A.docx',insertion:false};
 e.state.source=old;e.state.wordTicket=ticket;e.state.draftChanged=true;e.workspace.accepted(old);
 e.behavior(async action=>action==='wordWorkspaceStatus'?workspaceStatus(13,'A','A.docx'):undefined);
 assert.equal(await e.workspace.refreshCurrent(),false);
 assert.equal(e.state.wordTicket,ticket);assert.strictEqual(e.state.source,old);
 assert.equal(e.calls.filter(c=>c.action==='detach'||c.action==='wordDocumentOpen').length,0);
 assert.ok(e.messages.some(m=>m.error&&m.text.includes('未保存更改')&&m.text.includes('草稿已保留')));
});

test('Manual refresh leaves a disconnected or uncertain Word session untouched',async()=>{
 for(const status of [workspaceStatus(14,'', '',false),null]){
  const e=setup(),old={...document(),documentIdentity:'A',insertion:false};e.state.source=old;e.state.wordTicket=ticket;e.workspace.accepted(old);
  e.behavior(async action=>action==='wordWorkspaceStatus'?status:undefined);
  assert.equal(await e.workspace.refreshCurrent(),false);
  assert.equal(e.state.wordTicket,ticket);assert.strictEqual(e.state.source,old);
  assert.equal(e.calls.filter(c=>c.action==='detach'||c.action==='wordDocumentOpen').length,0);
 }
});

test('Manual refresh is blocked during busy, pending, unresolved and selecting states',async()=>{
 for(const blocked of ['busy','outcomeUnknown']){
  const e=setup(),old={...document(),documentIdentity:'A',insertion:false};e.state.source=old;e.state.wordTicket=ticket;e.state[blocked]=true;e.workspace.accepted(old);
  e.behavior(async action=>action==='wordWorkspaceStatus'?workspaceStatus(15,'A'):undefined);
  assert.equal(await e.workspace.refreshCurrent(),false,blocked);
  assert.equal(e.state.wordTicket,ticket);assert.strictEqual(e.state.source,old);
  assert.equal(e.calls.filter(c=>c.action==='detach'||c.action==='wordDocumentOpen').length,0,blocked);
 }
 {
  const e=setup(),old={...document(),documentIdentity:'A',insertion:false};e.workspace.remember(old);
  e.behavior(async action=>action==='wordWorkspaceStatus'?workspaceStatus(16,'A'):undefined);
  assert.equal(await e.workspace.resume(),true);const opens=e.calls.filter(c=>c.action==='wordDocumentOpen').length;
  assert.equal(e.workspace.pending,true);assert.equal(await e.workspace.refreshCurrent(),false);
  assert.equal(e.calls.filter(c=>c.action==='wordDocumentOpen').length,opens);
 }
 {
  const e=setup(),old={...document(),documentIdentity:'A',insertion:false},confirmation=deferred(),confirmStarted=deferred();
  e.state.source=old;e.state.wordTicket=ticket;e.state.draftChanged=true;e.workspace.accepted(old);
  e.behavior(async action=>{if(action==='wordWorkspaceStatus')return workspaceStatus(17,'B');if(action==='confirmWordSessionSwitch'){confirmStarted.resolve();return confirmation.promise;}});
  assert.equal(await e.workspace.syncCurrent(),false);e.state.draftChanged=false;
  const switching=e.workspace.switchToCurrent();await confirmStarted.promise;
  assert.equal(await e.workspace.refreshCurrent(),false);
  assert.equal(e.state.wordTicket,ticket);assert.strictEqual(e.state.source,old);
  assert.equal(e.calls.filter(c=>c.action==='detach'||c.action==='wordDocumentOpen').length,0);
  confirmation.resolve({discard:false});assert.equal(await switching,false);
 }
});

const catalogStatus=(active='word:A')=>({connected:true,revision:3,active:{identity:active,name:'Same.docx'},retiredIdentities:[],documents:[{identity:'word:A',name:'Same.docx',readOnly:false},{identity:'word:B',name:'Same.docx',readOnly:false},{identity:'word:C',name:'ReadOnly.docx',readOnly:true}]});
test('The open document catalog is metadata-only and keeps same-named identities distinct',async()=>{
 const e=setup();e.behavior(async action=>action==='wordWorkspaceStatus'?catalogStatus():undefined);
 assert.equal(await e.workspace.refreshList(),true);assert.equal(e.workspace.openDocuments.length,3);assert.deepEqual(e.workspace.openDocuments.map(x=>x.identity),['word:A','word:B','word:C']);
 assert.equal(e.workspace.connected,true);assert.equal(e.calls.some(x=>x.action==='wordDocumentOpen'||x.action==='detach'),false);
 const copy=e.workspace.openDocuments;copy[0].name='mutated';assert.equal(e.workspace.openDocuments[0].name,'Same.docx');
});
test('Metadata retirement hides a live source and preserves all editor state until foreground sync',async()=>{
 for(const statePatch of [{},{draftChanged:true},{busy:true},{outcomeUnknown:true}]){
  const e=setup(),old={...document(),documentIdentity:'word:A',documentName:'A.docx',insertion:false};
  Object.assign(e.state,{source:old,wordTicket:ticket,...statePatch});e.workspace.accepted(old);e.workspace.remember(old);
  await confirmPublished(e,old);
  e.behavior(async action=>action==='wordWorkspaceStatus'?{...catalogStatus('word:B'),retiredIdentities:['word:A']}:undefined);
  assert.equal(await e.workspace.refreshList(),true);
  assert.equal(e.workspace.wordDocumentUnavailable,true);assert.equal(e.workspace.visibleSource(old),null);
  assert.equal(e.workspace.openDocuments.some(item=>item.identity==='word:A'),false);
  assert.equal(e.state.source,old);assert.equal(e.state.wordTicket,ticket);assert.equal(e.state.draftChanged,!!statePatch.draftChanged);
  assert.equal(e.calls.some(call=>['detach','wordDocumentOpen','wordDocumentCancel'].includes(call.action)),false);
  await assert.rejects(e.workspace.prepareIncoming(old,requestId),/连接已结束|请求已经结束/);
 }
});
test('Foreground sync completes metadata retirement for an active target or no active document',async()=>{
 for(const active of ['word:B',null]){
  const e=setup(),old={...document(),documentIdentity:'word:A',documentName:'A.docx',insertion:false};
  e.state.source=old;e.state.wordTicket=ticket;e.workspace.accepted(old);e.workspace.remember(old);
  await confirmPublished(e,old);
  e.behavior(async action=>action==='wordWorkspaceStatus'?{...catalogStatus(active),active:active?{identity:active,name:'B.docx'}:null,retiredIdentities:['word:A']}:undefined);
  assert.equal(await e.workspace.refreshList(),true);assert.equal(e.workspace.wordDocumentUnavailable,true);
  assert.equal(await e.workspace.syncCurrent(),true);
  assert.equal(e.calls.filter(call=>call.action==='detach').length,1);assert.equal(e.state.wordTicket,null);assert.equal(e.state.source,null);
  assert.equal(e.calls.some(call=>call.action==='wordDocumentOpen'),active==='word:B');
  if(active==='word:B')assert.deepEqual(JSON.parse(JSON.stringify(e.calls.find(call=>call.action==='wordDocumentOpen').payload)),{});
  assert.equal(e.workspace.wordDocumentUnavailable,false);
 }
});
test('Metadata retirement leaves a pending request intact and disconnected metadata cannot retire',async()=>{
 const e=setup();e.workspace.remember({...document(),documentIdentity:'word:A',documentName:'A.docx'});
 let disconnected=false;e.behavior(async action=>action==='wordWorkspaceStatus'?{...catalogStatus('word:B'),connected:!disconnected,retiredIdentities:['word:A']}:undefined);
 assert.equal(await e.workspace.resume(),true);assert.equal(e.workspace.pending,true);
 assert.equal(await e.workspace.refreshList(),true);assert.equal(e.workspace.wordDocumentUnavailable,true);
 assert.equal(e.workspace.pending,true);assert.equal(e.calls.some(call=>call.action==='wordDocumentCancel'),false);
 const disconnectedCase=setup(),old={...document(),documentIdentity:'word:A',documentName:'A.docx',insertion:false};
 disconnectedCase.state.source=old;disconnectedCase.state.wordTicket=ticket;disconnectedCase.workspace.accepted(old);
 disconnectedCase.behavior(async action=>action==='wordWorkspaceStatus'?{...catalogStatus('word:B'),connected:false,retiredIdentities:['word:A']}:undefined);
 assert.equal(await disconnectedCase.workspace.refreshList(),false);assert.equal(disconnectedCase.workspace.wordDocumentUnavailable,false);
 assert.equal(disconnectedCase.state.source,old);assert.equal(disconnectedCase.state.wordTicket,ticket);
});

test('A no-document completion clears an empty cached retirement banner',async()=>{
 const e=setup();let wake,finished=false;
 e.api.pause=()=>new Promise(resolve=>{wake=resolve;});
 e.workspace.remember({...document(),documentIdentity:'word:A',documentName:'A.docx'});
 e.behavior(async action=>action==='wordWorkspaceStatus'?{...catalogStatus(null),active:null,documents:[],retiredIdentities:['word:A']}:action==='wordDocumentStatus'?{state:finished?'no-document':'queued'}:undefined);
 assert.equal(await e.workspace.resume(),true);await new Promise(resolve=>setImmediate(resolve));
 await e.workspace.refreshList();assert.equal(e.workspace.wordDocumentUnavailable,true);
 finished=true;wake();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(e.workspace.pending,false);assert.equal(e.workspace.hasDocument,false);
 assert.equal(e.workspace.wordDocumentUnavailable,false);assert.equal(e.workspace.documentName,null);
});

test('Clearing a detached closed-document draft retires its title even when active identity stays null',async()=>{
 const e=setup(),old={...document(),documentIdentity:'word:A',documentName:'A.docx'};
 Object.assign(e.state,{source:old,wordTicket:ticket,draftChanged:true});e.workspace.accepted(old);e.workspace.remember(old);
 await confirmPublished(e,old);
 e.behavior(async action=>action==='wordWorkspaceStatus'?{...catalogStatus(null),active:null,documents:[],retiredIdentities:['word:A']}:undefined);
 let cleared=0;e.api.empty=()=>cleared++;
 await e.workspace.syncCurrent();assert.equal(e.workspace.wordDocumentUnavailable,true);
 assert.equal(e.state.source,null);assert.equal(cleared,0,'a retained draft is not reset');
 e.state.draftChanged=false;
 assert.equal(await e.workspace.syncCurrent(),true);assert.equal(e.workspace.wordDocumentUnavailable,false);
 assert.equal(e.workspace.documentName,null);assert.equal(cleared,1);
});
test('Choosing a nonactive document binds a fresh request to that identity, not the active one',async()=>{
 const e=setup(),old={...document(),documentIdentity:'word:A',insertion:false};e.state.source=old;e.state.wordTicket=ticket;e.workspace.accepted(old);
 e.behavior(async action=>action==='wordWorkspaceStatus'?catalogStatus():undefined);
 assert.equal(await e.workspace.chooseDocument('word:B'),true);
 assert.equal(JSON.stringify(e.calls.find(x=>x.action==='wordDocumentOpen').payload),JSON.stringify({documentIdentity:'word:B'}));
 assert.equal(await e.workspace.chooseDocument('word:A'),false,'pending requests cannot overlap');
 await assert.rejects(e.workspace.prepareIncoming({...old,documentIdentity:'word:C'},requestId),/当前文档已变化/);
});
test('Document selection preserves drafts on decline or if the chosen document closes during confirmation',async()=>{
 for(const closes of [false,true]){
  const e=setup(),old={...document(),documentIdentity:'word:A',insertion:false};e.state.source=old;e.state.wordTicket=ticket;e.state.draftChanged=true;e.workspace.accepted(old);let status=catalogStatus();
  e.behavior(async action=>{if(action==='wordWorkspaceStatus')return status;if(action==='confirmWordSessionSwitch'){if(closes){status={...status,documents:[status.documents[0]],retiredIdentities:['word:B']};return {discard:true};}return {discard:false};}});
  assert.equal(await e.workspace.chooseDocument('word:B'),false);assert.equal(e.state.wordTicket,ticket);assert.equal(e.state.source,old);assert.equal(e.calls.some(x=>x.action==='detach'||x.action==='wordDocumentOpen'),false);
 }
});
test('Read-only and disconnected document choices never detach the current editor',async()=>{
 for(const status of [catalogStatus(),{...catalogStatus(),connected:false}]){const e=setup();e.state.wordTicket=ticket;e.behavior(async action=>action==='wordWorkspaceStatus'?status:undefined);assert.equal(await e.workspace.chooseDocument('word:C'),false);assert.equal(e.state.wordTicket,ticket);assert.equal(e.calls.some(x=>x.action==='detach'),false);}
});
test('An identity-bound empty document keeps its name and does not repeatedly reopen',async()=>{
 const e=setup();e.behavior(async action=>action==='wordWorkspaceStatus'?catalogStatus('word:B'):action==='wordDocumentStatus'?{state:'empty',documentIdentity:'word:B'}:undefined);
 assert.equal(await e.workspace.chooseDocument('word:B'),true);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(e.workspace.pending,false);assert.equal(e.workspace.documentIdentity,'word:B');assert.equal(e.workspace.documentName,'Same.docx');
 assert.equal(e.workspace.documentReadState,'empty');
 assert.equal(await e.workspace.syncCurrent(),false);assert.equal(e.calls.filter(x=>x.action==='wordDocumentOpen').length,1);
});
test('A failed document read retries the selected document even when a different Word window is active',async()=>{
 const e=setup(),first=deferred(),second=deferred();let reads=0;
 e.behavior(async action=>{
  if(action==='wordWorkspaceStatus')return catalogStatus();
  if(action==='wordDocumentStatus')return reads++===0?first.promise:second.promise;
 });
 assert.equal(await e.workspace.chooseDocument('word:B'),true);
 assert.equal(e.workspace.documentReadState,'loading');
 first.resolve({state:'failed'});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(e.workspace.documentReadState,'failed');
 assert.equal(e.workspace.documentIdentity,'word:B');
 assert.equal(e.workspace.documentName,'Same.docx');
 assert.equal(await e.workspace.retryRead(),true);
 assert.equal(e.workspace.documentReadState,'loading');
 assert.equal(e.calls.filter(call=>call.action==='wordDocumentOpen').at(-1).payload.documentIdentity,'word:B');
 second.resolve({state:'empty',documentIdentity:'word:B'});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(e.workspace.documentReadState,'empty');
});
test('Stable catalog polling does not detach or reload a current equation',async()=>{
 const e=setup(),old={...document(),documentIdentity:'word:A',insertion:false};e.state.source=old;e.state.wordTicket=ticket;e.workspace.accepted(old);e.behavior(async action=>action==='wordWorkspaceStatus'?catalogStatus():undefined);
 for(let i=0;i<5;i++)assert.equal(await e.workspace.syncCurrent(),false);
 assert.equal(e.calls.some(x=>x.action==='detach'||x.action==='wordDocumentOpen'),false);assert.equal(e.state.wordTicket,ticket);
});

test('Automatic reload falls back once to the verified same document when an old ordinal expires',async()=>{
 const e=setup(),old={...document(),documentIdentity:'word:A',documentName:'Same.docx',insertion:false,documentNumberingRevision:3};
 const fallbackId='f'.repeat(64),firstStatus=deferred(),fallbackStatus=deferred();
 e.state.source=old;e.state.wordTicket=ticket;e.workspace.accepted(old);
 e.behavior(async(action,payload)=>{
  if(action==='wordWorkspaceStatus')return {...catalogStatus('word:A'),documents:[{identity:'word:A',name:'Same.docx',readOnly:false,numberingRevision:4},{identity:'word:B',name:'Same.docx',readOnly:false,numberingRevision:1}]};
  if(action==='wordDocumentOpen')return {requestId:payload.documentIdentity?fallbackId:requestId,state:'queued'};
  if(action==='wordDocumentStatus')return payload.requestId===requestId?firstStatus.promise:fallbackStatus.promise;
 });
 await e.workspace.syncCurrent();
 assert.equal(e.workspace.visibleSource(null).numberingRefreshNeeded,true);
 assert.equal(await e.workspace.select(1,{reload:true,fallbackToDocument:true}),true);
 assert.equal(e.state.wordTicket,null);
 firstStatus.resolve({requestId,state:'failed',identity:'word:A',index:1});
 await new Promise(resolve=>setImmediate(resolve));
 const opens=e.calls.filter(call=>call.action==='wordDocumentOpen');
 assert.equal(opens.length,2);
 assert.equal(opens[0].payload.target.index,1);
 assert.deepEqual(JSON.parse(JSON.stringify(opens[1].payload)),{documentIdentity:'word:A'});
 assert.equal(e.workspace.pending,true);
 const fresh={...old,documentSnapshot:19,documentNumberingRevision:4,activeIndex:2,objects:[{index:0,latex:'inserted',nativeSha256:'e'.repeat(64)},{index:1,latex:'x+1',nativeSha256:digest},{index:2,latex:'y+2',nativeSha256:'d'.repeat(64)}]};
 assert.equal(await e.workspace.prepareIncoming(fresh,fallbackId),true);
 e.workspace.accepted(fresh);
 assert.equal(e.workspace.pending,false);
 assert.equal(e.workspace.visibleSource(null).numberingRefreshNeeded,false);
 assert.equal(e.workspace.visibleSource(null).objects.length,3);
});

test('Automatic reload fallback rejects a foreign document and never silently opens another formula on explicit click',async()=>{
 for(const explicitClick of [true,false]){
  let now=0;
  const e=setup(),old={...document(),documentIdentity:'word:A',documentName:'Same.docx',insertion:false,documentNumberingRevision:3};
  const fallbackId='f'.repeat(64),firstStatus=deferred(),fallbackStatus=deferred();
  e.api.now=()=>now;
  e.state.source=old;e.state.wordTicket=ticket;e.workspace.accepted(old);
  e.behavior(async(action,payload)=>{
   if(action==='wordWorkspaceStatus')return catalogStatus('word:A');
   if(action==='wordDocumentOpen')return {requestId:payload.documentIdentity?fallbackId:requestId,state:'queued'};
   if(action==='wordDocumentStatus')return payload.requestId===requestId?firstStatus.promise:fallbackStatus.promise;
  });
  assert.equal(await e.workspace.select(1,explicitClick?{reload:true}:{reload:true,fallbackToDocument:true}),true);
  firstStatus.resolve({requestId,state:'failed',identity:'word:A',index:1});
  await new Promise(resolve=>setImmediate(resolve));
  const opens=e.calls.filter(call=>call.action==='wordDocumentOpen');
  if(explicitClick){
   assert.equal(opens.length,1,'explicit row click must not fall back to a document-wide open');
   assert.equal(e.workspace.pending,false);
   now=60_000;
   assert.equal(await e.workspace.syncCurrent(),false);
   assert.equal(e.calls.filter(call=>call.action==='wordDocumentOpen').length,1,'polling must not silently reopen another row after an explicit click fails');
  }else{
   assert.equal(opens.length,2);
   await assert.rejects(e.workspace.prepareIncoming({...old,documentIdentity:'word:B',documentSnapshot:19,activeIndex:0},fallbackId),/当前文档已变化/);
   assert.equal(e.workspace.pending,false);
  }
 }
});

test('Temporary Word refusal or timeout recovers with bounded backoff without message spam',async()=>{
 for(const failureMode of ['failed','timeout']){
  let now=0,seq=0,wakePause=null;
  const e=setup(),old={...document(),documentIdentity:'word:A',documentName:'Same.docx',insertion:false,documentNumberingRevision:3};
  e.api.now=()=>now;
  e.api.pause=()=>new Promise(resolve=>{wakePause=resolve;});
  e.state.source=old;e.state.wordTicket=ticket;e.workspace.accepted(old);
  const ids=[];
  e.behavior(async(action,payload)=>{
   if(action==='wordWorkspaceStatus')return catalogStatus('word:A');
   if(action==='wordDocumentOpen'){const id=(++seq).toString(16).padStart(64,'0');ids.push({id,payload});return {requestId:id,state:'queued'};}
   if(action==='wordDocumentStatus'){
    if(failureMode==='timeout'&&ids.length===2)return {state:'queued'};
    return {requestId:payload.requestId,state:'failed',identity:'word:A',index:payload.requestId===ids[0]?.id?1:undefined};
   }
  });
  assert.equal(await e.workspace.select(1,{reload:true,fallbackToDocument:true}),true);
  await new Promise(resolve=>setImmediate(resolve));
  if(failureMode==='timeout'){
   assert.equal(ids.length,2);
   now=60_001;wakePause?.();
   await new Promise(resolve=>setImmediate(resolve));
  }
  assert.equal(e.workspace.pending,false,failureMode);
  assert.equal(ids.length,2,failureMode);
  const errorMessagesAfterInitial=e.messages.filter(m=>m.error).length;
  assert.equal(errorMessagesAfterInitial,1,failureMode);
  // Cooldown: polling every second before 4s must not interrupt Word.
  for(const t of [1000,2000,3000]){
   now+=1000;
   assert.equal(await e.workspace.syncCurrent(),false,`${failureMode}@${t}`);
  }
  assert.equal(ids.length,2,failureMode);
  // Bounded retries at +4s, +14s, +34s (3 total retries).
  now+=1000;assert.equal(await e.workspace.syncCurrent(),true,`${failureMode}:retry1`);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ids.length,3);
  now+=9000;assert.equal(await e.workspace.syncCurrent(),false,`${failureMode}:beforeRetry2`);
  now+=1000;assert.equal(await e.workspace.syncCurrent(),true,`${failureMode}:retry2`);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ids.length,4);
  now+=19000;assert.equal(await e.workspace.syncCurrent(),false,`${failureMode}:beforeRetry3`);
  now+=1000;assert.equal(await e.workspace.syncCurrent(),true,`${failureMode}:retry3`);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ids.length,5);
  // Exhausted: no further unbounded retries.
  now+=120_000;assert.equal(await e.workspace.syncCurrent(),false,`${failureMode}:exhausted`);
  assert.equal(ids.length,5,failureMode);
  // Duplicate failure messages were suppressed across automatic retries.
  if(failureMode==='failed')assert.equal(e.messages.filter(m=>m.error).length,1,'must not spam identical error messages');
 }
});

test('Auto-recovery stops on cancel, superseded, document switch, retirement, read-only or dirty draft',async()=>{
 for(const stopCase of ['cancelled','superseded','switched','retired','readOnly','dirty','explicitCancel']){
  let now=0,seq=0;
  const e=setup(),old={...document(),documentIdentity:'word:A',documentName:'Same.docx',insertion:false,documentNumberingRevision:3};
  e.api.now=()=>now;
  e.state.source=old;e.state.wordTicket=ticket;e.workspace.accepted(old);
  let status=catalogStatus('word:A');
  const firstStatus=deferred(),fallbackStatus=deferred();
  e.behavior(async(action,payload)=>{
   if(action==='wordWorkspaceStatus')return status;
   if(action==='wordDocumentOpen'){const id=(++seq).toString(16).padStart(64,'0');return {requestId:id,state:'queued'};}
   if(action==='wordDocumentStatus')return seq===1?firstStatus.promise:fallbackStatus.promise;
  });
  assert.equal(await e.workspace.select(1,{reload:true,fallbackToDocument:true}),true);
  if(stopCase==='cancelled'||stopCase==='superseded'){
   firstStatus.resolve({requestId:'1'.padStart(64,'0'),state:stopCase,identity:'word:A',index:1});
   await new Promise(resolve=>setImmediate(resolve));
   assert.equal(seq,1,stopCase);
   now=10_000;assert.equal(await e.workspace.syncCurrent(),false,stopCase);
   assert.equal(seq,1,stopCase);
   continue;
  }
  if(stopCase==='switched')status=catalogStatus('word:B');
  if(stopCase==='retired')status={...catalogStatus('word:B'),retiredIdentities:['word:A']};
  if(stopCase==='readOnly')status={...catalogStatus('word:A'),documents:[{identity:'word:A',name:'Same.docx',readOnly:true}]};
  firstStatus.resolve({requestId:'1'.padStart(64,'0'),state:'failed',identity:'word:A',index:1});
  await new Promise(resolve=>setImmediate(resolve));
  if(['switched','retired','readOnly'].includes(stopCase)){
   assert.equal(seq,1,`fallback must not open word:A when ${stopCase}`);
   if(stopCase==='readOnly'){now=10_000;assert.equal(await e.workspace.syncCurrent(),false);assert.equal(seq,1);}
   continue;
  }
  assert.equal(seq,2,stopCase);
  fallbackStatus.resolve({requestId:'2'.padStart(64,'0'),state:'failed'});
  await new Promise(resolve=>setImmediate(resolve));
  if(stopCase==='dirty')e.state.draftChanged=true;
  if(stopCase==='explicitCancel')await e.workspace.cancelPending();
  now=10_000;
  assert.equal(await e.workspace.syncCurrent(),false,stopCase);
  assert.equal(seq,2,stopCase);
 }
});

test('Automatic reload clears stale cache cleanly when the same verified document becomes empty',async()=>{
 const e=setup(),old={...document(),documentIdentity:'word:A',documentName:'Same.docx',insertion:false,documentNumberingRevision:3};
 let emptyCalls=0,seq=0;e.api.empty=()=>{emptyCalls++;};
 e.state.source=old;e.state.wordTicket=ticket;e.workspace.accepted(old);
 e.behavior(async(action,payload)=>{
  if(action==='wordWorkspaceStatus')return catalogStatus('word:A');
  if(action==='wordDocumentOpen')return {requestId:(++seq).toString(16).padStart(64,'0'),state:'queued'};
  if(action==='wordDocumentStatus')return seq===1?{requestId:payload.requestId,state:'failed',identity:'word:A',index:1}:{requestId:payload.requestId,state:'empty',documentIdentity:'word:A'};
 });
 assert.equal(await e.workspace.select(1,{reload:true,fallbackToDocument:true}),true);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(seq,2);assert.equal(e.workspace.pending,false);assert.equal(e.workspace.visibleSource(null),null);
 assert.equal(e.workspace.documentReadState,'empty');assert.equal(emptyCalls,1);
});

test('Target position shift rejected by prepareIncoming recovers via controlled same-document refresh',async()=>{
 let now=0,seq=0;
 const e=setup(),old={...document(),documentIdentity:'word:A',documentName:'Same.docx',insertion:false,documentNumberingRevision:3};
 e.api.now=()=>now;
 e.state.source=old;e.state.wordTicket=ticket;e.workspace.accepted(old);
 e.behavior(async action=>{
  if(action==='wordWorkspaceStatus')return catalogStatus('word:A');
  if(action==='wordDocumentOpen')return {requestId:(++seq).toString(16).padStart(64,'0'),state:'queued'};
  if(action==='wordDocumentStatus')return {state:'queued'};
 });
 assert.equal(await e.workspace.select(1,{reload:true,fallbackToDocument:true}),true);
 const shifted={...old,documentSnapshot:18,activeIndex:0,documentPosition:2,objects:[old.objects[1]]};
 await assert.rejects(e.workspace.prepareIncoming(shifted,'1'.padStart(64,'0')),/内容或位置已经变化/);
 assert.equal(e.workspace.pending,false);
 now=4000;
 assert.equal(await e.workspace.syncCurrent(),true);
 const opens=e.calls.filter(call=>call.action==='wordDocumentOpen');
 assert.equal(opens.length,2);
 assert.deepEqual(JSON.parse(JSON.stringify(opens[1].payload)),{documentIdentity:'word:A'});
});

test('Repeated background status polling failures do not spam the message bar',async()=>{
 const e=setup();let fail=true;
 e.behavior(async action=>{if(action==='wordWorkspaceStatus'){if(fail)throw Error('connect ECONNREFUSED');return catalogStatus('word:A');}});
 assert.equal(await e.workspace.refreshList(),false);
 assert.equal(await e.workspace.refreshList(),false);
 assert.equal(await e.workspace.refreshList(),false);
 assert.equal(e.messages.length,1);
 assert.equal(await e.workspace.syncCurrent(),false);
 assert.equal(await e.workspace.syncCurrent(),false);
 assert.equal(e.messages.length,2);
 // Manual refresh still reports error explicitly.
 assert.equal(await e.workspace.refreshCurrent(),false);
 assert.equal(e.messages.length,3);
 // Recovering resets deduplication so a future failure reports once.
 fail=false;assert.equal(await e.workspace.refreshList(),true);
 fail=true;assert.equal(await e.workspace.refreshList(),false);
 assert.equal(await e.workspace.refreshList(),false);
 assert.equal(e.messages.length,4);
});

test('Content-only save during documentLoading after local format save preserves confirmed numbering revision while invalidating the edited row',async()=>{
 for(const [editedRow,partialRevision] of [[2,4],[5,4],[2,3]]){
  const e=setup(),source={...document(),insertion:false,documentNumberingRevision:3,
   objects:Array.from({length:112},(_,index)=>({index,nativeSha256:(index+1).toString(16).padStart(64,'0'),latex:`x_${index}`,image:`image-${index}`,
    layout:{mode:'numbered-right',chapter:2,equation:index+1,numberFormat:'(#C1.#E1)',numberText:`(2.${index+1})`}}))};
  const row2Digest=source.objects[2].nativeSha256;
  const ack={documentIdentity:source.documentIdentity,documentSnapshot:source.documentSnapshot,index:2,previousNativeSha256:row2Digest,nativeSha256:row2Digest,numberingChanged:true,numberingLocal:true};
  e.workspace.rememberAfterSave(source,2,ack,'x_2',{format:'(#C1-#E1)',side:'right',previewText:'(2-3)',verifiedStartRevision:3});
  const partial={...source,documentSnapshot:18,documentLoading:true,activeIndex:0,documentPosition:editedRow,documentTotal:112,
   documentNumberingRevision:partialRevision,numberingRefreshNeeded:false,objects:[{index:0,nativeSha256:source.objects[editedRow].nativeSha256}]};
  // Content-only save while background document is still loading: server receipt change is null.
  e.workspace.rememberAfterSave(partial,0,null,'edited content',undefined);
  const cached=e.workspace.visibleSource(null);
  assert.equal(cached.objects[editedRow].nativeSha256,null,`edited row ${editedRow} native identity must be invalidated`);
  assert.equal(cached.objects[editedRow].image,null,`edited row ${editedRow} preview must be invalidated`);
  assert.equal(cached.objects[editedRow].latex,`x_${editedRow}`,'unconfirmed latex must not replace cached row');
  const untouched=editedRow===2?5:2;
  assert.equal(cached.objects[untouched].nativeSha256,source.objects[untouched].nativeSha256);
  assert.equal(cached.objects[untouched].image,`image-${untouched}`);
  assert.equal(cached.objects[2].layout.numberText,'(2-3)');
  assert.equal(cached.numberingRefreshNeeded,false);
  // Polling with Word's confirmed revision 4 keeps all 112 rows fresh.
  let liveRevision=4;
  e.behavior(action=>action==='wordWorkspaceStatus'?{connected:true,active:{identity:source.documentIdentity,name:source.documentName},
   documents:[{identity:source.documentIdentity,name:source.documentName,readOnly:false,numberingRevision:liveRevision}]}:undefined);
  assert.equal(await e.workspace.refreshList(),true);
  assert.equal(e.workspace.visibleSource(null).numberingRefreshNeeded,false,'confirmed revision 4 must not flip 112 rows stale');
  // Edited row cannot be opened as a verified target.
  assert.equal(await e.workspace.select(editedRow),false);
  // Reopening the edited row during load cannot pretend its unconfirmed row is fresh.
  assert.equal(e.workspace.visibleSource({...partial,documentNumberingRevision:4}).numberingRefreshNeeded,true);
  // Reopening an untouched row during load still keeps confirmed numbers fresh.
  const untouchedPartial={...partial,documentNumberingRevision:4,documentPosition:untouched,objects:[{index:0,nativeSha256:source.objects[untouched].nativeSha256}]};
  assert.equal(e.workspace.visibleSource(untouchedPartial).numberingRefreshNeeded,false);
  // Unconfirmed save must NOT be treated as warm-Dock-verified (even after cancelling an untouched row).
  e.workspace.rememberAfterCancel(untouchedPartial);
  assert.equal(await e.workspace.resume(),true);
  assert.equal(e.calls.filter(call=>call.action==='wordDocumentOpen').length,1,'Dock must request a fresh capture after an unconfirmed content save');
  // A newer Word revision 5 still flips the list stale.
  liveRevision=5;
  await e.workspace.refreshList();
  assert.equal(e.workspace.visibleSource(null).numberingRefreshNeeded,true);
 }
});

test('Diverged or unverified partial saves never stay marked fresh and still invalidate the edited row',async()=>{
 for(const variant of ['differentCount','newerRevision','newerLiveRevision','partialStale','ownerMismatch','numberingRequested','missingRevision']){
  const e=setup(),source={...document(),insertion:false,documentNumberingRevision:3,
   objects:Array.from({length:4},(_,index)=>({index,nativeSha256:(index+1).toString(16).padStart(64,'0'),latex:`x_${index}`,image:`image-${index}`,
    layout:{mode:'numbered-right',chapter:2,equation:index+1,numberFormat:'(#C1.#E1)',numberText:`(2.${index+1})`}}))};
  const row0Digest=source.objects[0].nativeSha256;
  const ack={documentIdentity:source.documentIdentity,documentSnapshot:source.documentSnapshot,index:0,previousNativeSha256:row0Digest,nativeSha256:row0Digest,numberingChanged:true,numberingLocal:true};
  e.workspace.rememberAfterSave(source,0,ack,'x_0',{format:'(#C1-#E1)',side:'right',previewText:'(2-1)',verifiedStartRevision:3});
  const partial={...source,documentSnapshot:18,documentLoading:true,activeIndex:0,documentPosition:1,
   documentTotal:variant==='differentCount'?5:4,
   documentNumberingRevision:variant==='newerRevision'?5:variant==='missingRevision'?undefined:4,
   liveNumberingRevision:variant==='newerLiveRevision'?5:undefined,
   numberingRefreshNeeded:variant==='partialStale',
   objects:[{index:0,nativeSha256:variant==='ownerMismatch'?'f'.repeat(64):source.objects[1].nativeSha256}]};
  e.workspace.rememberAfterSave(partial,0,null,'edited',variant==='numberingRequested'?{format:'(#E1)',side:'right'}:undefined);
  const cached=e.workspace.visibleSource(null);
  assert.equal(cached.objects[1].nativeSha256,null,variant);
  assert.equal(cached.objects[1].image,null,variant);
  assert.equal(cached.numberingRefreshNeeded,true,variant);
  assert.equal(cached.formatSaveRevision,null,variant);
 }
});
