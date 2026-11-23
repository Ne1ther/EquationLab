import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const controller=await readFile(new URL('../desktop/draft-recovery.js',import.meta.url),'utf8'),integration=await readFile(new URL('../desktop/draft-integration.js',import.meta.url),'utf8'),app=await readFile(new URL('../desktop/app.js',import.meta.url),'utf8');
const id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',old='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
function editor({recovered,restoreResult=recovered}={}){
 const calls=[],elements=new Map();let inputs=[],timer=0,composing=false;
 const element=id=>{if(!elements.has(id))elements.set(id,{value:({'layout-mode':'inline','layout-format':'(#E1)','layout-chapter':'1','layout-section':'1'})[id]??'',disabled:false,listeners:{},addEventListener(name,fn){this.listeners[name]=fn;},querySelectorAll:()=>inputs});return elements.get(id);};
 const c=vm.createContext({crypto:{randomUUID:()=>id},setTimeout:()=>++timer,clearTimeout(){},window:{},source:null,selected:null,mode:'rebuild',wordTicket:null,wordOutcomeUnknown:false,wordSaveQueued:false,wordCommitRunning:null,busy:false,editingRuler:undefined,mf:{value:''},$:element,
  native:async(action,payload)=>{calls.push({action,payload:JSON.parse(JSON.stringify(payload??{}))});if(action==='draftStatus')return recovered&&!(restoreResult?.available===false&&calls.some(c=>c.action==='draftRestore'))?{available:true,id:old,updatedAt:100,outcomeUnknown:recovered.draft.outcomeUnknown}:{available:false};if(action==='draftRestore')return restoreResult;if(action==='confirmWordSessionSwitch')return {discard:true};return {};},
  requestWorkbenchSync(){},message(){},renderModes(){inputs=(c.selected?.characters??[]).map(char=>({dataset:{offset:String(char.offset)},value:char.char}));},
  sourceEditMode:()=>c.mode,wordLayout:()=>({mode:element('layout-mode').value,numberFormat:element('layout-format').value,chapter:Number(element('layout-chapter').value),section:Number(element('layout-section').value)}),
  wordSessionChanged:()=>c.mode==='characters'||c.mf.value!==c.selected?.editorBaseline,
  resetNewFormula(){c.source=null;c.selected=null;c.mode='rebuild';c.mf.value='';},
  selectObject(index){c.selected=c.source.objects[index];c.mf.value=c.selected.latex;c.selected.editorBaseline=c.mf.value;c.renderModes();},
  changed(){},validate:async()=>{},perform:async fn=>fn()
 });
 c.window.editorIsComposing=()=>composing;c.window.desktopTypographyPatch=()=>null;c.window.desktopTypographySnapshot=()=>null;c.window.desktopTypographyRestorePatch=()=>{};c.window.desktopTypographyReady=Promise.resolve();
 vm.runInContext(controller+'\n'+integration,c);
 return {c,calls,element,compose:value=>{composing=value;}};
}
test('a blank draft retains layout-only changes and layout input is connected to persistence',async()=>{
 const {c,calls,element}=editor();await c.window.draftRecovery.initialize();
 element('layout-mode').value='numbered-right';element('layout-format').value='(#C1.#E1)';element('layout-chapter').value='3';
 element('layout-chapter').listeners.input();assert.equal(await c.window.nativeFlushDraft(),true);
 const saved=calls.find(call=>call.action==='draftSave');assert.equal(saved.payload.draft.latex,'');assert.equal(saved.payload.draft.layout.chapter,3);assert.equal(saved.payload.draft.layout.numberFormat,'(#C1.#E1)');
});
test('standalone equation layout changes are backed up relative to the loaded layout',async()=>{
 const {c,calls,element}=editor();await c.window.draftRecovery.initialize();
 c.sourceEditMode=()=> 'characters'; // An unchanged formula can use the native bytes when exported.
 const sourceLayout={mode:'numbered-left',numberFormat:'(#C1.#E1)',chapter:2,section:3};
 const object={index:0,latex:'x+1',nativeSha256:'f'.repeat(64),layout:sourceLayout,editorNumberFormatBaseline:sourceLayout.numberFormat,editorCounterBaseline:{chapter:'2',section:'3'}};
 c.source={path:'/private/document-copy.docx',objects:[object]};c.selectObject(0);
 const fields=[['mode','mode','display'],['format','numberFormat','(#S1-#E1)'],['chapter','chapter','4'],['section','section','5']];
 for(const [id,key] of fields)element('layout-'+id).value=String(sourceLayout[key]);
 assert.equal(await c.window.nativeFlushDraft(),true);
 assert.equal(calls.some(call=>call.action==='draftSave'),false);
 for(const [id,key,newValue] of fields){
  const field=element('layout-'+id);field.value=newValue;field.listeners.input();
  assert.equal(await c.window.nativeFlushDraft(),true);
  const saved=calls.at(-1);
  assert.equal(saved.action,'draftSave');assert.equal(String(saved.payload.draft.layout[key]),newValue);
  assert.equal(saved.payload.draft.mode,'rebuild','recovery preserves the editing mode, independent of the export strategy');
  assert.equal(saved.payload.source.nativeSha256,object.nativeSha256);
  field.value=String(sourceLayout[key]);field.listeners.input();
  assert.equal(await c.window.nativeFlushDraft(),true);
  assert.equal(calls.at(-1).action,'draftClear');
 }
});
test('clearing the contents of a loaded equation is still an edit',async()=>{
 const {c,calls}=editor();await c.window.draftRecovery.initialize();
 c.source={path:'/private/document-copy.docx',objects:[{index:0,latex:'x+1',nativeSha256:'f'.repeat(64)}]};c.selectObject(0);
 c.mf.value='';
 assert.equal(c.window.hasRecoverableDraft(),true);await c.window.nativeFlushDraft();
 assert.equal(calls.at(-1).payload.draft.latex,'');
});
test('a restored unknown Word save still gets a backup when its formula matches the baseline',async()=>{
 const recovered={draft:{latex:'x+1',mode:'rebuild',outcomeUnknown:true},source:{path:'/private/recovered.docx',recoveredDraft:true,objects:[{index:0,latex:'x+1',nativeSha256:'f'.repeat(64)}]}};
 const {c,calls}=editor({recovered});await c.window.draftRecovery.initialize();
 assert.equal(await c.window.nativeRestoreDraft(),true);
 assert.equal(c.wordSessionChanged(),false);
 assert.equal(await c.window.nativeFlushDraft(),true);
 assert.equal(calls.at(-1).action,'draftSave');assert.equal(calls.at(-1).payload.draft.outcomeUnknown,true);
});
test('materializing an unknown Word result rewrites the current backup before loading it',async()=>{
 const {c,calls}=editor();await c.window.draftRecovery.initialize();
 c.wordTicket='word-session';c.wordOutcomeUnknown=true;c.mf.value='x+1';
 await c.window.draftRecovery.flush();
 await c.window.materializeUnknownDraft();
 assert.deepEqual(calls.slice(-3).map(call=>call.action),['draftSave','draftSave','draftRestore']);
 assert.equal(calls.at(-2).payload.draft.outcomeUnknown,true);
 assert.equal(calls.at(-1).payload.id,id);
 assert.equal(calls.at(-1).payload.clientId,id);
});
test('a cleanly detached Word editor is clean until its inherited layout changes',async()=>{
 const {c,calls,element}=editor();await c.window.draftRecovery.initialize();
 const layout={mode:'numbered-right',numberFormat:'(#C1.#E1)',chapter:2,section:3};
 for(const [name,value] of Object.entries({mode:layout.mode,format:layout.numberFormat,chapter:layout.chapter,section:layout.section}))element('layout-'+name).value=String(value);
 c.mf.value='x+1';c.window.wordDetachedCleanBaseline={latex:'x+1',typography:'null',ruler:'[]',layout};
 assert.equal(c.window.hasRecoverableDraft(),false);
 await c.window.nativeFlushDraft();assert.equal(calls.some(call=>call.action==='draftSave'),false);
 element('layout-format').value='(#C1-#E1)';element('layout-format').listeners.input();
 assert.equal(c.window.hasRecoverableDraft(),true);await c.window.nativeFlushDraft();
 assert.equal(calls.at(-1).payload.draft.layout.numberFormat,'(#C1-#E1)');
});
test('restoring a missing recovery draft leaves the current Word session in place',async()=>{
 const {c,calls}=editor({recovered:{draft:{latex:'older',mode:'rebuild'}},restoreResult:{available:false}});
 await c.window.draftRecovery.initialize();
 c.wordTicket='word-session';c.mf.value='my live draft';
 let cancelled=false;c.window.nativeCancelWordSession=async()=>{cancelled=true;return true;};
 assert.equal(await c.window.nativeRestoreDraft(),false);
 assert.equal(cancelled,false);assert.equal(c.wordTicket,'word-session');assert.equal(c.mf.value,'my live draft');
 assert.equal(c.window.draftRecoveryState.available,false);
 assert.equal(calls.find(call=>call.action==='draftSave').payload.draft.latex,'my live draft');
});
test('A Word open already in flight prevents restoration from replacing the current editor',async()=>{
 const {c,calls}=editor({recovered:{draft:{latex:'older',mode:'rebuild'}}});
 await c.window.draftRecovery.initialize();
 c.mf.value='current';c.window.wordDocumentWorkspace={pending:true};
 assert.equal(await c.window.nativeRestoreDraft(),false);
 assert.equal(c.mf.value,'current');assert.equal(c.window.draftRecoveryState.available,true);
 assert.equal(calls.some(call=>['draftRestore','confirmWordSessionSwitch'].includes(call.action)),false);
});
test('live Word cancellation after materialization keeps the staged recovery source available',async()=>{
 const recovered={draft:{latex:'recovered',mode:'rebuild'},source:{path:'/private/staged.docx',recoveredDraft:true,objects:[{index:0,latex:'older',nativeSha256:'f'.repeat(64)}]}};
 const {c,calls}=editor({recovered});await c.window.draftRecovery.initialize();
 c.wordTicket='word-session';c.mf.value='my live draft';
 const editorUpdates=[];c.validate=async()=>{editorUpdates.push('validate');};
 c.window.nativeRefreshEditorSurface=()=>{assert.equal(c.mf.value,'recovered');editorUpdates.push('paint');};
 c.window.nativeCancelWordSession=async()=>{
  assert.ok(calls.some(call=>call.action==='draftRestore'));
  assert.equal(c.window.restoringRecoveryDraft,true);
  c.wordTicket=null;c.resetNewFormula();return true;
 };
 assert.equal(await c.window.nativeRestoreDraft(),true);
 assert.equal(c.mf.value,'recovered');assert.equal(c.source.path,recovered.source.path);
 assert.deepEqual(editorUpdates,['validate','paint']);
 assert.equal(c.window.restoringRecoveryDraft,false);
});
test('restoring and backing up a character draft keeps its baseline, replacements and unknown outcome',async()=>{
 const recovered={draft:{latex:'x+1',mode:'characters',replacements:{4:'y'},outcomeUnknown:true,layout:{mode:'numbered-right',numberFormat:'(#C1.#E1)',chapter:3,section:1}},source:{path:'/private/recovered.docx',objects:[{index:0,latex:'x+1',nativeSha256:'f'.repeat(64),characters:[{offset:4,char:'x'}]}]}};
 const {c,calls}=editor({recovered});await c.window.draftRecovery.initialize();
 assert.equal(await c.window.nativeRestoreDraft(),true);assert.equal(c.wordTicket,null);assert.equal(c.mode,'characters');assert.equal(c.window.draftOutcomeUnknown,true);
 await c.window.nativeFlushDraft();const snapshot=calls.filter(call=>call.action==='draftSave').at(-1).payload;
 assert.equal(snapshot.draft.mode,'characters');assert.equal(snapshot.draft.outcomeUnknown,true);assert.equal(snapshot.draft.replacements['4'],'y');assert.equal(snapshot.source.nativeSha256,'f'.repeat(64));
 assert.equal(calls.some(call=>/^wordSession/.test(call.action)),false);
});
test('character replacement production entry schedules backup without changing its composition handling',async()=>{
 const source=app.slice(app.indexOf('async function previewCharacterEdit()'),app.indexOf("$('mode-characters').onclick"));
 let scheduled=0,checks=0;const c=vm.createContext({window:{draftRecovery:{schedule:()=>scheduled++}},revision:0,valid:true,validationPending:false,controls(){},timer:1,clearTimeout(){},validate:async()=>{checks++;}});
 vm.runInContext(source,c);await c.previewCharacterEdit();assert.equal(scheduled,1);assert.equal(checks,1);
});
