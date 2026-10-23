import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createWordDocumentRequests} from '../src/word-document-requests.mjs';
const code=await readFile(new URL('../desktop/word-document-workspace.js',import.meta.url),'utf8');
test('The editor accepts an empty selected document using the real service receipt fields',async()=>{
 const service=createWordDocumentRequests(),hostId='a'.repeat(64),documents=[{identity:'word:A',name:'A.docx',readOnly:false},{identity:'word:B',name:'Empty.docx',readOnly:false}];
 await service.take({hostId,waitMs:0});service.handle('native-document-workspace',{hostId,active:{identity:'word:A',name:'A.docx'},documents,retiredIdentities:[]});
 const context=vm.createContext({window:{}});vm.runInContext(code,context);let resume,emptyCalls=0;const messages=[];
 const state={source:null,wordTicket:null,busy:false,outcomeUnknown:false,draftChanged:false};
 const workspace=context.window.createWordDocumentWorkspace({state:()=>state,changed(){},empty(){emptyCalls++;},message:text=>messages.push(text),now:Date.now,pause:()=>new Promise(resolve=>{resume=resolve;}),detach:async()=>true,native:async(action,body={})=>{
  if(action==='wordWorkspaceStatus')return service.handle('native-document-workspace-status',{});
  if(action==='wordDocumentOpen')return service.request(body);
  if(action==='wordDocumentStatus')return service.status(body);
  if(action==='wordDocumentCancel')return service.cancel(body);
  throw Error('Unexpected action '+action);
 }});
 assert.equal(await workspace.chooseDocument('word:B'),true);await new Promise(resolve=>setImmediate(resolve));
 const claim=await service.take({hostId,waitMs:0});assert.equal(claim.documentIdentity,'word:B');
 service.handle('native-document-workspace',{hostId,active:{identity:'word:B',name:'Empty.docx'},documents,retiredIdentities:[]});
 service.finish({hostId,requestId:claim.requestId,state:'empty'});assert.equal(service.status({requestId:claim.requestId}).documentIdentity,'word:B');
 assert.equal(typeof resume,'function');resume();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(workspace.pending,false);assert.equal(workspace.documentIdentity,'word:B');assert.equal(workspace.documentName,'Empty.docx');assert.equal(emptyCalls,1);assert.equal(messages.some(text=>text.includes('文档已变化')),false);
});
