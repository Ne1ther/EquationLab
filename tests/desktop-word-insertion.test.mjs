import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';
import {readFile} from 'node:fs/promises';

const appSource=await readFile(new URL('../desktop/app.js',import.meta.url),'utf8');
const workspaceSource=await readFile(new URL('../desktop/word-document-workspace.js',import.meta.url),'utf8');
const slice=(from,to)=>appSource.slice(appSource.indexOf(from),appSource.indexOf(to));
const ticket='a'.repeat(64);
const freshTicket='b'.repeat(64);
const documentIdentity='word-document-identity-1';
const documentSnapshot='word-document-snapshot-N';
const insertionLayout={mode:'inline',numberFormat:'(#E1)',chapter:1,section:1,equation:1};
const documentObjects=[
 {index:0,latex:'x+1',progId:'Equation.DSMT4',application:'MathType',nativeSha256:'1'.repeat(64)},
 {index:1,latex:'\\frac{a}{b}',progId:'Equation.DSMT4',application:'MathType',nativeSha256:'2'.repeat(64)},
 {index:2,latex:'\\sqrt{x}',progId:'Equation.DSMT4',application:'MathType',nativeSha256:'3'.repeat(64)}
];
const activePath='/private/var/folders/seed/WordInsertionSeed.docx#insertion-seed';
const insertionDocument={insertion:true,insertionLayout:{...insertionLayout},objects:documentObjects.map(object=>({...object})),activeIndex:null,activePath,path:'/private/var/folders/seed/WordInsertionSeed.docx',hasDocumentContext:true,documentIdentity,documentSnapshot};

function documentSnapshotFor(activeIndex,{snapshot=documentSnapshot,extraObject=false}={}){
 const objects=documentObjects.map(object=>({...object}));
 if(extraObject)objects.push({index:objects.length,latex:'\\frac{m}{n}+1',progId:'Equation.DSMT4',application:'MathType',nativeSha256:'4'.repeat(64)});
 return {hasDocumentContext:true,documentName:'Word integration fixture',documentIdentity,documentSnapshot:snapshot,activeIndex,activePath:'/private/var/folders/seed/CurrentWord.docx#ole-'+(activeIndex+1),path:'/private/var/folders/seed/CurrentWord.docx',objects};
}

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

function workspaceBootstrap(){
 const start=appSource.indexOf('window.wordDocumentWorkspace=');
 const end=appSource.indexOf('\nfunction message(',start);
 assert.ok(start>=0&&end>start,'the production Word workspace bootstrap should be present');
 return appSource.slice(start,end)+'\n'+slice('function wordSessionChanged(){','window.nativePrepareToClose=async()=>{');
}

