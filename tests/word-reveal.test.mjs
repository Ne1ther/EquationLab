import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createWordDocumentRequests,wordCatalogProof} from '../src/word-document-requests.mjs';

const requestId='a'.repeat(64),hostId='b'.repeat(64),ticket='c'.repeat(64);
const target={identity:'word-process:22',snapshot:17,index:4,nativeSha256:'d'.repeat(64)};
const active={identity:'word-process:1',name:'Same Name.docx'};
const document={identity:target.identity,name:active.name,readOnly:true};
const published={hostId,active,documents:[{...active,readOnly:false},document]};

test('a reveal is a short-lived, exact, non-mutating request for an open document',async()=>{
 let time=1_797_900_000_000;
 const requests=createWordDocumentRequests({now:()=>time});
 await requests.take({hostId,waitMs:0});
 const publish=metadata=>requests.handle('native-document-workspace',{...published,...metadata});
 publish({});
 for(const invalid of [{reveal:false,target},{reveal:true},{reveal:true,documentIdentity:target.identity},{reveal:true,target,insertionMode:'inline'}]){
  assert.throws(()=>requests.request(invalid),/exact Word position/);
 }
 assert.throws(()=>requests.request({reveal:true,target}),/Update the Word add-in/);
 publish({revealRequestSupport:true});
 for(const destination of [{target},{catalogTarget:{identity:target.identity,snapshot:target.snapshot,index:target.index,count:8,proof:wordCatalogProof(target.identity,target.snapshot,8,time+10_000)}}]){
  const poll=requests.take({hostId,waitMs:20_000});
  const {requestId:id}=requests.request({reveal:true,...destination});
  const claimed=await poll;
  assert.deepEqual(claimed,{state:'delivered',requestId:id,reveal:true,target:destination.catalogTarget?
   {...target,nativeSha256:destination.catalogTarget.proof.split('.')[1]}:target});
  assert.throws(()=>requests.finish({hostId,requestId:id,state:'opened'}),/does not match/);
  assert.equal(requests.finish({hostId,requestId:id,state:'revealed'}).state,'revealed');
  assert.deepEqual(requests.status({requestId:id}),{requestId:id,state:'revealed',identity:target.identity,index:target.index});
 }
 const ordinary=requests.request({target:{...target,identity:active.identity}});
 assert.throws(()=>requests.request({target,reveal:true}),/Another Word document request/);
 requests.cancel(ordinary);
 const reveal=requests.request({target,reveal:true});
 await requests.take({hostId,waitMs:0});
 time+=8001;
 assert.equal(requests.finish({hostId,requestId:reveal.requestId,state:'revealed'}).state,'expired');
 publish({revealRequestSupport:true,documents:[{...active,readOnly:false}],retiredIdentities:[target.identity]});
 assert.throws(()=>requests.request({target,reveal:true}),/not open/);
});

const workspaceCode=await readFile(new URL('../desktop/word-document-workspace.js',import.meta.url),'utf8');
const sidebarCode=await readFile(new URL('../desktop/sidebar-state.js',import.meta.url),'utf8');
function fixture({result,metadata,catalog=false,hold}={}){
 const context=vm.createContext({window:{}});
 vm.runInContext(workspaceCode,context);
 vm.runInContext(sidebarCode,context);
 let time=0;
 const calls=[],messages=[];
 const source={documentIdentity:target.identity,documentSnapshot:target.snapshot,documentTotal:8,hasDocumentContext:true,
  ...(catalog?{catalogProof:'receipt',documentLoading:true}:{}),
  objects:catalog?[]:Array.from({length:8},(_,index)=>({index,nativeSha256:target.nativeSha256}))};
 const state={source,wordTicket:ticket,busy:false,outcomeUnknown:false,draftChanged:true};
 const workspace=context.window.createWordDocumentWorkspace({
  state:()=>state,now:()=>time,changed(){},message:(...args)=>messages.push(args),pause:async ms=>{time+=ms;},
  detach(){assert.fail('reveal detached the existing edit or discarded a draft');},
  async native(action,payload){
   calls.push({action,payload});
   if(action==='wordWorkspaceStatus')return {connected:true,revealRequestSupport:true,...published,...metadata};
   if(action==='wordDocumentOpen'){await hold;return {requestId,state:'queued'};}
   if(action==='wordDocumentStatus')return {requestId,state:'revealed',identity:target.identity,index:target.index,...result};
   return {};
  }
 });
 const sidebar=context.window.createSidebarPublisher(workspace.revealBinding);
 const menuFor=index=>{
  const doc=workspace.visibleSource(state.source),row=sidebar.snapshot(doc).objects.find(row=>row.id===index);
  return () => workspace.reveal(row.id,doc.documentIdentity,row.revealToken);
 };
 return {workspace,state,source,calls,messages,menuFor};
}

