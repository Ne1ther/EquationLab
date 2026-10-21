import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../desktop/app.js',import.meta.url),'utf8');
const start=source.indexOf('function nativeSelectAllForKeyboard()');
const end=source.indexOf('\nwindow.nativeSelectAllForKeyboard=',start);
assert.ok(start>=0&&end>start,'keyboard selection handler is present');
const handler=source.slice(start,end)+'\nwindow.nativeSelectAllForKeyboard=nativeSelectAllForKeyboard;';

function harness(kind){
 const actions=[];
 class Input{constructor(type='text'){this.type=type;}select(){actions.push('input.select');}}
 class TextArea{select(){actions.push('textarea.select');}}
 const mf={value:'x+y',executeCommand(command){actions.push(`mathfield.${command}`);}};
 const activeElement=kind==='mathfield'?mf:kind==='textarea'?new TextArea():kind==='text-input'?new Input('text'):kind==='number-input'?new Input('number'):{tagName:'DIV'};
 const context=vm.createContext({document:{activeElement},HTMLInputElement:Input,HTMLTextAreaElement:TextArea,mf,window:{}});
 vm.runInContext(handler,context);
 return {actions,mf,context};
}

test('Native Select All uses MathLive model selection while the mathfield owns focus',()=>{
 const {actions,mf,context}=harness('mathfield');
 assert.equal(context.window.nativeSelectAllForKeyboard(),true);
 assert.deepEqual(actions,['mathfield.selectAll']);
 assert.equal(mf.value,'x+y','select all does not replace or clear the formula');
});

test('Native Select All keeps ordinary textarea and HTML input selection',()=>{
 for(const [kind,expected] of [['textarea','textarea.select'],['text-input','input.select'],['number-input','input.select']]){
  const {actions,context}=harness(kind);
  assert.equal(context.window.nativeSelectAllForKeyboard(),true);
  assert.deepEqual(actions,[expected]);
 }
});

test('Native Select All leaves page selection to WKWebView',()=>{
 const {actions,context}=harness('page');
 assert.equal(context.window.nativeSelectAllForKeyboard(),false);
 assert.deepEqual(actions,[]);
});
