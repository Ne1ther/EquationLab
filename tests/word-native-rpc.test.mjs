import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import JSZip from 'jszip';
import {desktopRequest} from '../src/desktop-rpc.mjs';
import {nativeSessionOperation as sessionOperation} from '../src/word-native-session.mjs';
import {createDocx,flatOpc,inspectDocx,hash} from '../src/document.mjs';
import {makeOle,inspectOle,characters,editCharacters,replaceOleLatex} from '../src/native.mjs';

// This process routes RPC HTTP calls directly to an isolated in-memory service.
// It never connects to the live Word/App service or edits user documents.
const originalFetch=globalThis.fetch,live=new Set(),calls=[];
let next=800000n,transform=null;
test.before(()=>{globalThis.fetch=async(url,options)=>{
 const parsed=new URL(url);assert.equal(parsed.origin,'http://127.0.0.1:37952');
 const body=JSON.parse(options.body),operation=parsed.pathname.replace('/api/','');calls.push({operation,body});
 try{let result=await sessionOperation(operation,body);if(transform)result=transform(operation,result);return {ok:true,json:async()=>result};}
 catch(error){return {ok:false,json:async()=>({error:error.message})};}
};});
test.afterEach(async()=>{
 transform=null;
 for(const ticket of live){await sessionOperation('native-cancel',{ticket}).catch(()=>{});await sessionOperation('native-poll',{ticket}).catch(()=>{});}
 live.clear();calls.length=0;
});
test.after(()=>{globalThis.fetch=originalFetch;});
async function open(latex='x^3'){
 const ole=makeOle(latex),native=inspectOle(ole).native,session=String(next++),result=await sessionOperation('native-open',{session,native:native.toString('base64')});live.add(result.ticket);
 const read=await sessionOperation('native-read',{ticket:result.ticket});return {...read,ole};
}
const save=(session,patch={})=>desktopRequest({action:'wordSessionSave',payload:{ticket:session.ticket,input:session.path,mode:'characters',replacements:{},...patch}});
const assertEditing=async session=>assert.deepEqual(await sessionOperation('native-poll',{ticket:session.ticket}),{state:'editing'});

test('RPC save binds the staged source and native identity, then commits the expected exact character edit',async()=>{
 const source=await open(),offset=characters(inspectOle(source.ole).parsed).find(c=>c.char==='3').offset,replacements={[offset]:'4'};
 assert.deepEqual(await save(source,{replacements}),{ok:true,checked:true,state:'complete'});
 const complete=calls.find(c=>c.operation==='native-complete');assert.equal(complete.body.session,source.session);
 const result=await sessionOperation('native-poll',{ticket:source.ticket}),expected=inspectOle(editCharacters(source.ole,replacements)).native;
 assert.equal(result.native,expected.toString('base64'));assert.match(Buffer.from(result.pdf,'base64').subarray(0,9).toString(),/^%PDF-/);assert.ok(result.width>0&&result.height>0);
 await assert.rejects(access(source.path),error=>error.code==='ENOENT');await assert.rejects(save(source),/Unknown or expired/);live.delete(source.ticket);
});

test('RPC refuses a different session staged file and never sends a completion for the wrong source',async()=>{
 const a=await open('x^3'),b=await open('y^9');
 await assert.rejects(save(a,{input:b.path}),/不属于当前 Word 会话/);assert.equal(calls.some(c=>c.operation==='native-complete'),false);
 await assertEditing(a);await assertEditing(b);
 await save(b);const result=await sessionOperation('native-poll',{ticket:b.ticket});assert.equal(result.native,b.native);live.delete(b.ticket);await assertEditing(a);
});

test('RPC rejects changed native bytes at the correct path without committing or deleting the source session',async()=>{
 const source=await open(),original=await readFile(source.path);
 await writeFile(source.path,await createDocx([{latex:'y^9'}]));
 await assert.rejects(save(source),/源公式已变化/);assert.equal(calls.some(c=>c.operation==='native-complete'),false);await assertEditing(source);
 await writeFile(source.path,original);await save(source);assert.equal((await sessionOperation('native-poll',{ticket:source.ticket})).native,source.native);live.delete(source.ticket);
});