function createEditor(){
 const calls=[],messages=[],layoutLoads=[],changedCalls=[],modeRenders=[],historyResets=[];let clock=0;
 const renderedLists=[],elements=new Map(),timers=new Map();let context,typographyPatch=null,validationFailure=null,timerId=0,discardDraftOnSwitch=false;
 let behavior=async(action)=>action==='wordSessionInsert'?{acknowledgement:false}:{};
 const defaults={'layout-mode':'inline','layout-format':'(#E1)','layout-chapter':'1','layout-section':'1'};
 const element=id=>{
  if(!elements.has(id))elements.set(id,{hidden:false,disabled:false,readOnly:false,value:defaults[id]??'',textContent:'',classList:{toggle(){}},querySelectorAll:()=>[],replaceChildren(){},append(){}});
  return elements.get(id);
 };
 context=vm.createContext({
  window:{},performance,busy:false,wordNavigating:false,wordNavigationTimer:null,wordTicket:null,wordSaveQueued:false,wordOutcomeUnknown:false,wordCommitRunning:null,timer:null,revision:0,validationRequested:false,validationPending:false,valid:true,idleWaiters:new Set(),source:null,selected:null,mode:'rebuild',editingRuler:undefined,favorites:[],mf:{value:'',readOnly:false},
  Date:{now:()=>clock},$:element,controls(){},message:(text,isError=false)=>messages.push({text,isError}),requestWorkbenchSync(){},loadWordThumbnails(){},
  renderObjects(){const document=context.window.wordDocumentWorkspace?.visibleSource(context.source)??context.source;const objects=document?.objects||[];renderedLists.push(objects.map(object=>object.index));return context.syncSidebar?.()??Promise.resolve();},
  loadObjectLayout(object){
   const layout=object?.layout||{};layoutLoads.push(structuredClone(layout));
   for(const [id,key] of [['layout-mode','mode'],['layout-format','numberFormat'],['layout-chapter','chapter'],['layout-section','section']])element(id).value=String(layout[key]??(key==='mode'?'inline':key==='numberFormat'?'(#E1)':'1'));
  },
  changed(scheduleValidation=true){changedCalls.push(scheduleValidation);context.revision++;context.valid=false;context.validationPending=true;element('latex').value=context.mf.value;},
  renderModes(){
   const readOnly=context.mode==='characters'||!!context.selected?.error;context.mf.readOnly=readOnly;element('latex').readOnly=readOnly;
   modeRenders.push({mode:context.mode,selected:context.selected?.index??null,readOnly});
  },
  validate:async()=>{if(validationFailure){const error=validationFailure;validationFailure=null;throw error;}context.valid=true;context.validationPending=false;},
  ensureValid:async()=>context.validate(),
  selectObject(index){context.selected=context.source.objects[index];context.mode='rebuild';context.mf.value=context.selected.latex;context.selected.editorBaseline=context.mf.value;return context.renderObjects();},
  sourceEditMode:()=>context.mode,rulerPatch:()=>context.editingRuler===undefined?{}:{ruler:context.editingRuler},
  wordLayout:()=>({mode:element('layout-mode').value,numberFormat:element('layout-format').value,chapter:Number(element('layout-chapter').value),section:Number(element('layout-section').value)}),
  setTimeout(callback,delay=0){const id=++timerId;timers.set(id,{callback,at:clock+delay});if(delay<5000)queueMicrotask(()=>{const timer=timers.get(id);if(timer){timers.delete(id);clock=Math.max(clock,timer.at);timer.callback();}});return id;},clearTimeout(id){timers.delete(id);},
  resetNewFormula(){
   if(context.wordTicket)return false;
   context.source=null;context.selected=null;context.mode='rebuild';context.editingRuler=undefined;context.mf.value='';context.mf.readOnly=false;element('latex').value='';element('latex').readOnly=false;
   context.loadObjectLayout({});context.window.resetEditorHistory?.();context.window.desktopTypographyNew?.();context.changed();context.renderObjects();return true;
  },
  resetEditorHistory(){historyResets.push('reset');},desktopTypographyNew(){typographyPatch=null;},
  desktopTypographyPatch:()=>typographyPatch,desktopTypographyRestorePatch:patch=>{typographyPatch=patch;},
  native:async(action,payload)=>{calls.push({action,payload});return behavior(action,payload);}
 });
 context.window.resetEditorHistory=()=>historyResets.push('reset');
 context.window.desktopTypographyNew=()=>{typographyPatch=null;};
 context.window.desktopTypographyPatch=()=>typographyPatch;
 context.window.desktopTypographyRestorePatch=patch=>{typographyPatch=patch;};
 const perform=appSource.split('\n').find(line=>line.startsWith('async function perform('));
 const idle=slice('async function waitForEditorIdle(','function resetNewFormula()');
 const open=slice('window.nativeOpenWordSession=async','async function loadWordThumbnails');
 const sidebarSync=appSource.split('\n').find(line=>line.startsWith('function syncSidebar(ended=false'));
 const select=slice('window.nativeSelectObject=async index=>','window.nativeFavorite=');
 const commit=appSource.slice(appSource.indexOf('async function bindSelectedWordFormula()'),appSource.indexOf("$('word-session-save').onclick"));
 // The source slice above intentionally executes the real open, selection, commit,
 // acknowledgement, cancellation, and sidebar-state functions in the VM.
 const native=async(action,payload={})=>{
  calls.push({action,payload});
  if(action==='confirmWordSessionSwitch')return {discard:discardDraftOnSwitch};
  if(action==='wordSessionRead'){
   const result=await behavior(action,payload);
   if(result?.hasDocumentContext||result?.insertion)return result;
   return {...insertionDocument,objects:insertionDocument.objects.map(object=>({...object}))};
  }
  return behavior(action,payload);
 };
 context.native=native;
 context.wordSessionChanged=()=>context.source?.insertion?!!context.mf.value.trim():context.mf.value!==context.selected?.editorBaseline;
 context.window.createWordDocumentWorkspace=undefined;
 vm.runInContext(workspaceSource,context);
 vm.runInContext(workspaceBootstrap(),context);
 vm.runInContext([perform,idle,sidebarSync,select,open,commit].join('\n'),context);
 return {
  context,calls,messages,layoutLoads,changedCalls,modeRenders,historyResets,renderedLists,elements,now:()=>clock,
  async advance(ms){const target=clock+ms;clock=target;for(const [id,timer] of [...timers])if(timer.at<=target){timers.delete(id);timer.callback();}await Promise.resolve();await Promise.resolve();},
  discardDraftOnSwitch(value=true){discardDraftOnSwitch=value;},
  setNativeBehavior(fn){behavior=fn;},
  failNextValidation(error=new Error('validation failed')){validationFailure=error;},
  setTypographyPatch(patch){typographyPatch=patch;},
  element
 };
}

