import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const code=await readFile(new URL('../desktop/app.js',import.meta.url),'utf8');
const slice=(from,to)=>code.slice(code.indexOf(from),code.indexOf(to));
function editor(){
 const calls=[],messages=[],elements=new Map();let confirm=false,failRead=false;
 const context=vm.createContext({window:{},busy:false,wordNavigating:false,wordNavigationTimer:null,wordTicket:null,wordSaveQueued:false,wordCommitRunning:null,timer:null,revision:0,validationRequested:false,validationPending:false,valid:true,idleWaiters:new Set(),source:null,selected:null,editingRuler:undefined,
  mf:{value:'',readOnly:false},$:id=>{if(!elements.has(id))elements.set(id,{hidden:false,value:'',querySelectorAll:()=>[]});return elements.get(id);},
  setTimeout,clearTimeout,controls(){},message:text=>messages.push(text),requestWorkbenchSync(){},renderObjects(){},loadWordThumbnails(){},resetNewFormula(){context.mf.value='';context.source=null;context.selected=null;},
  syncSidebar:async()=>{},validate:async()=>{},
  selectObject(index){context.selected=context.source.objects[index];context.mf.value=context.selected.latex;context.selected.editorBaseline=context.mf.value;},
  wordSessionChanged:()=>context.mf.value!==context.selected?.editorBaseline,
  native:async(action,payload)=>{calls.push({action,payload});if(action==='confirmWordSessionSwitch')return {discard:confirm};if(action==='wordSessionRead'){if(failRead)throw Error('read failed');return {hasDocumentContext:true,activeIndex:1,objects:[{index:0,latex:'other'},{index:1,latex:payload.ticket.slice(0,8)}]};}return {};}
 });
 vm.runInContext(code.split('\n').find(l=>l.startsWith('async function perform('))+'\n'+slice('async function waitForEditorIdle(','function resetNewFormula()')+'\n'+slice('window.nativeOpenWordSession=async','async function loadWordThumbnails'),context);
 return {context,calls,messages,discard:value=>confirm=value,failRead:()=>failRead=true};
}
function installCommit(context){
 const bind=slice('async function bindSelectedWordFormula()','window.nativeCommitWordSession=()=>{');
 const lifecycle=slice('window.nativeCommitWordSession=()=>{',"$('word-session-save').onclick");
 vm.runInContext(bind+'\n'+lifecycle,context);
}
test('Thirty direct Word activations replace clean sessions, release every old ticket and bind the selected equation',async()=>{
 const {context,calls,messages}=editor();
 for(let i=1;i<=30;i++){
  const ticket=i.toString(16).padStart(64,'0');
  assert.equal(await context.window.nativeOpenWordSession(ticket),true,messages.join(' | '));
  assert.equal(context.wordTicket,ticket);assert.equal(context.selected.index,1);assert.equal(context.mf.value,ticket.slice(0,8));assert.equal(context.busy,false);
  assert.equal(await context.window.nativeOpenWordSession(ticket),true,'duplicate reopen keeps the same editor');
 }
 assert.equal(calls.filter(c=>c.action==='wordSessionRead').length,60,'each activation reads once and each duplicate verifies the live ticket');
 const cancelled=calls.filter(c=>c.action==='wordSessionCancel').map(c=>c.payload.ticket);
 assert.deepEqual(cancelled,Array.from({length:29},(_,i)=>(i+1).toString(16).padStart(64,'0')));
});
for(const standalone of [false,true])test(`A dirty ${standalone?'standalone draft':'Word formula'} rejects a new ticket without overwriting text`,async()=>{
 const p=editor(),a='a'.repeat(64),b='b'.repeat(64);
 if(!standalone)assert.equal(await p.context.window.nativeOpenWordSession(a),true);
 p.context.mf.value='important unsaved draft';
 assert.equal(await p.context.window.nativeOpenWordSession(b),false);
 assert.equal(p.context.mf.value,'important unsaved draft');assert.equal(p.context.wordTicket,standalone?null:a);
 assert.deepEqual(p.calls.filter(c=>c.action==='wordSessionCancel').map(c=>c.payload.ticket),[b]);
 p.discard(true);assert.equal(await p.context.window.nativeOpenWordSession('c'.repeat(64)),true);assert.equal(p.context.wordTicket,'c'.repeat(64));
});
test('A failed replacement read preserves the old source binding and cancels only the incoming ticket',async()=>{
 const p=editor(),a='a'.repeat(64),b='b'.repeat(64);await p.context.window.nativeOpenWordSession(a);const original=p.context.source;p.failRead();
 assert.equal(await p.context.window.nativeOpenWordSession(b),false);assert.equal(p.context.wordTicket,a);assert.equal(p.context.source,original);
 assert.deepEqual(p.calls.filter(c=>c.action==='wordSessionCancel').map(c=>c.payload.ticket),[b]);assert.equal(p.context.busy,false);
});

