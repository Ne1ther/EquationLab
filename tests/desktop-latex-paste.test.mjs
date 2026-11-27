import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const app=await readFile(new URL('../desktop/app.js',import.meta.url),'utf8');
const start=app.indexOf('function clipboardHTMLText(');
const code=app.slice(start,app.indexOf('const groups=',start));
const history=app.slice(app.indexOf('function historySnapshot('),app.indexOf('function handleEditorHistoryKey('));
const changed=app.split('\n').find(line=>line.startsWith('function changed('));
const prose='技术进步与要素投入增量的影响相当';
const latex=String.raw`\begin{gathered}
a=b\\
c=d
\end{gathered}`;

function editor(native){
 const listeners=new Map(),messages=[],messageField={textContent:''};
 let commitCount=0,context;
 const target={
  value:'x+old+y',selectionStart:2,selectionEnd:5,selectionDirection:'forward',readOnly:false,
  addEventListener(name,handler){listeners.set(name,handler);},
  setRangeText(text,start,end,selectionMode){
   assert.equal(selectionMode,'end');
   this.value=this.value.slice(0,start)+text+this.value.slice(end);
   this.selectionStart=this.selectionEnd=start+text.length;
  }
 };
 context=vm.createContext({
  window:{webkit:{messageHandlers:{native:{}}},editorIsComposing:()=>false,syncEquationMacros(){}},
  document:{activeElement:target},wordTicket:'word-document-b',selected:null,editorHistory:[],
  mf:{value:target.value,readOnly:false},editingRuler:undefined,editorHistoryIndex:-1,restoringHistory:false,
  editorViewport:null,timer:null,revision:0,valid:false,validationPending:false,
  setTimeout(){},clearTimeout(){},validate(){},controls(){},status(){},message:(text,error=false)=>{messageField.textContent=text;messages.push({text,error});},
  $:id=>id==='message'?messageField:target,native,commitEditorInput:()=>{commitCount++;}
 });
 vm.runInContext(code+'\n'+history+'\n'+changed,context);
 context.window.resetEditorHistory();
 return {context,target,messages,emit:(event,data)=>listeners.get(event)(data),get commits(){return commitCount;},async paste({trusted=true,flavors={}}={}){
  let prevented=false,dispatching=true;
  const result=listeners.get('paste')({currentTarget:target,isTrusted:trusted,cancelable:true,preventDefault(){prevented=true;},
   clipboardData:{types:Object.keys(flavors),getData:type=>{
    assert.equal(dispatching,true,'WebKit clears clipboardData after dispatch');
    return flavors[type]??'';
   }}});
  dispatching=false;
  await result;
  return prevented;
 }};
}

test('Source Paste and Cmd+V each use fresh native text despite conflicting Word clipboard flavors',async()=>{
 for(const gesture of ['context-menu Paste','Cmd+V']){
  let reads=0;
  const e=editor(async action=>{
   assert.equal(action,'readLatexPasteboard');reads++;
   return {state:'available',text:latex.replaceAll('\n','\r\n')};
  });
  const flavors={'text/plain':prose,'text/html':'<p>'+prose+'</p>','text/rtf':'{\\rtf1 old}'};
  assert.equal(await e.paste({flavors}),true,gesture);
  assert.equal(e.target.value,'x+'+latex+'+y',gesture);
  assert.equal(e.target.selectionStart,2+latex.length);
  assert.equal(e.commits,1);
  e.target.selectionStart=0;e.target.selectionEnd=e.target.value.length;
  assert.equal(await e.paste({flavors}),true,gesture);
  assert.equal(e.target.value,latex,gesture);
  assert.equal(e.commits,2);
  assert.equal(reads,2);
 }
});

test('A delayed paste cannot write into a different Word session or replace newer input',async()=>{
 for(const mutate of [
  e=>{e.context.wordTicket='new-document';},
  e=>{e.context.window.wordSessionGeneration=1;},
  e=>{e.target.value='new';},
  e=>{e.target.selectionStart=1;},
  e=>{e.context.window.resetEditorHistory();},
 ]){
  let respond;
  const e=editor(()=>new Promise(resolve=>{respond=resolve;}));
  const pasting=e.paste();
  mutate(e);const value=e.target.value;
  respond({state:'available',text:latex});
  assert.equal(await pasting,true);
  assert.equal(e.target.value,value);
  assert.equal(e.commits,0);
 }
});