test('RPC refuses multiple staged formulas even if the first native formula matches the session',async()=>{
 const source=await open();await writeFile(source.path,await createDocx([{ole:source.ole},{latex:'z^2'}]));
 await assert.rejects(save(source),/只包含一个原生公式/);assert.equal(calls.some(c=>c.operation==='native-complete'),false);await assertEditing(source);
});

test('RPC rejects unknown edit modes and nonzero object indices instead of implicitly rebuilding',async()=>{
 const source=await open();
 for(const mode of [undefined,'character','unknown'])await assert.rejects(save(source,{mode}),/编辑模式/);
 await assert.rejects(save(source,{index:1}),/只包含一个原生公式/);assert.equal(calls.some(c=>c.operation==='native-complete'),false);await assertEditing(source);
});

test('RPC validates the authoritative response ticket and original native bytes before editing',async()=>{
 const source=await open();
 transform=(operation,result)=>operation==='native-read'?{...result,ticket:'f'.repeat(64)}:result;
 await assert.rejects(save(source),/会话源数据无效/);
 transform=(operation,result)=>operation==='native-read'?{...result,native:inspectOle(makeOle('wrong')).native.toString('base64')}:result;
 await assert.rejects(save(source),/源公式已变化/);
 transform=null;assert.equal(calls.some(c=>c.operation==='native-complete'),false);await assertEditing(source);
});

test('RPC validation failures keep the session editable and its original native source intact',async()=>{
 const source=await open();
 await assert.rejects(save(source,{typography:{styles:{3:{font:'Unverified Font'}}}}),/mapping/);
 assert.equal(calls.some(c=>c.operation==='native-complete'),false);await assertEditing(source);
 const read=await desktopRequest({action:'wordSessionRead',payload:{ticket:source.ticket}});assert.equal(read.path,source.path);assert.equal(read.objects.length,1);assert.equal(read.wordTicket,source.ticket);
 await desktopRequest({action:'wordSessionCancel',payload:{ticket:source.ticket}});assert.equal((await sessionOperation('native-poll',{ticket:source.ticket})).state,'cancelled');await assert.rejects(access(source.path),error=>error.code==='ENOENT');live.delete(source.ticket);
});

test('A live document snapshot exposes every equation and its actual layout while save remains bound to the activated duplicate',async()=>{
 const ole=makeOle('x^3'),document=await createDocx([{ole,layout:{mode:'numbered-right',chapter:2,numberFormat:'(#C1.#E1)'}},{latex:'y^9'},{ole,layout:{mode:'numbered-left',chapter:3,section:2,numberFormat:'(#C1.#S1.#E1)'}}]);
 const activated=inspectOle(ole).native.toString('base64'),opened=await sessionOperation('native-open',{session:String(next++),native:activated,document:{ooxml:await flatOpc(document),index:2,name:'未保存的中文文档.docx'}});live.add(opened.ticket);
 const result=await desktopRequest({action:'wordSessionRead',payload:{ticket:opened.ticket}});
 assert.equal(result.objects.length,3);assert.equal(result.activeIndex,2);assert.equal(result.documentName,'未保存的中文文档.docx');assert.equal(result.objects[2].layout.numberFormat,'(#C1.#S1.#E1)');assert.equal(result.objects[2].layout.mode,'numbered-left');assert.equal(result.objects[2].layout.chapter,3);assert.equal(result.objects[2].layout.section,2);
 assert.notEqual(result.activePath,result.path);
 await assert.rejects(save({ticket:opened.ticket,path:result.path}),/不属于当前 Word 会话/);
 const offset=characters(inspectOle(ole).parsed).find(c=>c.char==='3').offset;
 await save({ticket:opened.ticket,path:result.activePath},{replacements:{[offset]:'4'}});
 assert.equal((await sessionOperation('native-poll',{ticket:opened.ticket})).native,inspectOle(editCharacters(ole,{[offset]:'4'})).native.toString('base64'));live.delete(opened.ticket);
});

