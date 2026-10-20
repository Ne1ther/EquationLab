import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';
import {readFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {desktopRequest} from '../src/desktop-rpc.mjs';
import {createDocx,flatOpc,inspectDocx} from '../src/document.mjs';
import {inspectOle} from '../src/native.mjs';
import {nativeSessionOperation} from '../src/word-native-session.mjs';

const appSource=await readFile(new URL('../desktop/app.js',import.meta.url),'utf8');
const sourceDocx=await readFile(new URL('../docs/examples/equation-lab-30-formulas.docx',import.meta.url));
const sourceDocument=await inspectDocx(sourceDocx);
const sourceOpc=await flatOpc(sourceDocx);
const expectedFormula26=sourceDocument.objects[25];
const expectedNative26=inspectOle(expectedFormula26.ole).native;
const expectedHash26=createHash('sha256').update(expectedNative26).digest('hex');

let nextSession=97000000n;
const liveTickets=new Set();
test.afterEach(async()=>{
 for(const ticket of liveTickets){await nativeSessionOperation('native-cancel',{ticket}).catch(()=>{});await nativeSessionOperation('native-poll',{ticket}).catch(()=>{});}
 liveTickets.clear();
});

async function openDocument(index){
 const native=inspectOle(sourceDocument.objects[index].ole).native;
 const opened=await nativeSessionOperation('native-open',{session:String(nextSession++),native:native.toString('base64'),document:{ooxml:sourceOpc,index,name:'Equation Lab 30 formula test'}});
 liveTickets.add(opened.ticket);
 return {opened,native};
}

async function withLocalNativeService(fn){
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  const parsed=new URL(url);assert.equal(parsed.origin,'http://127.0.0.1:37952');
  const operation=parsed.pathname.replace('/api/',''),body=JSON.parse(options.body);
  try{return {ok:true,json:async()=>await nativeSessionOperation(operation,body)};}
  catch(error){return {ok:false,json:async()=>({error:error.message})};}
 };
 try{return await fn();}finally{globalThis.fetch=originalFetch;}
}

function createEditor(native){
 const calls=[],messages=[],elements=new Map();let timerId=0,clock=0,context;
 const element=id=>{if(!elements.has(id))elements.set(id,{hidden:false,disabled:false,textContent:'',querySelectorAll:()=>[]});return elements.get(id);};
 context=vm.createContext({window:{},performance:{now:()=>++clock},busy:false,wordNavigating:false,wordNavigationTimer:null,wordTicket:null,wordSaveQueued:false,wordCommitRunning:null,timer:null,revision:0,validationRequested:false,validationPending:false,valid:true,idleWaiters:new Set(),source:null,selected:null,mode:'rebuild',editingRuler:undefined,mf:{value:'',readOnly:false},
  $:element,controls(){},message:text=>messages.push(text),requestWorkbenchSync(){},renderObjects(){},loadWordThumbnails(){},syncSidebar:async()=>{},validate:async()=>{},
  selectObject(index){context.selected=context.source.objects[index];context.mf.value=context.selected.latex;context.selected.editorBaseline=context.mf.value;},
  wordSessionChanged:()=>context.mf.value!==context.selected?.editorBaseline,
  resetEditorHistory(){},desktopTypographyLoad(){},desktopTypographyPatch(){return null;},renderModes(){},
  ensureValid:async()=>{},sourceEditMode:()=>context.mode,rulerPatch:()=>context.editingRuler===undefined?{}:{ruler:context.editingRuler},
  setTimeout:()=>++timerId,clearTimeout(){},
  native:async(action,payload)=>{calls.push({action,payload});return native(action,payload);}
 });
 const perform=appSource.split('\n').find(line=>line.startsWith('async function perform('));
 const idle=appSource.slice(appSource.indexOf('async function waitForEditorIdle('),appSource.indexOf('function resetNewFormula()'));
 const reset='function resetNewFormula(){source=null;selected=null;mf.value="";mf.readOnly=false;}';
 const open=appSource.slice(appSource.indexOf('window.nativeOpenWordSession=async'),appSource.indexOf('async function loadWordThumbnails'));
 const cancel=appSource.split('\n').find(line=>line.startsWith('window.nativeCancelWordSession='));
 vm.runInContext([perform,idle,reset,open,cancel].join('\n'),context);
 return {context,calls,messages};
}

