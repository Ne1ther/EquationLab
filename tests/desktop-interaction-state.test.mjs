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

test('preflight editing allows insertion commands without allowing file or navigation actions',async()=>{
 const code=source.slice(source.indexOf('window.workbenchAction=async'),source.indexOf("document.body.classList.add('workbench-canvas')")),events=[];
 const context=vm.createContext({window:{documentPreflightEditing:true},wordNavigating:false,busy:true,mf:{readOnly:false,focus(){events.push('focus');},insert(value){events.push(value);}},changed(){events.push('changed');},requestWorkbenchSync(){}});
 vm.runInContext(code,context);
 assert.equal(await context.window.workbenchAction('insertLetter',{latex:'x'}),true);assert.deepEqual(events,['focus','x','changed']);
 for(const [action,payload]of [['click',{id:'save-edit'}],['field',{id:'layout-format'}],['exportGraphic',{format:'pdf'}],['preferencesImport',{}]])assert.equal(await context.window.workbenchAction(action,payload),false,action);
 context.wordNavigating=true;assert.equal(await context.window.workbenchAction('insertLetter',{latex:'y'}),false);assert.deepEqual(events,['focus','x','changed']);
});

test('Reverting the ruler restores the open equation’s own tab stops without changing its text',async()=>{
 const code=source.slice(source.indexOf('window.workbenchAction=async'),source.indexOf("document.body.classList.add('workbench-canvas')"));
 const original=[{position:3200,type:3}];
 let changes=0;
 const context=vm.createContext({window:{},wordNavigating:false,busy:false,
  mf:{value:'x+1',readOnly:false},editingRuler:[{position:6400,type:0}],
  selected:{ruler:original},changed(){changes++;},requestWorkbenchSync(){}});
 vm.runInContext(code,context);
 assert.equal(await context.window.workbenchAction('restoreRuler'),true);
 assert.strictEqual(context.editingRuler,original);
 assert.equal(context.mf.value,'x+1');
 assert.equal(changes,1);
 context.selected=null;
 assert.equal(await context.window.workbenchAction('restoreRuler'),true);
 assert.equal(context.editingRuler,undefined);
});

test('A busy New action is blocked; Word completion waits for the native window to hide before clearing the editor',async()=>{
 const names=['function resetNewFormula()','window.nativeNew='];
 const finish=source.slice(source.indexOf('async function finishWordSave('),source.indexOf('function releaseWordSaveLock()'));
 const code=[...names.map(name=>source.split('\n').find(line=>line.startsWith(name))),finish].join('\n');
 assert.ok(names.every(name=>code.includes(name)));
 const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,{hidden:false,textContent:'',querySelectorAll:()=>[]});return elements.get(id);};
 let hide;const hidden=new Promise(resolve=>{hide=resolve;});
 const metrics=[];let now=5;
 const mf={value:'edited formula',readOnly:true};const context=vm.createContext({window:{webkit:{messageHandlers:{native:{postMessage:value=>metrics.push(value)}}}},performance:{now:()=>now},busy:true,wordTicket:'active',wordSaveQueued:true,source:{},selected:{},editingRuler:[{position:3200,type:0}],mf,$:element,
  renderObjects(){},changed(){},loadObjectLayout(){},syncSidebar(){return hidden;},message(){}});
 vm.runInContext(code,context);assert.equal(context.window.nativeNew(),false);assert.equal(mf.value,'edited formula');
 const completion=vm.runInContext('finishWordSave({started: 1, kind: "save"})',context);assert.equal(mf.value,'edited formula','keep the formula painted while the window is visible');now=9;hide();await completion;assert.equal(mf.value,'');assert.equal(mf.readOnly,false);assert.equal(context.wordTicket,null);assert.equal(context.selected,null);assert.equal(context.editingRuler,undefined);assert.equal(element('word-session-actions').hidden,true);
 assert.deepEqual(JSON.parse(JSON.stringify(metrics)),[{action:'wordSaveTiming',payload:{kind:'save',confirmedMs:4,totalMs:8}}]);
});

test('Using a favorite inserts into an editable Word draft and defers all Word writes',()=>{
 const start=source.indexOf('window.nativeFavorite='),end=source.indexOf('\nsyncSidebar();',start);
 const events=[],workspace={pending:false,wordDocumentUnavailable:false};
 const field={value:'x+',readOnly:false,focus(){events.push('focus');},insert(latex,options){assert.equal(options.selectionMode,'after');this.value+=latex;}};
 const window={wordDocumentWorkspace:workspace,nativeNew:()=>assert.fail('a Word insertion must not discard the current draft')};
 const context=vm.createContext({window,mf:field,favorites:['\\frac{a}{b}'],busy:false,wordNavigating:false,wordTicket:'current-ticket',wordOutcomeUnknown:false,wordSourceUnavailable:()=>workspace.wordDocumentUnavailable,changed:()=>events.push('changed'),message(){}});
 vm.runInContext(source.slice(start,end),context);
 assert.equal(window.nativeFavorite(0),true);assert.equal(field.value,'x+\\frac{a}{b}');assert.equal(context.wordTicket,'current-ticket');assert.deepEqual(events,['focus','changed']);
 workspace.pending=true;assert.equal(window.nativeFavorite(0),false);workspace.pending=false;
 field.readOnly=true;assert.equal(window.nativeFavorite(0),false);field.readOnly=false;
 assert.equal(window.nativeFavorite(999),false);assert.equal(field.value,'x+\\frac{a}{b}');
});

