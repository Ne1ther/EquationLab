import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../desktop/app.js',import.meta.url),'utf8');
test('Busy dispatch rejects edits before touching the editor while leaving navigation available',async()=>{
 const code=source.slice(source.indexOf('window.workbenchAction=async'),source.indexOf("document.body.classList.add('workbench-canvas')"));
 const actions=[],context=vm.createContext({window:{},busy:true,mf:{readOnly:false,focus(){actions.push('focus');},insert(){actions.push('insert');}},
  groups:{Greek:[]},palette:name=>actions.push(name),requestWorkbenchSync(){}});
 vm.runInContext(code,context);
 for(const action of ['template','insertLetter','field','unit','fontStyle','arrangeAll','click'])assert.equal(await context.window.workbenchAction(action,{latex:'x'}),false,action);
 assert.deepEqual(actions,[]);
 assert.equal(await context.window.workbenchAction('category',{name:'Greek'}),true);assert.deepEqual(actions,['Greek']);
});

test('A busy user New action is blocked, but completing Word save still clears the committed session',()=>{
 const names=['function resetNewFormula()','window.nativeNew=','function finishWordSave()'];
 const code=names.map(name=>source.split('\n').find(line=>line.startsWith(name))).join('\n');
 assert.ok(names.every(name=>code.includes(name)));
 const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,{hidden:false,textContent:'',querySelectorAll:()=>[]});return elements.get(id);};
 const mf={value:'edited formula',readOnly:true};const context=vm.createContext({window:{},busy:true,wordTicket:'active',wordSaveQueued:true,source:{},selected:{},mf,$:element,
  renderObjects(){},changed(){},syncSidebar(){},message(){}});
 vm.runInContext(code,context);assert.equal(context.window.nativeNew(),false);assert.equal(mf.value,'edited formula');
 vm.runInContext('finishWordSave()',context);assert.equal(mf.value,'');assert.equal(mf.readOnly,false);assert.equal(context.wordTicket,null);assert.equal(context.selected,null);assert.equal(element('word-session-actions').hidden,true);
});