function installWordBrowse(context){
 const browse=appSource.slice(appSource.indexOf('function syncSidebar(ended=false'),appSource.indexOf('window.nativeFavorite='));
 vm.runInContext(browse,context);
}

function installActualWordBrowse(context){
 const elements=new Map();
 context.$=id=>{if(!elements.has(id))elements.set(id,{hidden:false,disabled:false,value:'',textContent:'',options:[],append(){},replaceChildren(){},querySelectorAll:()=>[]});return elements.get(id);};
 context.document={createElement:()=>({})};context.window.resetEditorHistory=()=>{};context.window.desktopTypographyLoad=()=>{};
 context.loadObjectLayout=()=>{};context.renderModes=()=>{};context.changed=()=>{};
 const select=appSource.split('\n').find(line=>line.startsWith('function selectObject('));
 vm.runInContext(select,context);
 context.renderObjects=()=>{context.renderCount++;return context.syncSidebar();};
 installWordBrowse(context);
}

function installWordCommit(context){
 const bind=appSource.slice(appSource.indexOf('async function bindSelectedWordFormula()'),appSource.indexOf('window.nativeCommitWordSession=()=>{'));
 const commit=appSource.slice(appSource.indexOf('window.nativeCommitWordSession=()=>{'),appSource.indexOf('async function finishWordSave()'));
 const finish=appSource.slice(appSource.indexOf('async function finishWordSave()'),appSource.indexOf('async function waitForWordSave()'));
 vm.runInContext([bind,commit,finish].join('\n'),context);
}

const snapshot=(activeIndex,marker)=>({hasDocumentContext:true,activeIndex,documentName:'Equation Lab 30 formula test',objects:Array.from({length:30},(_,index)=>({index,latex:`formula-${index+1}-${marker}`}))});

test('Cancelling formula 26 and immediately reopening the same document creates a fresh ticket with identical native bytes',async t=>{
 assert.equal(sourceDocument.objects.length,30);
 assert.equal(expectedFormula26.latex,'\\left\\|\\mathbf{x}\\right\\|_{2}=\\sqrt{\\sum_{i=1}^{n}{x_{i}^{2}}}');
 assert.equal(expectedFormula26.layout.numberText,'(3.6)');assert.equal(expectedFormula26.layout.bookmarkName,'EL_DEMO_26');assert.equal(expectedFormula26.layout.referenceCount,1);
 const first=await openDocument(25),firstStage=await nativeSessionOperation('native-read',{ticket:first.opened.ticket});
 const firstRead=await withLocalNativeService(()=>desktopRequest({action:'wordSessionRead',payload:{ticket:first.opened.ticket}}));
 assert.equal(firstRead.objects.length,30);assert.equal(firstRead.activeIndex,25);assert.equal(firstRead.objects[25].latex,expectedFormula26.latex);assert.equal(firstRead.objects[25].nativeSha256,expectedHash26);
 const before=performance.now();await nativeSessionOperation('native-cancel',{ticket:first.opened.ticket});
 assert.deepEqual(await nativeSessionOperation('native-poll',{ticket:first.opened.ticket}),{state:'cancelled'});liveTickets.delete(first.opened.ticket);
 await assert.rejects(access(firstStage.document.path),error=>error.code==='ENOENT');
 const second=await openDocument(25);assert.notEqual(second.opened.ticket,first.opened.ticket);
 const secondStage=await nativeSessionOperation('native-read',{ticket:second.opened.ticket});
 const secondRead=await withLocalNativeService(()=>desktopRequest({action:'wordSessionRead',payload:{ticket:second.opened.ticket}}));
 const reopenMs=performance.now()-before;
 assert.equal(secondRead.objects.length,30);assert.equal(secondRead.activeIndex,25);assert.equal(secondRead.objects[25].latex,expectedFormula26.latex);assert.equal(secondRead.objects[25].nativeSha256,expectedHash26);
 assert.deepEqual(inspectOle((await inspectDocx(await readFile(secondStage.document.path))).objects[25].ole).native,expectedNative26);
 t.diagnostic(`formula 26 cancel→new-ticket reopen: ${reopenMs.toFixed(1)} ms; index=26/30, (3.6), native sha256=${expectedHash26}`);
});

