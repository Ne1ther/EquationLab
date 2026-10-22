import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

test('The real sidebar renderer builds buttons from live and retained Word documents',async()=>{
 const source=await fs.readFile(new URL('../desktop/app.js',import.meta.url),'utf8');
 const render=source.split('\n').find(line=>line.startsWith('function renderObjects(){'));
 assert.ok(render.length>0&&render.length<2000);
 const elements=new Map(),make=()=>({children:[],append(child){this.children.push(child);},replaceChildren(){this.children=[];}});
 const object={index:0,latex:'x+1',application:'MathType',progId:'Equation.DSMT4'};
 for(const retained of [false,true]){
  const clicks=[],documentData={objects:[object]};
  const context=vm.createContext({source:retained?null:documentData,selected:null,
   window:{wordDocumentWorkspace:{visibleSource:input=>input??documentData},nativeSelectObject:index=>clicks.push(index)},
   document:{createElement:()=>make()},$:id=>{if(!elements.has(id))elements.set(id,make());return elements.get(id);}
  });
  vm.runInContext(render+'\nrenderObjects();',context);
  assert.equal(elements.get('count').textContent,1);
  const button=elements.get('objects').children[0];assert.equal(button.textContent,'1. x+1');
  button.onclick();assert.deepEqual(clicks,[0]);
 }
});
