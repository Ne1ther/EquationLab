import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
import {setImmediate as settle} from 'node:timers/promises';
const app=await readFile(new URL('../desktop/app.js',import.meta.url),'utf8'),loader=app.slice(app.indexOf('async function loadWordDocument('),app.indexOf('async function loadWordThumbnails('));
const thumbnailLoader=app.slice(app.indexOf('async function loadWordThumbnails('),app.indexOf('async function bindSelectedWordFormula('));
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
test('A source without a cached document renders selected and visible rows on demand',async()=>{
 const source={objects:Array.from({length:112},(_,index)=>({index})),activeIndex:14,documentIdentity:'word:42',documentSnapshot:101},batches=[];
 const context=vm.createContext({window:{},source,selected:source.objects[14],wordTicket:'a'.repeat(64),wordNavigating:false,busy:false,wordCommitRunning:null,validationRunning:null,validationPending:false,Set,Number,setTimeout:fn=>queueMicrotask(fn),requestWorkbenchSync(){},native:async(action,payload)=>{batches.push(payload);return {images:payload.indices.map(index=>({index,image:'image-'+index}))};}});
 vm.runInContext(thumbnailLoader,context);
 await context.loadWordThumbnails(context.wordTicket,source);
 assert.deepEqual(batches.flatMap(b=>Array.from(b.indices)),[14]);
 assert.equal(source.objects[80].image,undefined);assert.ok(batches.every(b=>b.indices.length===1&&b.documentIdentity==='word:42'&&b.documentSnapshot===101));
 await context.loadWordThumbnails(context.wordTicket,source,[80]);assert.equal(source.objects[80].image,'image-80');
 const count=batches.length;await context.loadWordThumbnails(context.wordTicket,source,[80]);assert.equal(batches.length,count);
 const loading=context.loadWordThumbnails(context.wordTicket,source,[70,81]);context.window.nativeReleaseWordThumbnail(70);await loading;
 assert.equal(source.objects[70].image,undefined);assert.equal(source.objects[81].image,'image-81');
});

function cachedThumbnailEditor({count=8,backgroundReply}={}){
 const makeDocument=(identity='word:42')=>({hasDocumentContext:true,path:identity+'.docx',documentIdentity:identity,documentSnapshot:101,
  documentNumberingRevision:7,sourceSha256:'b'.repeat(64),objects:Array.from({length:count},(_,index)=>({index,nativeSha256:index.toString(16).padStart(64,'0')}))});
 const source=makeDocument(),requests=[],cancellations=[],ticket='a'.repeat(64);
 const workspace={visibleSource:document=>document};
 const context=vm.createContext({window:{wordDocumentWorkspace:workspace},source,selected:source.objects[2],wordTicket:ticket,
  wordNavigating:false,busy:false,wordCommitRunning:null,validationRunning:null,validationPending:false,
  setTimeout:fn=>setImmediate(fn),requestWorkbenchSync(){},native:async(action,payload)=>{
   if(action==='wordDocumentThumbnailCancel'){cancellations.push(payload.requestId);return {};}
   if(action==='wordSessionThumbnails'){
    requests.push({kind:'visible',indices:Array.from(payload.indices)});
    return {images:payload.indices.map(index=>({index,image:'visible-'+index}))};
   }
   assert.equal(action,'wordDocumentThumbnail');
   requests.push({kind:payload.visible?'cached-visible':'background',index:payload.index,requestId:payload.requestId});
   return backgroundReply?.(payload)??{image:(payload.visible?'visible-':'idle-')+payload.index};
  }});
 vm.runInContext(thumbnailLoader,context);
 return {context,source,requests,cancellations,workspace,ticket,makeDocument};
}

test('A 112-row Word list fills offscreen thumbnails on its own from one cached snapshot',async()=>{
 const e=cachedThumbnailEditor({count:112});
 await e.context.loadWordThumbnails(e.ticket,e.source);
 assert.deepEqual(e.requests[0],{kind:'visible',indices:[2]});
 assert.deepEqual(e.requests.slice(1).map(row=>row.index),Array.from({length:112},(_,i)=>i).filter(i=>i!==2));
 assert.equal(e.source.objects[111].image,'idle-111');
 assert.ok(e.source.objects.every(row=>row.image));
});

