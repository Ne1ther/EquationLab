import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../desktop/app.js',import.meta.url),'utf8');
test('Busy dispatch rejects edits before touching the editor while leaving navigation available',async()=>{
 const code=source.slice(source.indexOf('window.workbenchAction=async'),source.indexOf("document.body.classList.add('workbench-canvas')"));
 const actions=[],context=vm.createContext({window:{},wordNavigating:false,busy:true,mf:{readOnly:false,focus(){actions.push('focus');},insert(){actions.push('insert');}},
  groups:{Greek:[]},palette:name=>actions.push(name),requestWorkbenchSync(){}});
 vm.runInContext(code,context);
 for(const action of ['template','insertLetter','field','unit','fontStyle','arrangeAll','click'])assert.equal(await context.window.workbenchAction(action,{latex:'x'}),false,action);
 assert.deepEqual(actions,[]);
 assert.equal(await context.window.workbenchAction('category',{name:'Greek'}),true);assert.deepEqual(actions,['Greek']);
});

test('A busy New action is blocked; Word completion waits for the native window to hide before clearing the editor',async()=>{
 const names=['function resetNewFormula()','window.nativeNew=','async function finishWordSave()'];
 const code=names.map(name=>source.split('\n').find(line=>line.startsWith(name))).join('\n');
 assert.ok(names.every(name=>code.includes(name)));
 const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,{hidden:false,textContent:'',querySelectorAll:()=>[]});return elements.get(id);};
 let hide;const hidden=new Promise(resolve=>{hide=resolve;});
 const mf={value:'edited formula',readOnly:true};const context=vm.createContext({window:{},busy:true,wordTicket:'active',wordSaveQueued:true,source:{},selected:{},mf,$:element,
  renderObjects(){},changed(){},loadObjectLayout(){},syncSidebar(){return hidden;},message(){}});
 vm.runInContext(code,context);assert.equal(context.window.nativeNew(),false);assert.equal(mf.value,'edited formula');
 const completion=vm.runInContext('finishWordSave()',context);assert.equal(mf.value,'edited formula','keep the formula painted while the window is visible');hide();await completion;assert.equal(mf.value,'');assert.equal(mf.readOnly,false);assert.equal(context.wordTicket,null);assert.equal(context.selected,null);assert.equal(element('word-session-actions').hidden,true);
});

test('Rapid sidebar clicks stay in the Word handoff until the new document ticket is read',async()=>{
 const calls=[],selected=[],cancelledTimers=[];let nextTimer=1;
 const element=()=>({hidden:false,textContent:''});
 const context=vm.createContext({window:{},busy:false,wordNavigating:false,wordNavigationTimer:null,wordTicket:'a'.repeat(64),timer:42,revision:0,validationRequested:true,validationPending:true,valid:true,idleWaiters:new Set(),
  source:{hasDocumentContext:true,objects:[{index:0},{index:1},{index:2}]},selected:{index:0},controls(){},message(){},wordSessionChanged:()=>false,
  selectObject(index){selected.push(index);context.selected=context.source.objects[index];},native:async(action,payload)=>{calls.push({action,payload});return action==='wordSessionRead'?{hasDocumentContext:true,activeIndex:1,objects:[{index:0},{index:1},{index:2}]}:{};},
  syncSidebar:async()=>{},renderObjects(){},validate:async()=>{},loadWordThumbnails(){},$:element,clearTimeout:id=>cancelledTimers.push(id),setTimeout:()=>nextTimer++});
 const dispatch=source.slice(source.indexOf('window.nativeSelectObject=async'),source.indexOf(';window.nativeFavorite='))+ ';';
 const open=source.slice(source.indexOf('window.nativeOpenWordSession=async'),source.indexOf('async function loadWordThumbnails'));
 const perform=source.split('\n').find(line=>line.startsWith('async function perform('));
 vm.runInContext(perform+'\n'+dispatch+'\n'+open,context);
 assert.equal(await context.window.nativeSelectObject(1),true);
 assert.equal(context.busy,false);assert.equal(context.wordNavigating,true);
 await context.window.nativeSelectObject(2);await context.window.nativeSelectObject(0);
 assert.deepEqual(selected,[],'do not select from a document whose temporary stage has been deleted');
 assert.deepEqual(calls.map(c=>c.action),['wordSessionNavigate']);assert.ok(cancelledTimers.includes(42));
 assert.equal(context.valid,false);assert.equal(context.validationRequested,false);
 assert.equal(await context.window.nativeOpenWordSession('b'.repeat(64)),true);
 assert.equal(context.wordNavigating,false);assert.equal(context.wordTicket,'b'.repeat(64));assert.deepEqual(selected,[1]);
 assert.deepEqual(calls.map(c=>c.action),['wordSessionNavigate','wordSessionRead']);
});

test('A lost navigation reply discards the stale stage instead of enabling standalone editing',async()=>{
 const calls=[];let resets=0;
 const context=vm.createContext({window:{},busy:false,wordNavigating:false,wordNavigationTimer:null,wordTicket:'a'.repeat(64),timer:42,revision:0,validationRequested:true,validationPending:true,valid:true,idleWaiters:new Set(),
  source:{hasDocumentContext:true,objects:[{index:0},{index:1}]},selected:{index:0},controls(){},message(){},wordSessionChanged:()=>false,selectObject(){throw Error('stale selection');},
  native:async action=>{calls.push(action);if(action==='wordSessionNavigate')throw Error('reply lost');return {};},syncSidebar:async()=>{},resetNewFormula(){resets++;},clearTimeout(){},setTimeout(){throw Error('navigation already failed');}});
 const dispatch=source.slice(source.indexOf('window.nativeSelectObject=async'),source.indexOf(';window.nativeFavorite='))+';';
 const perform=source.split('\n').find(line=>line.startsWith('async function perform('));vm.runInContext(perform+'\n'+dispatch,context);
 assert.equal(await context.window.nativeSelectObject(1),false);assert.deepEqual(calls,['wordSessionNavigate','wordSessionCancel']);
 assert.equal(context.wordNavigating,false);assert.equal(context.wordTicket,null);assert.equal(context.source,null);assert.equal(context.selected,null);assert.equal(resets,1);
});