test('Settings-only insertion drafts require confirmation before sidebar switching',async()=>{
 for(const change of [e=>e.setTypographyPatch({size:14}),e=>{e.context.editingRuler=[{position:24,align:'left'}];},e=>{e.element('layout-format').value='(#C1.#E1)';}]){
  const editor=createEditor(),c=editor.context;
  assert.equal(await c.window.nativeOpenWordSession(ticket),true);
  change(editor);
  assert.equal(c.mf.value,'');
  assert.equal(await c.window.nativeSelectObject(0),false);
  assert.equal(editor.calls.filter(call=>call.action==='confirmWordSessionSwitch').length,1);
  assert.equal(editor.calls.filter(call=>call.action==='wordSessionCancel').length,0);
  assert.equal(c.wordTicket,ticket);
 }
});

test('Opening a Word insertion session keeps the editor blank and retains the full document sidebar',async()=>{
 const editor=createEditor(),{context:c}=editor;
 assert.equal(await c.window.nativeOpenWordSession(ticket),true,editor.messages.map(item=>item.text).join(' | '));
 assert.equal(c.mf.value,'');assert.equal(c.selected,null);assert.strictEqual(c.source.insertion,true);
 assert.equal(c.source.activeIndex,null);assert.equal(c.source.activePath,activePath);assert.equal(c.source.hasDocumentContext,true);
 assert.deepEqual(c.source.insertionLayout,insertionLayout);
 assert.deepEqual(c.source.objects.map(object=>object.index),[0,1,2]);
 assert.deepEqual(editor.renderedLists.at(-1),[0,1,2],'rendering the insertion session must keep all existing formulas in the sidebar');
 assert.deepEqual(editor.layoutLoads[0],insertionLayout,'the insertion layout must initialize the layout controls');
 assert.deepEqual(editor.changedCalls,[false],'opening must update the editor without scheduling the edit debounce');
 assert.equal(editor.historyResets.length,1);assert.equal(editor.modeRenders.length,1);
 const state=editor.calls.filter(call=>call.action==='state').at(-1).payload;
 assert.equal(state.wordSessionIsInsertion,true);assert.equal(c.selected,null);assert.equal(Object.hasOwn(state,'objects'),false,'formula rows are published only through workbenchState');
 assert.deepEqual(editor.calls.filter(call=>['wordSessionInsert','wordSessionSave','wordSessionCancel'].includes(call.action)),[],'opening an insertion session must not write to Word');
});

test('Declining an existing sidebar formula during insertion preserves the draft and insertion session',async()=>{
 const editor=createEditor(),{context:c}=editor,draft='\\alpha+\\beta';
 await c.window.nativeOpenWordSession(ticket);c.mf.value=draft;editor.discardDraftOnSwitch(false);
 const source=c.source;
 assert.equal(await c.window.nativeSelectObject(1),false,'the user can decline discarding the insertion draft');
 assert.equal(c.mf.value,draft);assert.equal(c.selected,null);assert.strictEqual(c.source,source);assert.equal(c.wordTicket,ticket);
 assert.deepEqual(c.source.objects.map(object=>object.index),[0,1,2]);
 assert.equal(editor.calls.filter(call=>call.action==='wordDocumentOpen').length,0,'declining must not start a target open request');
 assert.deepEqual(editor.calls.filter(call=>['wordSessionInsert','wordSessionSave','wordSessionCancel'].includes(call.action)),[],'declining must not write or end the current insertion');
 assert.ok(editor.calls.some(call=>call.action==='confirmWordSessionSwitch'&&call.payload.browsing));
});