test('A detached revision change retires the old preload and prioritizes still-visible cached rows',async()=>{
 let started,respond;
 const began=new Promise(resolve=>{started=resolve;});
 const pending=new Promise(resolve=>{respond=resolve;});
 const e=cachedThumbnailEditor({backgroundReply:payload=>{if(payload.requestId===1){started();return pending;}}});
 const cached=e.source;
 e.context.source=null;e.context.wordTicket=null;e.context.selected=null;
 e.workspace.visibleSource=()=>cached;
 const oldJob=e.context.loadWordThumbnails(null,cached,[]);await began;
 // Swift visibility does not need to emit another event for the same row.
 e.context.window.nativeRequestWordThumbnail(7);
 cached.liveNumberingRevision=8;
 e.context.window.updateWordThumbnails();
 respond({image:'stale'});
 await oldJob;
 assert.deepEqual(e.cancellations,[1]);
 await settle();await settle();
 assert.deepEqual(e.requests[1],{kind:'cached-visible',index:7,requestId:2});
 assert.equal(cached.objects[7].image,'visible-7');
 assert.notEqual(cached.objects[0].image,'stale');
 e.context.window.nativeStopWordThumbnails();
});

test('Switching document, changing revision, cancelling or closing invalidates in-flight idle thumbnails',async()=>{
 for(const reason of ['document','revision','cancel','close']){
  let started,respond;
  const began=new Promise(resolve=>{started=resolve;});
  const pending=new Promise(resolve=>{respond=resolve;});
  const e=cachedThumbnailEditor({backgroundReply:payload=>{if(payload.requestId===1){started();return pending;}}});
  const oldJob=e.context.loadWordThumbnails(e.ticket,e.source);await began;
  if(reason==='document')e.context.source=e.makeDocument('word:43');
  if(reason==='revision')e.source.liveNumberingRevision=8;
  if(reason==='cancel')e.context.window.wordSessionGeneration=1;
  if(reason==='close')e.context.window.nativeStopWordThumbnails();
  e.context.window.updateWordThumbnails();
  assert.deepEqual(e.cancellations,[1],reason);
  respond({image:'late-image'});await oldJob;
  assert.notEqual(e.source.objects[0].image,'late-image',reason);
  assert.notEqual(e.context.source.objects[0].image,'late-image',reason);
  e.context.window.nativeStopWordThumbnails();
 }
});

test('Visible rows, editing and locating yield no work to the idle queue until they finish',async()=>{
 let started,respond;
 const began=new Promise(resolve=>{started=resolve;});
 const pending=new Promise(resolve=>{respond=resolve;});
 const e=cachedThumbnailEditor({backgroundReply:payload=>{if(payload.requestId===1){started();return pending;}}});
 const loading=e.context.loadWordThumbnails(e.ticket,e.source);await began;
 e.context.window.nativeRequestWordThumbnail(7);
 e.context.validationPending=true;e.workspace.revealing=true;
 assert.deepEqual(e.cancellations,[1]);
 respond({cancelled:true});await settle();
 assert.equal(e.requests.length,2);
 e.context.validationPending=false;await settle();
 assert.equal(e.requests.length,2,'a pending reveal also holds idle work');
 e.workspace.revealing=false;await loading;
 assert.deepEqual(e.requests[2],{kind:'visible',indices:[7]});
 assert.equal(e.source.objects[7].image,'visible-7');
 assert.equal(e.source.objects[0].image,'idle-0');
});

function thumbnailVisibilityTest(reply) {
 const source={objects:Array.from({length:112},(_,index)=>({index})),path:'full.docx',activeIndex:0,documentIdentity:'word:42',documentSnapshot:101};
 const requests=[];
 const context=vm.createContext({
  window:{},source,selected:source.objects[0],wordTicket:'a'.repeat(64),wordNavigating:false,busy:false,
  wordCommitRunning:null,validationRunning:null,validationPending:false,setTimeout:queueMicrotask,
  requestWorkbenchSync(){},
  async native(action,payload){
   assert.equal(action,'wordSessionThumbnails');
   assert.equal(payload.documentSnapshot,101);
   assert.equal(payload.documentIdentity,'word:42');
   const indices=Array.from(payload.indices);
   requests.push(...indices);
   await reply(indices);
   return {images:indices.map(index=>({index,image:'image-'+index}))};
  }
 });
 vm.runInContext(thumbnailLoader,context);
 const show=(index,visible=true)=>context.window.nativeWordThumbnailVisibility(JSON.stringify({index,visible,path:source.path}));
 return {show,source,requests};
}

