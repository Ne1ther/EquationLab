import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const app=await readFile(new URL('../desktop/app.js',import.meta.url),'utf8');
const workspace=await readFile(new URL('../desktop/word-document-workspace.js',import.meta.url),'utf8');
const bootstrap=app.slice(app.indexOf('window.wordDocumentWorkspace='),app.indexOf('window.nativeResumeWordDocument='));
const requestId='b'.repeat(64),oldTicket='a'.repeat(64),newTicket='c'.repeat(64);
const document=identity=>({hasDocumentContext:true,documentIdentity:identity,documentSnapshot:1,documentName:identity+'.docx',objects:[{index:0,latex:'x',editorBaseline:'x',nativeSha256:'d'.repeat(64)}]});

function editor(cancel,workspaceStatus={connected:true,revision:2,active:{identity:'B',name:'B.docx'}}){
 const calls=[],messages=[],elements=new Map(),source=document('A');
 const context=vm.createContext({
  window:{},Date,setTimeout(){},busy:false,wordNavigating:false,wordCommitRunning:null,wordSaveQueued:false,wordOutcomeUnknown:false,wordTicket:oldTicket,source,selected:source.objects[0],mode:'rebuild',editingRuler:undefined,mf:{value:'x',readOnly:false},
  $(id){if(!elements.has(id))elements.set(id,{});return elements.get(id);},
  renderObjects(){},renderModes(){},controls(){},changed(){context.changedCalls=(context.changedCalls||0)+1;},requestWorkbenchSync(){},resetNewFormula(){context.mf.value='';context.resetCalls=(context.resetCalls||0)+1;},syncSidebar:async(...args)=>calls.push({action:'syncSidebar',args}),
  wordSessionChanged:()=>context.mf.value!==context.selected?.editorBaseline,
  message:(message,error)=>messages.push({message,error}),
  native:async(action,payload)=>{
   calls.push({action,payload});
   if(action==='wordWorkspaceStatus')return workspaceStatus;
   if(action==='wordSessionCancel')return cancel(context);
   if(action==='confirmWordSessionSwitch')return {discard:true};
   if(action==='wordDocumentOpen')return {requestId};
   if(action==='wordDocumentStatus')return {state:'queued'};
   return {};
  }
 });
 vm.runInContext(workspace,context);vm.runInContext(bootstrap,context);
 context.window.wordDocumentWorkspace.accepted(source);
 return {context,calls,messages,workspace:context.window.wordDocumentWorkspace};
}

test('Closing the source document lets a clean expired ticket detach and read the remaining document',async()=>{
 const e=editor(()=>{throw Error('Unknown or expired native session');});
 assert.equal(await e.workspace.syncCurrent(),true);
 assert.equal(e.context.wordTicket,null);
 assert.equal(e.context.source,null);
 assert.equal(e.context.mf.value,'x','keep the old formula until a fresh target is accepted');
 assert.equal(e.calls.filter(x=>x.action==='wordDocumentOpen').length,1);
 assert.equal(await e.workspace.prepareIncoming({...document('B'),activeIndex:0},requestId),true);
 await e.workspace.cancelPending();
});

test('A closed source document does not discard a dirty draft without an explicit switch',async()=>{
 const e=editor(()=>{throw Error('Unknown or expired native session');});
 e.context.mf.value='x+1';
 assert.equal(await e.workspace.syncCurrent(),false);
 assert.equal(e.context.wordTicket,oldTicket);
 assert.equal(e.context.mf.value,'x+1');
 assert.equal(e.calls.some(x=>x.action==='wordSessionCancel'),false);
 assert.equal(e.workspace.otherWordDocumentName,'B.docx');
 assert.equal(await e.workspace.switchToCurrent(),true);
 assert.equal(e.context.wordTicket,null);
 assert.equal(e.context.mf.value,'x+1','a confirmed switch still retains the draft until fresh data arrives');
 await e.workspace.cancelPending();
});

test('Other cancellation failures retain the old binding and do not open another document',async()=>{
 const e=editor(()=>{throw Error('Connection refused');});
 assert.equal(await e.workspace.syncCurrent(),false);
 assert.equal(e.context.wordTicket,oldTicket);
 assert.equal(e.context.source.documentIdentity,'A');
 assert.equal(e.context.mf.value,'x');
 assert.equal(e.calls.some(x=>x.action==='wordDocumentOpen'),false);
 assert.match(e.messages.at(-1).message,/Connection refused/);
});

test('An expired cancellation reply cannot clear a newer accepted ticket',async()=>{
 const e=editor(context=>{
  context.window.wordSessionGeneration++;
  context.wordTicket=newTicket;context.source=document('C');context.selected=context.source.objects[0];context.mf.value='new formula';
  throw Error('Unknown or expired native session');
 });
 assert.equal(await e.workspace.syncCurrent(),false);
 assert.equal(e.context.wordTicket,newTicket);
 assert.equal(e.context.source.documentIdentity,'C');
 assert.equal(e.context.mf.value,'new formula');
 assert.equal(e.calls.some(x=>x.action==='wordDocumentOpen'),false);
});

test('Retired dirty source detaches its expired ticket, keeps the draft settings and removes staging identity',async()=>{
 const e=editor(()=>{throw Error('Unknown or expired native session');},{connected:true,revision:3,active:{identity:'B',name:'B.docx'},retiredIdentities:['A']});
 e.context.mf.value='x+1';e.context.editingRuler=[{position:3,type:1}];
 const priorChanges=e.context.changedCalls||0;
 assert.equal(await e.workspace.syncCurrent(),true);
 assert.equal(e.context.wordTicket,null);assert.equal(e.context.source,null);assert.equal(e.context.selected,null);
 assert.equal(e.context.mf.value,'x+1');assert.deepEqual(JSON.parse(JSON.stringify(e.context.editingRuler)),[{position:3,type:1}]);
 assert.equal(e.workspace.visibleSource(null),null);assert.equal(e.workspace.wordDocumentUnavailable,true);
 assert.equal(e.workspace.documentName,'A.docx');assert.equal(e.workspace.otherWordDocumentName,'B.docx');
 assert.equal(e.context.changedCalls,priorChanges+1,'detaching the staging source schedules standalone validation');
 assert.ok(e.messages.some(item=>item.message==='文档连接已结束，草稿已保留。'));
 assert.equal(e.calls.filter(item=>item.action==='wordDocumentOpen').length,0);
});

test('Closing the last clean source clears its formula so a newly opened document can be followed',async()=>{
 const status={connected:true,revision:3,active:null,retiredIdentities:['A']};
 const e=editor(()=>{throw Error('Unknown or expired native session');},status);
 assert.equal(await e.workspace.syncCurrent(),true);
 assert.equal(e.context.wordTicket,null);assert.equal(e.context.source,null);
 assert.equal(e.context.mf.value,'');assert.equal(e.context.resetCalls,1);
 assert.equal(e.workspace.wordDocumentUnavailable,false);
 status.revision++;status.active={identity:'B',name:'B.docx'};
 assert.equal(await e.workspace.syncCurrent(),true);
 assert.equal(e.calls.filter(item=>item.action==='wordDocumentOpen').length,1);
 await e.workspace.cancelPending();
});