test('Save and window-close share one commit, keep App in front while waiting, and clear only after acknowledgement',async()=>{
 const p=editor(),c=p.context,order=[];await c.window.nativeOpenWordSession('a'.repeat(64));c.mf.value='changed';
 c.ensureValid=async()=>{};c.sourceEditMode=()=> 'rebuild';c.rulerPatch=()=>({});
 c.native=async action=>{order.push(action);if(action==='wordSessionSave')return {acknowledgement:true};if(action==='wordSessionStatus')return {state:'committed'};return {};};
 c.syncSidebar=async()=>{order.push('hide');assert.equal(c.mf.value,'changed','do not flash a blank editor while saving');};
 installCommit(c);
 const saved=c.window.nativeCommitWordSession(),closed=c.window.nativePrepareToClose();
 assert.equal(await saved,true);assert.equal(await closed,true);
 assert.deepEqual(order,['wordSessionSave','wordSessionStatus','hide']);assert.equal(c.wordTicket,null);assert.equal(c.busy,false);assert.equal(c.wordSaveQueued,false);
});

test('Rejecting or failing an incoming Word request never poisons the previous document list',async()=>{
 for(const failure of ['reject','read']){
  const p=editor(),c=p.context;await c.window.nativeOpenWordSession('a'.repeat(64));const original=c.source;
  if(failure==='reject')c.mf.value='keep this draft';else p.failRead();
  assert.equal(await c.window.nativeOpenWordSession('b'.repeat(64)),false);
  assert.equal(c.source,original);assert.equal(c.source.navigationUnavailable,undefined);assert.equal(c.wordTicket,'a'.repeat(64));
 }
});

test('Explicit cancel works during an incoming read and a late response cannot reopen the cancelled editor',async()=>{
 const p=editor(),c=p.context;await c.window.nativeOpenWordSession('a'.repeat(64));installCommit(c);
 let startRead,finishRead;const started=new Promise(resolve=>{startRead=resolve;}),gate=new Promise(resolve=>{finishRead=resolve;});
 const originalNative=c.native;c.native=async(action,payload)=>{if(action==='wordSessionRead'){startRead();await gate;return {hasDocumentContext:true,activeIndex:0,objects:[{index:0,latex:'late response'}]};}return originalNative(action,payload);};
 const opening=c.window.nativeOpenWordSession('b'.repeat(64));await started;
 assert.equal(c.busy,true);assert.equal(await c.window.nativeCancelWordSession(),true);assert.equal(c.wordTicket,null);assert.equal(c.mf.value,'');
 finishRead();assert.equal(await opening,false);assert.equal(c.wordTicket,null);assert.equal(c.source,null);assert.equal(c.mf.value,'');assert.equal(c.busy,false);
});

test('Cancel during an actual Word save keeps the draft until the bounded acknowledgement finishes',async()=>{
 const p=editor(),c=p.context;await c.window.nativeOpenWordSession('a'.repeat(64));installCommit(c);c.mf.value='changed';
 c.ensureValid=async()=>{};c.sourceEditMode=()=> 'rebuild';c.rulerPatch=()=>({});
 let startSave,finishSave;const started=new Promise(resolve=>{startSave=resolve;}),gate=new Promise(resolve=>{finishSave=resolve;});
 const originalNative=c.native;c.native=async(action,payload)=>{if(action==='wordSessionSave'){startSave();await gate;return {acknowledgement:false};}return originalNative(action,payload);};
 const saving=c.window.nativeCommitWordSession();await started;
 assert.equal(await c.window.nativeCancelWordSession(),false);assert.equal(c.wordTicket,'a'.repeat(64));assert.equal(c.mf.value,'changed');
 finishSave();assert.equal(await saving,true);assert.equal(c.wordTicket,null);assert.equal(c.mf.value,'');assert.ok(p.messages.includes('已保存回 Word 原生公式。'));
 assert.equal(await c.window.nativeOpenWordSession('c'.repeat(64)),true);assert.equal(c.wordTicket,'c'.repeat(64));
});

test('Closing a valid formula with an expired save binding offers recovery instead of locking the window',async()=>{
 const p=editor(),c=p.context;await c.window.nativeOpenWordSession('a'.repeat(64));installCommit(c);c.mf.value='important draft';
 c.ensureValid=async()=>{};c.sourceEditMode=()=> 'rebuild';c.rulerPatch=()=>({});
 const originalNative=c.native;c.native=async(action,payload)=>{if(action==='wordSessionSave')throw Error('Native session is no longer editing');return originalNative(action,payload);};
 assert.equal(await c.window.nativePrepareToClose(),false);assert.equal(c.mf.value,'important draft');assert.equal(c.wordTicket,'a'.repeat(64));assert.equal(c.busy,false);
 assert.ok(p.calls.some(call=>call.action==='confirmWordSessionSwitch'&&call.payload.closing));
 p.discard(true);assert.equal(await c.window.nativePrepareToClose(),true);assert.equal(c.wordTicket,null);assert.equal(c.mf.value,'');
});