test('Wrong snapshot index or native bytes cannot attach another document; navigation is single-use and drops private staging',async()=>{
 const a=makeOle('x^3'),b=makeOle('y^9'),ooxml=await flatOpc(await createDocx([{ole:a},{ole:b}]));
 await assert.rejects(sessionOperation('native-open',{session:String(next++),native:inspectOle(a).native.toString('base64'),document:{ooxml,index:1,name:'wrong.docx'}}),/does not match/);
 const opened=await sessionOperation('native-open',{session:String(next++),native:inspectOle(a).native.toString('base64'),document:{ooxml,index:0,name:'test.docx'}});live.add(opened.ticket);
 const staged=await sessionOperation('native-read',{ticket:opened.ticket});
 for(const index of [-1,0,2,0.5])await assert.rejects(desktopRequest({action:'wordSessionNavigate',payload:{ticket:opened.ticket,index}}),/navigation target/);
 await desktopRequest({action:'wordSessionNavigate',payload:{ticket:opened.ticket,index:1}});
 await assert.rejects(access(staged.path));await assert.rejects(access(staged.document.path));
 assert.deepEqual(await sessionOperation('native-poll',{ticket:opened.ticket}),{state:'navigate',index:1});
 await assert.rejects(sessionOperation('native-poll',{ticket:opened.ticket}),/expired/);live.delete(opened.ticket);
});

async function openDocument(document,index,{identity='word-process-a:document-1',snapshot=1}={}){
 const inspected=await inspectDocx(document),native=inspectOle(inspected.objects[index].ole).native;
 const opened=await sessionOperation('native-open',{session:String(next++),native:native.toString('base64'),document:{ooxml:await flatOpc(document),index,name:'同名测试.docx',...identity?{identity,snapshot}:{}}});
 live.add(opened.ticket);return {...await sessionOperation('native-read',{ticket:opened.ticket}),objects:inspected.objects};
}
const targetOf=(session,index)=>({index,expectedNativeSha256:session.objects[index].nativeSha256,documentIdentity:session.document.identity});

async function alternateMainPart(document){
 const zip=await JSZip.loadAsync(document),xml=await zip.file('word/document.xml').async('string'),relationships=await zip.file('word/_rels/document.xml.rels').async('string');
 const rootRelationships=await zip.file('_rels/.rels').async('string'),contentTypes=await zip.file('[Content_Types].xml').async('string');
 zip.remove('word/document.xml');zip.remove('word/_rels/document.xml.rels');
 zip.file('word/document2.xml','\uFEFF'+xml);zip.file('word/_rels/document2.xml.rels','\uFEFF'+relationships);
 zip.file('_rels/.rels','\uFEFF'+rootRelationships.replace('Target="word/document.xml"','Target="/word/document2.xml"'));
 zip.file('[Content_Types].xml','\uFEFF'+contentTypes.replace('/word/document.xml','/word/document2.xml'));
 return zip.generateAsync({type:'nodebuffer'});
}

test('Document context diagnostics distinguish a verified full snapshot from a genuinely missing capture without guessing from the last document',async()=>{
 const document=await createDocx([{latex:'x^3'},{latex:'y^9'}]),first=await openDocument(document,1);
 const read=await desktopRequest({action:'wordSessionRead',payload:{ticket:first.ticket}});
 assert.equal(read.documentIdentity,'word-process-a:document-1');assert.equal(read.objects.length,2);
 assert.deepEqual(read.documentContext,{state:'available',reason:'captured',identity:first.document.identity,snapshot:1,count:2,index:1});
 const absent=await open('y^9'),single=await desktopRequest({action:'wordSessionRead',payload:{ticket:absent.ticket}});
 assert.equal(single.hasDocumentContext,false);assert.equal(single.documentIdentity,null);assert.equal(single.objects.length,1);
 assert.deepEqual(single.documentContext,{state:'missing',reason:'not-captured',identity:null,snapshot:null,count:0,index:null});
 for(const text of [JSON.stringify(read.documentContext),JSON.stringify(single.documentContext)]){assert.equal(text.includes('同名测试'),false);assert.equal(text.includes('equationlab-word-native-'),false);assert.equal(text.includes(first.ticket),false);}
});