test('A Word navigation terminal is consumed before the newest target is reopened',async t=>{
 const first=await openDocument(25),staged=await nativeSessionOperation('native-read',{ticket:first.opened.ticket});
 await nativeSessionOperation('native-navigate',{ticket:first.opened.ticket,index:16});
 assert.deepEqual(await nativeSessionOperation('native-poll',{ticket:first.opened.ticket}),{state:'navigate',index:16});liveTickets.delete(first.opened.ticket);
 await assert.rejects(access(staged.path),error=>error.code==='ENOENT');
 const latest=await openDocument(16),read=await nativeSessionOperation('native-read',{ticket:latest.opened.ticket});
 assert.notEqual(latest.opened.ticket,first.opened.ticket);
 const document=await inspectDocx(await readFile(read.document.path));
 assert.equal(document.objects.length,30);assert.equal(read.document.index,16);assert.equal(document.objects[16].latex,sourceDocument.objects[16].latex);
 assert.equal(document.objects[16].nativeSha256,sourceDocument.objects[16].nativeSha256);
 t.diagnostic(`navigation handoff selected newest index 17; ticket rotated ${first.opened.ticket.slice(0,8)}→${latest.opened.ticket.slice(0,8)}`);
});

test('Concurrent Word activations leave the editor on the newest formula rather than a stale earlier read',async()=>{
 const old='a'.repeat(64),middle='b'.repeat(64),latest='c'.repeat(64);let releaseMiddle,startedMiddleResolve;
 const middleGate=new Promise(resolve=>{releaseMiddle=resolve;}),startedMiddle=new Promise(resolve=>{startedMiddleResolve=resolve;});
 const editor=createEditor(async(action,{ticket}={})=>{
  if(action==='wordSessionRead'&&ticket===middle){startedMiddleResolve();await middleGate;return snapshot(25,'middle');}
  if(action==='wordSessionRead'&&ticket===latest)return snapshot(16,'latest');
  if(action==='wordSessionRead'&&ticket===old)return snapshot(25,'old');
  return {};
 });
 assert.equal(await editor.context.window.nativeOpenWordSession(old),true);
 const openingMiddle=editor.context.window.nativeOpenWordSession(middle);await startedMiddle;
 const openingLatest=editor.context.window.nativeOpenWordSession(latest);
 releaseMiddle();
 assert.equal(await openingMiddle,true);assert.equal(await openingLatest,true);
 assert.equal(editor.context.wordTicket,latest);assert.equal(editor.context.source.activeIndex,16);assert.equal(editor.context.selected.index,16);assert.equal(editor.context.mf.value,'formula-17-latest');
 assert.deepEqual(editor.calls.filter(call=>call.action==='wordSessionCancel').map(call=>call.payload.ticket),[old,middle]);
 assert.equal(editor.context.busy,false);assert.equal(editor.context.wordNavigating,false);
});

