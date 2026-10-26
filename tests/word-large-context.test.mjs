import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {deflateRawSync} from 'node:zlib';
import {nativeSessionOperation as operation} from '../src/word-native-session.mjs';
import {createDocx,flatOpc,inspectDocx,MAX_FLAT_OPC_BYTES} from '../src/document.mjs';
import {makeOle,inspectOle} from '../src/native.mjs';

test('Compressed live Word context opens beyond the old XML limit with exact document and Native identity',async()=>{
 const bytes=await createDocx([{latex:'x^3'},{latex:'y^2'}]),before=await inspectDocx(bytes),native=inspectOle(before.objects[1].ole).native;
 const xml=(await flatOpc(bytes)).replace('</pkg:package>',('<!--'+' '.repeat(100_000)+'-->').repeat(301)+'</pkg:package>');
 const document={ooxml:deflateRawSync(xml).toString('base64'),encoding:'deflate-base64',index:1,name:'Large unsaved.docx',identity:'host:large',snapshot:1};
 const opened=await operation('native-open',{session:'73001',native:native.toString('base64'),document});
 try{const read=await operation('native-read',{ticket:opened.ticket});assert.equal(read.documentContext.count,2);assert.equal(read.document.identity,'host:large');const back=await inspectDocx(await readFile(read.document.path));assert.deepEqual(back.objects.map(o=>o.nativeSha256),before.objects.map(o=>o.nativeSha256));}
 finally{await operation('native-cancel',{ticket:opened.ticket});await operation('native-poll',{ticket:opened.ticket});}
 await assert.rejects(operation('native-open',{session:'73002',native:inspectOle(makeOle('z')).native.toString('base64'),document}),/does not match/);
});

test('Compressed captures reject unknown codecs, invalid streams, invalid UTF-8 and expansion bombs',async()=>{
 const base={index:0,name:'Unsafe.docx',identity:'host:unsafe',snapshot:1},native=inspectOle(makeOle('x')).native.toString('base64');let session=73100;
 for(const document of [
  {...base,encoding:'gzip',ooxml:'eA=='},
  {...base,encoding:'deflate-base64',ooxml:'not base64'},
  {...base,encoding:'deflate-base64',ooxml:Buffer.from('broken').toString('base64')},
  {...base,encoding:'deflate-base64',ooxml:deflateRawSync(Buffer.from([0xff])).toString('base64')},
  {...base,encoding:'deflate-base64',ooxml:deflateRawSync(Buffer.alloc(MAX_FLAT_OPC_BYTES+1,32)).toString('base64')}
 ])await assert.rejects(operation('native-open',{session:String(session++),native,document}),/context/);
});