test('Approved selection of an existing row opens a fresh target-bound Word update session',async()=>{
 const editor=createEditor(),{context:c}=editor,draft='\\alpha+\\beta',requestId='c'.repeat(64),status=deferred(),statusStarted=deferred();
 editor.discardDraftOnSwitch(true);
 editor.setNativeBehavior(async(action,payload={})=>{
  if(action==='wordDocumentOpen')return {requestId};
  if(action==='wordDocumentStatus'){statusStarted.resolve(payload.requestId);return status.promise;}
  if(action==='wordSessionRead'&&payload.ticket===freshTicket)return documentSnapshotFor(1);
  return {};
 });
 await c.window.nativeOpenWordSession(ticket);c.mf.value=draft;
 assert.equal(await c.window.nativeSelectObject(1),true,'an approved row selection should request the actual Word formula');
 await statusStarted.promise;
 const openCall=editor.calls.find(call=>call.action==='wordDocumentOpen');
 assert.deepEqual(JSON.parse(JSON.stringify(openCall.payload.target)),{identity:documentIdentity,snapshot:documentSnapshot,index:1,nativeSha256:documentObjects[1].nativeSha256},'the request is bound to the selected document identity, snapshot, row and native bytes');
 assert.equal(Object.hasOwn(openCall.payload,'path'),false,'cached sidebar metadata must not supply an old file path');
 assert.equal(editor.calls.filter(call=>call.action==='wordSessionCancel'&&call.payload.ticket===ticket).length,1,'the old insertion ticket ends before the target open');
 assert.ok(editor.calls.some(call=>call.action==='state'&&call.payload.wordSessionSwitching===true),'the insertion ticket ends in switch mode so the window stays available');
 assert.equal(c.wordTicket,null);assert.equal(c.source,null);assert.equal(c.mf.value,draft,'detaching preserves the draft until the new binding is accepted');
 assert.equal(await c.window.nativeOpenWordSession(freshTicket,requestId),true,editor.messages.map(item=>item.text).join(' | '));
 status.resolve({state:'pending'});
 assert.equal(c.wordTicket,freshTicket);assert.notEqual(c.wordTicket,ticket);assert.equal(c.source.insertion,undefined);assert.equal(c.source.activeIndex,1);assert.equal(c.selected.index,1);
 assert.equal(c.mf.value,documentObjects[1].latex,'the approved draft is discarded once the fresh Word formula is accepted');
 assert.match(c.$('title').textContent,/编辑 Word/);assert.match(c.$('subtitle').textContent,/更新公式/);
 const latestState=editor.calls.filter(call=>call.action==='state').at(-1).payload;
 assert.equal(latestState.wordSessionIsInsertion,false);assert.equal(c.selected.index,1);
 assert.deepEqual(editor.calls.filter(call=>call.action==='wordSessionInsert'||call.action==='wordSessionSave'),[],'switching alone must not insert the old draft or save the target formula');
});

test('A blank insertion can switch to an existing sidebar formula without a discard prompt',async()=>{
 const editor=createEditor(),{context:c}=editor,requestId='d'.repeat(64),status=deferred(),statusStarted=deferred();
 editor.setNativeBehavior(async(action,payload={})=>{
  if(action==='wordDocumentOpen')return {requestId};
  if(action==='wordDocumentStatus'){statusStarted.resolve(payload.requestId);return status.promise;}
  if(action==='wordSessionRead'&&payload.ticket===freshTicket)return documentSnapshotFor(1);
  return {};
 });
 await c.window.nativeOpenWordSession(ticket);
 assert.equal(await c.window.nativeSelectObject(1),true);
 await statusStarted.promise;
 assert.equal(editor.calls.filter(call=>call.action==='confirmWordSessionSwitch').length,0,'an empty insertion has no draft to discard');
 assert.deepEqual(JSON.parse(JSON.stringify(editor.calls.find(call=>call.action==='wordDocumentOpen').payload.target)),{identity:documentIdentity,snapshot:documentSnapshot,index:1,nativeSha256:documentObjects[1].nativeSha256});
 assert.equal(editor.calls.filter(call=>call.action==='wordSessionCancel'&&call.payload.ticket===ticket).length,1);
 assert.equal(await c.window.nativeOpenWordSession(freshTicket,requestId),true);
 status.resolve({state:'pending'});
 assert.equal(c.wordTicket,freshTicket);assert.equal(c.source.insertion,undefined);assert.equal(c.selected.index,1);assert.equal(c.mf.value,documentObjects[1].latex);
});

test('A late cancelled document-open response cancels its request without clearing a newer binding',async()=>{
 const editor=createEditor(),{context:c}=editor,requestId='e'.repeat(64),started=deferred(),releaseOpen=deferred();
 editor.setNativeBehavior(async(action,payload={})=>{
  if(action==='wordDocumentOpen'){started.resolve();await releaseOpen.promise;return {requestId};}
  if(action==='wordSessionRead'&&payload.ticket===freshTicket)return documentSnapshotFor(2);
  return {};
 });
 await c.window.nativeOpenWordSession(ticket);
 const selecting=c.window.nativeSelectObject(1);await started.promise;
 assert.equal(c.window.wordDocumentWorkspace.pending,true,'the unresolved target open is tracked by the production workspace');
 assert.equal(await c.window.nativeOpenWordSession(freshTicket),true,'a newer Word activation can bind while the old request is unresolved');
 const binding=c.source,selection=c.selected,formula=c.mf.value;
 assert.equal(c.wordTicket,freshTicket);assert.equal(selection.index,2);
 releaseOpen.resolve();
 assert.equal(await selecting,false,'the late response cannot revive the cancelled selection request');
 assert.deepEqual(editor.calls.filter(call=>call.action==='wordDocumentCancel').map(call=>call.payload.requestId),[requestId]);
 assert.equal(c.wordTicket,freshTicket);assert.strictEqual(c.source,binding);assert.strictEqual(c.selected,selection);assert.equal(c.mf.value,formula);
});

