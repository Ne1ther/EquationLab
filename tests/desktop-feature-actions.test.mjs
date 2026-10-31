import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {desktopRequest} from '../src/desktop-rpc.mjs';
import {inspectDocx} from '../src/document.mjs';
import {inspectOle,readRuler} from '../src/native.mjs';

const macroSource=await readFile(new URL("../desktop/editable-macros.js",import.meta.url),"utf8");
const source=await readFile(new URL('../desktop/app.js',import.meta.url),'utf8');
function harness(){
 const elements=new Map(),insertions=[],requests=[],element=id=>{
  if(!elements.has(id))elements.set(id,{value:id==='formula'?'x':'',textContent:'',disabled:false,setAttribute(name,value){this[name]=value;},querySelectorAll:()=>[],addEventListener(){},classList:{toggle(){}}});return elements.get(id);
 };
 const mf=element('formula');mf.focus=()=>{};mf.insert=latex=>{insertions.push(latex);mf.value+=latex;};
 const context=vm.createContext({window:{webkit:{messageHandlers:{native:{postMessage:r=>requests.push(r)}}}},MathfieldElement:{},
  document:{getElementById:element,querySelector:()=>element('editor-card')},requestWorkbenchSync(){},setTimeout:()=>1,clearTimeout(){}});
 vm.runInContext(macroSource,context);
 vm.runInContext(source.split('const groups=')[0],context);
 vm.runInContext(source.slice(source.indexOf('window.workbenchAction=async'),source.indexOf("document.body.classList.add('workbench-canvas')")),context);
 context.window.resetEditorHistory();return {context,mf,insertions,requests};
}

test('Custom matrix actions preserve dimensions, fences, partitions and equal-size flags',async()=>{
 const {context,insertions}=harness();
 await context.window.workbenchAction('matrixInsert',{rows:3,columns:7,environment:'bmatrix',alignment:'r',divider:true,equalColumns:true,equalRows:true});
 const latex=insertions[0].replaceAll('#?','x');
 assert.match(latex,/^\\mtmatrix\{130\}\{129\}\{1\}/);
 const result=await desktopRequest({action:'validate',payload:{latex}});assert.ok(result.svg.includes('<svg'));
 const dir=await mkdtemp(join(tmpdir(),'equationlab-matrix-action-'));
 try{await desktopRequest({action:'export',payload:{output:join(dir,'matrix.docx'),equations:[{latex}]}});
  const {objects}=await inspectDocx(await readFile(join(dir,'matrix.docx')));let matrix;
  function walk(nodes){for(const n of nodes){if(n.type===5)matrix=n;if(n.children)walk(n.children);}}walk(inspectOle(objects[0].ole).parsed.records);
  assert.equal(matrix.rows,3);assert.equal(matrix.cols,7);assert.equal(matrix.hjust,130);assert.equal(matrix.vjust,129);assert.ok(matrix.colPartitions.some(Boolean));
 }finally{await rm(dir,{recursive:true,force:true});}
 await assert.rejects(context.window.workbenchAction('matrixInsert',{rows:32,columns:1,environment:'matrix',alignment:'c'}),/1至31/);
});

test('Ruler changes participate in formula undo/redo and invalidate the previous export check',async()=>{
 const {context}=harness();
 await context.window.workbenchAction('ruler',{tabs:[{position:2304,type:4}]});
 assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(rulerPatch())',context)),{ruler:[{position:2304,type:4}]});
 assert.equal(vm.runInContext('valid',context),false);
 await context.window.workbenchAction('editorCommand',{command:'undo'});
 assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(rulerPatch())',context)),{});
 await context.window.workbenchAction('editorCommand',{command:'redo'});
 assert.equal(JSON.parse(vm.runInContext('JSON.stringify(rulerPatch())',context)).ruler[0].type,4);
});

test('Ruler and real tab survive DOCX export, source inspection, character editing and graphic output',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'equationlab-ruler-save-'));
 try{
  const input=join(dir,'before.docx'),output=join(dir,'after.docx'),ruler=[{position:2304,type:4}],latex='x\\eltab y=2.5';
  await desktopRequest({action:'export',payload:{output:input,equations:[{latex,ruler}]}});
  const before=await desktopRequest({action:'inspect',payload:{path:input}});assert.deepEqual(before.objects[0].ruler,ruler);assert.match(before.objects[0].latex,/\\eltab/);
  const character=before.objects[0].characters.find(c=>c.char==='x');
  await desktopRequest({action:'edit',payload:{input,output,index:0,mode:'characters',replacements:{[character.offset]:'z'},ruler}});
  const {objects}=await inspectDocx(await readFile(output));assert.deepEqual(readRuler(objects[0].ole),ruler);assert.match(objects[0].latex,/z/);
  for(const format of ['svg','pdf','png']){const path=join(dir,'formula.'+format);await desktopRequest({action:'exportGraphic',payload:{format,output:path,latex,ruler}});const bytes=await readFile(path);assert.ok(bytes.length>100);if(format==='pdf')assert.equal(bytes.subarray(0,4).toString(),'%PDF');if(format==='png')assert.equal(bytes.subarray(1,4).toString(),'PNG');}
 }finally{await rm(dir,{recursive:true,force:true});}
});
