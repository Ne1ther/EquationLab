import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const controller=await readFile(new URL('../desktop/draft-recovery.js',import.meta.url),'utf8'),integration=await readFile(new URL('../desktop/draft-integration.js',import.meta.url),'utf8'),app=await readFile(new URL('../desktop/app.js',import.meta.url),'utf8');
const id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',old='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
function editor({recovered}={}){
 const calls=[],elements=new Map();let inputs=[],timer=0,composing=false;
 const element=id=>{if(!elements.has(id))elements.set(id,{value:({'layout-mode':'inline','layout-format':'(#E1)','layout-chapter':'1','layout-section':'1'})[id]??'',disabled:false,listeners:{},addEventListener(name,fn){this.listeners[name]=fn;},querySelectorAll:()=>inputs});return elements.get(id);};
 const c=vm.createContext({crypto:{randomUUID:()=>id},setTimeout:()=>++timer,clearTimeout(){},window:{},source:null,selected:null,mode:'rebuild',wordTicket:null,wordOutcomeUnknown:false,wordSaveQueued:false,wordCommitRunning:null,busy:false,editingRuler:undefined,mf:{value:''},$:element,
  native:async(action,payload)=>{calls.push({action,payload:JSON.parse(JSON.stringify(payload??{}))});if(action==='draftStatus')return recovered?{available:true,id:old,updatedAt:100,outcomeUnknown:recovered.draft.outcomeUnknown}:{available:false};if(action==='draftRestore')return recovered;if(action==='confirmWordSessionSwitch')return {discard:true};return {};},
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
 let scheduled=0;const c=vm.createContext({window:{draftRecovery:{schedule:()=>scheduled++}},revision:0,valid:true,validationPending:false,controls(){},$:()=>({querySelectorAll:()=>[],value:''}),source:{path:'fixture'},selected:{index:0},rulerPatch:()=>({}),native:async()=>({latex:'y+1'}),mf:{value:'x+1'},status(){},formulaKey:()=>'',validatedFormulaKey:null});
 vm.runInContext(source,c);await c.previewCharacterEdit();assert.equal(scheduled,1);assert.equal(c.mf.value,'y+1');
});