test('Canceling a drafted insertion closes the session without inserting or saving',async()=>{
 const editor=createEditor(),{context:c}=editor;
 await c.window.nativeOpenWordSession(ticket);c.mf.value='x^2+1';
 assert.equal(await c.window.nativeCancelWordSession(),true);
 assert.equal(c.wordTicket,null);assert.equal(c.source,null);assert.equal(c.selected,null);assert.equal(c.mf.value,'');
 const actions=editor.calls.map(call=>call.action);
 assert.equal(actions.filter(action=>action==='wordSessionCancel').length,1);
 assert.equal(actions.filter(action=>action==='wordSessionInsert'||action==='wordSessionSave').length,0);
});

test('Insertion submits the formula and layout, waits for Word acknowledgement, then clears the session',async()=>{
 const editor=createEditor(),{context:c}=editor,insertStarted=deferred(),releaseInsert=deferred(),statusStarted=deferred(),releaseStatus=deferred();
 const draft='\\frac{m}{n}+1';let insertedPayload,statusCalls=0;
 editor.setNativeBehavior(async(action,payload)=>{
  if(action==='wordSessionInsert'){insertedPayload=payload;insertStarted.resolve();await releaseInsert.promise;return {acknowledgement:true};}
  if(action==='wordSessionStatus'){statusCalls++;statusStarted.resolve();await releaseStatus.promise;return {state:'committed'};}
  return {};
 });
 await c.window.nativeOpenWordSession(ticket);c.mf.value=draft;c.changed();
 const commit=c.window.nativeCommitWordSession();await insertStarted.promise;
 assert.equal(c.busy,true);assert.equal(c.wordTicket,ticket);assert.equal(c.mf.value,draft);
 assert.equal(await c.window.nativeCancelWordSession(),false,'cancellation must remain blocked until Word resolves an in-flight insertion');
 releaseInsert.resolve();await statusStarted.promise;
 assert.equal(c.wordTicket,ticket);assert.equal(c.mf.value,draft);assert.equal(c.wordSaveQueued,true,'an acknowledgement means the native Word operation is still pending');
 releaseStatus.resolve();assert.equal(await commit,true);
 assert.deepEqual(JSON.parse(JSON.stringify(insertedPayload)),{ticket,input:activePath,latex:draft,layout:insertionLayout,typography:null});
 assert.equal(statusCalls,1);assert.equal(c.wordTicket,null);assert.equal(c.source,null);assert.equal(c.selected,null);assert.equal(c.mf.value,'');
 assert.equal(editor.calls.filter(call=>call.action==='wordSessionSave').length,0);
 assert.equal(editor.calls.filter(call=>call.action==='wordSessionInsert').length,1);

 const retained=c.window.wordDocumentWorkspace.visibleSource(c.source);
 assert.equal(retained.documentSnapshot,documentSnapshot,'a successful insert leaves the last read-only Word snapshot visible');
 assert.equal(retained.objects.length,3,'the cached list stays at version N until Word sends a fresh document read');
 assert.equal(Object.hasOwn(retained,'path'),false);assert.equal(Object.hasOwn(retained,'activePath'),false);
 const refreshRequestId='c'.repeat(64),refreshStatus=deferred(),refreshStatusStarted=deferred(),updated=documentSnapshotFor(3,{snapshot:'word-document-snapshot-N-plus-1',extraObject:true});
 editor.setNativeBehavior(async(action,payload={})=>{
  if(action==='wordDocumentOpen')return {requestId:refreshRequestId};
  if(action==='wordDocumentStatus'){refreshStatusStarted.resolve(payload.requestId);return refreshStatus.promise;}
  if(action==='wordSessionRead'&&payload.ticket===freshTicket)return updated;
  return {};
 });
 assert.equal(await c.window.nativeResumeWordDocument(true),true,'Dock activation should request a fresh Word document ticket');
 await refreshStatusStarted.promise;
 const refreshOpen=editor.calls.filter(call=>call.action==='wordDocumentOpen').at(-1);
 assert.deepEqual(JSON.parse(JSON.stringify(refreshOpen.payload)),{},'a Dock refresh reopens the document without reusing an old OLE path or ticket');
 assert.equal(c.wordTicket,null);assert.strictEqual(c.window.wordDocumentWorkspace.visibleSource(c.source),retained);
 assert.equal(c.window.wordDocumentWorkspace.visibleSource(c.source).documentSnapshot,documentSnapshot);
 assert.equal(await c.window.nativeOpenWordSession(freshTicket,refreshRequestId),true);
 refreshStatus.resolve({state:'pending'});
 assert.notEqual(c.wordTicket,ticket);assert.equal(c.wordTicket,freshTicket);
 assert.equal(c.source.documentSnapshot,'word-document-snapshot-N-plus-1');assert.equal(c.source.objects.length,4);assert.equal(c.selected.index,3);
 const reads=editor.calls.filter(call=>call.action==='wordSessionRead');
 assert.deepEqual(reads.map(call=>call.payload.ticket),[ticket,freshTicket],'the Dock refresh must consume the fresh ticket, never the insertion ticket');
 assert.deepEqual(editor.calls.filter(call=>call.action==='wordSessionInsert').map(call=>call.payload.ticket),[ticket]);
 assert.equal(editor.calls.filter(call=>call.action==='wordSessionCancel'&&call.payload.ticket===ticket).length,0,'a completed insert is not cancelled through its spent ticket');
});