test('Opening a Word formula renders and syncs once, skips the debounce, and waits for validation before ready',async()=>{
 const ticket='9'.repeat(64),editor=createEditor(async action=>action==='wordSessionRead'?snapshot(25,'open'):{}),context=editor.context;
 let renders=0,syncs=0,scheduleValidation=null,releaseValidation,validationStartedResolve;
 const validationGate=new Promise(resolve=>{releaseValidation=resolve;}),validationStarted=new Promise(resolve=>{validationStartedResolve=resolve;});
 const timingMessages=[];
 context.window.webkit={messageHandlers:{native:{postMessage(body){timingMessages.push(body);throw Error('simulated logger bridge failure');}}}};
 const elements=new Map();
 context.$=id=>{if(!elements.has(id)){const value={hidden:false,textContent:'',replaceChildren(){},append(){}};elements.set(id,value);}return elements.get(id);};
 context.document={createElement:()=>({})};
 context.loadObjectLayout=()=>{};context.renderModes=()=>{};context.controls=()=>{};context.status=()=>{};
 context.syncSidebar=()=>{syncs++;return Promise.resolve();};
 context.renderObjects=()=>{renders++;return context.syncSidebar();};
 context.changed=scheduled=>{scheduleValidation=scheduled;};
 const select=appSource.split('\n').find(line=>line.startsWith('function selectObject('));
 vm.runInContext(select,context);
 context.validate=async()=>{validationStartedResolve();await validationGate;};
 let ready=false;
 const opening=context.window.nativeOpenWordSession(ticket).then(result=>{ready=true;return result;});
 await validationStarted;
 await Promise.resolve();
 assert.equal(ready,false,'an unfinished validation must keep the window delivery pending');
 assert.equal(renders,1,'the active formula should trigger the sole list render');
 assert.equal(syncs,1,'the selected state should be synchronized once');
 assert.equal(scheduleValidation,false,'open should skip the 90 ms edit debounce');
 assert.equal(context.wordTicket,ticket);
 releaseValidation();
 assert.equal(await opening,true,'the Word session becomes ready after validation resolves');
 assert.equal(timingMessages.length,1,'a successful new session emits one timing event');
 assert.equal(timingMessages[0].action,'wordOpenTiming');
 assert.deepEqual(Object.keys(timingMessages[0].payload).sort(),['prepareMs','readMs','sidebarMs','totalMs','validateMs']);
 for(const value of Object.values(timingMessages[0].payload))assert.ok(Number.isFinite(value)&&value>=0&&value<60_000);
});

test('Repeated live same-ticket activation validates the native session without overwriting an unsaved formula-26 draft',async()=>{
 const ticket='d'.repeat(64);let reads=0,statusChecks=0;
 const editor=createEditor(async(action,payload={})=>{
  if(action==='wordSessionRead'){reads++;return snapshot(25,`read-${reads}`);}
  if(action==='wordSessionStatus'){statusChecks++;return {state:'editing'};}
  return {};
 });
 assert.equal(await editor.context.window.nativeOpenWordSession(ticket),true);assert.equal(editor.context.selected.index,25);
 const activeSource=editor.context.source,activeObject=editor.context.selected;editor.context.mf.value='unsaved formula 26 draft';const before=editor.calls.length;
 assert.equal(await editor.context.window.nativeOpenWordSession(ticket),true);
 const verification=editor.calls.slice(before).filter(call=>['wordSessionRead','wordSessionStatus'].includes(call.action));
 assert.ok(verification.length>0,'a repeated activation must verify the native session rather than trusting the in-memory ticket');
 assert.equal(editor.context.wordTicket,ticket);assert.strictEqual(editor.context.source,activeSource);assert.strictEqual(editor.context.selected,activeObject);
 assert.equal(editor.context.mf.value,'unsaved formula 26 draft',"revalidation must not reload the formula or overwrite the user's current draft");
 assert.equal(editor.context.busy,false);
 assert.ok(reads+statusChecks>=2);
});