test('A sidebar target saves directly from its bound snapshot with one completion and no navigation or replacement session',async()=>{
 const document=await createDocx([{latex:'x^3'},{latex:'y^9'},{latex:'z^2'}]),source=await openDocument(document,0),target=targetOf(source,2);
 const offset=characters(inspectOle(source.objects[2].ole).parsed).find(c=>c.char==='2').offset,replacements={[offset]:'7'};
 const expected=inspectOle(editCharacters(source.objects[2].ole,replacements)).native;
 await save(source,{target,replacements});
 const complete=calls.filter(c=>c.operation==='native-complete');assert.equal(complete.length,1);assert.deepEqual(complete[0].body.target,target);assert.equal(complete[0].body.ticket,source.ticket);
 assert.equal(calls.some(c=>c.operation==='native-navigate'||c.operation==='native-open'),false);
 const result=await sessionOperation('native-poll',{ticket:source.ticket});live.delete(source.ticket);
 assert.deepEqual(result.target,target);assert.equal(result.native,expected.toString('base64'));assert.notEqual(result.native,source.native);
});

test('Number format changes require a capable Word host and an exact live document target',async()=>{
 const document=await createDocx([{latex:'x^3'},{latex:'y^9'}]),objects=(await inspectDocx(document)).objects;
 const native=inspectOle(objects[0].ole).native.toString('base64'),identity='word-format:doc',ooxml=await flatOpc(document);
 const opened=await sessionOperation('native-open',{session:String(next++),native,acknowledgement:true,numberingSupport:true,document:{ooxml,index:0,name:'format.docx',identity,snapshot:1}});live.add(opened.ticket);
 const read=await desktopRequest({action:'wordSessionRead',payload:{ticket:opened.ticket}});assert.equal(read.wordNumberingSupported,true);
 const source={ticket:opened.ticket,path:read.activePath},target={index:1,expectedNativeSha256:objects[1].nativeSha256,documentIdentity:identity};
 for(const numbering of [{format:'(#C1)',side:'right'},{format:'(#E1)',side:'bad'},{format:'(#E1)',side:'right',extra:true}])await assert.rejects(save(source,{target,numbering}));
 await assert.rejects(save(source,{numbering:{format:'(#C1.#E1)',side:'right'}}),/编号目标/);
 await save(source,{target,numbering:{format:'(#C1.#E1)',side:'left'}});
 const result=await sessionOperation('native-poll',{ticket:opened.ticket});live.delete(opened.ticket);
 assert.deepEqual(result.target,target);assert.deepEqual(result.numbering,{format:'(#C1.#E1)',side:'left'});
 const legacy=await openDocument(document,0);assert.equal((await desktopRequest({action:'wordSessionRead',payload:{ticket:legacy.ticket}})).wordNumberingSupported,false);
 await assert.rejects(save(legacy,{target:targetOf(legacy,0),numbering:{format:'(#E1)',side:'right'}}),/插件能力/);
});

