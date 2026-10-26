import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../desktop/app.js',import.meta.url),'utf8');
function editor(){
 const nodes=new Map();const $=id=>{if(!nodes.has(id)){const flags=new Set();nodes.set(id,{textContent:'',classList:{toggle(name,on){on?flags.add(name):flags.delete(name);},contains:name=>flags.has(name)}});}return nodes.get(id);};
 let warnings=['原公式含未映射字符，方框为占位显示；原始字符数据已保留。'];
 const context=vm.createContext({$,window:{},wordNavigating:false,validationRequested:false,validationPending:false,validationRunning:null,validatedFormulaKey:null,revision:0,valid:false,source:null,selected:null,mf:{value:'x'},formulaKey:()=>1,rulerPatch:()=>({}),controls(){},requestWorkbenchSync(){},native:async()=>({svg:'preview',nativeBytes:12,warnings})});
 const code=source.split('\n').filter(line=>/^function (message|status)\(/.test(line)).join('\n')+'\n'+source.slice(source.indexOf('async function validate(){'),source.indexOf('\nfunction changed('));
 vm.runInContext(code,context);return{context,$,setWarnings:value=>{warnings=value;},validate:()=>vm.runInContext('validate()',context)};
}
test('An unmapped glyph remains a visible warning after sidebar selection reports success, without disabling native preservation',async()=>{
 const e=editor();await e.validate();vm.runInContext("message('已打开文档中的第 81 个公式。')",e.context);
 assert.equal(e.context.valid,true);assert.equal(e.$('native-status').classList.contains('warning'),true);assert.equal(e.$('native-status').classList.contains('error'),false);assert.match(e.$('status-detail').textContent,/方框.*原始字符数据已保留/);
});
test('Selecting an ordinary formula clears the previous glyph warning',async()=>{
 const e=editor();await e.validate();e.setWarnings([]);await e.validate();assert.equal(e.$('native-status').classList.contains('warning'),false);assert.equal(e.context.valid,true);assert.equal(e.$('status-title').textContent,'原生 MathType 数据检查通过');
});