test('revealing a non-active, same-name Word document preserves the active draft and supports directory rows',async()=>{
 for(const catalog of [false,true]){
  const {workspace,state,source,calls,messages,menuFor}=fixture({catalog});
  assert.equal(await menuFor(target.index)(),true);
  const open=calls.find(({action})=>action==='wordDocumentOpen').payload;
  const destination=catalog?{catalogTarget:{identity:target.identity,snapshot:target.snapshot,index:target.index,count:8,proof:'receipt'}}:{target};
  assert.deepEqual(JSON.parse(JSON.stringify(open)),{...destination,reveal:true});
  assert.equal(state.source,source);
  assert.equal(state.wordTicket,ticket);
  assert.equal(state.draftChanged,true);
  assert.equal(workspace.revealing,false);
  assert.deepEqual(messages,[]);
  assert.equal(calls.some(({action})=>action==='wordDocumentCancel'),false);
 }
});

test('stale positions, mismatched receipts, closed documents and legacy add-ins fail gently',async()=>{
 for(const {options,expected,submits} of [
  {options:{result:{state:'failed'}},expected:/公式位置可能已变化/,submits:true},
  {options:{result:{index:target.index+1}},expected:/公式位置可能已变化/,submits:true},
  {options:{result:{state:'no-document'}},expected:/已关闭/,submits:true},
  {options:{result:{state:'queued'}},expected:/暂时没有响应/,submits:true},
  {options:{metadata:{revealRequestSupport:false}},expected:/更新 Word 插件/,submits:false},
  {options:{metadata:{documents:[active],retiredIdentities:[target.identity]}},expected:/已关闭/,submits:false}
 ]){
  const {workspace,state,calls,messages,menuFor}=fixture(options);
  assert.equal(await menuFor(target.index)(),false);
  assert.match(messages[0][0],expected);
  assert.equal(messages[0][1],true);
  assert.equal(state.wordTicket,ticket);
  assert.equal(workspace.revealing,false);
  assert.equal(calls.filter(({action})=>action==='wordDocumentOpen').length,Number(submits));
  assert.equal(calls.filter(({action})=>action==='wordDocumentCancel').length,Number(submits));
 }
});

test('changing documents or closing while the reveal is queued retires the exact late receipt',async()=>{
 for(const closing of [false,true]){
  let release;
  const hold=new Promise(resolve=>{release=resolve;});
  const {workspace,state,source,calls,messages,menuFor}=fixture({hold});
  const reveal=menuFor(target.index)();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(workspace.revealing,true);
  if(closing)workspace.cancelReveal();
  else state.source={...source,documentIdentity:active.identity};
  release();
  assert.equal(await reveal,false);
  assert.equal(workspace.revealing,false);
  assert.equal(calls.filter(({action})=>action==='wordDocumentCancel').length,1);
  assert.equal(calls.some(({action})=>action==='wordDocumentStatus'),false);
  assert.deepEqual(messages,[]);
 }
});

