import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {desktopRequest} from '../src/desktop-rpc.mjs';

const app=await readFile(new URL('../desktop/app.js',import.meta.url),'utf8');
const workspace=await readFile(new URL('../desktop/word-document-workspace.js',import.meta.url),'utf8');
const prefix=app.slice(0,app.indexOf('const groups='));
const oldListener="mf.addEventListener('input',changed);$('latex').addEventListener('input',()=>{mf.value=$('latex').value;changed();});\n";
const oldStart=prefix.indexOf('function beginEditorComposition(');
const oldPrefix=prefix.slice(0,oldStart).replace("function changed(scheduleValidation=true){if(window.editorIsComposing?.())return;",'function changed(scheduleValidation=true){')+oldListener;
const line=starts=>{const result=app.split('\n').find(s=>s.startsWith(starts));assert.ok(result,starts);return result;};
const microtasks=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

function harness({old=false}={}){
 const elements=new Map(),requests=[],timers=new Map(),syncs=[],previews=[],viewport=[];let nextTimer=0,now=0;
 const element=id=>{
  if(elements.has(id))return elements.get(id);
  let value=id==='formula'?'x':'',selectionStart=0,selectionEnd=0;
  const listeners=new Map(),writes=[];
  const e={id,writes,disabled:false,hidden:false,readOnly:false,textContent:'',dataset:{},selection:{ranges:[[0,0]]},
   get value(){return value;},set value(v){writes.push(v);value=v;selectionStart=selectionEnd=v.length;},
   get selectionStart(){return selectionStart;},set selectionStart(v){selectionStart=v;},get selectionEnd(){return selectionEnd;},set selectionEnd(v){selectionEnd=v;},
   userValue(v,start=v.length,end=start){value=v;selectionStart=start;selectionEnd=end;},
   addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);},
   dispatch(type,props={}){for(const fn of listeners.get(type)||[])fn({type,target:e,...props});},
   classList:{toggle(){},contains(){return false;}},setAttribute(){},querySelectorAll(){return [];},replaceChildren(){},append(){},focus(){}};
  elements.set(id,e);return e;
 };
 const win={webkit:{messageHandlers:{native:{postMessage(request){requests.push(request);}}}},
  prepareEquationMacros:x=>x,equationCatalogMacros:{},installEquationMacroEditing(){},syncEquationMacros:()=>syncs.push('sync'),desktopFontPreview:value=>previews.push(value)};
 const context=vm.createContext({window:win,MathfieldElement:{},document:{getElementById:element,querySelector:()=>element('editor-card')},
  requestWorkbenchSync(){},renderObjects(){},wordLayout:()=>({mode:'inline'}),
  setTimeout(fn,delay=0){const id=++nextTimer;timers.set(id,{fn,at:now+delay});return id;},clearTimeout(id){timers.delete(id);}});
 vm.runInContext(workspace,context);
 vm.runInContext(old?oldPrefix:prefix,context);
 vm.runInContext(`${line('async function perform(')}\n${line('window.nativeExport=')}\n${app.slice(app.indexOf('function wordSessionChanged(){'),app.indexOf('window.nativePrepareToClose=async()=>{'))}`,context);
 vm.runInContext('editorViewport={refresh:()=>viewportRefresh()}; window.resetEditorHistory()',Object.assign(context,{viewportRefresh:()=>viewport.push('refresh')}));
 const reply=(request,result)=>win.nativeReply({id:request.id,result:{ok:true,data:result}});
 const advance=async ms=>{const end=now+ms;while(true){const due=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!due)break;now=due[1].at;timers.delete(due[0]);due[1].fn();await microtasks();}now=end;await microtasks();};
 return {context,win,element,mf:element('formula'),latex:element('latex'),requests,syncs,previews,viewport,reply,advance,
  evaluate:s=>vm.runInContext(s,context),history:()=>JSON.parse(vm.runInContext('JSON.stringify(editorHistory)',context))};
}

async function finishValidation(h){await h.advance(90);const request=h.requests.filter(r=>r.action==='validate').at(-1);assert.ok(request,'native validation was requested');const result=await desktopRequest({action:'validate',payload:request.payload});h.reply(request,result);await microtasks();return request;}

test('negative control: old input listeners immediately overwrite both editors and run editor side effects',()=>{
 const h=harness({old:true});h.latex.dispatch('compositionstart');h.latex.userValue('zhong',2);h.latex.dispatch('input',{isComposing:true});
 assert.equal(h.mf.value,'zhong');assert.deepEqual(h.latex.writes,['zhong']);assert.equal(h.latex.selectionStart,5);assert.equal(h.syncs.length,1);assert.equal(h.history().length,2);assert.equal(h.viewport.length,1);
});