test('Browsing the 30-formula Word list uses actual selection and one render/sync without navigating Word',async()=>{
 const ticket='e'.repeat(64),editor=createEditor(async()=>({})),context=editor.context;
 const objects=sourceDocument.objects.map((object,index)=>({...object,index}));
 context.wordTicket=ticket;context.source={hasDocumentContext:true,activeIndex:0,path:'/tmp/equations.docx',objects};context.selected=objects[0];context.mf.value=objects[0].latex;context.selected.editorBaseline=context.mf.value;context.favorites=[];
 context.renderCount=0;installActualWordBrowse(context);
 for(let index=0;index<30;index++){
  const result=await context.window.nativeSelectObject(index);
  if(index===0)assert.equal(result,undefined,'formula 1 is already the active local selection');
  else assert.equal(result,true,`formula ${index+1} should be browseable`);
  assert.equal(context.selected.index,index);assert.equal(context.mf.value,sourceDocument.objects[index].latex);
  assert.equal(context.source.activeIndex,0,'local browsing must not change Word’s active OLE binding');
 }
 assert.equal(context.renderCount,29,'actual selection renders the object list once per changed selection');
 assert.equal(editor.calls.filter(call=>call.action==='wordSessionNavigate').length,0);
 assert.equal(editor.calls.filter(call=>call.action==='state').length,29,'the native workbench may receive sidebar state updates for the 29 actual changes');
 assert.ok(editor.calls.filter(call=>call.action==='state').every(call=>call.payload.wordSession===true&&!call.payload.wordSessionNavigating&&!call.payload.wordSessionEnded),'sidebar updates must preserve the live Word owner without a navigation handoff');
 assert.equal(sourceDocument.objects[25].layout.numberText,'(3.6)','the formula 26 fixture retains its original numbering');
 assert.deepEqual(JSON.parse(JSON.stringify(context.source.objects[25].layout)),JSON.parse(JSON.stringify(sourceDocument.objects[25].layout)),'local browsing must preserve formula 26 layout and numbering');
 const rendersBeforeDirtyGuard=context.renderCount,statesBeforeDirtyGuard=editor.calls.filter(call=>call.action==='state').length;context.mf.value+=' + unsaved';
 assert.equal(await context.window.nativeSelectObject(0),undefined,'a dirty formula must block local browsing');
 assert.equal(context.selected.index,29);assert.equal(context.renderCount,rendersBeforeDirtyGuard);assert.equal(editor.calls.filter(call=>call.action==='state').length,statesBeforeDirtyGuard);
 assert.match(editor.messages.at(-1),/修改，请先保存/);
});

test('Saving a locally browsed formula sends one target-bound save without navigation or reopening',async()=>{
 const ticket='f'.repeat(64),targetIndex=25,draft='\\left\\|\\mathbf{x}\\right\\|_{2}=26';let savedPayload;
 let editor;
 const native=async(action,payload={})=>{
  if(action==='wordSessionSave'){savedPayload=payload;return {acknowledgement:false};}
  return {};
 };
 editor=createEditor(native);const context=editor.context,objects=sourceDocument.objects.map((object,index)=>({...object,index}));context.favorites=[];
 context.wordTicket=ticket;context.source={hasDocumentContext:true,documentIdentity:'live-document-1',activeIndex:0,path:'/tmp/equations.docx',activePath:'/tmp/equations.docx#ole-1',objects};
 context.selected=objects[0];context.mf.value=objects[0].latex;context.selected.editorBaseline=context.mf.value;context.mode='rebuild';context.editingRuler=undefined;
 context.ensureValid=async()=>{};context.sourceEditMode=()=>context.mode;context.rulerPatch=()=>({});
 context.selectObject=index=>{context.selected=context.source.objects[index];context.mf.value=context.selected.latex;context.selected.editorBaseline=context.mf.value;};
 installWordBrowse(context);installWordCommit(context);
 assert.equal(await context.window.nativeSelectObject(targetIndex),true);
 context.mf.value=draft;
 assert.equal(await context.window.nativeCommitWordSession(),true,editor.messages.join(' | '));
 assert.equal(editor.calls.filter(call=>call.action==='wordSessionNavigate'||call.action==='wordSessionRead'||call.action==='wordSessionWillSave').length,0);
 assert.equal(savedPayload.ticket,ticket);assert.equal(savedPayload.input,'/tmp/equations.docx#ole-1','the original ticket must retain its owner input');
 assert.deepEqual(JSON.parse(JSON.stringify(savedPayload.target)),{index:targetIndex,expectedNativeSha256:objects[targetIndex].nativeSha256,documentIdentity:'live-document-1'});
 assert.equal(savedPayload.latex,draft);
});

