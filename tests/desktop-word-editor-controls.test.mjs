import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source=await fs.readFile(new URL('../desktop/app.js',import.meta.url),'utf8');
const start=source.indexOf('window.syncWordEditorControls=()=>{');
const sync=source.slice(start,source.indexOf('\n};',start)+3);
function setup(){
 const elements=new Map();
 const context=vm.createContext({window:{},busy:false,wordNavigating:false,wordOutcomeUnknown:false,wordTicket:'a'.repeat(64),source:{insertion:true},selected:null,
  $:id=>{if(!elements.has(id))elements.set(id,{hidden:false,disabled:false,setAttribute(name,value){this[name]=value;}});return elements.get(id);}
 });
 vm.runInContext(sync,context);return {context,elements,refresh:()=>context.window.syncWordEditorControls()};
}
test('Blank insertion keeps its shared action row visible and cancel usable',()=>{
 const e=setup();e.refresh();
 assert.equal(e.elements.get('source-panel').hidden,false);
 assert.equal(e.elements.get('word-session-save').textContent,'完成并插入');
 assert.equal(e.elements.get('word-session-cancel').disabled,false);
 assert.equal(e.elements.get('mode-characters').disabled,true);
});
test('Existing formula, pending work, uncertain outcome and language update the same controls',()=>{
 const e=setup(),c=e.context;c.source={insertion:false};c.selected={index:0};e.refresh();
 assert.equal(e.elements.get('word-session-save')['aria-label'],'更新公式');
 assert.equal(e.elements.get('mode-characters').disabled,false);
 c.busy=true;e.refresh();assert.equal(e.elements.get('word-session-cancel').disabled,true);
 c.busy=false;c.wordOutcomeUnknown=true;e.refresh();
 assert.equal(e.elements.get('word-session-cancel').textContent,'关闭');
 assert.equal(e.elements.get('word-session-cancel').disabled,false);
 assert.equal(e.elements.get('mode-characters').disabled,true);
 c.window.workbenchEnglish=true;e.refresh();
 assert.equal(e.elements.get('word-session-save').textContent,'Update equation');
 assert.equal(e.elements.get('word-session-cancel')['aria-label'],'Close');
 c.wordTicket=null;c.selected=null;e.refresh();
 assert.equal(e.elements.get('source-panel').hidden,true);
 assert.equal(e.elements.get('word-session-actions').hidden,true);
});
