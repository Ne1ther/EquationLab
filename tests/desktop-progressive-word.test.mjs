import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
const app=await readFile(new URL('../desktop/app.js',import.meta.url),'utf8'),loader=app.slice(app.indexOf('async function loadWordDocument('),app.indexOf('async function loadWordThumbnails('));
function editor(reply){
 const initial={documentLoading:true,documentPosition:25,documentTotal:30,documentIdentity:'word:42',documentSnapshot:100,path:'partial.docx'},old={index:0,nativeSha256:'f'.repeat(64),editorBaseline:'original',ruler:[{position:50,type:1}]};
 const field={value:'live draft',selection:{ranges:[[2,4]]}},ruler=[{position:70,type:2}],history=['original','live draft'],calls=[];
 const full={wordTicket:'a'.repeat(64),activeIndex:25,documentIdentity:'word:42',documentSnapshot:101,path:'full.docx',documentContext:{count:30},objects:Array.from({length:30},(_,index)=>({index,nativeSha256:index===25?'f'.repeat(64):String(index),latex:'original'}))};
 const context=vm.createContext({window:{wordSessionGeneration:0,wordDocumentWorkspace:{remember:r=>calls.push(['remember',r])}},wordTicket:'a'.repeat(64),source:initial,selected:old,mf:field,editingRuler:ruler,mode:'characters',history,busy:false,wordSaveQueued:false,wordOutcomeUnknown:false,wordCommitRunning:null,wordNavigating:false,validationRunning:null,validationPending:false,valid:true,validatedFormulaKey:'old',formulaKey:()=>context.source.path,calls,Date,setTimeout:(fn)=>{fn();},native:async()=>reply?reply(context,full):{state:'available',document:full},renderObjects:async()=>calls.push(['render']),controls:()=>{},requestWorkbenchSync:()=>{},loadWordThumbnails:()=>calls.push(['thumbnails']),$:()=>({textContent:'keep current message'}),message:()=>{}});
 vm.runInContext(loader,context);return {context,initial,old,field,ruler,history,full,calls};
}
test('Hydrating the full list preserves the live formula, selection, undo, character mode and ruler patch',async()=>{
 const e=editor();await e.context.loadWordDocument(e.context.wordTicket,e.initial);
 assert.equal(e.context.source,e.full);assert.equal(e.context.selected,e.old);assert.equal(e.old.index,25);assert.equal(e.old.editorBaseline,'original');
 assert.equal(e.context.mf,e.field);assert.equal(e.field.value,'live draft');assert.deepEqual(e.field.selection.ranges,[[2,4]]);assert.equal(e.context.editingRuler,e.ruler);assert.equal(e.context.history,e.history);assert.equal(e.context.mode,'characters');assert.equal(e.context.validatedFormulaKey,'full.docx');assert.equal(e.calls.filter(c=>c[0]==='render').length,1);
});
test('A cancelled or superseded ticket cannot apply a late full list',async()=>{
 const e=editor((ctx,full)=>{ctx.wordTicket='b'.repeat(64);return {state:'available',document:full};});
 await e.context.loadWordDocument('a'.repeat(64),e.initial);assert.equal(e.context.source,e.initial);assert.equal(e.old.index,0);assert.equal(e.calls.length,0);
});
test('A foreign or failed list preserves the partial owner and live draft',async()=>{
 for(const mode of ['foreign','failed']){
  const e=editor((ctx,full)=>mode==='failed'?{state:'failed'}:{state:'available',document:{...full,documentIdentity:'other:42'}});
  await e.context.loadWordDocument(e.context.wordTicket,e.initial);assert.equal(e.context.source,e.initial);assert.equal(e.initial.documentLoadFailed,true);assert.equal(e.context.mf.value,'live draft');assert.equal(e.old.index,0);assert.equal(e.calls.length,0);
 }
});
test('A thesis renders only the opening viewport and explicit scroll demand, not every off-screen thumbnail',async()=>{
 const source={objects:Array.from({length:112},(_,index)=>({index})),activeIndex:14,documentIdentity:'word:42',documentSnapshot:101},batches=[];
 const context=vm.createContext({window:{},source,wordTicket:'a'.repeat(64),wordNavigating:false,busy:false,wordCommitRunning:null,validationRunning:null,validationPending:false,Set,Number,setTimeout:fn=>queueMicrotask(fn),requestWorkbenchSync(){},native:async(action,payload)=>{batches.push(payload);return {images:payload.indices.map(index=>({index,image:'image-'+index}))};}});
 vm.runInContext(app.slice(app.indexOf('async function loadWordThumbnails('),app.indexOf('async function bindSelectedWordFormula(')),context);
 await context.loadWordThumbnails(context.wordTicket,source);
 assert.deepEqual(batches.flatMap(b=>Array.from(b.indices)),[14,0,1,2,3,4,5,6,7,8,9]);
 assert.equal(source.objects[80].image,undefined);assert.ok(batches.every(b=>b.indices.length<=2&&b.documentIdentity==='word:42'&&b.documentSnapshot===101));
 await context.loadWordThumbnails(context.wordTicket,source,[80]);assert.equal(source.objects[80].image,'image-80');
 const count=batches.length;await context.loadWordThumbnails(context.wordTicket,source,[80]);assert.equal(batches.length,count);
});