test('An accepted insertion stays locked and keeps its draft while Word acknowledgement takes longer than 20 seconds',async()=>{
 const editor=createEditor(),{context:c}=editor,draft='\\sum_{i=1}^{n} i',started=deferred();let cancelResult,close;
 editor.setNativeBehavior(async action=>{
  if(action==='wordSessionInsert')return {acknowledgement:true};
  if(action==='wordSessionStatus'){
   if(editor.now()<21000)return {state:'delivered'};
   cancelResult=await c.window.nativeCancelWordSession();close=c.window.nativePrepareToClose();started.resolve();return {state:'committed'};
  }
  return {};
 });
 await c.window.nativeOpenWordSession(ticket);c.mf.value=draft;c.changed();
 const commit=c.window.nativeCommitWordSession();await started.promise;
 assert.ok(editor.now()>20000,'the simulated Word delay must cross the former timeout');
 assert.equal(cancelResult,false,'cancel stays blocked after the host accepted the insertion');
 assert.equal(c.wordTicket,ticket);assert.equal(c.mf.value,draft);assert.equal(c.wordSaveQueued,true);
 assert.ok(editor.messages.some(item=>item.text.includes('仍在等待 Word 确认')),'the user receives a continuing waiting status');
 assert.equal(await commit,true);assert.equal(await close,true);
 assert.equal(c.wordTicket,null);assert.equal(c.source,null);assert.equal(c.mf.value,'');
});

test('A status RPC that never responds times out after 60 seconds and close detaches without a duplicate insertion',async()=>{
 const editor=createEditor(),{context:c}=editor,draft='\\frac{a}{b}+c',statusStarted=deferred(),never=deferred();
 editor.setNativeBehavior(async action=>{
  if(action==='wordSessionInsert')return {acknowledgement:true};
  if(action==='wordSessionStatus'){statusStarted.resolve();return never.promise;}
  return {};
 });
 await c.window.nativeOpenWordSession(ticket);c.mf.value=draft;c.changed();
 const commit=c.window.nativeCommitWordSession();await statusStarted.promise;
 const close=c.window.nativePrepareToClose();await editor.advance(60_001);
 assert.equal(await commit,false);assert.equal(await close,true);
 assert.equal(editor.now()>60_000,true,'the simulated acknowledgement wait passed its bound');
 assert.equal(c.wordTicket,null);assert.equal(c.mf.value,draft,'closing keeps the draft in the retained editor');
 assert.equal(editor.calls.filter(call=>call.action==='wordSessionInsert').length,1,'the uncertain insertion was submitted once');
 assert.equal(editor.calls.filter(call=>call.action==='wordSessionCancel'&&call.payload.ticket===ticket).length,0,'close must not cancel a delivered insertion');
 assert.ok(editor.messages.some(item=>item.text.includes('无法确认')),'the user is told to check Word');
});

