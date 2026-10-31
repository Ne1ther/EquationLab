import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, cp, readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {buildMathLiveEditor} from '../packaging/mathlive-editor.mjs';
import {desktopRequest} from '../src/desktop-rpc.mjs';

const run=promisify(execFile), root=resolve(new URL('..',import.meta.url).pathname);
const fixture=String.raw`
const f=document.getElementById('formula'), t=document.getElementById('latex');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const out={userAgent:navigator.userAgent,mathlive:MathfieldElement.version,events:[],states:[],requests:window.imeRequests,errors:window.imeErrors};
let stage='startup';
function state(label){out.states.push({label,formula:f.value,latex:t.value,selection:[t.selectionStart,t.selectionEnd],mathSelection:f.selection,composing:window.editorIsComposing(),history:editorHistory.length,syncs:window.imeSyncs,validations:window.imeRequests.filter(x=>x.action==='validate').length});}
function listen(target,name){for(const type of ['compositionstart','compositionupdate','compositionend','input'])target.addEventListener(type,e=>{out.events.push({stage,where:name,type,data:e.data??null,inputType:e.inputType??null,isComposing:e.isComposing??null,composed:e.composed,bubbles:e.bubbles,target:e.target===f?'host':e.target===t?'textarea':'sink',composing:window.editorIsComposing(),formula:f.value});},true);}
function comp(target,type,data=''){target.dispatchEvent(new CompositionEvent(type,{data,bubbles:true,composed:true}));}
function input(target,data,isComposing=true){target.dispatchEvent(new InputEvent('input',{data,inputType:'insertCompositionText',isComposing,bubbles:true,composed:true}));}
function check(v,m){if(!v)throw Error(m);}
async function validated(count){if(window.imeRequests.filter(x=>x.action==='validate').length>count)return;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{window.removeEventListener('ime-request',onRequest);reject(Error('validation request did not arrive'));},3000);function onRequest(){if(window.imeRequests.filter(x=>x.action==='validate').length<=count)return;clearTimeout(timer);window.removeEventListener('ime-request',onRequest);resolve();}window.addEventListener('ime-request',onRequest);});}
globalThis.ready=(async()=>{
 await document.fonts.ready;await wait(400);
 const sink=f.shadowRoot.querySelector('.ML__keyboard-sink');check(sink,'real MathLive keyboard sink missing');out.sink={tag:sink.tagName,editable:sink.getAttribute('contenteditable')};listen(sink,'sink');listen(f,'host');listen(t,'textarea');
 let n=window.imeRequests.filter(x=>x.action==='validate').length;f.value='x';f.dispatchEvent(new InputEvent('input',{bubbles:true,composed:true}));await validated(n);window.resetEditorHistory();
 stage='math';state('math-before');comp(sink,'compositionstart');state('math-start');
 for(const value of ['z','zhong','zhongwen']){comp(sink,'compositionupdate',value);input(sink,value);await wait(130);state('math-update-'+value);}
 n=window.imeRequests.filter(x=>x.action==='validate').length;comp(sink,'compositionend','中');state('math-end-sync');await validated(n);state('math-final');
 stage='math-cancel';n=window.imeRequests.filter(x=>x.action==='validate').length;comp(sink,'compositionstart');comp(sink,'compositionupdate','unfinished');await wait(130);comp(sink,'compositionend','');await validated(n);state('math-cancel-final');
 stage='math-second';n=window.imeRequests.filter(x=>x.action==='validate').length;comp(sink,'compositionstart');comp(sink,'compositionupdate','wen');await wait(130);comp(sink,'compositionend','文');await validated(n);state('math-second-final');
 stage='textarea';n=window.imeRequests.filter(x=>x.action==='validate').length;f.value='x';f.dispatchEvent(new InputEvent('input',{bubbles:true,composed:true}));await validated(n);window.resetEditorHistory();state('textarea-before');
 comp(t,'compositionstart');for(const value of ['z','zhong','zhongwenshurufa']){t.value=value;t.setSelectionRange(0,1);input(t,value);await wait(130);state('textarea-update-'+value);}
 n=window.imeRequests.filter(x=>x.action==='validate').length;t.value='\\text{中文}';t.setSelectionRange(t.value.length,t.value.length);input(t,'中文');comp(t,'compositionend','中文');input(t,'中文',false);await validated(n);state('textarea-final');
 stage='cancel';const before=f.value;n=window.imeRequests.filter(x=>x.action==='validate').length;comp(t,'compositionstart');t.value='cancelled';t.setSelectionRange(2,4);input(t,'cancelled');await wait(110);t.value=before;comp(t,'compositionend','');await validated(n);state('cancel-final');
 stage='second';n=window.imeRequests.filter(x=>x.action==='validate').length;comp(t,'compositionstart');t.value='\\text{中文二}';input(t,'二');comp(t,'compositionend','二');await validated(n);state('second-final');
})().catch(e=>{out.error=String(e);out.stack=e.stack;});
globalThis.readout=()=>out;
`;

