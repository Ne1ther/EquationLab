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
 const api={state:()=>state,changed(){},message:(text,error)=>messages.push({text,error}),now:()=>0,pause:()=>new Promise(()=>{}),detach:async()=>{calls.push({action:'detach'});state.wordTicket=null;state.source=null;return true;},native:async(action,payload)=>{
  calls.push({action,payload});if(behavior){const result=await behavior(action,payload);if(result!==undefined)return result;}
  if(action==='confirmWordSessionSwitch')return {discard};if(action==='wordDocumentOpen')return {requestId,state:'queued'};if(action==='wordDocumentStatus')return {state:'queued'};return {};
 }};
 const workspace=context.window.createWordDocumentWorkspace(api);return {workspace,state,calls,messages,discard:()=>{discard=true;},behavior:fn=>{behavior=fn;}};
}

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
 const e=setup(),response=deferred();e.behavior(async action=>action==='wordDocumentOpen'?response.promise:undefined);
 const opening=e.workspace.resume();await Promise.resolve();await Promise.resolve();await e.workspace.cancelPending();response.resolve({requestId,state:'queued'});assert.equal(await opening,false);
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