test('Unconfirmed insertion stays locked until explicit detach; safe Cancel preserves its draft and permits a later session',async()=>{
 const editor=createEditor(),{context:c}=editor,draft='x^2+1',statusStarted=deferred(),never=deferred(),nextTicket='b'.repeat(64);
 editor.setNativeBehavior(async action=>{
  if(action==='wordSessionInsert')return {acknowledgement:true};
  if(action==='wordSessionStatus'){statusStarted.resolve();return never.promise;}
  return {};
 });
 await c.window.nativeOpenWordSession(ticket);c.mf.value=draft;c.changed();
 const commit=c.window.nativeCommitWordSession();await statusStarted.promise;await editor.advance(60_001);
 assert.equal(await commit,false);assert.equal(c.wordOutcomeUnknown,true);assert.equal(c.wordTicket,ticket);
 assert.equal(c.mf.value,draft);assert.equal(c.source.insertion,true);assert.equal(c.wordSaveQueued,false);
 assert.equal(await c.window.nativeOpenWordSession(ticket),false,'the same delivered ticket cannot be reopened while its outcome is unknown');
 assert.equal(editor.calls.filter(call=>call.action==='wordSessionCancel'&&call.payload.ticket===ticket).length,0,'reopening the delivered ticket must not send a cancel');
 assert.equal(await c.window.nativeCommitWordSession(),false,'the same insertion cannot be submitted again');
 assert.equal(await c.window.nativeCancelWordSession(),true,'explicit detach is available after the bounded wait');
 assert.equal(c.mf.value,draft);assert.equal(c.wordTicket,null);assert.equal(c.source,null);
 assert.equal(editor.calls.filter(call=>call.action==='wordSessionCancel'&&call.payload.ticket===ticket).length,0,'safe detach does not send a cancel for the delivered ticket');
 assert.equal(editor.calls.filter(call=>call.action==='wordSessionInsert').length,1);
 editor.discardDraftOnSwitch();assert.equal(await c.window.nativeOpenWordSession(nextTicket),true,'a later Word session can start after the explicit ending');
 assert.equal(c.wordTicket,nextTicket);assert.equal(editor.calls.filter(call=>call.action==='wordSessionInsert').length,1);
});

test('A request rejected before acceptance keeps the insertion draft retryable',async()=>{
 const editor=createEditor(),{context:c}=editor,draft='\\alpha+\\beta';let attempts=0;
 editor.setNativeBehavior(async action=>{
  if(action==='wordSessionInsert'){if(++attempts===1)throw Error('request rejected before acceptance');return {acknowledgement:true};}
  if(action==='wordSessionStatus')return {state:'committed'};
  return {};
 });
 await c.window.nativeOpenWordSession(ticket);c.mf.value=draft;c.changed();
 assert.equal(await c.window.nativeCommitWordSession(),false);
 assert.equal(c.wordTicket,ticket);assert.equal(c.mf.value,draft);assert.equal(c.wordSaveQueued,false);assert.equal(c.window.wordSaveInFlight,false);
 assert.ok(editor.messages.some(item=>item.text==='request rejected before acceptance'));
 assert.equal(await c.window.nativeCommitWordSession(),true);
 assert.equal(attempts,2);assert.equal(c.wordTicket,null);assert.equal(c.mf.value,'');
 assert.deepEqual(editor.calls.filter(call=>call.action==='wordSessionInsert').map(call=>call.payload.ticket),[ticket,ticket]);
});

test('Failed validation keeps the insertion draft and still permits cancellation',async()=>{
 const editor=createEditor(),{context:c}=editor,draft='\\int_0^1 x\\,dx';
 await c.window.nativeOpenWordSession(ticket);c.mf.value=draft;c.changed();editor.failNextValidation(new Error('validation rejected formula'));
 assert.equal(await c.window.nativeCommitWordSession(),false);
 assert.equal(c.wordTicket,ticket);assert.equal(c.mf.value,draft);assert.equal(c.selected,null);
 assert.equal(editor.calls.filter(call=>call.action==='wordSessionInsert'||call.action==='wordSessionSave').length,0);
 assert.ok(editor.messages.some(item=>item.text==='validation rejected formula'));
 assert.equal(await c.window.nativeCancelWordSession(),true);assert.equal(c.wordTicket,null);assert.equal(c.mf.value,'');
});

