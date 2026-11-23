import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const app=await readFile(new URL('../desktop/app.js',import.meta.url),'utf8');
const macros=await readFile(new URL('../desktop/editable-macros.js',import.meta.url),'utf8');

function editor(){
 const nodes=new Map(),requests=[],previews=[],timers=new Map();let nextTimer=0;
 function node(tag){
  const classes=new Set();
  return {tag,value:'',textContent:'',disabled:false,hidden:false,readOnly:false,children:[],dataset:{},
   classList:{toggle(name,on){on?classes.add(name):classes.delete(name);},contains:name=>classes.has(name)},
   append(child){this.children.push(child);},replaceChildren(){this.children=[];},
   querySelectorAll(selector){return this.children.flatMap(child=>child.tag===selector?[child]:child.querySelectorAll(selector));},
   addEventListener(){},setAttribute(name,value){this[name]=value;}};
 }
 const element=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
 const context=vm.createContext({MathfieldElement:{},
  document:{getElementById:element,querySelector:()=>element('editor-card'),createElement:node},
  window:{webkit:{messageHandlers:{native:{postMessage:request=>requests.push(request)}}},desktopFontPreview:svg=>previews.push(svg)},
  requestWorkbenchSync(){},loadObjectLayout(){},renderObjects(){return Promise.resolve();},
  setTimeout:fn=>{const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)});
 vm.runInContext(macros,context);
 vm.runInContext(app.slice(0,app.indexOf('const groups=')),context);
 const lines=app.split('\n');
 vm.runInContext([
  ...['selectObject','renderModes'].map(name=>lines.find(line=>line.startsWith('function '+name+'('))),
  lines.find(line=>line.startsWith('async function perform(')),
  app.slice(app.indexOf('async function confirmDraftReplacement('),app.indexOf('function replaceStandaloneDraft(')),
  app.slice(app.indexOf('async function previewCharacterEdit()'),app.indexOf("$('mode-characters').onclick")),
  lines.find(line=>line.startsWith("$('mode-characters').onclick")),
 ].join('\n'),context);
 vm.runInContext(`source={path:'synthetic.docx',objects:[
  {index:0,latex:'a+b',progId:'Equation.DSMT4',nativeSha256:'first',characters:[{offset:4,char:'a',editable:true}],image:'first-original.png'},
  {index:1,latex:'partial decode',progId:'Equation.DSMT4',nativeSha256:'unsupported',characters:[],image:'unsupported-original.png',error:'Unsupported synthetic record'},
  {index:2,latex:'z^{2}',progId:'Equation.DSMT4',nativeSha256:'last',characters:[],image:'last-original.png'}
 ]};`,context);
 const run=code=>vm.runInContext(code,context);
 const reply=(request,result)=>run(`window.nativeReply(${JSON.stringify({id:request.id,result})})`);
 return {element,requests,previews,timers,run,reply,
  select:(index,scheduleValidation=false)=>run(`selectObject(${index},{scheduleValidation:${scheduleValidation}})`),
  state:()=>run('({selectedIndex:selected.index,valid,validationPending,validationRequested,validatedFormulaKey,baseline:selected.editorBaseline})')};
}

test('Character mode keeps the structural draft unless the user explicitly discards it',async()=>{
 const e=editor();await e.select(0);e.element('formula').value='a+b+edit';
 let switching=e.element('mode-characters').onclick();
 let alert=e.requests.findLast(request=>request.action==='confirmWordSessionSwitch');
 assert.equal(alert.payload.characterMode,true);
 e.reply(alert,{ok:true,data:{discard:false}});assert.equal(await switching,false);
 assert.equal(e.run('mode'),'rebuild');assert.equal(e.element('formula').value,'a+b+edit');
 switching=e.element('mode-characters').onclick();alert=e.requests.findLast(request=>request.action==='confirmWordSessionSwitch');
 e.reply(alert,{ok:true,data:{discard:true}});assert.equal(await switching,true);
 assert.equal(e.run('mode'),'characters');assert.equal(e.element('formula').value,'a+b');
 assert.equal(e.element('mode-characters').onclick(),false,'clicking the active mode is a no-op');
});

test('Structural mode waits for the latest character input before removing its fields',async()=>{
 const e=editor();await e.select(0);e.element('mode-characters').onclick();
 const input=e.element('character-editor').querySelectorAll('input')[0];input.value='q';
 const preview=input.oninput();
 const switching=e.element('mode-rebuild').onclick();
 assert.equal(e.run('mode'),'characters');assert.equal(e.element('character-editor').querySelectorAll('input')[0],input);
 let request=e.requests.findLast(request=>request.action==='editPreview');
 assert.equal(request.payload.replacements[4],'q');
 e.reply(request,{ok:true,data:{latex:'q+b',svg:'q-preview',nativeBytes:22}});
 // A concurrent ensureValid asks the running validator to read the updated key.
 await new Promise(resolve=>setImmediate(resolve));
 const next=e.requests.findLast(request=>request.action==='editPreview');
 if(next!==request)e.reply(next,{ok:true,data:{latex:'q+b',svg:'q-preview',nativeBytes:22}});
 await preview;assert.equal(await switching,true);
 assert.equal(e.run('mode'),'rebuild');assert.equal(e.element('formula').value,'q+b');
});

