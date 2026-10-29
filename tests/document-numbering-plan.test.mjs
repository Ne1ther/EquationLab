import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,symlink,link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import JSZip from 'jszip';
import {createDocx,inspectDocx,hash} from '../src/document.mjs';
import {preflightNumbering,applyNumbering} from '../src/document-numbering-plan.mjs';

async function fixture(){
 return createDocx(['x','y','z'].map(latex=>({latex,layout:{mode:'numbered-right',numberFormat:'(#C1.#E1)',chapter:3}})),{references:[{target:0,prefix:'See '}]});
}
async function mutate(input,change){const zip=await JSZip.loadAsync(input);zip.file('word/document.xml',change(await zip.file('word/document.xml').async('string')));return zip.generateAsync({type:'nodebuffer'});}
const numbers=async bytes=>(await inspectDocx(bytes)).objects.map(o=>o.layout.numberText);

test('current/selected/all scopes preserve original native objects, paragraph layout and reference anchors',async()=>{
 const input=await fixture(),original=await inspectDocx(input);
 const plan=await preflightNumbering(input,{scope:'selected',indices:[2,0],numberFormat:'[#C1-#E1]'});
 assert.deepEqual(plan.options.indices,[0,2]);assert.equal(plan.summary.ready,2);assert.equal(plan.documentDefaultChanged,false);
 const {buffer,report}=await applyNumbering(input,JSON.parse(JSON.stringify(plan))),result=await inspectDocx(buffer);
 assert.deepEqual(await numbers(buffer),['[3-1]','(3.2)','[3-3]']);assert.equal(result.numberFormat,'(#C1.#E1)');
 assert.deepEqual(result.objects.map(o=>[o.nativeSha256,o.layout.bookmarkName]),original.objects.map(o=>[o.nativeSha256,o.layout.bookmarkName]));
 for(let i=0;i<original.objects.length;i++)assert.deepEqual(result.objects[i].ole,original.objects[i].ole);
 const before=await original.zip.file('word/document.xml').async('string'),after=await result.zip.file('word/document.xml').async('string');
 assert.deepEqual(after.match(/<w:pPr>[\s\S]*?<\/w:pPr>/g),before.match(/<w:pPr>[\s\S]*?<\/w:pPr>/g));
 assert.ok(after.includes('REF '+original.objects[0].layout.bookmarkName));assert.equal(report.references.markedForUpdate,1);assert.equal(report.requiresWordFieldUpdate,true);assert.equal(report.hostVerified,false);
 for(const name of Object.keys(original.zip.files).filter(n=>!original.zip.files[n].dir&&n!=='word/document.xml'))assert.deepEqual(await result.zip.file(name).async('nodebuffer'),await original.zip.file(name).async('nodebuffer'),name);
 const all=await applyNumbering(input,await preflightNumbering(input,{scope:'all',numberFormat:'#E1'}));assert.deepEqual(await numbers(all.buffer),['1','2','3']);
 const current=await applyNumbering(input,await preflightNumbering(input,{scope:'current',index:1,numberFormat:'(#EI)'}));assert.deepEqual(await numbers(current.buffer),['(3.1)','(II)','(3.3)']);
});

test('future-only changes the document default while existing formulas and references remain byte-identical',async()=>{
 const input=await fixture(),before=await JSZip.loadAsync(input),plan=await preflightNumbering(input,{scope:'future',numberFormat:'[#E1]'});
 assert.equal(plan.summary.selected,0);assert.equal(plan.documentDefaultChanged,true);assert.equal(plan.requiresWordFieldUpdate,false);
 const {buffer}=await applyNumbering(input,plan),after=await JSZip.loadAsync(buffer);
 for(const name of Object.keys(before.files).filter(n=>!before.files[n].dir&&n!=='word/settings.xml'))assert.deepEqual(await after.file(name).async('nodebuffer'),await before.file(name).async('nodebuffer'),name);
 assert.equal((await inspectDocx(buffer)).numberFormat,'[#E1]');assert.deepEqual(await numbers(buffer),['(3.1)','(3.2)','(3.3)']);
 const same=await preflightNumbering(buffer,{scope:'future',numberFormat:'[#E1]'});assert.equal(same.documentDefaultChanged,false);assert.deepEqual((await applyNumbering(buffer,same)).buffer,buffer);
});