test('Save preflight locks the captured local formula until its single target-bound write completes',async()=>{
 const ticket='3'.repeat(64),targetIndex=25,nextIndex=16;let startValidation,releaseValidation;
 const validationStarted=new Promise(resolve=>{startValidation=resolve;}),validationGate=new Promise(resolve=>{releaseValidation=resolve;});
 const editor=createEditor(async()=>({})),context=editor.context,objects=sourceDocument.objects.map((object,index)=>({...object,index}));
 context.wordTicket=ticket;context.source={hasDocumentContext:true,documentIdentity:'live-document-1',activeIndex:0,path:'/tmp/equations.docx',objects};context.selected=objects[0];context.mf.value=objects[0].latex;context.selected.editorBaseline=context.mf.value;context.favorites=[];context.mode='rebuild';
 context.ensureValid=()=>{startValidation();return validationGate;};
 context.selectObject=index=>{context.selected=context.source.objects[index];context.mf.value=context.selected.latex;context.selected.editorBaseline=context.mf.value;};
 installWordBrowse(context);installWordCommit(context);
 assert.equal(await context.window.nativeSelectObject(targetIndex),true);
 const commit=context.window.nativeCommitWordSession();await validationStarted;
 assert.equal(await context.window.nativeSelectObject(nextIndex),undefined,'a save must not be retargeted during validation');
 assert.equal(context.selected.index,targetIndex);
 releaseValidation();assert.equal(await commit,true);
 const saves=editor.calls.filter(call=>call.action==='wordSessionSave');assert.equal(saves.length,1);assert.equal(saves[0].payload.target.index,targetIndex);
 assert.equal(editor.calls.filter(call=>call.action==='wordSessionNavigate').length,0);
});

test('The local list is locked during a delayed target save and the draft remains painted until acknowledgement',async()=>{
 const ticket='4'.repeat(64),targetIndex=25,nextIndex=16,draft='formula-26 draft';let savedPayload,startSave,finishSave;
 const saveStarted=new Promise(resolve=>{startSave=resolve;}),saveGate=new Promise(resolve=>{finishSave=resolve;});let editor;
 const native=async(action,payload={})=>{
  if(action==='wordSessionSave'){savedPayload=payload;startSave();await saveGate;return {acknowledgement:false};}
  return {};
 };
 editor=createEditor(native);const context=editor.context,objects=sourceDocument.objects.map((object,index)=>({...object,index}));context.favorites=[];
 context.wordTicket=ticket;context.source={hasDocumentContext:true,documentIdentity:'live-document-1',activeIndex:0,path:'/tmp/equations.docx',activePath:'/tmp/equations.docx#ole-1',objects};context.selected=objects[0];context.mf.value=objects[0].latex;context.selected.editorBaseline=context.mf.value;context.mode='rebuild';context.editingRuler=undefined;
 context.ensureValid=async()=>{};context.sourceEditMode=()=>context.mode;context.rulerPatch=()=>({});
 context.selectObject=index=>{context.selected=context.source.objects[index];context.mf.value=context.selected.latex;context.selected.editorBaseline=context.mf.value;context.mode='rebuild';};
 installWordBrowse(context);installWordCommit(context);
 assert.equal(await context.window.nativeSelectObject(targetIndex),true);context.mf.value=draft;
 assert.equal(context.selected.index,targetIndex);assert.equal(context.source.activeIndex,0);assert.equal(context.source.hasDocumentContext,true);
 const commit=context.window.nativeCommitWordSession();
 await saveStarted;
 assert.equal(context.busy,true);assert.equal(await context.window.nativeSelectObject(nextIndex),undefined);
 assert.equal(context.selected.index,targetIndex);assert.equal(context.mf.value,draft);
 finishSave();
 assert.equal(await commit,true);
 assert.equal(savedPayload.ticket,ticket);assert.equal(savedPayload.input,'/tmp/equations.docx#ole-1');assert.equal(savedPayload.target.index,targetIndex);assert.equal(savedPayload.latex,draft);
 assert.equal(editor.calls.filter(call=>call.action==='wordSessionNavigate'||call.action==='wordSessionRead').length,0);
});