test('Alternate BOM-prefixed main parts populate context, validate target saves, and accept the generated insertion fragment',async()=>{
 const document=await alternateMainPart(await createDocx([{latex:'x^3'},{latex:'y_2+1'}])),inspected=await inspectDocx(document),ooxml=await flatOpc(document);
 assert.equal(inspected.mainPart,'word/document2.xml');assert.equal(inspected.objects.length,2);assert.ok(inspected.objects.every(object=>object.mainDocument));

 const identity='word-main-part:target-save',snapshot='snapshot-main-part',openedSession=String(next++),ownerNative=inspectOle(inspected.objects[1].ole).native;
 const opened=await sessionOperation('native-open',{session:openedSession,native:ownerNative.toString('base64'),document:{ooxml,index:1,name:'alternate-main.docx',identity,snapshot}});live.add(opened.ticket);
 const read=await desktopRequest({action:'wordSessionRead',payload:{ticket:opened.ticket}});
 assert.equal(read.activeIndex,1);assert.equal(read.objects.length,2);assert.ok(read.objects.every(object=>object.mainDocument));
 assert.deepEqual(read.documentContext,{state:'available',reason:'captured',identity,snapshot,count:2,index:1});
 const target={index:1,expectedNativeSha256:inspected.objects[1].nativeSha256,documentIdentity:identity},latex='alternate_main_target';
 await desktopRequest({action:'wordSessionSave',payload:{ticket:opened.ticket,input:read.activePath,mode:'rebuild',latex,target}});
 const saved=await sessionOperation('native-poll',{ticket:opened.ticket});live.delete(opened.ticket);
 assert.deepEqual(saved.target,target);assert.equal(saved.native,inspectOle(replaceOleLatex(inspected.objects[1].ole,latex)).native.toString('base64'));

 const insertionSession=String(next++),layout={mode:'inline',numberFormat:'(#E1)',chapter:2,section:1,equation:2};
 const insertion=await sessionOperation('native-insert-open',{session:insertionSession,acknowledgement:true,document:{ooxml,index:-1,name:'alternate-main.docx',identity:'word-main-part:insert',snapshot},layout});live.add(insertion.ticket);
 const insertionRead=await desktopRequest({action:'wordSessionRead',payload:{ticket:insertion.ticket}});
 assert.equal(insertionRead.insertion,true);assert.equal(insertionRead.objects.length,2);assert.ok(insertionRead.objects.every(object=>object.mainDocument));
 assert.equal(insertionRead.documentContext.count,2);assert.equal(insertionRead.documentContext.index,-1);
 await desktopRequest({action:'wordSessionInsert',payload:{ticket:insertion.ticket,input:insertionRead.activePath,latex:'new_alternate_main_formula',layout:insertionRead.insertionLayout}});
 const completion=calls.filter(call=>call.operation==='native-complete').at(-1),fragment=await inspectDocx(Buffer.from(completion.body.docx,'base64'));
 assert.equal(fragment.objects.length,1);assert.equal(fragment.objects[0].mainDocument,true);
 const inserted=await sessionOperation('native-poll',{ticket:insertion.ticket});live.delete(insertion.ticket);
 assert.equal(inserted.state,'complete');assert.equal(inserted.docx,completion.body.docx);
 assert.deepEqual(await sessionOperation('native-ack',{ticket:insertion.ticket,session:insertionSession,ok:true}),{state:'committed'});
});

test('Identical document bytes and names do not make different Word document identities interchangeable',async()=>{
 const document=await createDocx([{latex:'x^3'},{latex:'y^9'}]),a=await openDocument(document,0,{identity:'word-process-a:document-1'}),b=await openDocument(document,0,{identity:'word-process-a:document-2'});
 const aTarget=targetOf(a,1),bTarget=targetOf(b,1);
 await assert.rejects(save(a,{target:bTarget}),/不属于当前文档/);
 await assert.rejects(save(b,{target:aTarget}),/不属于当前文档/);
 await assertEditing(a);await assertEditing(b);assert.equal(calls.some(c=>c.operation==='native-complete'),false);
 await save(a,{target:aTarget});assert.deepEqual((await sessionOperation('native-poll',{ticket:a.ticket})).target,aTarget);live.delete(a.ticket);
 const remaining=await desktopRequest({action:'wordSessionRead',payload:{ticket:b.ticket}});assert.equal(remaining.objects.length,2);assert.equal(remaining.documentIdentity,b.document.identity);
});