test('A failed Word insertion acknowledgement retains the draft and still permits cancellation',async()=>{
 const editor=createEditor(),{context:c}=editor,draft='\\sqrt{x}+3';
 editor.setNativeBehavior(async action=>action==='wordSessionInsert'?{acknowledgement:true}:action==='wordSessionStatus'?{state:'failed'}:{});
 await c.window.nativeOpenWordSession(ticket);c.mf.value=draft;c.changed();
 assert.equal(await c.window.nativeCommitWordSession(),false);
 assert.equal(c.wordTicket,ticket);assert.equal(c.source.insertion,true);assert.equal(c.selected,null);assert.equal(c.mf.value,draft);
 assert.equal(c.wordSaveQueued,false);assert.equal(c.window.wordSaveInFlight,false);assert.equal(c.busy,false);
 assert.equal(editor.calls.filter(call=>call.action==='wordSessionInsert').length,1);
 assert.equal(editor.calls.filter(call=>call.action==='wordSessionSave').length,0);
 assert.ok(editor.messages.some(item=>item.text.includes('Word 未能完成保存')));
 assert.equal(await c.window.nativeCancelWordSession(),true);assert.equal(c.wordTicket,null);assert.equal(c.mf.value,'');
});

test('Clean A to B document following keeps old content until a new Word ticket is validated',async()=>{
 const editor=createEditor(),c=editor.context,requestId='f'.repeat(64),a={...documentSnapshotFor(0),documentIdentity:'word:A',documentName:'A.docx'},b={...documentSnapshotFor(0),documentIdentity:'word:B',documentName:'B.docx'},pending=deferred();
 editor.setNativeBehavior(async(action,payload={})=>{
  if(action==='wordSessionRead')return payload.ticket===freshTicket?b:a;
  if(action==='wordWorkspaceStatus')return {connected:true,revision:2,active:{identity:'word:B',name:'B.docx'}};
  if(action==='wordDocumentOpen')return {requestId};
  if(action==='wordDocumentStatus')return pending.promise;
  return {};
 });
 assert.equal(await c.window.nativeOpenWordSession(ticket),true);const baseline=c.mf.value;
 assert.equal(await c.window.nativeSyncWordWorkspace(),true);
 assert.equal(c.wordTicket,null);assert.equal(c.mf.value,baseline,'the real detach must retain formula contents while the fresh request is pending');
 assert.equal(editor.calls.filter(call=>call.action==='confirmWordSessionSwitch').length,0);
 assert.equal(await c.window.nativeOpenWordSession(freshTicket,requestId),true);
 assert.equal(c.wordTicket,freshTicket);assert.equal(c.source.documentIdentity,'word:B');assert.equal(c.mf.value,b.objects[0].latex);
 assert.equal(editor.calls.some(call=>['wordSessionSave','wordSessionInsert'].includes(call.action)),false);
 pending.resolve({state:'opened'});
});

test('Manual refresh recaptures the same clean Word document while automatic sync remains a no-op',async()=>{
 const editor=createEditor(),c=editor.context,requestId='9'.repeat(64),statusStarted=deferred(),pending=deferred(),original=documentSnapshotFor(0),updated=documentSnapshotFor(1,{snapshot:'word-document-snapshot-N-plus-1'});
 editor.setNativeBehavior(async(action,payload={})=>{
  if(action==='wordSessionRead')return payload.ticket===freshTicket?updated:original;
  if(action==='wordWorkspaceStatus')return {connected:true,revision:21,active:{identity:documentIdentity,name:'Word integration fixture'}};
  if(action==='wordDocumentOpen')return {requestId};
  if(action==='wordDocumentStatus'){statusStarted.resolve(payload.requestId);return pending.promise;}
  return {};
 });
 assert.equal(await c.window.nativeOpenWordSession(ticket),true);
 assert.equal(await c.window.nativeSyncWordWorkspace(),false,'the automatic same-identity poll must not reopen Word');
 assert.equal(editor.calls.filter(call=>call.action==='wordDocumentOpen').length,0);
 assert.equal(await c.window.nativeRefreshWordWorkspace(),true,'the explicit refresh requests a fresh capture');
 await statusStarted.promise;
 assert.equal(c.wordTicket,null);assert.equal(c.source,null);
 assert.deepEqual(JSON.parse(JSON.stringify(editor.calls.filter(call=>call.action==='wordDocumentOpen').at(-1).payload)),{});
 assert.equal(editor.calls.filter(call=>call.action==='confirmWordSessionSwitch').length,0,'a clean manual refresh needs no confirmation');
 assert.equal(await c.window.nativeOpenWordSession(freshTicket,requestId),true);
 assert.equal(c.wordTicket,freshTicket);assert.equal(c.source.documentSnapshot,updated.documentSnapshot);
 assert.equal(c.source.activeIndex,1);assert.equal(c.mf.value,updated.objects[1].latex);
 assert.equal(editor.calls.filter(call=>call.action==='wordSessionCancel'&&call.payload.ticket===ticket).length,1);
 pending.resolve({state:'opened'});
});
