import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createDocx,inspectDocx,hash} from '../src/document.mjs';
import {makeNewOle} from '../src/new-formula.mjs';
import {editCharacters,inspectOle,characters} from '../src/native.mjs';

test('RPC recovers a structure-preserving draft into a new standalone source with no Word authority',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'el-recovery-rpc-')),previous=process.env.EQUATIONLAB_DATA_DIR;
 process.env.EQUATIONLAB_DATA_DIR=directory;
 try{
  const {desktopRequest}=await import('../src/desktop-rpc.mjs?draft-rpc');
  const path=join(directory,'original.docx'),bytes=await createDocx([{latex:'x+1'}]);await writeFile(path,bytes);
  const object=(await inspectDocx(bytes)).objects[0],parsed=inspectOle(object.ole),character=characters(parsed.parsed).find(item=>item.value==='x'||item.char==='x')??characters(parsed.parsed)[0];
  const replacements={[character.offset]:'y'},draft={latex:object.latex,mode:'characters',replacements,typography:{fullSize:14},ruler:[],layout:{mode:'numbered-right',numberFormat:'(#C1.#E1)',chapter:3,section:1},outcomeUnknown:true};
  const old='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',current='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
  await desktopRequest({action:'draftSave',payload:{clientId:old,draft,source:{path,index:0,nativeSha256:object.nativeSha256}}});
  assert.equal((await desktopRequest({action:'draftStatus',payload:{clientId:current}})).id,old);
  const restored=await desktopRequest({action:'draftRestore',payload:{id:old,clientId:current}});
  assert.equal(restored.draft.mode,'characters');assert.equal(restored.draft.outcomeUnknown,true);assert.notEqual(restored.source.path,path);
  assert.equal(restored.source.wordTicket,undefined);assert.equal(restored.source.documentIdentity,undefined);assert.equal(restored.source.objects.length,1);
  const originalNative=inspectOle(editCharacters(object.ole,replacements)).native;
  const recovered=await inspectDocx(await readFile(restored.source.path));
  assert.ok(inspectOle(editCharacters(recovered.objects[0].ole,replacements)).native.equals(originalNative));
  assert.equal(hash(await readFile(path)),hash(bytes),'original input is unchanged');
  const data=await readFile(join(directory,'drafts',old+'.json'),'utf8');assert.ok(!data.includes(path));assert.doesNotMatch(data,/wordTicket|documentIdentity/);
  await assert.rejects(desktopRequest({action:'draftSave',payload:{clientId:current,draft,source:{path,index:0,nativeSha256:'0'.repeat(64)}}}),/source changed/);
  // A new worker has no in-memory baseline and Word's old stage is gone.
  const restarted=(await import('../src/desktop-rpc.mjs?draft-rpc-restarted')).desktopRequest;
  const missing=join(directory,'expired-word-stage.docx');await writeFile(missing,bytes);await unlink(missing);
  await restarted({action:'draftSave',payload:{clientId:old,draft:{...draft,latex:'latest retained text'},source:{path:missing,index:0,nativeSha256:object.nativeSha256}}});
  const latest=await restarted({action:'draftRestore',payload:{id:old,clientId:current}});assert.equal(latest.draft.latex,'latest retained text');assert.equal(latest.draft.mode,'characters');
  assert.ok(makeNewOle('x').length>0);
 }finally{if(previous===undefined)delete process.env.EQUATIONLAB_DATA_DIR;else process.env.EQUATIONLAB_DATA_DIR=previous;await rm(directory,{recursive:true,force:true});}
});
