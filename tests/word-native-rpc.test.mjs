import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {desktopRequest} from '../src/desktop-rpc.mjs';
import {nativeSessionOperation as sessionOperation} from '../src/word-native-session.mjs';
import {createDocx} from '../src/document.mjs';
import {makeOle,inspectOle,characters,editCharacters} from '../src/native.mjs';

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
