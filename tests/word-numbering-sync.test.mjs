import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {checkedWordNumbering} from '../src/word-numbering.mjs';
import {createDocx,inspectDocx,flatOpc} from '../src/document.mjs';
import {inspectOle} from '../src/native.mjs';
import {nativeSessionOperation as session} from '../src/word-native-session.mjs';
import {desktopRequest} from '../src/desktop-rpc.mjs';
import {createWordDocumentRequests} from '../src/word-document-requests.mjs';

const context={chapter:4,section:2,expectedChapter:3,expectedSection:1};
const numbering={format:'(#C1.#S1.#E1)',side:'right',context};
test('chapter/section writes require a capable host and an exact target, with bounded immutable counters',()=>{
 const options={supported:true,contextSupported:true,target:{}};
 const copy=checkedWordNumbering(numbering,options);assert.deepEqual(copy,numbering);assert.notEqual(copy.context,context);
 for(const patch of [{supported:false},{contextSupported:false},{target:null}])assert.throws(()=>checkedWordNumbering(numbering,{...options,...patch}));
 for(const bad of [{chapter:0},{section:32768},{expectedChapter:-1},{expectedSection:1.5},{extra:1}])assert.throws(()=>checkedWordNumbering({...numbering,context:{...context,...bad}},options));
 assert.deepEqual(checkedWordNumbering({format:'(#E1)',side:'left'},{supported:true,target:{}}),{format:'(#E1)',side:'left'});
});

test('document capture reads shared defaults and chapter context even for an unnumbered equation',async()=>{
 const bytes=await createDocx([{latex:'x',layout:{mode:'numbered-right',chapter:3,section:2,numberFormat:'(#C1.#E1)'}},{latex:'y'}]);
 const read=await inspectDocx(bytes);assert.equal(read.numberFormat,'(#C1.#E1)');
 assert.equal(read.objects[1].layout.chapter,3);assert.equal(read.objects[1].layout.section,2);
});

test('a live workspace default change is identity-bound metadata and increments its revision',async()=>{
 const hostId='f'.repeat(64),queue=createWordDocumentRequests();await queue.take({hostId,waitMs:0});
 const doc={identity:'word:1',name:'thesis.docx',readOnly:false,numberFormat:'(#C1.#E1)'};
 const first=queue.handle('native-document-workspace',{hostId,active:{identity:doc.identity,name:doc.name},documents:[doc]});
 const second=queue.handle('native-document-workspace',{hostId,active:first.active,documents:[{...doc,numberFormat:'(#C1.#S1.#E1)'}]});
 assert.ok(second.revision>first.revision);assert.equal(second.documents[0].numberFormat,'(#C1.#S1.#E1)');
 assert.throws(()=>queue.handle('native-document-workspace',{hostId,active:first.active,documents:[{...doc,numberFormat:'(#C1)'}]}),/format/);
});

test('an existing Word equation carries chapter edits through the real RPC and native completion',async()=>{
 const bytes=await createDocx([{latex:'x',layout:{mode:'numbered-right',chapter:3,section:1,numberFormat:'(#C1.#E1)'}}]);
 const object=(await inspectDocx(bytes)).objects[0],native=inspectOle(object.ole).native.toString('base64');
 const opened=await session('native-open',{session:'9822210',native,numberingSupport:true,numberingContextSupport:true,document:{ooxml:await flatOpc(bytes),index:0,name:'context-save.docx',identity:'context-save:1',snapshot:1}});
 const oldFetch=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{try{return {ok:true,json:async()=>await session(new URL(url).pathname,JSON.parse(options.body))};}catch(e){return {ok:false,json:async()=>({error:e.message})};}};
 try{
  const source=await desktopRequest({action:'wordSessionRead',payload:{ticket:opened.ticket}});assert.equal(source.wordNumberingContextSupported,true);
  await desktopRequest({action:'wordSessionSave',payload:{ticket:opened.ticket,input:source.activePath,mode:'characters',replacements:{},target:{index:0,expectedNativeSha256:object.nativeSha256,documentIdentity:'context-save:1'},numbering}});
  const result=await session('native-poll',{ticket:opened.ticket});assert.deepEqual(result.numbering,numbering);assert.equal(result.native,native);
 }finally{globalThis.fetch=oldFetch;await session('native-cancel',{ticket:opened.ticket}).catch(()=>{});await session('native-poll',{ticket:opened.ticket}).catch(()=>{});}
});

