import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,symlink,link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import JSZip from 'jszip';
import {preflightTypography,applyTypography,readTypographyPreset,normalizeTypographyPatch} from '../src/document-typography.mjs';
import {inspectDocx,NS} from '../src/document.mjs';
import {inspectOle,wrapNative} from '../src/native.mjs';
import {readTypography} from '../src/typography-native.mjs';
import {auditDocx} from '../src/document-audit.mjs';
import {baseCompatibilityDocument,mutateDocument} from './helpers/document-compat-corpus.mjs';

const sourcePromise=baseCompatibilityDocument();
test('typography leaves prose sharing an equation run and its baseline untouched',async()=>{
 const input=await mutateDocument(await sourcePromise,doc=>{
  const object=doc.getElementsByTagNameNS(NS.o,'OLEObject')[0],run=object.parentNode.parentNode;
  const text=doc.createElementNS(NS.w,'w:t');text.textContent='Prose that must not move';run.appendChild(text);
 });
 const plan=await preflightTypography(input,{indices:[0],typography:{fullSize:22}});
 assert.equal(plan.targets[0].status,'skipped');assert.match(plan.targets[0].reason,/shares a text run/);
 assert.deepEqual((await applyTypography(input,plan)).buffer,input);
});
function suffix(ole){const s=inspectOle(ole),pref=s.parsed.records.find(n=>n.type===18);return s.data.subarray(pref.end);}
function companions(ole){const s=inspectOle(ole);return s.cfb.FileIndex.flatMap((entry,i)=>entry.type===2&&entry.name!=='Equation Native'?[[s.cfb.FullPaths[i],Buffer.from(entry.content)]]:[]);}

test('batch typography patches only selected preferences, preserving native structure, streams, numbers and references',async()=>{
 const bytes=await sourcePromise,original=Buffer.from(bytes),before=await inspectDocx(bytes);
 const plan=await preflightTypography(bytes,{indices:[2,0],typography:{fullSize:18,styles:{3:{style:3}}}});
 assert.deepEqual(plan.options.indices,[0,2]);assert.equal(plan.summary.ready,2);assert.equal(plan.summary.skipped,0);
 assert.deepEqual(bytes,original);assert.equal(plan.targets[0].preview.width>0,true);
 const {buffer,report}=await applyTypography(bytes,JSON.parse(JSON.stringify(plan))),after=await inspectDocx(buffer);
 assert.equal(report.ready,2);assert.equal(report.hostVerified,false);
 for(const index of [0,2]){
  assert.deepEqual(suffix(after.objects[index].ole),suffix(before.objects[index].ole));
  assert.deepEqual(companions(after.objects[index].ole),companions(before.objects[index].ole));
  assert.equal(readTypography(after.objects[index].ole).sizes[0].value,'18');
 }
 assert.deepEqual(after.objects[1].ole,before.objects[1].ole);
 assert.deepEqual(after.objects.map(o=>o.layout),before.objects.map(o=>o.layout));
 const auditBefore=await auditDocx(bytes),auditAfter=await auditDocx(buffer);
 assert.deepEqual(auditAfter.targets.map(t=>[t.bookmark,t.cachedText,t.referenceIds.length]),auditBefore.targets.map(t=>[t.bookmark,t.cachedText,t.referenceIds.length]));
 for(const part of Object.keys(before.zip.files).filter(p=>!before.zip.files[p].dir&&!['word/document.xml','word/_rels/document.xml.rels','[Content_Types].xml'].includes(p)))assert.deepEqual(await after.zip.file(part).async('nodebuffer'),await before.zip.file(part).async('nodebuffer'),part);
});

test('a new preflight after application is byte-idempotent and stale plans cannot be replayed',async()=>{
 const bytes=await sourcePromise,options={indices:[0,1,2],typography:{fullSize:16}},first=await preflightTypography(bytes,options),changed=(await applyTypography(bytes,first)).buffer;
 await assert.rejects(applyTypography(changed,first),/changed since/);
 const again=await preflightTypography(changed,options);assert.equal(again.summary.ready,0);assert.equal(again.summary.unchanged,3);
 const result=await applyTypography(changed,again);assert.deepEqual(result.buffer,changed);assert.equal(result.report.changed,false);
});

test('tampered plans and source changes fail before writing',async()=>{
 const bytes=await sourcePromise,plan=await preflightTypography(bytes,{indices:[0],typography:{fullSize:17}}),tampered=structuredClone(plan);tampered.options.indices=[1];
 await assert.rejects(applyTypography(bytes,tampered),/modified/);
 const changed=await mutateDocument(bytes,doc=>doc.documentElement.setAttribute('data-test','changed'));
 await assert.rejects(applyTypography(changed,plan),/changed since/);
});

test('unknown native preferences are skipped without rewriting their OLE or neighboring formulas',async()=>{
 const bytes=await sourcePromise,before=await inspectDocx(bytes),zip=await JSZip.loadAsync(bytes),ole=before.objects[1].ole,s=inspectOle(ole),pref=s.parsed.records.find(n=>n.type===18),native=Buffer.from(s.native);
 native[s.header.length+pref.start+1]=1;const unsupported=wrapNative(native,ole);zip.file(before.objects[1].path,unsupported);
 const input=await zip.generateAsync({type:'nodebuffer'}),plan=await preflightTypography(input,{typography:{fullSize:18}});
 assert.equal(plan.summary.ready,2);assert.equal(plan.targets[1].status,'skipped');assert.match(plan.targets[1].reason,/EQN_PREFS/);
 const result=await inspectDocx((await applyTypography(input,plan)).buffer);assert.deepEqual(result.objects[1].ole,unsupported);
});

