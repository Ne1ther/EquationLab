import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';
import {readFile} from 'node:fs/promises';

const appSource=await readFile(new URL('../desktop/app.js',import.meta.url),'utf8');
const slice=(from,to)=>appSource.slice(appSource.indexOf(from),appSource.indexOf(to));
const ticket='a'.repeat(64);
const insertionLayout={mode:'inline',numberFormat:'(#E1)',chapter:1,section:1,equation:1};
const documentObjects=[
 {index:0,latex:'x+1',progId:'Equation.DSMT4',application:'MathType'},
 {index:1,latex:'\\frac{a}{b}',progId:'Equation.DSMT4',application:'MathType'},
 {index:2,latex:'\\sqrt{x}',progId:'Equation.DSMT4',application:'MathType'}
];
const activePath='/private/var/folders/seed/WordInsertionSeed.docx#insertion-seed';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

function createEditor(){
 const calls=[],messages=[],layoutLoads=[],changedCalls=[],modeRenders=[],historyResets=[];let clock=0;
 const renderedLists=[],elements=new Map(),timers=new Map();let context,typographyPatch=null,validationFailure=null,timerId=0,discardDraftOnSwitch=false;
 const defaults={'layout-mode':'inline','layout-format':'(#E1)','layout-chapter':'1','layout-section':'1'};
 const element=id=>{
  if(!elements.has(id))elements.set(id,{hidden:false,disabled:false,readOnly:false,value:defaults[id]??'',textContent:'',classList:{toggle(){}},querySelectorAll:()=>[],replaceChildren(){},append(){}});
  return elements.get(id);
 };
 context=vm.createContext({
  window:{},performance,busy:false,wordNavigating:false,wordNavigationTimer:null,wordTicket:null,wordSaveQueued:false,wordOutcomeUnknown:false,wordCommitRunning:null,timer:null,revision:0,validationRequested:false,validationPending:false,valid:true,idleWaiters:new Set(),source:null,selected:null,mode:'rebuild',editingRuler:undefined,favorites:[],mf:{value:'',readOnly:false},
  Date:{now:()=>clock},$:element,controls(){},message:(text,isError=false)=>messages.push({text,isError}),requestWorkbenchSync(){},loadWordThumbnails(){},
  renderObjects(){const objects=context.source?.objects||[];renderedLists.push(objects.map(object=>object.index));return context.syncSidebar?.()??Promise.resolve();},
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
  selectObject(index){context.selected=context.source.objects[index];context.mf.value=context.selected.latex;},
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
  native:async(action,payload)=>{
   calls.push({action,payload});
   if(action==='wordSessionRead')return {insertion:true,insertionLayout:{...insertionLayout},objects:documentObjects.map(object=>({...object})),activeIndex:null,activePath,path:'/private/var/folders/seed/WordInsertionSeed.docx',hasDocumentContext:true};
   if(action==='confirmWordSessionSwitch')return {discard:discardDraftOnSwitch};
   return {};
  }
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
 vm.runInContext([perform,idle,sidebarSync,select,open,commit].join('\n'),context);
 let behavior=async(action)=>action==='wordSessionInsert'?{acknowledgement:false}:{};
 context.native=async(action,payload)=>{calls.push({action,payload});if(action==='wordSessionRead')return {insertion:true,insertionLayout:{...insertionLayout},objects:documentObjects.map(object=>({...object})),activeIndex:null,activePath,path:'/private/var/folders/seed/WordInsertionSeed.docx',hasDocumentContext:true};if(action==='confirmWordSessionSwitch')return {discard:discardDraftOnSwitch};return behavior(action,payload);};
 return {
  context,calls,messages,layoutLoads,changedCalls,modeRenders,historyResets,renderedLists,elements,now:()=>clock,
  async advance(ms){const target=clock+ms;clock=target;for(const [id,timer] of [...timers])if(timer.at<=target){timers.delete(id);timer.callback();}await Promise.resolve();await Promise.resolve();},
  discardDraftOnSwitch(value=true){discardDraftOnSwitch=value;},
  setNativeBehavior(fn){behavior=fn;},
  failNextValidation(error=new Error('validation failed')){validationFailure=error;},
  element
 };
}

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
 assert.equal(state.wordSessionIsInsertion,true);assert.equal(state.selected,null);assert.deepEqual(state.objects.map(object=>object.id),[0,1,2]);
 assert.deepEqual(editor.calls.filter(call=>['wordSessionInsert','wordSessionSave','wordSessionCancel'].includes(call.action)),[],'opening an insertion session must not write to Word');
});

test('Selecting an existing sidebar formula during insertion preserves the draft and insertion session',async()=>{
 const editor=createEditor(),{context:c}=editor,draft='\\alpha+\\beta';
 await c.window.nativeOpenWordSession(ticket);c.mf.value=draft;
 const source=c.source;
 assert.equal(await c.window.nativeSelectObject(1),undefined,'the insertion editor must refuse a document formula row');
 assert.equal(c.mf.value,draft);assert.equal(c.selected,null);assert.strictEqual(c.source,source);assert.equal(c.wordTicket,ticket);
 assert.deepEqual(c.source.objects.map(object=>object.index),[0,1,2]);
 assert.deepEqual(editor.calls.filter(call=>['wordSessionInsert','wordSessionSave','wordSessionRead'].includes(call.action)).map(call=>call.action),['wordSessionRead']);
 assert.ok(editor.messages.some(item=>item.text.includes('请先完成或取消新公式')));
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