test('A source reopened at the same path ignores stale visibility events and delayed images',async()=>{
 const makeSource=generation=>({
  path:'copy.docx',sourceSha256:String(generation).repeat(64),fileCopyGeneration:generation,
  objects:[{index:0},{index:1}]
 });
 const old=makeSource(1),next=makeSource(2),requests=[];
 let started,finish;
 const began=new Promise(resolve=>{started=resolve;});
 const pending=new Promise(resolve=>{finish=resolve;});
 const context=vm.createContext({
  window:{},source:old,selected:old.objects[0],wordTicket:null,wordNavigating:false,busy:false,
  wordCommitRunning:null,validationRunning:null,validationPending:false,setTimeout:queueMicrotask,requestWorkbenchSync(){},
  async native(action,payload){
   assert.equal(action,'fileCopyThumbnails');
   assert.equal(payload.path,'copy.docx');
   requests.push(payload.sourceSha256);
   if(payload.sourceSha256===old.sourceSha256){started();await pending;}
   return {images:[{index:1,image:payload.sourceSha256}]};
  }
 });
 vm.runInContext(thumbnailLoader,context);
 const show=generation=>context.window.nativeWordThumbnailVisibility(JSON.stringify({index:1,visible:true,path:old.path,fileCopyGeneration:generation}));
 show(1);await began;
 context.source=next;context.selected=next.objects[0];
 show(1);
 finish();await settle();
 assert.equal(next.objects[1].image,undefined);
 assert.equal(old.objects[1].image,undefined);
 show(2);await settle();
 assert.deepEqual(requests,[old.sourceSha256,next.sourceSha256]);
 assert.equal(next.objects[1].image,next.sourceSha256);
});

test('Opening a cancelled, empty or unreadable DOCX keeps the current source and selected formula',async()=>{
 const old={path:'current.docx',objects:[{index:0,latex:'x+1'}]},selected=old.objects[0],messages=[];
 let response=null,dirty=false,discard=false;
 const operations=[];
 const context=vm.createContext({
  window:{hasRecoverableDraft:()=>dirty,draftOutcomeUnknown:true,clearSavedDrafts:async()=>operations.push('clear')},wordTicket:null,source:old,selected,
  perform:async operation=>{try{return await operation()!==false;}catch(error){messages.push(error.message);return false;}},
  native(action,payload){
   if(action==='confirmWordSessionSwitch'){assert.equal(payload.fileCopy,true);operations.push('confirm');return {discard};}
   assert.equal(action,'open');assert.equal(payload.thumbnails,false);if(response instanceof Error)throw response;return response;
  },
  message(text){messages.push(text);},
  $(){return {};},
  selectObject(index){context.selected=context.source.objects[index];operations.push('select');},
  loadWordThumbnails(ticket,document){assert.equal(ticket,null);assert.equal(document,response);operations.push('queue');}
 });
 vm.runInContext(app.slice(app.indexOf('function retireStandaloneDraft('),app.indexOf('function renderObjects(')),context);
 dirty=true;
 for(response of [null,{path:'empty.docx',objects:[]},Error('Cannot read this file')]){
  assert.equal(await context.window.nativeOpen(),false);
  assert.equal(context.source,old);
  assert.equal(context.selected,selected);
 }
 assert.deepEqual(operations,[]);
 assert.match(messages[1],/当前编辑已保留/);
 response={path:'reopened.docx',objects:[{index:0,latex:'y+1'}],sourceSha256:'4'.repeat(64)};
 assert.equal(await context.window.nativeOpen(),false);
 assert.equal(context.source,old);assert.equal(context.selected,selected);
 assert.equal(context.window.draftOutcomeUnknown,true);
 discard=true;
 assert.equal(await context.window.nativeOpen(),true);
 assert.equal(context.source,response);
 assert.equal(context.source.fileCopyGeneration,1);
 assert.equal(context.selected,response.objects[0]);
 assert.equal(context.window.draftOutcomeUnknown,false);
 assert.deepEqual(operations,['confirm','confirm','clear','select','queue']);
});

test('A thumbnail request remains deduplicated when its row leaves and re-enters while the RPC is pending',async()=>{
 let notifyStarted,deliver;
 const started=new Promise(resolve=>{notifyStarted=resolve;});
 const pending=new Promise(resolve=>{deliver=resolve;});
 const {show,source,requests}=thumbnailVisibilityTest(async()=>{notifyStarted();await pending;});
 show(80);
 await started;
 show(80,false);
 show(80);
 deliver();
 await settle();
 assert.deepEqual(requests,[80]);
 assert.equal(source.objects[80].image,'image-80');
});

test('A transient thumbnail failure retries once without stranding another visible row',async()=>{
 let failed=false;
 const {show,source,requests}=thumbnailVisibilityTest(async indices=>{
  if(indices.includes(70)&&!failed){failed=true;throw Error('Temporarily unavailable');}
 });
 show(70);
 show(71);
 await settle();
 assert.equal(requests.filter(index=>index===70).length,2);
 assert.equal(requests.filter(index=>index===71).length,2);
 assert.equal(source.objects[70].image,'image-70');
 assert.equal(source.objects[71].image,'image-71');
});

