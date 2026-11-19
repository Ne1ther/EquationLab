import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const script=await readFile(new URL('../desktop/document-tools.js',import.meta.url),'utf8');
function fixture({savedHash='hash'}={}){
 const calls=[],selected=[],doc={path:'snapshot',hasDocumentContext:true,documentIdentity:'a',documentSnapshot:7,objects:[{index:0,nativeSha256:'hash'}]};
 const c=vm.createContext({source:doc,selected:doc.objects[0],wordTicket:'ticket',window:{desktopTypographySnapshot:()=>({fullSize:15}),nativeSelectObject:index=>selected.push(index)},$:()=>({value:'(#E1)'}),wordSourceUnavailable:()=>false,perform:fn=>fn(),message(){},native:async(action,payload)=>{
  calls.push({action,payload});
  if(action==='chooseDocumentToolSource')return {path:'saved.docx',name:'saved.docx'};
  if(action==='documentAudit')return {equations:[{index:0,nativeSha256:'hash'}]};
  if(action.endsWith('Preflight'))return {schema:'plan',targets:payload.options.scope==='future'||payload.options.preset?[]:[{index:0,nativeSha256:savedHash,beforeNativeSha256:savedHash}]};
  return {path:'copy.docx'};
 }});
 vm.runInContext(script,c);return {c,calls,selected,doc};
}
test('Word copy preview uses a saved source independently of the live snapshot',async()=>{
 const {c,calls}=fixture();await c.window.nativeDocumentTypographyPlan('current');
 const call=calls.find(item=>item.action==='documentTypographyPreflight');assert.deepEqual(Array.from(call.payload.options.indices),[0]);assert.equal(call.payload.input,'saved.docx');assert.equal(call.payload.ticket,undefined);
 c.source={...c.source,path:'other'};await assert.rejects(c.window.nativeApplyDocumentTool(),/文档已变化/);assert.equal(calls.filter(item=>item.action==='documentTypographyApply').length,0);
});

test('Full-document numbering rejects a saved file with a different formula despite its matching name',async()=>{
 const {c,calls}=fixture({savedHash:'same-count-different-formula'});
 c.source.documentName='saved.docx';
 await assert.rejects(c.window.nativeDocumentNumberingPlan('all'),/所选文件与当前 Word 文档中的公式不一致/);
 assert.equal(calls.some(call=>call.action==='documentToolsResult'),false);
 const same=fixture();await same.c.window.nativeDocumentNumberingPlan('all');
 assert.equal(same.calls.some(call=>call.action==='documentToolsResult'),true);
});
test('audit formula selection is bound to its source and Native hash, and future presets do not target existing objects',async()=>{
 const {c,calls,selected}=fixture();await c.window.nativeDocumentAudit();await c.window.nativeSelectAuditedEquation(0);assert.deepEqual(selected,[0]);
 c.source.objects[0].nativeSha256='changed';await c.window.nativeSelectAuditedEquation(0);assert.deepEqual(selected,[0]);
 await c.window.nativeDocumentTypographyPlan('future');const options=calls.find(item=>item.action==='documentTypographyPreflight').payload.options;
 assert.equal(options.indices.length,0);assert.equal(options.preset.scope,'new-equations');assert.equal(options.typography,undefined);
});

test('preflights opt into editing, capture options and reject an altered document binding',async()=>{
 for(const kind of ['typography','numbering']){
  let release,started;const gate=new Promise(resolve=>release=resolve),preflightStarted=new Promise(resolve=>started=resolve),calls=[],snapshot={styles:{3:{font:'Original',style:0}}},doc={path:'snapshot',hasDocumentContext:true,documentIdentity:'a',documentSnapshot:7,objects:[{index:0}]};
  const flags=[],context=vm.createContext({source:doc,selected:doc.objects[0],wordTicket:'ticket',window:{desktopTypographySnapshot:()=>snapshot},$:()=>({value:'(#E1)'}),wordSourceUnavailable:()=>false,
   perform:(fn,navigation,options)=>{flags.push({navigation,options});return fn();},message(){},native:async(action,payload)=>{calls.push({action,payload});if(action==='chooseDocumentToolSource')return {path:'saved.docx'};if(action.endsWith('Preflight')){started();await gate;return {schema:'plan'};}return {};}});
  vm.runInContext(script,context);const pending=kind==='typography'?context.window.nativeDocumentTypographyPlan('current'):context.window.nativeDocumentNumberingPlan('current');
  assert.equal(flags[0].navigation,false);assert.equal(flags[0].options.allowPreflightEditing,true);
  await preflightStarted;const sent=calls.find(call=>call.action.endsWith('Preflight')).payload;if(kind==='typography'){snapshot.styles[3].font='Changed';assert.equal(sent.options.typography.styles[3].font,'Original');}else assert.equal(sent.options.numberFormat,'(#E1)');
  context.source.documentSnapshot=8;release();await assert.rejects(pending,/文档已变化/);
  assert.equal(calls.some(call=>call.action==='documentToolsResult'),false);
 }
});

test('a previously displayed report cannot be applied after its source identity changes in place',async()=>{
 const {c,calls}=fixture();await c.window.nativeDocumentNumberingPlan('current');
 c.source.documentIdentity='different';await assert.rejects(c.window.nativeApplyDocumentTool(),/文档已变化/);
 assert.equal(calls.some(call=>call.action==='documentNumberingApply'),false);
});

test('A failed or owner-only Word snapshot cannot start a copy preflight or audit',async()=>{
 for(const override of [{documentLoading:true},{documentLoadFailed:true,documentLoading:false},{hasDocumentContext:false}]){
  const {c,calls}=fixture();Object.assign(c.source,override);
  await assert.rejects(c.window.nativeDocumentNumberingPlan('future'),/完整/);
  await assert.rejects(c.window.nativeDocumentTypographyPlan('future'),/完整/);
  await assert.rejects(c.window.nativeDocumentAudit(),/完整/);
  assert.deepEqual(calls,[]);
 }
});