test('Reopening the same live document object on a fresh ticket restores its existing draft automatically',async()=>{
 const p=editor(),c=p.context;installCommit(c);c.mode='rebuild';c.editingRuler=[{position:100,type:1}];c.renderModes=()=>{};
 let counter=0;c.native=async(action)=>{if(action==='wordSessionRead')return {documentIdentity:'live-doc-1',documentSnapshot:'snapshot-1',hasDocumentContext:true,activeIndex:1,objects:[{index:0,latex:'other',nativeSha256:'0'.repeat(64)},{index:1,latex:'original',nativeSha256:'1'.repeat(64)}]};if(action==='confirmWordSessionSwitch'){counter++;return {discard:false};}return {};};
 await c.window.nativeOpenWordSession('a'.repeat(64));c.mf.value='important retained draft';
 assert.equal(await c.window.nativeOpenWordSession('b'.repeat(64)),true);assert.equal(c.mf.value,'important retained draft');assert.equal(c.wordTicket,'b'.repeat(64));assert.equal(c.source.documentIdentity,'live-doc-1');assert.equal(counter,0);
});

test('A different snapshot with the same formula bytes and position cannot silently adopt an existing draft',async()=>{
 const p=editor(),c=p.context;installCommit(c);let version=0,confirmations=0;
 c.native=async action=>{if(action==='wordSessionRead')return {documentIdentity:'live-doc-1',documentSnapshot:++version===1?'snapshot-1':'snapshot-2',hasDocumentContext:true,activeIndex:0,objects:[{index:0,latex:'same formula bytes',nativeSha256:'1'.repeat(64)}]};if(action==='confirmWordSessionSwitch'){confirmations++;return {discard:false};}return {};};
 assert.equal(await c.window.nativeOpenWordSession('a'.repeat(64)),true);c.mf.value='original object draft';
 assert.equal(await c.window.nativeOpenWordSession('b'.repeat(64)),false);assert.equal(confirmations,1);assert.equal(c.mf.value,'original object draft');assert.equal(c.wordTicket,'a'.repeat(64));
});

test('A failed native acknowledgement unlocks editing and can be ended without leaving a stuck queued save',async()=>{
 const p=editor(),c=p.context;await c.window.nativeOpenWordSession('a'.repeat(64));installCommit(c);c.mf.value='retained failed draft';
 c.ensureValid=async()=>{};c.sourceEditMode=()=> 'rebuild';c.rulerPatch=()=>({});let restored=0;c.renderModes=()=>{restored++;c.mf.readOnly=false;};
 const originalNative=c.native;c.native=async(action,payload)=>{if(action==='wordSessionSave')return {acknowledgement:true};if(action==='wordSessionStatus')return {state:'failed'};return originalNative(action,payload);};
 assert.equal(await c.window.nativeCommitWordSession(),false);assert.equal(c.mf.value,'retained failed draft');assert.equal(c.mf.readOnly,false);assert.equal(c.wordSaveQueued,false);assert.equal(c.window.wordSaveInFlight,false);assert.equal(restored,1);
 assert.equal(await c.window.nativeCancelWordSession(),true);assert.equal(c.wordTicket,null);
});

test('An acknowledgement timeout releases the queued flag and retains the draft for an explicit recovery choice',async()=>{
 const p=editor(),c=p.context;await c.window.nativeOpenWordSession('a'.repeat(64));installCommit(c);c.mf.value='retained timed-out draft';
 c.wordSaveQueued=true;c.mf.readOnly=true;let tick=0;c.Date={now:()=>tick++===0?0:21000};c.renderModes=()=>{c.mf.readOnly=false;};
 await assert.rejects(vm.runInContext('waitForWordSave()',c),/保存确认/);
 assert.equal(c.wordSaveQueued,false);assert.equal(c.mf.value,'retained timed-out draft');assert.equal(c.mf.readOnly,false);assert.equal(await c.window.nativeCancelWordSession(),true);
});

test('Closing during a short open operation waits for idle and then cancels an unchanged formula',async()=>{
 const p=editor(),c=p.context;await c.window.nativeOpenWordSession('a'.repeat(64));
 installCommit(c);
 c.busy=true;const closed=c.window.nativePrepareToClose();
 assert.equal(c.wordTicket,'a'.repeat(64));c.busy=false;for(const wake of c.idleWaiters)wake();
 assert.equal(await closed,true);assert.equal(c.wordTicket,null);assert.equal(c.busy,false);
 assert.equal(p.calls.filter(r=>r.action==='wordSessionCancel').length,1);
});