test('Malformed, stale and mutated snapshot targets fail atomically while the owner remains editable',async()=>{
 const document=await createDocx([{latex:'x^3'},{latex:'y^9'}]),source=await openDocument(document,0),target=targetOf(source,1);
 for(const bad of [null,{...target,index:-1},{...target,index:2},{...target,expectedNativeSha256:'0'.repeat(64)},{...target,extra:true}])await assert.rejects(save(source,{target:bad}),/保存目标/);
 const legacy=await openDocument(document,0,{identity:null});await assert.rejects(save(legacy,{target}),/不属于当前文档/);
 const changed=await createDocx([{latex:'x^3'},{latex:'z^2'}]);await writeFile(source.document.path,changed);
 await assert.rejects(save(source,{target}),/保存目标已变化/);await assertEditing(source);assert.equal(calls.some(c=>c.operation==='native-complete'),false);
 // The service independently checks the original snapshot even if RPC callers
 // bypass its rendering checks or supply a completion directly.
 const pdf=Buffer.from('%PDF-1.4\n%%EOF\n').toString('base64');
 await assert.rejects(sessionOperation('native-complete',{ticket:source.ticket,native:source.native,pdf,width:1,height:1,target:{...target,expectedNativeSha256:'f'.repeat(64)}}),/does not match/);await assertEditing(source);
});

test('Queued native completions snapshot the target fields before later caller mutation',async()=>{
 const document=await createDocx([{latex:'x^3'},{latex:'y^9'}]),source=await openDocument(document,0),target=targetOf(source,1);
 const body={ticket:source.ticket,native:inspectOle(source.objects[1].ole).native.toString('base64'),pdf:Buffer.from('%PDF-1.4\n%%EOF\n').toString('base64'),width:1,height:1,target:{...target}};
 const pending=sessionOperation('native-complete',body);body.target.index=0;body.target.documentIdentity='other-word:other-document';
 await pending;assert.deepEqual((await sessionOperation('native-poll',{ticket:source.ticket})).target,target);live.delete(source.ticket);
});

test('Offline protocol regression reads and directly saves every formula in the real 30-formula demonstration twice',async t=>{
 const document=await readFile(new URL('../docs/examples/equation-lab-30-formulas.docx',import.meta.url)),inspected=await inspectDocx(document),ooxml=await flatOpc(document),timings=[];
 assert.equal(inspected.objects.length,30);
 for(let round=0;round<2;round++)for(let index=0;index<30;index++){
  const owner=(index+7)%30,native=inspectOle(inspected.objects[owner].ole).native,started=performance.now();
  const opened=await sessionOperation('native-open',{session:String(next++),native:native.toString('base64'),acknowledgement:true,document:{ooxml,index:owner,name:'30公式后端回归.docx',identity:'offline-word:thirty-formulas',snapshot:round+1}});live.add(opened.ticket);
  const read=await desktopRequest({action:'wordSessionRead',payload:{ticket:opened.ticket}});
  assert.equal(read.objects.length,30);assert.equal(read.activeIndex,owner);assert.equal(read.objects[index].nativeSha256,inspected.objects[index].nativeSha256);
  const character=characters(inspectOle(inspected.objects[index].ole).parsed).find(c=>/^[A-Za-z0-9]$/.test(c.char));assert.ok(character);
  const replacements={[character.offset]:round?'p':'q'},target={index,expectedNativeSha256:inspected.objects[index].nativeSha256,documentIdentity:read.documentIdentity};
  const expected=inspectOle(editCharacters(inspected.objects[index].ole,replacements)).native;
  await desktopRequest({action:'wordSessionSave',payload:{ticket:opened.ticket,input:read.activePath,mode:'characters',replacements,target}});
  const result=await sessionOperation('native-poll',{ticket:opened.ticket});live.delete(opened.ticket);
  assert.equal(result.state,'complete');assert.deepEqual(result.target,target);assert.equal(hash(Buffer.from(result.native,'base64')),hash(expected));
  // This is an isolated protocol acknowledgement, not a real Word SaveObject.
  await sessionOperation('native-ack',{ticket:opened.ticket,session:String(next-1n),ok:true});
  timings.push(performance.now()-started);
 }
 assert.equal(calls.filter(c=>c.operation==='native-complete').length,60);assert.equal(calls.some(c=>c.operation==='native-navigate'),false);
 timings.sort((a,b)=>a-b);t.diagnostic(`Offline only: 60/60 direct-target saves; read/render/stage/poll p50=${timings[30].toFixed(1)} ms, p95=${timings[57].toFixed(1)} ms. No Word GUI or host persistence was exercised.`);
});
