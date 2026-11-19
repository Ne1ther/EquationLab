import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createDocx,editDocxBatch,hash,inspectDocx} from '../src/document.mjs';
import {auditDocx} from '../src/document-audit.mjs';

const source=await createDocx([
  {latex:'x^3',layout:{mode:'numbered-right',chapter:2,numberFormat:'(#C1-#E1)'}},
  {latex:'y+2',layout:{mode:'numbered-left',chapter:2,numberFormat:'(#C1-#E1)'}},
  {latex:'z^5'}
],{fragment:true,references:[{target:0},{target:1}]});
const {objects}=await inspectDocx(source);
const digit=objects[0].characters.find(item=>item.char==='3');
const edit=(index,patch)=>({index,expectedNativeSha256:objects[index].nativeSha256,...patch});

test('A document batch replaces separate formula regions and preserves the existing numbers, references and untouched Native',async()=>{
  const {bytes,results}=await editDocxBatch(source,[
    edit(1,{latex:'y+4',ruler:[{type:0,position:128}]}),
    edit(0,{replacements:{[digit.offset]:'4'}})
  ]);
  const target=(await inspectDocx(bytes)).objects;
  assert.deepEqual(target.map(row=>row.latex),['x^{4}','y+4','z^{5}']);
  assert.deepEqual(target[1].ruler,[{type:0,position:128}]);
  assert.deepEqual(target.map(row=>row.layout),objects.map(row=>row.layout));
  assert.equal(target[2].nativeSha256,objects[2].nativeSha256);
  assert.equal(new Set(target.map(row=>row.path)).size,3);
  for(const row of results)assert.equal(row.afterNativeSha256,target[row.index].nativeSha256);
  const references=async bytes=>(await auditDocx(bytes)).references.map(row=>[row.bookmark,row.state,row.cachedText]);
  assert.deepEqual(await references(bytes),await references(source));
});

test('Stale, duplicate and ambiguous edits are rejected; a verified no-op preserves the exact package',async()=>{
  await assert.rejects(editDocxBatch(source,[edit(0,{latex:'a'}),{...edit(1,{latex:'b'}),expectedNativeSha256:'0'.repeat(64)}]),/expected Native hash/);
  await assert.rejects(editDocxBatch(source,[edit(0,{latex:'a'}),edit(0,{latex:'b'})]),/distinct/);
  await assert.rejects(editDocxBatch(source,[edit(0,{latex:'a',replacements:{[digit.offset]:'4'}})]),/either/);
  assert.deepEqual((await editDocxBatch(source,[edit(0,{latex:objects[0].latex})])).bytes,source);
});

test('The public batch CLI produces only a new copy and never publishes a failed batch',async()=>{
  const root=await mkdtemp(join(tmpdir(),'equationlab-edit-batch-'));
  try{
    const cli=fileURLToPath(new URL('../src/cli.mjs',import.meta.url)),run=promisify(execFile);
    const input=join(root,'original.docx'),manifest=join(root,'edits.json'),output=join(root,'out.docx');
    await writeFile(input,source);
    await writeFile(manifest,JSON.stringify([edit(0,{latex:'a'}),edit(1,{latex:'\\notExistingTemplate{b}'})]));
    const apply=target=>run(process.execPath,[cli,'edit-batch',input,manifest,target]);
    await assert.rejects(apply(output));
    await assert.rejects(access(output),error=>error.code==='ENOENT');
    const edits=[edit(0,{latex:'a'})];
    await writeFile(manifest,JSON.stringify({sourceSha256:'0'.repeat(64),edits}));
    await assert.rejects(apply(output),/Source document changed since inspection/);
    await assert.rejects(access(output),error=>error.code==='ENOENT');
    await writeFile(manifest,JSON.stringify({sourceSha256:hash(source),edits}));
    await apply(output);
    const written=await readFile(output);
    await assert.rejects(apply(output),/EEXIST/);
    await assert.rejects(apply(input),/EEXIST/);
    assert.deepEqual(await readFile(output),written);
    assert.deepEqual(await readFile(input),source);
  }finally{await rm(root,{recursive:true,force:true});}
});