test('textarea long pinyin preserves MathLive, marked text and selection until final Chinese commit',async()=>{
 const h=harness();h.latex.userValue('x',1);h.latex.dispatch('compositionstart');
 for(const s of ['z','zh','zhong','zhongwen','zhongwenshurufa']){h.latex.userValue(s,2,4);h.latex.dispatch('input',{isComposing:true});await h.advance(120);assert.equal(h.mf.value,'x');assert.equal(h.latex.value,s);assert.equal(h.latex.selectionStart,2);assert.equal(h.latex.selectionEnd,4);}
 assert.deepEqual(h.mf.writes,[]);assert.deepEqual(h.latex.writes,[]);assert.equal(h.syncs.length,0);assert.equal(h.history().length,1);assert.equal(h.viewport.length,0);assert.equal(h.requests.length,0);
 h.latex.userValue('\\text{中文}');h.latex.dispatch('input',{isComposing:true});h.latex.dispatch('compositionend');assert.equal(h.win.editorIsComposing(),true);h.latex.dispatch('input',{isComposing:false});
 assert.equal(h.mf.value,'\\text{中文}');assert.equal(h.win.editorIsComposing(),false);assert.equal(h.history().length,2);const request=await finishValidation(h);assert.equal(request.payload.latex,'\\text{中文}');assert.equal(h.evaluate('valid'),true);assert.equal(h.element('export').disabled,false);assert.deepEqual(h.requests.filter(r=>r.action==='validate').map(r=>r.payload.latex),['\\text{中文}']);
});

test('MathLive composition suppresses editor side effects and invalidates an outstanding native response',async()=>{
 const h=harness();h.mf.userValue('old');h.mf.dispatch('input');await h.advance(90);const stale=h.requests[0];assert.equal(stale.payload.latex,'old');
 const syncCount=h.syncs.length,historyCount=h.history().length,viewCount=h.viewport.length;h.mf.dispatch('compositionstart');h.mf.userValue('zhong');h.mf.dispatch('input',{isComposing:true});
 h.reply(stale,{svg:'stale',nativeBytes:99});await microtasks();await h.advance(300);
 assert.equal(h.evaluate('valid'),false);assert.equal(h.element('export').disabled,true);assert.deepEqual(h.previews,[]);assert.equal(h.syncs.length,syncCount);assert.equal(h.history().length,historyCount);assert.equal(h.viewport.length,viewCount);assert.equal(h.requests.length,1);assert.equal(h.latex.value,'old');
 h.mf.userValue('\\text{中}');h.mf.dispatch('compositionend');h.mf.dispatch('input');const final=await finishValidation(h);assert.equal(final.payload.latex,'\\text{中}');assert.equal(h.evaluate('valid'),true);
});

test('composition end before input, input before end, cancellation without input and consecutive compositions recover',async()=>{
 for(const order of ['before','after','cancel','consecutive']){
  const h=harness();h.latex.userValue('x');h.latex.dispatch('compositionstart');h.latex.userValue(order==='cancel'?'x':'\\text{中}');
  if(order==='before')h.latex.dispatch('input',{isComposing:false});
  h.latex.dispatch('compositionend');
  if(order==='after'||order==='consecutive')h.latex.dispatch('input',{isComposing:false});
  await h.advance(0);assert.equal(h.win.editorIsComposing(),false,order);assert.equal(h.mf.value,order==='cancel'?'x':'\\text{中}',order);
  if(order==='consecutive'){h.latex.dispatch('compositionstart');h.latex.userValue('\\text{中文}');h.latex.dispatch('input',{isComposing:true});h.latex.dispatch('compositionend');h.latex.dispatch('input');assert.equal(h.mf.value,'\\text{中文}');}
  const request=await finishValidation(h);assert.equal(request.payload.latex,h.mf.value);assert.equal(h.evaluate('valid'),true,order);
 }
});

test('export and automatic Word workspace switch cannot submit or replace a composition',async()=>{
 const h=harness();h.latex.userValue('x');h.latex.dispatch('compositionstart');h.latex.userValue('unfinished',3);h.latex.dispatch('input',{isComposing:true});
 assert.equal(await h.win.nativeExport(),false);assert.match(h.element('message').textContent,/完成输入法组字/);assert.equal(h.requests.some(r=>r.action==='export'||r.action==='validate'),false);assert.equal(h.evaluate('exportAvailable()'),false);
 await h.evaluate('validate()');assert.equal(h.requests.length,0,'direct validation is also suppressed');
 h.evaluate("source={documentIdentity:'original',documentName:'Original.docx',hasDocumentContext:true,objects:[]}; wordTicket='original-ticket'; selected={editorBaseline:'x',ruler:[]}");
 const follow=h.win.nativeSyncWordWorkspace();const status=h.requests.find(r=>r.action==='wordWorkspaceStatus');assert.ok(status);h.reply(status,{connected:true,revision:1,active:{identity:'other',name:'Other.docx'},documents:[{identity:'other',name:'Other.docx'}]});assert.equal(await follow,false);
 assert.equal(h.requests.some(r=>['wordDocumentOpen','wordSessionCancel','export'].includes(r.action)),false);assert.equal(h.evaluate('source.documentIdentity'),'original');assert.equal(h.evaluate('wordTicket'),'original-ticket');assert.equal(h.mf.value,'x');assert.equal(h.latex.value,'unfinished');assert.equal(h.latex.selectionStart,3);
 h.evaluate('source=null; wordTicket=null; selected=null');
 h.latex.userValue('\\text{中文}');h.latex.dispatch('compositionend');await h.advance(0);await finishValidation(h);assert.equal(h.evaluate('exportAvailable()'),true);
 const exported=h.win.nativeExport();await microtasks();const req=h.requests.find(r=>r.action==='export');assert.ok(req);assert.equal(req.payload.equations[0].latex,'\\text{中文}');h.reply(req,{path:'/tmp/final.docx'});assert.equal(await exported,true);
});