test('real WebKit and pinned MathLive deliver internal IME events to production editor',{skip:process.platform!=='darwin',timeout:65000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'equationlab-ime-webkit-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const evidence=join(root,'.local/ime-20261031/r2/webkit');await mkdir(evidence,{recursive:true});
 await cp(join(root,'desktop'),directory,{recursive:true});await mkdir(join(directory,'vendor'),{recursive:true});
 const adapter=await buildMathLiveEditor({root,mathliveDirectory:join(root,'node_modules/mathlive'),output:join(directory,'vendor/mathlive.min.js')});
 await cp(join(root,'node_modules/mathlive/fonts'),join(directory,'vendor/fonts'),{recursive:true});
 let html=await readFile(join(directory,'index.html'),'utf8');
 const prelude=`<script>window.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),16);window.cancelAnimationFrame=clearTimeout;window.imeRequests=[];window.imeErrors=[];window.addEventListener('error',e=>imeErrors.push(e.message));</script>`;
 html=html.replace('<script src="vendor/mathlive.min.js">',prelude+'<script src="vendor/mathlive.min.js">');
 html=html.replace('<script src="app.js">',`<script>window.imeSyncs=0;const imeSync=window.syncEquationMacros;window.syncEquationMacros=(...args)=>{window.imeSyncs++;return imeSync(...args)};</script><script src="app.js">`);
 html=html.replace('</body>',`<script>${fixture}</script></body>`);await writeFile(join(directory,'index.html'),html);
 const binary=join(directory,'webkit');await run('/usr/bin/swiftc',[join(root,'tests/fixtures/ime-webkit.swift'),'-o',binary],{timeout:25000});
 try{await run(binary,[join(directory,'index.html'),join(directory,'result.json')],{timeout:35000});}
 catch(error){try{await cp(join(directory,'result.json'),join(evidence,'timeout-partial.json'));}catch{}throw error;}
 const result=JSON.parse(await readFile(join(directory,'result.json'),'utf8'));
 const versions=await run('/usr/libexec/PlistBuddy',['-c','Print :CFBundleVersion','/System/Library/Frameworks/WebKit.framework/Resources/Info.plist']);
 result.webkitFrameworkVersion=versions.stdout.trim();result.adapter=adapter;result.appSha256=createHash('sha256').update(await readFile(join(directory,'app.js'))).digest('hex');
 result.nativeValidation=[];
 for(const label of ['math-final','math-cancel-final','math-second-final','textarea-final','cancel-final','second-final']){
  const row=result.states.find(s=>s.label===label);if(!row)continue;
  try{const native=await desktopRequest({action:'validate',payload:{previewOnly:true,latex:row.formula}});result.nativeValidation.push({label,latex:row.formula,ok:true,nativeBytes:native.nativeBytes,warnings:native.warnings});}
  catch(error){result.nativeValidation.push({label,latex:row.formula,ok:false,error:String(error)});}
 }
 await writeFile(join(evidence,'result.json'),JSON.stringify(result,null,2)+'\n');
 assert.equal(result.error,undefined,result.error+'\n'+result.stack);assert.deepEqual(result.errors,[]);
 const get=label=>{const x=result.states.find(s=>s.label===label);assert.ok(x,label);return x;};
 assert.equal(result.mathlive,'0.111.1');assert.equal(result.sink.editable,'true');
 for(const type of ['compositionstart','compositionupdate','compositionend'])assert.ok(result.events.some(e=>e.stage==='math'&&e.where==='host'&&e.type===type&&e.composed),`sink ${type} reaches host`);
 const m0=get('math-before');for(const row of result.states.filter(s=>s.label.startsWith('math-update-'))){assert.equal(row.composing,true,row.label);assert.equal(row.latex,m0.latex,row.label);assert.equal(row.history,m0.history,row.label);assert.equal(row.syncs,m0.syncs,row.label);assert.equal(row.validations,m0.validations,row.label);}
 assert.ok(get('math-final').formula.includes('中'));assert.equal(get('math-final').composing,false);
 assert.equal(get('math-cancel-final').formula,get('math-final').formula);assert.equal(get('math-cancel-final').composing,false);assert.ok(get('math-second-final').formula.includes('文'));assert.equal(get('math-second-final').composing,false);
 const t0=get('textarea-before');for(const row of result.states.filter(s=>s.label.startsWith('textarea-update-'))){assert.equal(row.composing,true,row.label);assert.equal(row.formula,t0.formula,row.label);assert.deepEqual(row.selection,[0,1],row.label);assert.equal(row.history,t0.history,row.label);assert.equal(row.syncs,t0.syncs,row.label);assert.equal(row.validations,t0.validations,row.label);}
 assert.ok(get('textarea-final').formula.includes('中文'));assert.equal(get('textarea-final').composing,false);assert.equal(get('cancel-final').formula,get('textarea-final').formula);assert.equal(get('cancel-final').composing,false);assert.ok(get('second-final').formula.includes('中文二'));assert.equal(get('second-final').composing,false);
 assert.ok(result.events.some(e=>e.stage==='math'&&e.where==='host'&&e.type==='input'&&e.data==='中'&&e.isComposing===false),'MathLive sends a separate non-composing input after compositionend');
 const mathEvents=result.events.filter(e=>e.stage==='math'&&e.where==='host');assert.ok(mathEvents.findIndex(e=>e.type==='compositionend')<mathEvents.findIndex(e=>e.type==='input'&&e.data==='中'&&e.inputType==='insertText'),'MathLive input follows compositionend');
 assert.equal(result.nativeValidation.length,6);
 assert.ok(result.nativeValidation.every(x=>x.ok&&x.nativeBytes>0&&x.warnings.length===0),JSON.stringify(result.nativeValidation));
 for(const label of ['math-final','textarea-final','cancel-final','second-final']){const row=get(label);assert.ok(result.requests.some(r=>r.action==='validate'&&r.payload.latex===row.formula),label+' requests native validation');}
});
