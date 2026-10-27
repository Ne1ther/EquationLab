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
test('Switching between documents with identical formulas and names opens a fresh empty Word session',async()=>{
 const e=setup(),old={...document(),documentIdentity:'A',documentName:'same.docx',insertion:false};e.state.source=old;e.state.wordTicket=ticket;e.workspace.accepted(old);
 e.behavior(async action=>action==='wordWorkspaceStatus'?workspaceStatus(1,'B','same.docx'):undefined);
 assert.equal(await e.workspace.syncCurrent(),true);
 assert.deepEqual(e.calls.filter(c=>c.action==='detach').length,1);
 const opening=e.calls.find(c=>c.action==='wordDocumentOpen');assert.deepEqual(JSON.parse(JSON.stringify(opening.payload)),{});
 assert.equal(e.workspace.visibleSource(null),null,'the old formula list is hidden while the new Word document is being read');
});

test('A Word draft stays visible and offers a confirmed switch to the other document',async()=>{
 const e=setup(),old={...document(),documentIdentity:'A',documentName:'A.docx',insertion:false};e.state.source=old;e.state.wordTicket=ticket;e.state.draftChanged=true;e.workspace.accepted(old);let discard=false;
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
 assert.equal(await e.workspace.syncCurrent(),false);assert.equal(e.calls.filter(x=>x.action==='wordDocumentOpen').length,1);
});
test('Stable catalog polling does not detach or reload a current equation',async()=>{
 const e=setup(),old={...document(),documentIdentity:'word:A',insertion:false};e.state.source=old;e.state.wordTicket=ticket;e.workspace.accepted(old);e.behavior(async action=>action==='wordWorkspaceStatus'?catalogStatus():undefined);
 for(let i=0;i<5;i++)assert.equal(await e.workspace.syncCurrent(),false);
 assert.equal(e.calls.some(x=>x.action==='detach'||x.action==='wordDocumentOpen'),false);assert.equal(e.state.wordTicket,ticket);
});