test('Unreadable AppKit data and a rejected bridge fall back to synchronous event text',async()=>{
 for(const native of [async()=>({state:'unavailable'}),async()=>{throw Error('Clipboard request is not from the editor.');}]){
  const e=editor(native);
  assert.equal(await e.paste({flavors:{'text/plain':latex}}),true);
  assert.equal(e.target.value,'x+'+latex+'+y');
  assert.equal(e.commits,1);
  assert.deepEqual(e.messages,[]);
 }
 const e=editor(async()=>({state:'unavailable'}));
 assert.equal(await e.paste(),true);
 assert.deepEqual(e.messages,[{text:'剪贴板没有可读取的文本。',error:true}]);
 assert.equal(e.commits,0);
});

test('A clipboard owner change rejects stale event text, shows feedback and allows retry',async()=>{
 let reads=0;
 const e=editor(async()=>++reads===1?{state:'ownerChanged'}:{state:'available',text:latex});
 assert.equal(await e.paste({flavors:{'text/plain':prose}}),true);
 assert.equal(e.target.value,'x+old+y');
 assert.equal(e.commits,0);
 assert.deepEqual(e.messages,[{text:'剪贴板在粘贴时发生变化，请重新粘贴。',error:true}]);
 assert.equal(await e.paste({flavors:{'text/plain':prose}}),true);
 assert.equal(e.target.value,'x+'+latex+'+y');
 assert.equal(e.commits,1);
 assert.deepEqual(e.messages.at(-1),{text:'',error:false});
});

test('Typing then Undo and restoring the original selection still invalidate an in-flight paste',async()=>{
 let respond;
 const e=editor(()=>new Promise(resolve=>{respond=resolve;}));
 const pasting=e.paste();
 e.context.mf.value='x+new+y';
 e.context.changed(false);
 assert.equal(e.context.editorUndo(),true);
 assert.equal(e.target.value,'x+old+y');
 assert.deepEqual([e.target.selectionStart,e.target.selectionEnd],[2,5]);
 respond({state:'available',text:latex});
 assert.equal(await pasting,true);
 assert.equal(e.target.value,'x+old+y');
 assert.equal(e.commits,0);
});

test('Moving the selection away and back invalidates a pending paste without changing the text',async()=>{
 let respond;
 const e=editor(()=>new Promise(resolve=>{respond=resolve;}));
 const pasting=e.paste();
 e.target.selectionStart=1;
 e.target.selectionStart=2;
 e.emit('selectionchange'); // WebKit can coalesce the two selection moves.
 respond({state:'available',text:latex});
 assert.equal(await pasting,true);
 assert.equal(e.target.value,'x+old+y');
 assert.equal(e.commits,0);
});

test('The newest paste request owns the selection whichever native reply arrives first',async()=>{
 for(const order of [[0,1],[1,0]]){
  const replies=[];
  const e=editor(()=>new Promise(resolve=>{replies.push(resolve);}));
  const pastes=[e.paste(),e.paste()];
  for(const index of order){
   replies[index]({state:'available',text:index===1?latex:prose});
   assert.equal(await pastes[index],true);
  }
  assert.equal(e.target.value,'x+'+latex+'+y');
  assert.equal(e.commits,1);
 }
});

test('A paste cannot read the native clipboard from a synthetic event or a locked editor',async()=>{
 const e=editor(()=>assert.fail('clipboard read outside an editable trusted paste'));
 assert.equal(await e.paste({trusted:false}),false);
 e.target.readOnly=true;
 assert.equal(await e.paste(),true);
 e.target.readOnly=false;e.context.window.editorIsComposing=()=>true;
 assert.equal(await e.paste(),true);
 assert.equal(e.commits,0);
});
