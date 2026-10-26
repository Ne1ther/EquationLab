import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import JSZip from 'jszip';
import {checkedWordSnapshotZip} from '../src/word-snapshot.mjs';import {inspectDocx} from '../src/document.mjs';import {inspectOle} from '../src/native.mjs';import {nativeSessionOperation} from '../src/word-native-session.mjs';
const source=await readFile(new URL('../docs/examples/equation-lab-30-formulas.docx',import.meta.url)),original=await inspectDocx(source),zip=await JSZip.loadAsync(source),compact=new JSZip();
for(const [name,entry]of Object.entries(zip.files))if(/\.(xml|rels|bin)$/i.test(name))compact.file(name,await entry.async('nodebuffer'),{createFolders:false});
const bytes=await compact.generateAsync({type:'nodebuffer',compression:'DEFLATE'}),encoded=bytes.toString('base64');
let session=98001000n;const body=index=>({session:String(session++),native:inspectOle(original.objects[index].ole).native.toString('base64'),document:{ooxml:encoded,encoding:'docx-base64',index,count:30,name:'Saved thesis.docx',identity:'qa:1',snapshot:1}});
test('Compact saved Word snapshots preserve all native objects and exact owner/index binding',async()=>{
 const data=await checkedWordSnapshotZip(encoded),doc=await inspectDocx(data);assert.deepEqual(doc.objects.map(o=>o.nativeSha256),original.objects.map(o=>o.nativeSha256));assert.ok(data.length<source.length);
 const opened=await nativeSessionOperation('native-open',body(25));try{const read=await nativeSessionOperation('native-read',{ticket:opened.ticket});assert.equal(read.document.index,25);const staged=await inspectDocx(await readFile(read.document.path));assert.equal(staged.objects[25].nativeSha256,original.objects[25].nativeSha256);}finally{await nativeSessionOperation('native-cancel',{ticket:opened.ticket});await nativeSessionOperation('native-poll',{ticket:opened.ticket});}
});
test('A changed live count or wrong selected native value cannot use a saved document snapshot',async()=>{
 const count=body(0);count.document.count=29;await assert.rejects(nativeSessionOperation('native-open',count),/equation count/);
 const selected=body(0);selected.native=inspectOle(original.objects[1].ole).native.toString('base64');await assert.rejects(nativeSessionOperation('native-open',selected),/activated equation/);
});
test('Saved snapshots reject noncanonical base64, invalid CRCs and lying inflate sizes',async()=>{
 await assert.rejects(checkedWordSnapshotZip(encoded+'!'),/Invalid saved Word snapshot/);
 const badCrc=Buffer.from(bytes),central=badCrc.indexOf(Buffer.from('504b0102','hex'));badCrc[central+16]^=1;await assert.rejects(checkedWordSnapshotZip(badCrc.toString('base64')),/checksum mismatch/);
 const bomb=Buffer.from(bytes);bomb.writeUInt32LE(1,central+24);bomb.writeUInt32LE(1,bomb.readUInt32LE(central+42)+22);await assert.rejects(checkedWordSnapshotZip(bomb.toString('base64')),/oversized saved Word snapshot part/);
});
test('Saved snapshots reject path traversal and unrelated media entries',async()=>{
 for(const name of ['../outside.xml','word/media/image.png']){const bad=new JSZip();bad.file(name,'x',{createFolders:false});const b=await bad.generateAsync({type:'nodebuffer'});await assert.rejects(checkedWordSnapshotZip(b.toString('base64')),/Invalid saved Word snapshot part/);}
});