test('shared source OLE and preview parts are cloned so an unselected occurrence stays unchanged',async()=>{
 const bytes=await sourcePromise,input=await mutateDocument(bytes,async(doc,zip)=>{
  const xml=await zip.file('word/_rels/document.xml.rels').async('string');zip.file('word/_rels/document.xml.rels',xml.replace('embeddings/oleObject2.bin','embeddings/oleObject1.bin').replace('media/image2.png','media/image1.png'));
 });
 const before=await inspectDocx(input);assert.equal(before.objects[0].path,before.objects[1].path);
 const plan=await preflightTypography(input,{indices:[0],typography:{fullSize:22}}),after=await inspectDocx((await applyTypography(input,plan)).buffer);
 assert.notEqual(after.objects[0].path,after.objects[1].path);assert.deepEqual(after.objects[1].ole,before.objects[1].ole);
 assert.deepEqual(await after.zip.file(before.objects[0].path).async('nodebuffer'),before.objects[0].ole);
});

test('document presets persist a declared patch for future equations without silently styling existing ones',async()=>{
 const bytes=await sourcePromise,preset={name:'Synthetic thesis style',scope:'new-equations',typography:{fullSize:15,sizes:{1:{unit:'%',value:60}},styles:{3:{font:'Times New Roman',style:2}}}};
 const plan=await preflightTypography(bytes,{indices:[],preset});assert.equal(plan.summary.selected,0);assert.equal(plan.presetChanged,true);
 const result=await applyTypography(bytes,plan),read=await readTypographyPreset(result.buffer);
 assert.equal(read.name,preset.name);assert.equal(read.scope,'new-equations');assert.deepEqual(read.typography,normalizeTypographyPatch(preset.typography));
 assert.deepEqual((await inspectDocx(result.buffer)).objects.map(o=>o.nativeSha256),(await inspectDocx(bytes)).objects.map(o=>o.nativeSha256));
 const again=await preflightTypography(result.buffer,{indices:[],preset});assert.equal(again.presetChanged,false);assert.deepEqual((await applyTypography(result.buffer,again)).buffer,result.buffer);
 const clear=await preflightTypography(result.buffer,{indices:[],preset:null});assert.equal(await readTypographyPreset((await applyTypography(result.buffer,clear)).buffer),null);
});

test('new-copy output refuses the original, existing files, hard links and symlinks',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'el-typography-'));
 try{
  const input=join(dir,'source.docx'),output=join(dir,'copy.docx'),bytes=await sourcePromise;await writeFile(input,bytes);
  const plan=await preflightTypography(input,{indices:[0],typography:{fullSize:13}});
  await assert.rejects(applyTypography(input,plan,{output:input}),/new copy/);
  await link(input,join(dir,'hard.docx'));await symlink(input,join(dir,'sym.docx'));
  await assert.rejects(applyTypography(input,plan,{output:join(dir,'hard.docx')}),/exist/i);await assert.rejects(applyTypography(input,plan,{output:join(dir,'sym.docx')}),/new copy|exist/i);
  const result=await applyTypography(input,plan,{output});assert.equal(result.report.path,output);assert.deepEqual(await readFile(input),bytes);assert.deepEqual(await readFile(output),result.buffer);
  await assert.rejects(applyTypography(input,plan,{output}),/exist/i);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('tracked equations are skipped and malformed batch scopes are rejected',async()=>{
 const bytes=await sourcePromise,input=await mutateDocument(bytes,doc=>{
  const object=doc.getElementsByTagNameNS(NS.o,'OLEObject')[0],run=object.parentNode.parentNode,ins=doc.createElementNS(NS.w,'w:ins');run.parentNode.replaceChild(ins,run);ins.appendChild(run);
 });
 const plan=await preflightTypography(input,{indices:[0],typography:{fullSize:20}});assert.equal(plan.targets[0].status,'skipped');assert.match(plan.targets[0].reason,/Tracked/);
 assert.deepEqual((await applyTypography(input,plan)).buffer,input);
 for(const indices of [[0,0],[-1],[3],['0']])await assert.rejects(preflightTypography(bytes,{indices,typography:{fullSize:12}}),/indices/);
 await assert.rejects(preflightTypography(bytes,{indices:[0],typography:{fullSize:0}}),/size range/);
 await assert.rejects(preflightTypography(bytes,{indices:[],preset:{scope:'all-equations',typography:{fullSize:12}}}),/future equations/);
});

test('protected and signed packages are rejected before any copy mutation',async()=>{
 const bytes=await sourcePromise,protectedZip=await JSZip.loadAsync(bytes);
 protectedZip.file('word/settings.xml',(await protectedZip.file('word/settings.xml').async('string')).replace('<w:updateFields','<w:documentProtection w:enforcement="1"/><w:updateFields'));
 await assert.rejects(preflightTypography(await protectedZip.generateAsync({type:'nodebuffer'}),{typography:{fullSize:18}}),/Protected/);
 const signed=await JSZip.loadAsync(bytes);signed.file('_xmlsignatures/sig1.xml','<Signature/>');
 await assert.rejects(preflightTypography(await signed.generateAsync({type:'nodebuffer'}),{typography:{fullSize:18}}),/Signed/);
});
