import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('Rapid edits update source immediately, limit validation to one request and never publish an obsolete result',async()=>{
 const source=(await readFile(new URL('../desktop/app.js',import.meta.url),'utf8')).split('const groups=')[0];
 const elements=new Map(),requests=[],previews=[],timers=new Map();let sequence=0;
 const element=id=>{
  if(!elements.has(id))elements.set(id,{value:id==='formula'?'x^3':'',disabled:false,textContent:'',classList:{toggle(){}},addEventListener(){},querySelectorAll(){return [];}});
  return elements.get(id);
 };
 const context=vm.createContext({MathfieldElement:{},document:{getElementById:element,querySelector:()=>element('editor-card')},requestWorkbenchSync(){},
  window:{webkit:{messageHandlers:{native:{postMessage:r=>requests.push(r)}}},desktopFontPreview:s=>previews.push(s)},
  setTimeout:fn=>{const id=++sequence;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)});
 vm.runInContext(await readFile(new URL("../desktop/editable-macros.js",import.meta.url),"utf8"),context);
 vm.runInContext(source,context);
 const first=vm.runInContext('validate()',context);assert.equal(requests.length,1);
 const mf=element('formula');mf.value='x^3+z';vm.runInContext('changed()',context);
 assert.equal(element('latex').value,'x^3+z');assert.equal(element('export').disabled,true);
 for(const [id,fn]of [...timers]){timers.delete(id);fn();}
 assert.equal(requests.length,1,'the new request waits while one is in flight');
 vm.runInContext(`window.nativeReply(${JSON.stringify({id:requests[0].id,result:{ok:true,data:{svg:'obsolete',nativeBytes:10}}})})`,context);
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(previews,[],'outdated success must not paint or enable export');
 assert.equal(element('export').disabled,true);assert.equal(requests.length,2);assert.equal(requests[1].payload.latex,'x^3+z');
 vm.runInContext(`window.nativeReply(${JSON.stringify({id:requests[1].id,result:{ok:true,data:{svg:'current',nativeBytes:20}}})})`,context);
 await first;assert.deepEqual(previews,['current']);assert.equal(element('export').disabled,false);
 vm.runInContext('busy=true;controls()',context);assert.equal(element('editor-card').inert,true);assert.equal(element('copy-latex').disabled,true);
 vm.runInContext('busy=false;controls()',context);assert.equal(element('editor-card').inert,false);assert.equal(element('copy-latex').disabled,false);
 mf.value='';vm.runInContext('changed()',context);await vm.runInContext('validate()',context);
 assert.equal(requests.length,2);assert.equal(element('export').disabled,true,'an empty edit cannot retain a previously valid export');
 assert.equal(element('copy-latex').disabled,true,'all copy-source paths reject empty content');
 assert.equal(previews.at(-1),null,'clearing the formula must remove the previous Word preview');
});
