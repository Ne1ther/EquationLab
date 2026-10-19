import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import JSZip from 'jszip';
import sharp from 'sharp';
import {createDocx} from '../src/document.mjs';
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