test('Cross-formula character mode, typography and ruler drafts are submitted without reloading the editor',async()=>{
 const ticket='1'.repeat(64),targetIndex=25,character=sourceDocument.objects[targetIndex].characters.find(item=>item.editable),fontDraft={styles:{1:{font:'Cambria',style:2}}},rulerDraft=[{position:1536,type:3}];
 let savedPayload,savedUiState,validationState,editor,activeTypography=null;const inputNodes=[];
 const elements=new Map();
 const element=id=>{
  if(!elements.has(id)){
   if(id==='character-editor')elements.set(id,{hidden:true,replaceChildren(){inputNodes.length=0;},append(label){for(const child of label.children||[])if(child.tagName==='input')inputNodes.push(child);},querySelectorAll:()=>inputNodes});
   else if(id==='mode-characters'||id==='mode-rebuild'){const button={selected:false};button.classList={toggle(_name,value){button.selected=value;}};elements.set(id,button);}
   else elements.set(id,{hidden:false,disabled:false,value:'',textContent:'',querySelectorAll:()=>[],classList:{toggle(){}}});
  }
  return elements.get(id);
 };
 const native=async(action,payload={})=>{
  if(action==='wordSessionSave'){savedPayload=payload;savedUiState={mode:editor.context.mode,characterEditorHidden:element('character-editor').hidden,charactersSelected:element('mode-characters').selected,rebuildSelected:element('mode-rebuild').selected};return {acknowledgement:false};}
  return {};
 };
 editor=createEditor(native);const context=editor.context;context.$=element;context.favorites=[];
 context.document={createElement(tag){return {tagName:tag,children:[],dataset:{},setAttribute(){},append(child){this.children.push(child);}};}};
 const renderModes=appSource.slice(appSource.indexOf('function renderModes()'),appSource.indexOf("$('mode-characters').onclick="));
 vm.runInContext(renderModes,context);
 const objects=sourceDocument.objects.map((object,index)=>({...object,index}));
 context.wordTicket=ticket;context.source={hasDocumentContext:true,documentIdentity:'live-document-1',activeIndex:0,path:'/tmp/equations.docx',activePath:'/tmp/equations.docx#ole-1',objects};
 context.selected=objects[0];context.mf.value=objects[0].latex;context.selected.editorBaseline=context.mf.value;context.mode='rebuild';context.editingRuler=undefined;
 context.ensureValid=async()=>context.validate();context.sourceEditMode=()=>context.mode;context.rulerPatch=()=>context.editingRuler===undefined?{}:{ruler:context.editingRuler};
 context.selectObject=index=>{context.selected=context.source.objects[index];context.mf.value=context.selected.latex;context.selected.editorBaseline=context.mf.value;context.mode='rebuild';context.editingRuler=context.selected.ruler??undefined;context.window.desktopTypographyLoad?.(context.selected.typography);context.renderModes();};
 context.window.desktopTypographyPatch=()=>activeTypography;
 context.window.desktopTypographyLoad=profile=>{activeTypography=profile??null;};
 context.window.desktopTypographyRestorePatch=patch=>{activeTypography=patch;};
 context.validate=async()=>{validationState={mode:context.mode,typography:context.window.desktopTypographyPatch(),ruler:context.rulerPatch(),latex:context.mf.value};};
 installWordBrowse(context);installWordCommit(context);
 assert.ok(character,'formula 26 should expose an editable character for this regression');
 assert.equal(await context.window.nativeSelectObject(targetIndex),true);
 context.mode='characters';context.renderModes();assert.equal(inputNodes.length>0,true);
 const editInput=inputNodes.find(input=>String(input.dataset.offset)===String(character.offset));assert.ok(editInput);
 editInput.value='z';activeTypography=fontDraft;context.editingRuler=rulerDraft;
 assert.equal(await context.window.nativeCommitWordSession(),true,editor.messages.join(' | '));
 const expectedReplacements=Object.fromEntries(sourceDocument.objects[targetIndex].characters.filter(item=>item.editable).map(item=>[String(item.offset),item.offset===character.offset?'z':item.char]));
 assert.deepEqual(JSON.parse(JSON.stringify(savedPayload.replacements)),expectedReplacements,'the changed character and the remaining original editable characters must survive rebinding');
 assert.deepEqual(savedPayload.typography,fontDraft,'the source formula font draft must be restored after loading the target formula');
 assert.deepEqual(savedPayload.ruler,rulerDraft,'the source formula ruler draft must survive the rebind');
 assert.equal(savedPayload.mode,'characters');assert.equal(savedPayload.ticket,ticket);assert.equal(savedPayload.input,'/tmp/equations.docx#ole-1');assert.equal(savedPayload.target.index,targetIndex);
 assert.deepEqual(validationState,{mode:'characters',typography:fontDraft,ruler:{ruler:rulerDraft},latex:sourceDocument.objects[targetIndex].latex},'revalidation must run against the restored font, ruler, and formula draft');
 assert.deepEqual(savedUiState,{mode:'characters',characterEditorHidden:false,charactersSelected:true,rebuildSelected:false},'the visible editor mode must match the restored character-edit mode before commit');
 assert.equal(context.wordTicket,null);assert.equal(editor.calls.filter(call=>call.action==='wordSessionNavigate'||call.action==='wordSessionRead').length,0);
});