test('Selecting an unsupported formula clears the previous editor and preview, then a supported selection recovers',async()=>{
 const e=editor();await e.select(0);const first=e.run('validate()');
 e.reply(e.requests[0],{ok:true,data:{svg:'first-preview',nativeBytes:20}});await first;
 assert.equal(e.element('latex').value,'a+b');assert.equal(e.previews.at(-1),'first-preview');
 assert.equal(e.element('word-session-save').disabled,false);

 await e.select(1);
 assert.equal(e.state().selectedIndex,1);assert.equal(e.state().baseline,'');
 assert.equal(e.element('formula').value,'');assert.equal(e.element('latex').value,'');
 assert.equal(e.element('formula').readOnly,true);assert.equal(e.element('latex').readOnly,true);
 assert.equal(e.previews.at(-1),null);assert.equal(e.element('word-session-save').disabled,true);
 assert.equal(e.element('copy-latex').disabled,true);assert.equal(e.state().validationPending,false);
 assert.equal(e.state().validatedFormulaKey,null);
 assert.equal(e.element('original-preview').children[0].src,'unsupported-original.png','only this object\'s original preview may remain');
 assert.equal(e.element('status-title').textContent,'当前公式只读');
 assert.equal(e.element('status-detail').textContent,'Unsupported synthetic record');
 await e.run('validate()');
 assert.equal(e.requests.length,1,'an unsupported object must not be validated as an empty new formula');
 assert.equal(e.element('status-title').textContent,'当前公式只读');

 await e.select(2);const last=e.run('validate()');
 e.reply(e.requests[1],{ok:true,data:{svg:'last-preview',nativeBytes:30}});await last;
 assert.equal(e.element('formula').readOnly,false);assert.equal(e.element('latex').readOnly,false);
 assert.equal(e.element('latex').value,'z^{2}');assert.equal(e.previews.at(-1),'last-preview');
 assert.equal(e.element('word-session-save').disabled,false);assert.equal(e.state().selectedIndex,2);
});

test('Rapid character edits share the mode validation queue and update LaTeX with the current preview',async()=>{
 const e=editor();await e.select(0);e.element('mode-characters').onclick();
 assert.equal(e.timers.size,1,'entering character mode schedules a check of the original');
 const [input]=e.element('character-editor').querySelectorAll('input');
 input.value='x';const first=input.oninput();
 assert.equal(e.timers.size,0,'the first edit must replace the mode timer');
 assert.equal(e.requests.length,1);
 input.value='w';const intermediate=input.oninput();
 input.value='y';const latest=input.oninput();
 assert.equal(e.requests.length,1,'keep one character preview in flight');
 e.reply(e.requests[0],{ok:true,data:{latex:'x+b',svg:'obsolete-preview'}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(e.previews,[]);
 assert.equal(e.element('word-session-save').disabled,true);
 assert.equal(e.requests.length,2);
 const request=e.requests[1];
 assert.equal(request.action,'editPreview');assert.equal(request.payload.previewOnly,true);
 assert.equal(request.payload.mode,'characters');assert.equal(request.payload.replacements['4'],'y');
 e.reply(request,{ok:true,data:{latex:'y+b',svg:'current-preview'}});
 await Promise.all([first,intermediate,latest]);
 assert.deepEqual(e.previews,['current-preview']);
 assert.equal(e.element('latex').value,'y+b');assert.equal(e.element('formula').value,'y+b');
 assert.equal(e.state().validatedFormulaKey,e.run('formulaKey()'));
 assert.equal(e.element('word-session-save').disabled,false);
});

for(const operation of ['validate()','previewCharacterEdit()']){
 for(const outcome of ['success','failure']){
  test(`Unsupported selection rejects a late ${operation} ${outcome} from the previous formula`,async()=>{
   const e=editor();await e.select(0);
   if(operation==='previewCharacterEdit()')e.element('mode-characters').onclick();
   const pending=e.run(operation);
   // A queued input check must also be cancelled, not silently restarted for
   // the unsupported selection when the outstanding preview finishes.
   e.run('changed()');assert.equal(e.timers.size,1);
   await e.select(1);assert.equal(e.timers.size,0);
   e.reply(e.requests[0],outcome==='success'?{ok:true,data:{latex:'obsolete edit',svg:'obsolete-preview',nativeBytes:20}}:{ok:false,error:'Obsolete preview failure'});
   await pending;
   assert.equal(e.requests.length,1);assert.deepEqual(e.previews,[null]);
   assert.equal(e.element('formula').value,'');assert.equal(e.element('latex').value,'');
   assert.equal(e.element('status-title').textContent,'当前公式只读');
   assert.equal(e.element('status-detail').textContent,'Unsupported synthetic record');
   assert.equal(e.state().valid,false);assert.equal(e.state().validationPending,false);
   assert.equal(e.element('word-session-save').disabled,true);
  });
 }
}
