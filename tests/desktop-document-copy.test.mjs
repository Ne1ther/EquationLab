import test from 'node:test';
import assert from 'node:assert/strict';
import {link,mkdtemp,readFile,readdir,realpath,rm,stat,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDocx,inspectDocx} from '../src/document.mjs';
import {desktopRequest} from '../src/desktop-rpc.mjs';

for(const [action,options,expected] of [
 ['edit',{index:0,mode:'rebuild',latex:'x+2'},{latex:'x+2',mode:'inline'}],
 ['arrange',{indices:[0],layout:{mode:'display'}},{latex:'x+1',mode:'display'}],
]){
 test('Standalone '+action+' protects the source through hard links and symlinks',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'equationlab-document-copy-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const input=join(directory,'source.docx'),hard=join(directory,'hard-link.docx'),symbolic=join(directory,'symbolic-link.docx'),copy=join(directory,'copy.docx');
  const original=await createDocx([{latex:'x+1'}],{fragment:true});
  await writeFile(input,original);await link(input,hard);await symlink(input,symbolic);
  const writeCopy=output=>desktopRequest({action,payload:{input,output,...options}});
  for(const output of [input,hard,symbolic]){
   await assert.rejects(writeCopy(output),/另存为副本/);
   assert.deepEqual(await readFile(input),original);
   assert.deepEqual(await readFile(output),original);
  }
  await writeFile(copy,original,{mode:0o600});
  const written=await writeCopy(copy);
  const output=await readFile(copy),{objects:[object]}=await inspectDocx(output);
  assert.equal(written.path,await realpath(copy));assert.equal(written.bytes,output.length);
  assert.equal(object.latex,expected.latex);assert.equal(object.layout.mode,expected.mode);
  assert.equal((await stat(copy)).mode&0o777,0o600);
  assert.deepEqual(await readFile(input),original);
  assert.deepEqual((await readdir(directory)).sort(),['copy.docx','hard-link.docx','source.docx','symbolic-link.docx']);
 });
}
