import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const macroSource=await readFile(new URL("../desktop/editable-macros.js",import.meta.url),"utf8");
const source=await readFile(new URL('../desktop/app.js',import.meta.url),'utf8');
function editor(){
 const elements=new Map(),requests=[],timers=new Map();let sequence=0;
 const element=id=>{
  if(!elements.has(id))elements.set(id,{value:id==='formula'?'x^3':'',disabled:false,textContent:'',classList:{toggle(){}},addEventListener(){},querySelectorAll(){return [];}});
  return elements.get(id);
 };
 const context=vm.createContext({MathfieldElement:{},document:{getElementById:element,querySelector:()=>element('editor-card')},requestWorkbenchSync(){},wordLayout:()=>({}),
  window:{webkit:{messageHandlers:{native:{postMessage:r=>requests.push(r)}}},desktopFontPreview(){}},
  setTimeout:fn=>{const id=++sequence;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)});
 const run=code=>vm.runInContext(code,context);
 run(macroSource);
 run(source.split('const groups=')[0]);
 for(const prefix of ['async function perform(','window.nativeExport=','$(\'save-edit\').onclick=','$(\'copy-latex\').onclick='])run(source.split('\n').find(line=>line.startsWith(prefix)));
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 const reply=async(request,ok=true)=>{run(`window.nativeReply(${JSON.stringify({id:request.id,result:ok?{ok:true,data:{svg:'current',nativeBytes:20,path:'/tmp/fixture.docx'}}:{ok:false,error:'unsupported typography'}})})`);await flush();};
 const patch=value=>{context.window.desktopTypographyPatch=()=>value;run('changed()');};
 return {run,element,requests,patch,reply,flush,async ready(){const pending=run('validate()');await reply(requests.at(-1));await pending;}};
}

test('Typography changes keep export visually available, and an immediate export waits for the latest preferences',async()=>{
 const p=editor();await p.ready();
 const typography={styles:{3:{font:'Times New Roman',style:2}}};p.patch(typography);
 assert.equal(p.run('valid'),false);assert.equal(p.element('export').disabled,false,'a pending typography check must not gray the button');
 assert.equal(p.element('copy-png').disabled,false);
 const pending=p.run('window.nativeExport()');
 assert.equal(p.requests.at(-1).action,'validate');assert.equal(p.requests.filter(r=>r.action==='export').length,0);
 await p.reply(p.requests.at(-1));
 const exported=p.requests.at(-1);assert.equal(exported.action,'export');assert.deepEqual(exported.payload.equations[0].typography,typography);
 await p.reply(exported);assert.equal(await pending,true);
});

test('Rapid font changes cannot export an obsolete successful check, and a failing latest check disables export',async()=>{
 const p=editor();await p.ready();p.patch({styles:{3:{font:'Times New Roman',style:1}}});
 const first=p.run('validate()'),old=p.requests.at(-1);
 p.patch({styles:{3:{font:'missing font',style:2}}});
 const exporting=p.run('window.nativeExport()');await p.reply(old);
 assert.equal(p.requests.filter(r=>r.action==='export').length,0);
 const latest=p.requests.at(-1);assert.equal(latest.action,'validate');assert.equal(latest.payload.typography.styles[3].font,'missing font');
 await p.reply(latest,false);await first;assert.equal(await exporting,false);
 assert.equal(p.element('export').disabled,true);assert.equal(p.run('exportAvailable()'),false);assert.equal(p.run('busy'),false);
});

test('A pending content or document change cannot inherit the previous formula export availability',async()=>{
 const p=editor();await p.ready();p.element('formula').value='\\unsupported{x}';p.run('changed()');assert.equal(p.element('export').disabled,true);
 p.element('formula').value='x^3';p.run("source={path:'/tmp/other.docx'};selected={index:0,nativeSha256:'other'};changed()");assert.equal(p.element('export').disabled,true);
});

for(const route of ['save-edit','copy-png'])test(`${route} also waits for the latest typography check`,async()=>{
 const p=editor();p.run("source={path:'/tmp/source.docx'};selected={index:0};");await p.ready();
 p.patch({styles:{3:{font:'Times New Roman',style:3}}});
 const pending=p.element(route).onclick();assert.equal(p.requests.at(-1).action,'editPreview');
 await p.reply(p.requests.at(-1));const output=p.requests.at(-1);assert.equal(output.action,route==='save-edit'?'edit':'copyPNG');assert.equal(output.payload.typography.styles[3].style,3);
 await p.reply(output);assert.equal(await pending,true);
});
