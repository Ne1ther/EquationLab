import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const app=await readFile(new URL('../desktop/app.js',import.meta.url),'utf8');
const preferences=await readFile(new URL('../desktop/preferences.js',import.meta.url),'utf8');
const slice=(from,to)=>app.slice(app.indexOf(from),app.indexOf(to));
const swapFactory=vm.runInNewContext('('+preferences.slice(preferences.indexOf('function decodedPreviewSwap('),preferences.indexOf('\n let base='))+')');
const reported=String.raw`H_{\mathrm{pos},\tau}=H_{\mathrm{init},\tau}+PE_\tau`;
const fraction=String.raw`\frac{a}{b}\times\frac{c}{d}=\frac{ac}{bd}`;
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function editor(){
 const calls=[],decodes=[],messages=[],elements=new Map(),image={src:'old-preview',removeAttribute(){this.src='';}};
 let typography={fullSize:18};
 const swap=swapFactory(image,()=>{},()=>({decode(){return new Promise((resolve,reject)=>decodes.push({resolve,reject}));}}));
 const element=id=>{if(!elements.has(id))elements.set(id,{value:'',disabled:false,hidden:false,readOnly:false,querySelectorAll:()=>[]});return elements.get(id);};
 const context=vm.createContext({
  window:{desktopTypographyPatch:()=>typography,desktopFontPreview:swap},
  mf:{value:reported},$:element,source:{path:'seed.docx',activePath:'seed.docx',insertion:true,insertionLayout:{mode:'numbered-right',numberFormat:'(#E1)',chapter:1,section:1,equation:11}},selected:null,
  mode:'rebuild',revision:0,timer:null,valid:false,validationRunning:null,validationRequested:false,validationPending:false,validatedFormulaKey:null,
  busy:false,wordNavigating:false,wordSaveQueued:false,wordOutcomeUnknown:false,wordCommitRunning:null,wordTicket:'a'.repeat(64),idleWaiters:new Set(),editingRuler:undefined,
  clearTimeout,setTimeout,controls(){},status(){},message:text=>messages.push(text),
  rulerPatch:()=>({}),wordLayout:()=>({}),sourceEditMode:()=> 'rebuild',syncSidebar:async()=>{},resetNewFormula(){},
  native:async(action,payload)=>{calls.push({action,payload});if(action==='validate'||action==='editPreview')return {svg:JSON.stringify([payload.latex??reported,payload.typography]),latex:payload.latex??reported,nativeBytes:100};return {acknowledgement:false};}
 });
 vm.runInContext([
  app.split('\n').find(line=>line.startsWith('function formulaKey(')),
  slice('async function ensureValid()','function changed('),
  app.split('\n').find(line=>line.startsWith('async function perform(')),
  app.split('\n').find(line=>line.startsWith('function wordSourceUnavailable()')),
  app.split('\n').find(line=>line.startsWith('async function previewCharacterEdit()')),
  slice('async function bindSelectedWordFormula()',"$('word-session-save').onclick")
 ].join('\n'),context);
 return {context,calls,decodes,messages,image,setTypography:patch=>{typography=patch;},
  change(latex=reported){context.mf.value=latex;context.revision++;context.valid=false;context.validationPending=true;},
  async decode(){assert.ok(decodes.length,'a preview decode should be pending');decodes.shift().resolve();await tick();}};
}

test('Word insertion waits for the preview of the current content and typography to be displayed',async()=>{
 const e=editor(),c=e.context;e.change();
 const checking=c.validate();await tick();
 assert.equal(c.valid,false,'a native response alone must not make the old displayed image insertable');
 const saving=c.window.nativeCommitWordSession();await tick();
 assert.equal(e.calls.filter(x=>x.action==='wordSessionInsert').length,0,'insertion must wait for image decoding');
 await e.decode();await checking;assert.equal(await saving,true);
 const submitted=e.calls.find(x=>x.action==='wordSessionInsert').payload;
 assert.equal(e.image.src,JSON.stringify([submitted.latex,submitted.typography]));
 assert.equal(submitted.latex,reported);assert.equal(submitted.typography.fullSize,18);
 assert.equal(submitted.layout.equation,11,'the captured numbering counter must remain intact');
});

test('A late decode from an earlier equation cannot validate a newer insertion',async()=>{
 const e=editor(),c=e.context;e.change();const checking=c.validate();await tick();
 e.change(fraction);e.setTypography({fullSize:12});const next=c.validate();
 await e.decode();assert.equal(c.valid,false,'the obsolete H preview cannot validate the fraction');
 await e.decode();await Promise.all([checking,next]);
 assert.equal(c.valid,true);assert.equal(e.image.src,JSON.stringify([fraction,{fullSize:12}]));
 assert.equal(await c.window.nativeCommitWordSession(),true);
 const submitted=e.calls.find(x=>x.action==='wordSessionInsert').payload;
 assert.equal(e.image.src,JSON.stringify([submitted.latex,submitted.typography]));
});

test('A preview decode failure keeps the draft and prevents insertion',async()=>{
 const e=editor(),c=e.context;e.change();const saving=c.window.nativeCommitWordSession();await tick();
 e.decodes.shift().reject(Error('decode failed'));await tick();
 assert.equal(await saving,false);assert.equal(c.valid,false);assert.equal(c.mf.value,reported);
 assert.equal(e.calls.filter(x=>x.action==='wordSessionInsert').length,0);
});

test('Changing only typography waits for its new preview before inserting',async()=>{
 const e=editor(),c=e.context;e.change();const first=c.validate();await tick();await e.decode();await first;
 e.setTypography({fullSize:12,styles:{3:{font:'Arial',style:0}}});e.change();
 const checking=c.validate();await tick();const saving=c.window.nativeCommitWordSession();await tick();
 assert.equal(e.calls.filter(x=>x.action==='wordSessionInsert').length,0);
 await e.decode();await checking;assert.equal(await saving,true);
 const submitted=e.calls.find(x=>x.action==='wordSessionInsert').payload;
 assert.equal(submitted.typography.fullSize,12);assert.equal(submitted.typography.styles[3].font,'Arial');
 assert.equal(e.image.src,JSON.stringify([submitted.latex,submitted.typography]));
});

test('Character-only editing also waits for the current preview before enabling save',async()=>{
 const e=editor(),c=e.context;c.source={path:'existing.docx',activeIndex:0};c.selected={index:0,nativeSha256:'b'.repeat(64)};c.mode='characters';
 const checking=c.previewCharacterEdit();await tick();assert.equal(c.valid,false);
 await e.decode();await checking;assert.equal(c.valid,true);
 assert.equal(await c.window.nativeCommitWordSession(),true);
 const submitted=e.calls.find(x=>x.action==='wordSessionSave').payload;
 assert.equal(e.image.src,JSON.stringify([submitted.latex,submitted.typography]));
});