test('a new Word equation can establish chapter context without changing its insertion identity or native bytes',async()=>{
 const bytes=await createDocx([]),ooxml=await flatOpc(bytes),tickets=[];
 const oldFetch=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{try{return {ok:true,json:async()=>await session(new URL(url).pathname,JSON.parse(options.body))};}catch(e){return {ok:false,json:async()=>({error:e.message})};}};
 try{
  for(const capable of [false,true]){
   const opened=await session('native-insert-open',{session:capable?'9822202':'9822201',acknowledgement:true,...capable?{numberingContextSupport:true}:{},document:{ooxml,index:-1,identity:'context-insert:1',snapshot:1,name:'new.docx'},layout:{mode:'numbered-right',numberFormat:'(#E1)',chapter:1,section:1,equation:11}});tickets.push(opened.ticket);
   const source=await session('native-read',{ticket:opened.ticket});
   const request={action:'wordSessionInsert',payload:{ticket:opened.ticket,input:source.path,latex:'x+1',layout:{mode:'numbered-right',numberFormat:'(#C1.#S1.#E1)',chapter:3,section:2,equation:11}}};
   if(!capable){await assert.rejects(desktopRequest(request),/updated plugin/);continue;}
   await desktopRequest(request);const result=await session('native-poll',{ticket:opened.ticket});
   const read=await inspectDocx(Buffer.from(result.docx,'base64'));assert.equal(read.objects.length,1);
   assert.equal(read.objects[0].layout.chapter,3);assert.equal(read.objects[0].layout.section,2);assert.equal(read.objects[0].layout.equation,1);
   assert.equal(inspectOle(read.objects[0].ole).native.toString('base64'),result.native);
  }
 }finally{
  globalThis.fetch=oldFetch;
  for(const ticket of tickets){await session('native-cancel',{ticket}).catch(()=>{});await session('native-poll',{ticket}).catch(()=>{});}
 }
});

test('Word numbering dialogs use English native controls while the app keeps localized inline settings',async()=>{
 const swift=await readFile(new URL('../macos/Views/NumberingFormatEditor.swift',import.meta.url),'utf8');
 assert.doesNotMatch(swift,/\.popover\(isPresented/);assert.match(swift,/bridge\.t\("常用编号"\)/);
 assert.match(swift,/尚未写入 Word：请点击“更新公式”。/);assert.match(swift,/文档默认格式/);
 const prompt=await readFile(new URL('../native-word-probe/include/numbering_prompt.hpp',import.meta.url),'utf8');
 assert.match(prompt,/addButtonWithTitle:@"OK"/);assert.match(prompt,/addButtonWithTitle:@"Cancel"/);assert.match(prompt,/systemFontOfSize/);
 const vba=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabRibbon.bas',import.meta.url),'utf8');
 const numbering=vba.slice(vba.indexOf('Private Function PromptNumberingSettings'),vba.indexOf('Private Sub EncodeTextUtf8'));
 assert.doesNotMatch(numbering,/InputBox\(/);assert.match(numbering,/SaveSharedNumberFormat Doc/);
 const shared=vba.slice(vba.indexOf('Private Sub SaveSharedNumberFormat'),vba.indexOf('Private Function SharedContextXML'));
 assert.match(shared,/SavePreferenceForDocument Doc, "EquationLabNumberFormat", pattern/);assert.match(shared,/CustomDocumentProperties\("MTEquationNumber2"\)\.Value = pattern/);
});

test('a numbered insertion recalculates the owning document even when MathType wraps its SEQs inside macrobutton code',async()=>{
 const vba=await readFile(new URL('../native-word-probe/automatic-loader/EquationLabDocumentContext.bas',import.meta.url),'utf8');
 const update=vba.slice(vba.indexOf('Private Function ELTryUpdateInsertedNumbers'),vba.indexOf('End Function',vba.indexOf('Private Function ELTryUpdateInsertedNumbers')));
 const shared=update.slice(update.indexOf('If numberFormat <> "" Then'),update.indexOf('    Else'));
 assert.match(shared,/ELUpdateNumbersForDocument Doc/);assert.doesNotMatch(shared,/For Each field/);
 assert.ok(update.indexOf('ELUpdateNumbersForDocument Doc')<update.indexOf('ELAdoptInsertedNumberFormat Doc, numberFormat'));
 assert.doesNotMatch(update,/ActiveDocument|Selection|\.Select/);
});

test('the first chapter-numbered insertion establishes real counters even when the preview values were unchanged',async()=>{
 const bytes=await createDocx([]),layout={mode:'numbered-right',numberFormat:'(#C1.#E1)',chapter:3,section:1,equation:11,contextEstablished:false};
 const opened=await session('native-insert-open',{session:'9822230',acknowledgement:true,numberingContextSupport:true,document:{ooxml:await flatOpc(bytes),index:-1,name:'first.docx',identity:'first-context:1',snapshot:1},layout});
 const oldFetch=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{try{return {ok:true,json:async()=>await session(new URL(url).pathname,JSON.parse(options.body))};}catch(e){return {ok:false,json:async()=>({error:e.message})};}};
 try{
  const source=await session('native-read',{ticket:opened.ticket});
  await desktopRequest({action:'wordSessionInsert',payload:{ticket:opened.ticket,input:source.path,latex:'x',layout}});
  const result=await session('native-poll',{ticket:opened.ticket}),read=await inspectDocx(Buffer.from(result.docx,'base64'));
  assert.equal(read.objects[0].layout.chapter,3);assert.equal(read.objects[0].layout.section,1);assert.equal(read.objects[0].layout.equation,1);
 }finally{globalThis.fetch=oldFetch;await session('native-cancel',{ticket:opened.ticket}).catch(()=>{});await session('native-poll',{ticket:opened.ticket}).catch(()=>{});}
});