test('Rapid scrolling coalesces surviving visible rows into bounded thumbnail batches',async()=>{
 const batches=[];
 const {show,source}=thumbnailVisibilityTest(async indices=>batches.push(indices));
 for(const index of [4,5,6,7,8])show(index);
 for(const index of [4,5,6,7,8])show(index,false);
 for(const index of [71,72,73,74,75,76])show(index);
 await settle();
 assert.deepEqual(batches,[[71,72,73,74],[75,76]]);
 assert.equal(source.objects[4].image,undefined);
 assert.equal(source.objects[76].image,'image-76');
});

test('Favorite thumbnails discard late results for an evicted entry and schedule the new list',async()=>{
 let start,finish,syncs=0;
 const started=new Promise(resolve=>{start=resolve;}),result=new Promise(resolve=>{finish=resolve;});
 const images=new Map(),requests=[];
 const context=vm.createContext({
  favorites:['old'],workbenchFavoriteImages:images,workbenchFavoriteRenderRunning:false,validationPending:false,
  validationRunning:false,setTimeout:queueMicrotask,requestWorkbenchSync(){syncs++;},
  async native(action,payload){requests.push({action,latex:payload.latex,background:payload.favoriteThumbnail});start();return result;}
 });
 vm.runInContext(app.slice(app.indexOf('async function refreshFavoriteThumbnails('),app.indexOf('function workbenchField(')),context);
 const rendering=context.refreshFavoriteThumbnails(null);
 await started;context.favorites=['new'];finish({png:'stale-preview'});
 await rendering;
 assert.deepEqual(requests,[{action:'preview',latex:'old',background:true}]);
 assert.equal(images.size,0);
 assert.equal(syncs,1);
});

test('Favorites reuse an available preview when an earlier document row has the same LaTeX without an image',async()=>{
 const image='data:image/png;base64,preview',source={objects:[{index:0,latex:'x'},{index:1,latex:'x',image}]};
 const messages=[],nativeCalls=[];
 const element={value:'',options:[],children:[],textContent:'',disabled:false,hidden:false,classList:{contains:()=>false,toggle(){}}};
 const context=vm.createContext({
  window:{sidebarPublisher:{snapshot:()=>({objects:source.objects,delta:null})},webkit:{messageHandlers:{native:{postMessage:message=>messages.push(message)}}}},
  document:{body:element},$(){return element;},source,selected:null,mf:{value:''},favorites:['x'],groups:{},
  wordTicket:'a'.repeat(64),wordNavigating:false,busy:false,wordOutcomeUnknown:false,valid:true,mode:'rebuild',
  workbenchFavoriteImages:new Map(),workbenchFavoriteRenderRunning:false,workbenchLastFields:new Map(),workbenchZoom:0,
  editorViewport:{effectiveZoom:100},editingRuler:null,validationPending:false,validationRunning:false,
  workbenchFields:()=>[],matrixContext:()=>null,canMoveEditorHistory:()=>false,exportAvailable:()=>true,setTimeout:queueMicrotask,
  native:async(...args)=>{nativeCalls.push(args);return {};},requestWorkbenchSync(){}
 });
 vm.runInContext(app.slice(app.indexOf('function documentSidebarState('),app.indexOf('function workbenchField(')),context);
 context.publishWorkbenchState();
 await settle();
 assert.equal(messages[0].payload.favorites[0].image,image);
 assert.deepEqual(nativeCalls,[]);

 assert.ok(Object.hasOwn(messages[0].payload,'templates'));
 assert.ok(Object.hasOwn(messages[0].payload,'categories'));
 context.mf.value='x+1';
 context.publishWorkbenchState();
 assert.deepEqual(Object.keys(messages[1].payload),['latex']);
 context.workbenchFavoriteImages.set('x','updated-image');
 context.publishWorkbenchState();
 assert.equal(messages[2].payload.favorites[0].image,'updated-image');
 assert.equal(Object.hasOwn(messages[2].payload,'templates'),false);
 context.favorites=['y','x'];
 context.publishWorkbenchState();
 assert.deepEqual(messages[3].payload.favorites.map(item=>item.latex),['y','x']);
 context.favorites=[];
 context.publishWorkbenchState();
 assert.equal(messages[4].payload.favorites.length,0);
 assert.equal(context.workbenchFavoriteImages.size,0);
 // Simulated WebKit reload starts with an empty last-field cache and resends static templates/categories.
 context.workbenchLastFields.clear();
 context.publishWorkbenchState();
 assert.ok(Object.hasOwn(messages[5].payload,'templates'));
 assert.ok(Object.hasOwn(messages[5].payload,'categories'));
 assert.ok(Object.hasOwn(messages[5].payload,'favorites'));
});