test('Rapid sidebar browsing changes only the local selection and retains the Word save owner',async()=>{
 const calls=[],selected=[];let sidebar=0;
 const context=vm.createContext({window:{},busy:false,wordNavigating:false,wordTicket:'a'.repeat(64),
  source:{hasDocumentContext:true,activeIndex:0,path:'immutable-snapshot.docx',objects:[{index:0},{index:1},{index:2}]},selected:{index:0},
  message(){},wordSessionChanged:()=>false,native:async action=>calls.push(action),syncSidebar:async()=>{sidebar++;},
  selectObject(index){selected.push(index);context.selected=context.source.objects[index];return context.syncSidebar();}});
 const dispatch=source.slice(source.indexOf('window.nativeSelectObject=async'),source.indexOf(';window.nativeFavorite='))+';';
 vm.runInContext(dispatch,context);
 for(const index of [1,2,0])assert.equal(await context.window.nativeSelectObject(index),true);
 assert.deepEqual(selected,[1,2,0]);assert.deepEqual(calls,[]);assert.equal(sidebar,3);
 assert.equal(context.wordNavigating,false);assert.equal(context.wordTicket,'a'.repeat(64));assert.equal(context.source.activeIndex,0);
 context.wordSessionChanged=()=>true;await context.window.nativeSelectObject(2);assert.equal(context.selected.index,0,'unsaved changes stay in their original formula');
});

test('Cross-formula save refuses an untrusted document target while retaining its editable draft',async()=>{
 const calls=[],elements=new Map();const element=id=>{if(!elements.has(id))elements.set(id,{querySelectorAll:()=>[]});return elements.get(id);};
 const context=vm.createContext({window:{desktopTypographyPatch:()=>null},busy:false,wordNavigating:false,wordNavigationTimer:null,wordTicket:'a'.repeat(64),mode:'rebuild',editingRuler:undefined,
  source:{hasDocumentContext:true,activeIndex:0,objects:[{index:0},{index:1}]},selected:{index:1,nativeSha256:'target-hash'},mf:{value:'important edited formula'},
  $:element,controls(){},message(){},changed(){},ensureValid:async()=>{},syncSidebar:async()=>{},setTimeout,clearTimeout,
  resetNewFormula(){context.source=null;context.selected=null;context.mf.value='';},
  native:async action=>{calls.push(action);throw Error('reply lost');}});
 const bind=source.slice(source.indexOf('async function bindSelectedWordFormula()'),source.indexOf('window.nativeCommitWordSession='));
 vm.runInContext(bind,context);
 await assert.rejects(vm.runInContext('bindSelectedWordFormula()',context),/可靠的 Word 文档信息/);
 assert.deepEqual(calls,[]);assert.equal(context.wordNavigating,false);assert.equal(context.wordTicket,'a'.repeat(64));
 assert.equal(context.selected.index,1);assert.equal(context.mf.value,'important edited formula');
});

test('Loading a legacy macro records its normalized editor baseline before dirty checks',()=>{
 const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,{hidden:false,textContent:'',replaceChildren(){},querySelectorAll:()=>[]});return elements.get(id);};
 const object={index:0,latex:'legacy macro spelling',progId:'Equation.DSMT4',ruler:[],characters:[]},mf={value:''};
 const context=vm.createContext({window:{syncEquationMacros(field){if(field.value==='legacy macro spelling')field.value='canonical macro spelling';}},source:{objects:[object]},selected:null,mode:'rebuild',editingRuler:undefined,mf,$:element,loadObjectLayout(){},renderModes(){},renderObjects(){},changed(){context.window.syncEquationMacros(mf);},controls(){},status(){}});
 const select=source.split('\n').find(line=>line.startsWith('function selectObject(')),dirty=source.slice(source.indexOf('function wordSessionChanged('),source.indexOf('\nwindow.nativePrepareToClose=')),mode=source.split('\n').find(line=>line.startsWith('function sourceEditMode('));
 vm.runInContext(select+'\n'+dirty+'\n'+mode,context);vm.runInContext('selectObject(0)',context);
 assert.equal(object.editorBaseline,'canonical macro spelling');assert.equal(vm.runInContext('wordSessionChanged()',context),false);assert.equal(vm.runInContext('sourceEditMode()',context),'characters','normalization alone retains native bytes');
 mf.value+=' + user edit';assert.equal(vm.runInContext('wordSessionChanged()',context),true);assert.equal(vm.runInContext('sourceEditMode()',context),'rebuild');
});
