import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import JSZip from 'jszip';
import sharp from 'sharp';
import {createDocx,hash} from '../src/document.mjs';
import {desktopRequest} from '../src/desktop-rpc.mjs';

test('Sidebar thumbnails replace a stale low-resolution Word image with fresh native rendering',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'equationlab-preview-quality-'));
 try{
  const zip=await JSZip.loadAsync(await createDocx([{latex:'s=vt+1'}],{fragment:true}));
  zip.file('word/media/image1.png',await sharp({create:{width:1,height:1,channels:4,background:'#ffffff'}}).png().toBuffer());
  const path=join(directory,'stale.docx');await writeFile(path,await zip.generateAsync({type:'nodebuffer'}));
  const quick=await desktopRequest({action:'inspect',payload:{path,thumbnails:false}});assert.equal(quick.objects[0].image,null,'defer native thumbnails without retaining the stale image');
  const rendered=await desktopRequest({action:'inspect',payload:{path,thumbnailIndices:[0]}}),image=Buffer.from(rendered.objects[0].image.split(',')[1],'base64'),metadata=await sharp(image).metadata();
  assert.ok(metadata.width>300&&metadata.height>50,'short formulas need enough pixels for a Retina sidebar');
  assert.ok((await sharp(image).stats()).channels[0].min<10,'the original white placeholder was replaced by formula ink');
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('Reopening reuses only fresh thumbnails with exactly matching native data',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'equationlab-preview-cache-'));
 try{
  const path=join(directory,'first.docx'),other=join(directory,'other.docx');
  await writeFile(path,await createDocx([{latex:'x+317'}]));
  const rendered=await desktopRequest({action:'inspect',payload:{path,thumbnailIndices:[0]}});
  const reopened=await desktopRequest({action:'inspect',payload:{path,thumbnails:false}});assert.equal(reopened.objects[0].image,rendered.objects[0].image);
  await writeFile(other,await createDocx([{latex:'x+318'}]));
  assert.equal((await desktopRequest({action:'inspect',payload:{path:other,thumbnails:false}})).objects[0].image,null,'changed native bytes cannot reuse an old preview');
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('A saved document loads its catalogue before rasterizing only requested rows',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'equationlab-copy-thumbnails-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const path=join(directory,'source.docx');
 const bytes=await createDocx(Array.from({length:8},(_,i)=>({latex:`c_{921${i}}+2718`})));
 await writeFile(path,bytes);
 const opened=await desktopRequest({action:'inspect',payload:{path,thumbnails:false}});
 assert.equal(opened.sourceSha256,hash(bytes));
 assert.equal(opened.objects.length,8);
 assert.ok(opened.objects.every(row=>row.latex&&row.image===null));
 let scheduled=0;
 const {images}=await desktopRequest({action:'fileCopyThumbnails',payload:{path,sourceSha256:opened.sourceSha256,indices:[7,3]}},{
  scheduleThumbnail(work){scheduled++;return work();}
 });
 assert.equal(scheduled,2);
 assert.deepEqual(images.map(row=>row.index),[7,3]);
 assert.ok(images.every(row=>row.image?.startsWith('data:image/png;')));
 const again=await desktopRequest({action:'inspect',payload:{path,thumbnails:false}});
 assert.deepEqual(again.objects.filter(row=>row.image).map(row=>row.index),[3,7]);
});

test('Replacing an opened DOCX blocks old-index preview, thumbnail and copy actions',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'equationlab-copy-replaced-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const path=join(directory,'source.docx'),output=join(directory,'output.docx');
 const bytes=await createDocx([{latex:'a+1'},{latex:'b+2'}]);
 await writeFile(path,bytes);
 const opened=await desktopRequest({action:'inspect',payload:{path,thumbnails:false}});
 const reversed=await createDocx([{latex:'b+2'},{latex:'a+1'}]);
 await writeFile(path,reversed);
 const sourceSha256=opened.sourceSha256,source={path,index:0,sourceSha256,mode:'rebuild'};
 const edit={input:path,index:0,latex:'u+3',mode:'rebuild',sourceSha256,output};
 for(const request of [
  {action:'fileCopyThumbnails',payload:{path,sourceSha256,indices:[0]}},
  {action:'editPreview',payload:edit},
  {action:'edit',payload:edit},
  {action:'arrange',payload:{input:path,output,indices:[0],sourceSha256,layout:{mode:'display'}}},
  {action:'export',payload:{source,output,equations:[{latex:'u+3'}]}},
  {action:'exportGraphic',payload:{source,output,format:'svg',latex:'u+3'}},
  {action:'preview',payload:{source,latex:'u+3'}},
  {action:'documentAudit',payload:{input:path,sourceSha256}},
  {action:'documentTypographyPreflight',payload:{input:path,sourceSha256,options:{typography:{fullSize:14}}}}
 ])await assert.rejects(desktopRequest(request),/源 Word 文件已变更/,request.action);
 await assert.rejects(readFile(output),{code:'ENOENT'});
 assert.deepEqual(await readFile(path),reversed);
 const reopened=await desktopRequest({action:'inspect',payload:{path,thumbnails:false}});
 await desktopRequest({action:'edit',payload:{...edit,sourceSha256:reopened.sourceSha256}});
 assert.deepEqual(await readFile(path),reversed);
 assert.notDeepEqual(await readFile(output),reversed);
});
