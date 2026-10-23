import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const app=await fs.readFile(new URL('../desktop/app.js',import.meta.url),'utf8');
const render=app.split('\n').find(line=>line.startsWith('function documentSidebarState(){'));
const object={index:0,latex:'x+1',application:'MathType',progId:'Equation.DSMT4'};
test('Native sidebar rows represent live and retained Word documents without creating hidden buttons',()=>{
 for(const retained of [false,true]){
  const documentData={objects:[object]};
  const context=vm.createContext({source:retained?null:documentData,window:{wordDocumentWorkspace:{visibleSource:input=>input??documentData}},document:{createElement(){throw Error('Hidden DOM renderer');}}});
  vm.runInContext(render,context);const sidebar=context.documentSidebarState();assert.equal(sidebar.documentSource,documentData);assert.equal(sidebar.objects.length,1);assert.equal(sidebar.objects[0].id,0);assert.equal(sidebar.objects[0].latex,'x+1');
 }
});
test('An unavailable workspace can hide its rows even before a busy source has detached',()=>{
 const context=vm.createContext({source:{objects:[object]},window:{wordDocumentWorkspace:{visibleSource:()=>null}}});vm.runInContext(render,context);assert.equal(context.documentSidebarState().documentSource,null);assert.equal(context.documentSidebarState().objects.length,0);
});
