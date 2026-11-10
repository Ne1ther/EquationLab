import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rename,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import JSZip from 'jszip';
import {createDocx,inspectDocx,hash} from '../src/document.mjs';
import {desktopRequest,documentSnapshotCacheStats} from '../src/desktop-rpc.mjs';

test('compact RPC snapshots retain native/numbering identity and invalidate replaced documents',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'equationlab-rpc-snapshot-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=join(dir,'document.docx');
 const make=latex=>createDocx([{latex,layout:{mode:'numbered-right',numberFormat:'(#C1.#E1)',chapter:1,bookmarkName:'EL_CACHE_TEST',bookmarkId:41}}],{fragment:true});
 const first=await make('x+1');await writeFile(file,first);
 const before=await inspectDocx(first),result=await desktopRequest({action:'inspect',payload:{path:file,thumbnails:false}});
 assert.equal(result.objects[0].nativeSha256,before.objects[0].nativeSha256);
 assert.deepEqual(result.objects[0].layout,before.objects[0].layout);
 assert.deepEqual(await desktopRequest({action:'inspect',payload:{path:file,thumbnails:false}}),result);
 const replacement=await make('x+2');await writeFile(join(dir,'replacement'),replacement);await rename(join(dir,'replacement'),file);
 const updated=await desktopRequest({action:'inspect',payload:{path:file,thumbnails:false}});
 assert.notEqual(updated.objects[0].nativeSha256,result.objects[0].nativeSha256);
 assert.equal(hash(await readFile(file)),hash(replacement));
 const stats=documentSnapshotCacheStats();assert.ok(stats.retainedBytes>0);assert.ok(stats.hits>0);
 assert.ok(!Object.keys(stats).some(key=>/path|document|content/i.test(key)&&!['pendingPaths','pendingContent'].includes(key)));
});

test('stored-preview fallback is lazy, repeatable and bound to replaced snapshot bytes',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'equationlab-rpc-stored-preview-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=join(dir,'unsupported.docx'),base=await createDocx([{latex:'x+1'}],{fragment:true});
 const broken=async label=>{
  const zip=await JSZip.loadAsync(base),inspected=await inspectDocx(base),object=inspected.objects[0];
  zip.file(object.path,Buffer.from('unsupported-ole'));
  zip.file(object.imagePath,Buffer.from(label));
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
 };
 await writeFile(file,await broken('stored-first'));
 const before=documentSnapshotCacheStats(),first=await desktopRequest({action:'inspect',payload:{path:file,thumbnails:false}});
 assert.ok(first.objects[0].error);assert.ok(first.objects[0].image.endsWith(Buffer.from('stored-first').toString('base64')));
 const afterFirst=documentSnapshotCacheStats();
 const repeat=await desktopRequest({action:'inspect',payload:{path:file,thumbnails:false}});
 assert.equal(repeat.objects[0].image,first.objects[0].image);
 assert.equal(documentSnapshotCacheStats().previewMisses,afterFirst.previewMisses);
 assert.ok(afterFirst.previewMisses>before.previewMisses);
 await writeFile(join(dir,'replacement'),await broken('stored-second'));await rename(join(dir,'replacement'),file);
 const changed=await desktopRequest({action:'inspect',payload:{path:file,thumbnails:false}});
 assert.ok(changed.objects[0].image.endsWith(Buffer.from('stored-second').toString('base64')));
});