test('Thirty-formula Word reads stay bound to their requested native object and report a repeatable performance probe',async t=>{
 const elapsed=[],expected=sourceDocument.objects.map(object=>object.nativeSha256);
 await withLocalNativeService(async()=>{
  for(let index=0;index<sourceDocument.objects.length;index++){
   const started=performance.now(),session=await openDocument(index);
   const read=await desktopRequest({action:'wordSessionRead',payload:{ticket:session.opened.ticket}});
   elapsed.push(performance.now()-started);
   assert.equal(read.objects.length,30);assert.equal(read.activeIndex,index,`activation ${index+1}`);
   assert.equal(read.objects[index].nativeSha256,expected[index],`native identity for ${index+1}`);
   await nativeSessionOperation('native-cancel',{ticket:session.opened.ticket});
   assert.deepEqual(await nativeSessionOperation('native-poll',{ticket:session.opened.ticket}),{state:'cancelled'});liveTickets.delete(session.opened.ticket);
  }
 });
 const sorted=[...elapsed].sort((a,b)=>a-b),median=sorted[Math.floor(sorted.length/2)],p95=sorted[Math.ceil(sorted.length*.95)-1];
 assert.ok(elapsed.every(Number.isFinite));assert.equal(elapsed.length,30);
 t.diagnostic(`30-object Word read probe: total=${elapsed.reduce((a,b)=>a+b,0).toFixed(1)} ms; p50=${median.toFixed(1)} ms; p95=${p95.toFixed(1)} ms; max=${Math.max(...elapsed).toFixed(1)} ms`);
});
