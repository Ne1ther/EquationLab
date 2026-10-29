import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {desktopRequest} from '../src/desktop-rpc.mjs';
import {baseCompatibilityDocument} from './helpers/document-compat-corpus.mjs';
import {inspectDocx} from '../src/document.mjs';

test('document tools RPC preflights and writes exclusive copies, preserving the input and reference identity',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'el-tools-rpc-'));
 try{
  const input=join(directory,'input.docx'),original=await baseCompatibilityDocument();await writeFile(input,original);
  const audit=await desktopRequest({action:'documentAudit',payload:{input}});assert.equal(audit.summary.equations,3);
  const targets=await desktopRequest({action:'documentReferenceTargets',payload:{input,query:'1.1'}});assert.equal(targets.length,1);
  const types=await desktopRequest({action:'documentTypographyPreflight',payload:{input,options:{indices:[1],typography:{fullSize:16}}}});
  const styled=join(directory,'styled.docx');assert.equal((await desktopRequest({action:'documentTypographyApply',payload:{input,plan:types,output:styled}})).path,styled);
  const numbers=await desktopRequest({action:'documentNumberingPreflight',payload:{input,options:{scope:'all',numberFormat:'[#C1.#E1]'}}});
  const numbered=join(directory,'numbered.docx');const result=await desktopRequest({action:'documentNumberingApply',payload:{input,plan:numbers,output:numbered}});
  assert.equal(result.requiresWordFieldUpdate,true);
  const before=await inspectDocx(original),after=await inspectDocx(await readFile(numbered));assert.deepEqual(after.objects.map(o=>o.nativeSha256),before.objects.map(o=>o.nativeSha256));
  assert.deepEqual(await readFile(input),original);
  await assert.rejects(desktopRequest({action:'documentTypographyApply',payload:{input,plan:types,output:styled}}),/exist/i);
  const selected=await desktopRequest({action:'inspect',payload:{path:input,thumbnails:false,onlyIndices:[2]}});assert.deepEqual(selected.objects.map(o=>o.index),[2]);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('document tools reject a retired, mismatched or still-partial Word snapshot before examining content',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'el-tools-binding-')),input=join(directory,'input.docx'),fetchBefore=globalThis.fetch,ticket='a'.repeat(64);
 try{
  await writeFile(input,await baseCompatibilityDocument());
  const session={ticket,path:input,native:'not-used-for-readonly-audit',session:'1',document:{path:input,identity:'doc-a',snapshot:7}};
  globalThis.fetch=async()=>({ok:true,json:async()=>session});
  const payload={input,ticket,documentIdentity:'doc-a',documentSnapshot:7};
  assert.equal((await desktopRequest({action:'documentAudit',payload})).summary.equations,3);
  await assert.rejects(desktopRequest({action:'documentAudit',payload:{...payload,documentIdentity:'doc-b'}}),/快照/);
  session.document.scope='insertion';await assert.rejects(desktopRequest({action:'documentAudit',payload}),/快照/);
 }finally{globalThis.fetch=fetchBefore;await rm(directory,{recursive:true,force:true});}
});