test('an open menu cannot reveal a replacement row in a new snapshot or at the same snapshot and index',async()=>{
 for(const replacement of [
  source=>({...source,documentIdentity:active.identity}),
  source=>({...source,documentSnapshot:source.documentSnapshot+1}),
  source=>({...source,objects:source.objects.map((row,index)=>index===target.index?{...row,nativeSha256:'e'.repeat(64)}:row)})
 ]){
  const {state,source,calls,messages,menuFor}=fixture();
  const click=menuFor(target.index);
  state.source=replacement(source);
  menuFor(target.index);
  assert.equal(await click(),false);
  assert.equal(calls.length,0,'the old menu must not address a replacement object');
  assert.match(messages[0][0],/公式位置可能已变化/);
 }
 const {state,source,calls,menuFor}=fixture();
 const click=menuFor(target.index);
 state.source={...source,objects:source.objects.map(row=>({...row,image:'refreshed thumbnail'}))};
 menuFor(target.index);
 assert.equal(await click(),true,'updating thumbnails does not change the selected formula identity');
 assert.ok(calls.some(({action})=>action==='wordDocumentOpen'));
});

test('SwiftUI forwards the context row to the reveal route and Word selects only a verified live anchor',async()=>{
 const read=path=>readFile(new URL(path,import.meta.url),'utf8');
 const [sidebar,bridge,app,vba]=await Promise.all([
  read('../macos/Views/FormulaSidebar.swift'),read('../macos/Services/DesktopBridge.swift'),
  read('../desktop/app.js'),read('../native-word-probe/automatic-loader/EquationLabDocumentContext.bas')
 ]);
 assert.match(sidebar,/\.contextMenu \{[\s\S]*?Button\(bridge\.t\("定位原文位置"\)\) \{\s*bridge\.revealWordFormula\(item\.id, documentIdentity: documentIdentity, revealToken: item\.revealToken\)/);
 assert.match(bridge,/return await window\.nativeRevealWordFormula\(index, documentIdentity, revealToken\)[\s\S]*?if revealed as\? Bool == true \{ self\.returnToWord\(hideEditor: false\)/);
 const entryPoint=app.slice(app.indexOf('window.nativeRevealWordFormula='),app.indexOf('window.nativeRefreshWordDocumentList='));
 assert.match(entryPoint,/\.reveal\(index,\s*documentIdentity,\s*revealToken\)/);
 const reveal=vba.slice(vba.indexOf('Private Sub ApplyWordReveal'),vba.indexOf('Private Function KnownDocumentIdentity'));
 assert.match(reveal,/For Each candidate In Application.Documents[\s\S]*?KnownDocumentIdentity\(candidate\) = identity/);
 assert.match(reveal,/Doc Is Nothing[\s\S]*?MathTypeBridgeFinishWordDocumentRequestNoDocument/);
 assert.match(reveal,/ResolveWordRevealEquation\(Doc, snapshot, index\)[\s\S]*?If shape Is Nothing Then GoTo Failed[\s\S]*?MathTypeBridgeBeginWordDocumentRequest[\s\S]*?ELRevealEquationInWindow/);
 assert.match(reveal,/mBoundDocuments\(CStr\(snapshot\)\)[\s\S]*?bound Is Doc[\s\S]*?mBoundShapes\(CStr\(snapshot\)\)[\s\S]*?retained = shapes\(index\)/);
 assert.match(reveal,/ResolveBoundEquation\(Doc, anchor, index, True\)[\s\S]*?retainedRange\.Start <> shape\.Range\.Start/);
 assert.match(reveal,/Doc\.Activate[\s\S]*?target\.Select[\s\S]*?ActiveWindow\.ScrollIntoView[\s\S]*?previousSelection\.Select[\s\S]*?previousWindow\.Activate/);
 assert.doesNotMatch(reveal,/OLEFormat\.Activate|WordOpenXML|\.Save\b|\.Delete\b/);
});