test('explicit reset and repeat switches survive format changes, including Word complex fields',async()=>{
 let input=await mutate(await fixture(),xml=>xml.replace('SEQ EquationLab \\n \\* ARABIC','SEQ EquationLab \\r 7 \\* ARABIC').replace(/(SEQ EquationLab \\r 7[^>]*>\s*<w:r><w:t[^>]*>)1(<\/w:t>)/,'$17$2'));
 // Set the actual displayed counter explicitly; the formatter changes format,
 // not the host's live numbering sequence or its delayed cache refresh.
 input=await mutate(input,xml=>xml.replace(/(<w:fldSimple w:instr="SEQ EquationLab \\r 7[^>]*>)([\s\S]*?)(<\/w:fldSimple>)/,(_all,begin,body,end)=>begin+body.replace('>1<','>7<')+end));
 const reset=await applyNumbering(input,await preflightNumbering(input,{scope:'current',index:0,numberFormat:'[#EI]'}));
 let xml=await (await JSZip.loadAsync(reset.buffer)).file('word/document.xml').async('string');assert.match(xml,/SEQ EquationLab \\r 7 \\\* ROMAN/);assert.equal((await numbers(reset.buffer))[0],'[VII]');
 const repeated=await mutate(input,xml=>xml.replace('SEQ EquationLab \\r 7','SEQ EquationLab \\c').replace(/<w:fldSimple w:instr="(SEQ EquationLab[^"]*)" w:dirty="true">([\s\S]*?)<\/w:fldSimple>/g,(_all,code,body)=>`<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>${code}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${body}<w:r><w:fldChar w:fldCharType="end"/></w:r>`));
 const plan=await preflightNumbering(repeated,{scope:'current',index:0,numberFormat:'(#EA)'});assert.equal(plan.summary.ready,1,JSON.stringify(plan.targets));
 const output=await applyNumbering(repeated,plan);xml=await (await JSZip.loadAsync(output.buffer)).file('word/document.xml').async('string');assert.match(xml,/SEQ EquationLab \\c \\\* ALPHABETIC/);assert.equal((await numbers(output.buffer))[0],'(G)');
});

test('unsafe/unknown targets are explicit skips; changing another target does not rewrite them',async()=>{
 for(const [reason,change]of [
  ['locked',xml=>xml.replace('w:instr="SEQ EquationLab \\n','w:fldLock="true" w:instr="SEQ EquationLab \\n')],
  ['Custom',xml=>xml.replace(/(<w:bookmarkStart[^>]*\/>)/,'<w:bookmarkStart w:id="910" w:name="_RefKeep"/>$1<w:bookmarkEnd w:id="910"/>')],
  ['prose',xml=>xml.replace('<w:object','<w:t>Keep this prose</w:t><w:object')],
  ['legacy',xml=>xml.replace('<w:pStyle w:val="EquationLab"','<w:pStyle w:val="MathType"')]
 ]){
  const input=await mutate(await fixture(),change),plan=await preflightNumbering(input,{scope:'all',numberFormat:'[#E1]'});
  assert.equal(plan.targets[0].status,'skipped',reason);assert.match(plan.targets[0].reason,new RegExp(reason,'i'));
  const out=await applyNumbering(input,plan);assert.equal((await numbers(out.buffer))[0],(await numbers(input))[0]);
 }
 const unnumbered=await createDocx([{latex:'x'}]);assert.equal((await preflightNumbering(unnumbered,{scope:'current',index:0,numberFormat:'(#E1)'})).targets[0].status,'skipped');
});

test('plans are bound to exact source bytes and recomputed, with exclusive new-file output',async()=>{
 const input=await fixture(),plan=await preflightNumbering(input,{scope:'current',index:0,numberFormat:'[#E1]',updateFuture:true});
 await assert.rejects(applyNumbering(await fixture(),plan),/changed since/);
 const altered=structuredClone(plan);altered.targets[0].afterNumber='forged';await assert.rejects(applyNumbering(input,altered),/modified/);
 const forged=structuredClone(plan);forged.targets[0].status='skipped';const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;const {planSha256,...body}=forged;forged.planSha256=hash(JSON.stringify(canonical(body)));await assert.rejects(applyNumbering(input,forged),/no longer matches/);
 const directory=await mkdtemp(join(tmpdir(),'equationlab-numbering-'));
 try{
  const source=join(directory,'source.docx'),output=join(directory,'copy.docx');await writeFile(source,input);
  await assert.rejects(applyNumbering(source,plan,{output:source}),/new copy/);
  await symlink(source,join(directory,'sym.docx'));await assert.rejects(applyNumbering(source,plan,{output:join(directory,'sym.docx')}),/new copy/);
  await link(source,join(directory,'hard.docx'));await assert.rejects(applyNumbering(source,plan,{output:join(directory,'hard.docx')}),/EEXIST/);
  const result=await applyNumbering(source,plan,{output});assert.equal(result.report.path,output);assert.deepEqual(await readFile(source),input);
  assert.equal((await inspectDocx(result.buffer)).numberFormat,'[#E1]');await assert.rejects(applyNumbering(source,plan,{output}),/EEXIST/);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('invalid scopes, duplicate selections, unknown switches and missing chapters never become write plans',async()=>{
 const input=await fixture();
 for(const options of [{scope:'selected',indices:[0,0],numberFormat:'(#E1)'},{scope:'current',index:4,numberFormat:'(#E1)'},{scope:'future',index:0,numberFormat:'(#E1)'},{scope:'all',numberFormat:'(#E1)',extra:true}])await assert.rejects(preflightNumbering(input,options));
 const unsupported=await mutate(input,xml=>xml.replace('SEQ EquationLab \\n','SEQ EquationLab \\s 1'));
 assert.equal((await preflightNumbering(unsupported,{scope:'current',index:0,numberFormat:'[#E1]'})).targets[0].status,'skipped');
 const noChapter=await createDocx([{latex:'x',layout:{mode:'numbered-right'}}],{fragment:true,initializeContext:false});
 assert.equal((await preflightNumbering(noChapter,{scope:'current',index:0,numberFormat:'(#C1.#E1)'})).targets[0].status,'skipped');
});

test('locked references stay untouched and duplicate target bookmarks cannot be reformatted',async()=>{
 const input=await fixture();
 const locked=await mutate(input,xml=>xml.replace(/(<w:fldSimple w:instr="REF [^"]+") w:dirty="true"/,'$1 w:fldLock="true" w:dirty="false"'));
 const result=await applyNumbering(locked,await preflightNumbering(locked,{scope:'current',index:0,numberFormat:'[#E1]'}));
 assert.deepEqual(result.report.references,{markedForUpdate:0,locked:1});
 assert.match(await (await JSZip.loadAsync(result.buffer)).file('word/document.xml').async('string'),/w:instr="REF [^"]+" w:fldLock="true" w:dirty="false"/);
 const {objects}=await inspectDocx(input),duplicate=await mutate(input,xml=>xml.replace(objects[1].layout.bookmarkName,objects[0].layout.bookmarkName));
 const plan=await preflightNumbering(duplicate,{scope:'all',numberFormat:'[#E1]'});assert.equal(plan.targets[0].status,'skipped');assert.equal(plan.targets[1].status,'skipped');assert.match(plan.targets[0].reason,/Duplicate/);assert.equal(plan.targets[2].status,'ready');
});

test('document-wide field update setting is not enabled and protected settings reject a future-default change',async()=>{
 const source=await fixture(),zip=await JSZip.loadAsync(source);
 zip.file('word/settings.xml',(await zip.file('word/settings.xml').async('string')).replace(/<w:updateFields[^>]*\/>/,''));
 const input=await zip.generateAsync({type:'nodebuffer'});
 const result=await applyNumbering(input,await preflightNumbering(input,{scope:'current',index:0,numberFormat:'[#E1]',updateFuture:true}));
 assert.doesNotMatch(await (await JSZip.loadAsync(result.buffer)).file('word/settings.xml').async('string'),/updateFields/);
 zip.file('word/settings.xml',(await zip.file('word/settings.xml').async('string')).replace('</w:settings>','<w:documentProtection w:edit="readOnly" w:enforcement="true"/></w:settings>'));
 await assert.rejects(preflightNumbering(await zip.generateAsync({type:'nodebuffer'}),{scope:'future',numberFormat:'[#E1]'}),/Protected/);
});

test('signed packages reject both future-default and existing-number modifications',async()=>{
 const zip=await JSZip.loadAsync(await fixture());zip.file('_xmlsignatures/sig1.xml','<Signature/>');const input=await zip.generateAsync({type:'nodebuffer'});
 for(const options of [{scope:'future',numberFormat:'[#E1]'},{scope:'current',index:0,numberFormat:'[#E1]'}])await assert.rejects(preflightNumbering(input,options),/Signed documents/);
});
