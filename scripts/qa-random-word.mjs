#!/usr/bin/env node
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {monitorEventLoopDelay,performance} from 'node:perf_hooks';
import {isMainModule} from '../src/cli-entry.mjs';
import {arrangeDocx,createDocx,editDocx,editDocxBatch,hash,inspectDocx,replaceDocxEquation} from '../src/document.mjs';
import {auditDocx,getReferenceTargets} from '../src/document-audit.mjs';
import {applyNumbering,preflightNumbering} from '../src/document-numbering-plan.mjs';
import {applyTypography,preflightTypography} from '../src/document-typography.mjs';
import {desktopRequest} from '../src/desktop-rpc.mjs';
import {createRenderScheduler} from '../src/render-scheduler.mjs';
import {inspectOle} from '../src/native.mjs';

const usage='node scripts/qa-random-word.mjs --document COPY.docx [--seed 20261120] [--rounds 4] [--output REPORT.json]';
const round=value=>Math.round(value*1000)/1000;
const shaObject=object=>object.nativeSha256??null;
const byteCounts=objects=>objects.map(shaObject);

function parseArguments(args){
 const options={rounds:4,seed:20261120};
 for(let index=0;index<args.length;index+=2){
  const option=args[index],value=args[index+1];
  if(!['--document','--seed','--rounds','--output'].includes(option)||!value)throw Error(usage);
  const key=option.slice(2);
  options[key]=key==='seed'||key==='rounds'?Number(value):resolve(value);
 }
 if(!options.document||!Number.isSafeInteger(options.seed)||options.seed<1||options.seed>0xffffffff||!Number.isSafeInteger(options.rounds)||options.rounds<1||options.rounds>12)throw Error(usage);
 return options;
}

function seededRandom(seed){
 let state=seed;
 return limit=>{
  state^=state<<13;
  state^=state>>>17;
  state^=state<<5;
  return Math.floor((state>>>0)/4294967296*limit);
 };
}

function shuffle(items,random){
 const shuffled=[...items];
 for(let i=shuffled.length-1;i>0;i--){
  const j=random(i+1);
  [shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];
 }
 return shuffled;
}

function byChapter(items,random){
 const groups=new Map();
 for(const item of items){
  const chapter=item.layout.chapter??null;
  if(!groups.has(chapter))groups.set(chapter,[]);
  groups.get(chapter).push(item);
 }
 const queues=shuffle([...groups.values()],random).map(items=>shuffle(items,random));
 const ordered=[];
 while(queues.some(rows=>rows.length))for(const rows of queues)if(rows.length)ordered.push(rows.pop());
 return ordered;
}

function referenceIdentity(doc){
 const targets=new Map(doc.targets.map(target=>[target.id,target]));
 return doc.references.map(ref=>{
  const target=targets.get(ref.targetId);
  return [ref.location.part,ref.type,ref.bookmark,ref.state,target?.bookmark??null,target?.equationIndices??null];
 });
}

function layoutIdentity(doc){
 return doc.objects.map(o=>[o.part,o.layout.mode,o.layout.bookmarkName,o.layout.numberText,o.layout.numberFormat]);
}

function differentIndices(before,after){
 assert.equal(after.length,before.length,'formula count changed');
 return before.flatMap((object,index)=>shaObject(after[index])!==shaObject(object)?[index]:[]);
}

function replacement(object,random){
 const candidates=object.characters.filter(character=>character.editable&&/^[a-zA-Z0-9]$/.test(character.char));
 if(!candidates.length)return null;
 const character=candidates[random(candidates.length)];
 const alphabet=/\d/.test(character.char)?'0123456789':/[A-Z]/.test(character.char)?'XYZAB':'xyzab';
 const choices=[...alphabet].filter(value=>value!==character.char);
 return {character,replacement:choices[random(choices.length)]};
}

function timingSummary(events){
 const groups=new Map();
 for(const entry of events){
  if(!groups.has(entry.action))groups.set(entry.action,[]);
  groups.get(entry.action).push(entry);
 }
 return Object.fromEntries([...groups].map(([action,entries])=>{
  const times=entries.filter(entry=>entry.status==='passed').map(entry=>entry.ms).sort((a,b)=>a-b);
  const middle=Math.floor(times.length/2);
  const durations=times.length?{medianMs:times.length%2?times[middle]:round((times[middle-1]+times[middle])/2),maxMs:times.at(-1)}:{};
  return [action,{passed:times.length,skipped:entries.filter(e=>e.status==='skipped').length,failed:entries.filter(e=>e.status==='failed').length,...durations}];
 }));
}

async function runScenario(options){
 const read=await readFile(options.document),inputHash=hash(read);
 const random=seededRandom(options.seed),scratch=await mkdtemp(join(tmpdir(),'equationlab-random-qa-'));
 const events=[],schedulerTimings=[],loop=monitorEventLoopDelay({resolution:10}),started=performance.now();
 const rpc=(action,payload,execution)=>desktopRequest({action,payload},execution);
 let fixture,baselineAudit,initialList,checks,thumbnails=0;
 const record=async(action,detail,work)=>{
  const start=performance.now();
  try{
   const result=await work();
   events.push({action,...detail,ms:round(performance.now()-start),status:result?.skip?'skipped':'passed',...result?.skip?{reason:result.skip}:{}});
   return result;
  }catch(error){
   events.push({action,...detail,ms:round(performance.now()-start),status:'failed',reason:String(error.message).split('\n')[0].slice(0,350)});
   return null;
  }
 };
 const validateEdited=async(bytes,expectedChanged)=>{
  const result=await inspectDocx(bytes);
  assert.deepEqual(differentIndices(fixture.objects,result.objects),expectedChanged);
  assert.deepEqual(layoutIdentity(result),layoutIdentity(fixture));
  assert.deepEqual(referenceIdentity(await auditDocx(bytes)),referenceIdentity(baselineAudit));
  return result;
 };
 loop.enable();
 try{
  fixture=await record('package-inspect',{},()=>inspectDocx(read));
  baselineAudit=await record('full-reference-audit',{},()=>rpc('documentAudit',{input:options.document}));
  if(!fixture?.objects.length||!baselineAudit)throw Error('Baseline document contains no auditable equations');
  initialList=await record('sidebar-initial-metadata',{},()=>rpc('inspect',{path:options.document,thumbnails:false}));
  if(!initialList)throw Error('Unable to index the input sidebar');
  assert.deepEqual(byteCounts(initialList.objects),byteCounts(fixture.objects));
  const objectOrder=byChapter(fixture.objects,random),selectable=objectOrder.filter(o=>!o.parseError&&!o.previewError&&o.shape&&o.image);
  assert(selectable.length,'No formula supports editable-preview round trips');
  const groups=Map.groupBy(objectOrder,o=>String(o.layout.chapter??'unknown'));
  const layoutGroups=Map.groupBy(objectOrder,o=>o.layout.mode);
  checks={equations:fixture.objects.length,chapters:Object.fromEntries([...groups].map(([key,rows])=>[key,rows.length])),layouts:Object.fromEntries([...layoutGroups].map(([key,rows])=>[key,rows.length])),referenceFields:baselineAudit.references.length,referenceableTargets:getReferenceTargets(baselineAudit).length};
  const eligible=selectable.filter(object=>object.mainDocument&&object.layout.mode.startsWith('numbered-'));
  const sourceRefs=referenceIdentity(baselineAudit);

  for(let cycle=0;cycle<options.rounds;cycle++){
   const object=selectable[cycle%selectable.length];
   const sample={cycle:cycle+1,index:object.index,chapter:object.layout.chapter??null};
   const jobs=[
    async()=>{
     const item=replacement(object,random);
     await record('character-copy',sample,async()=>{
      if(!item)return {skip:'No supported Latin letter or digit in the sampled formula'};
      const {character,replacement}=item,result=await editDocx(read,object.index,{[character.offset]:replacement});
      const after=(await validateEdited(result,[object.index])).objects[object.index];
      const beforeNative=inspectOle(object.ole).native,afterNative=inspectOle(after.ole).native;
      assert.equal(afterNative.length,beforeNative.length,'a character-only change resized Native data');
      const mutableBytes=new Set([28+character.offset,29+character.offset]);
      if(character.fontPositionOffset!==undefined)for(let i=0;i<character.fontPositionSize;i++)mutableBytes.add(28+character.fontPositionOffset+i);
      beforeNative.forEach((value,index)=>{if(!mutableBytes.has(index))assert.equal(afterNative[index],value,'unexpected Native byte changed');});
      assert.equal(after.characters.find(candidate=>candidate.offset===character.offset)?.char,replacement);
     });
    },
    async()=>{
     await record('formula-rebuild-copy',sample,async()=>{
      const exponent=random(7)+2,value=cycle+11,latex=`q_{${value}}^{${exponent}}+1`;
      const result=await replaceDocxEquation(read,object.index,latex);
      const after=(await validateEdited(result,[object.index])).objects[object.index];
      assert.equal(after.latex,latex);
     });
    },
    async()=>{
     const styleIndices=[...new Set([object.index,selectable[(cycle+1)%selectable.length].index])].sort((a,b)=>a-b);
     const options={indices:styleIndices,typography:{fullSize:15+cycle%3,spaces:{0:{unit:'%',value:105+cycle}}}};
     const plan=await record('typography-spacing-preflight',{cycle:cycle+1,indices:styleIndices},()=>preflightTypography(read,options));
     if(!plan)return;
     for(const target of plan.targets.filter(t=>t.status==='skipped'))events.push({action:'typography-row',index:target.index,status:'skipped',reason:target.reason});
     await record('typography-spacing-copy',{cycle:cycle+1,indices:styleIndices},async()=>{
      const expected=plan.targets.filter(t=>t.status==='ready').map(t=>t.index);
      if(!expected.length)return {skip:'Preflight has no changes'};
      const result=await applyTypography(read,plan),after=await validateEdited(result.buffer,expected);
      for(const target of plan.targets.filter(t=>t.status==='ready'))assert.equal(after.objects[target.index].nativeSha256,target.afterNativeSha256);
      assert.deepEqual(after.objects.map(o=>o.latex),fixture.objects.map(o=>o.latex));
     });
    },
    async()=>{
     const numbered=eligible[cycle%eligible.length],pattern=cycle%2?'[#C1-#E1]':'[#C1.#E1]';
     const scope=cycle===0?'all':'selected',options={scope,numberFormat:pattern,...scope==='selected'?{indices:numbered?[numbered.index]:[]}:{}};
     const detail={cycle:cycle+1,scope,indices:options.indices};
     const plan=await record('number-format-preflight',detail,async()=>{
      if(!numbered)return {skip:'No supported numbered main-story equation'};
      return preflightNumbering(read,options);
     });
     if(!plan?.targets)return;
     for(const target of plan.targets.filter(t=>t.status==='skipped'))events.push({action:'number-format-row',index:target.index,status:'skipped',reason:target.reason});
     await record('number-format-copy',detail,async()=>{
      if(!plan.summary.ready&&!plan.documentDefaultChanged)return {skip:'No numbering changes passed preflight'};
      const {buffer}=await applyNumbering(read,plan),after=await inspectDocx(buffer);
      assert.deepEqual(byteCounts(after.objects),byteCounts(fixture.objects));
      assert.deepEqual(after.objects.map(o=>o.layout.bookmarkName),fixture.objects.map(o=>o.layout.bookmarkName));
      assert.deepEqual(referenceIdentity(await auditDocx(buffer)),sourceRefs);
      for(const target of plan.targets.filter(t=>t.status==='ready'))assert.equal(after.objects[target.index].layout.numberFormat,pattern);
     });
    },
    async()=>{
     await record('sidebar-cached-random-rows',sample,async()=>{
      const indices=[...new Set([object.index,objectOrder[random(objectOrder.length)].index])];
      const selected=await rpc('inspect',{path:options.document,thumbnails:false,onlyIndices:indices});
      assert.deepEqual(selected.objects.map(o=>[o.index,o.nativeSha256]),indices.map(i=>[i,fixture.objects[i].nativeSha256]));
     });
     await record('number-reference-search',sample,async()=>{
      const query=eligible[cycle%eligible.length]?.layout.numberText??String(object.index+1);
      const results=getReferenceTargets(baselineAudit,{query});
      for(const target of results)assert.ok(baselineAudit.targets.includes(target));
      if(!checks.referenceableTargets)return {skip:'Saved thesis contains no numbered target with a resolvable equation bookmark; positive search is exercised in the generated fixture'};
     });
    }
   ];
   for(const job of shuffle(jobs,random))await job();
  }

  if(eligible.length)await record('thesis-single-layout-side',{index:eligible[0].index},async()=>{
   let bytes;
   try{bytes=await arrangeDocx(read,{indices:[eligible[0].index],layout:{mode:'numbered-left',numberFormat:'(#C1.#E1)'}});}
   catch(error){
    if(/段落包含|段落含|公式与正文|特殊包装|段落中有多个|编号计数链|编号域|公式编号范围/.test(error.message))return {skip:error.message};
    throw error;
   }
   const after=await inspectDocx(bytes);
   assert.deepEqual(byteCounts(after.objects),byteCounts(fixture.objects));
   assert.deepEqual(referenceIdentity(await auditDocx(bytes)),sourceRefs);
   assert.equal(after.objects[eligible[0].index].layout.mode,'numbered-left');
  });

  for(let i=0;i<objectOrder.length;i+=4){
   const indices=objectOrder.slice(i,i+4).map(o=>o.index);
   await record('sidebar-visible-thumbnail-batch',{indices},async()=>{
    const output=await rpc('inspect',{path:options.document,onlyIndices:indices});
    assert.deepEqual(output.objects.map(o=>o.index),indices);
    thumbnails+=output.objects.filter(o=>o.image?.startsWith('data:image/')).length;
   });
  }
  for(let cycle=0;cycle<options.rounds;cycle++){
   await record('editing-preview-during-full-preflight',{cycle:cycle+1},async()=>{
    const scheduler=createRenderScheduler();
    let resolveStart;
    const started=new Promise(resolve=>{resolveStart=resolve;});
    const slow=scheduler.enqueue(async execution=>{
     resolveStart();
     return preflightNumbering(read,{scope:'all',numberFormat:'[#C1-#E1]'},execution);
    });
    await started;
    const previews=Array.from({length:6},(_,index)=>scheduler.enqueue(()=>rpc('validate',{latex:`x^{${index+1}}`}),{priority:1,key:'latest-preview',checkpointPreview:true,onTiming:entry=>schedulerTimings.push({...entry,cycle:cycle+1})}));
    const [,images]=await Promise.all([slow,Promise.all(previews)]);
    assert.equal(images.filter(result=>result.superseded).length,5);
    assert.equal(images.at(-1).latex,'x^{6}');
   });
  }

  await record('new-native-fragment-and-reference-fixture',{},async()=>{
   const mode=random(2)?'numbered-right':'numbered-left',newLatex=`x_{${random(9)+1}}+1`;
   const gallery=await createDocx([{latex:newLatex,layout:{mode,chapter:2,numberFormat:'(#C1.#E1)'}},{latex:'\\sqrt{x^2+1}',layout:{mode:'inline'}}],{fragment:true,insertionBody:true,references:[{target:0}],numberingFamily:'mathtype'});
   const doc=await inspectDocx(gallery),audit=await auditDocx(gallery);
   const ref=getReferenceTargets(audit,{query:'2.1'});
   assert.equal(doc.objects.length,2);
   assert.equal(doc.objects[0].latex,newLatex);
   assert.equal(doc.objects[0].layout.mode,mode);
   assert.equal(ref.length,1);
   assert.equal(audit.references.filter(ref=>ref.state==='resolved').length,1);
   const moved=await arrangeDocx(gallery,{indices:[0],layout:{mode:mode==='numbered-right'?'numbered-left':'numbered-right',numberFormat:'(#C1.#E1)'}});
   const after=await inspectDocx(moved);
   assert.deepEqual(byteCounts(after.objects),byteCounts(doc.objects));
   assert.deepEqual(referenceIdentity(await auditDocx(moved)),referenceIdentity(audit));
   assert.notEqual(after.objects[0].layout.mode,mode);
  });

  for(const [format,prefix]of [['pdf','%PDF-'],['svg','<svg'],['png','89504e470d0a1a0a']]){
   await record('graphic-export',{format},async()=>{
    const output=join(scratch,'formula.'+format);
    await rpc('exportGraphic',{format,output,latex:`z_{${random(9)+1}}^2+1`});
    const bytes=await readFile(output);
    assert((format==='png'?bytes.subarray(0,8).toString('hex'):bytes.toString('utf8')).startsWith(prefix));
   });
  }

  const batchRows=selectable.slice(0,4);
  if(batchRows.length===4){
   const [first,second,third,fourth]=batchRows,characterEdit=replacement(second,random);
   const edits=[
    {index:first.index,expectedNativeSha256:first.nativeSha256,latex:`q_{${random(9)+1}}^2+7`},
    {index:second.index,expectedNativeSha256:second.nativeSha256,...characterEdit?{replacements:{[characterEdit.character.offset]:characterEdit.replacement}}:{latex:'x^3+7'}},
    {index:third.index,expectedNativeSha256:third.nativeSha256,typography:{fullSize:Number(third.typography?.sizes?.[0]?.value)===17?18:17,spaces:{0:{unit:'%',value:125}}}},
    {index:fourth.index,expectedNativeSha256:fourth.nativeSha256,ruler:[{position:512+random(500),type:0}]}
   ];
   const indices=edits.map(edit=>edit.index).sort((a,b)=>a-b);
   const compare={indices,chapters:batchRows.map(object=>object.layout.chapter??null)};
   const checkBatch=async bytes=>{
    const after=await validateEdited(bytes,indices);
    assert.equal(Number(after.objects[third.index].typography?.sizes?.[0]?.value),edits[2].typography.fullSize);
    assert.deepEqual(after.objects[fourth.index].ruler,edits[3].ruler);
    return byteCounts(after.objects);
   };
   const sequential=await record('ai-sequential-equivalent-copy',compare,async()=>{
    let bytes=read;
    for(const edit of edits){
     const {index,latex,replacements={},typography,ruler}=edit;
     bytes=latex===undefined
      ?await editDocx(bytes,index,replacements,{typography,ruler})
      :await replaceDocxEquation(bytes,index,latex,{typography,ruler});
    }
    return checkBatch(bytes);
   });
   await record('ai-batch-copy',compare,async()=>{
    const result=await editDocxBatch(read,edits);
    assert.equal(result.results.filter(row=>row.status==='updated').length,edits.length);
    const batchHashes=await checkBatch(result.bytes);
    if(sequential)assert.deepEqual(batchHashes,sequential);
   });
   await record('ai-batch-stale-hash-rejected',compare,async()=>{
    const stale=edits.map((edit,index)=>index===edits.length-1?{...edit,expectedNativeSha256:'0'.repeat(64)}:edit);
    await assert.rejects(editDocxBatch(read,stale),/expected Native hash/);
    assert.equal(hash(read),inputHash);
   });
  }else events.push({action:'ai-batch-copy',status:'skipped',reason:'The mixed batch comparison requires four formulas with supported editable previews'});
 }finally{
  loop.disable();
  await rm(scratch,{recursive:true,force:true});
 }
 const fileUnchanged=hash(await readFile(options.document))===inputHash;
 const successfulPreviews=schedulerTimings.filter(t=>t.outcome==='fulfilled');
 return {
  schema:'equationlab.seeded-document-qa.v1',seed:options.seed,rounds:options.rounds,inputSha256:inputHash,inputUnchanged:fileUnchanged,
  runtime:{node:process.version,platform:process.platform,arch:process.arch},
  timingScope:'Timed operations include each stated postcondition check; backend only. Scheduler preview completion is measured separately from the contended full-document job.',
  checks:{...checks,thumbnailRowsWithImages:thumbnails},
  actions:timingSummary(events),events,
  responsiveness:{completedPreviewSamples:successfulPreviews.length,previewQueuedMaxMs:round(Math.max(0,...successfulPreviews.map(t=>t.queuedMs))),previewElapsedMaxMs:round(Math.max(0,...successfulPreviews.map(t=>t.elapsedMs))),previewSuperseded:schedulerTimings.filter(t=>t.outcome==='superseded').length,eventLoopDelayP95Ms:round(loop.percentile(95)/1e6),eventLoopDelayMaxMs:round(loop.max/1e6)},
  skippedWorkflows:['Word OLE insertion at an open document cursor','Word field recalculation and OLE persistence','Window, scroll, and keyboard frame timings'],
  elapsedMs:round(performance.now()-started),hostVerified:false
 };
}

if(await isMainModule(import.meta.url)){
 try{
  const options=parseArguments(process.argv.slice(2)),report=await runScenario(options);
  const output=JSON.stringify(report,null,2)+'\n';
  if(options.output)await writeFile(options.output,output,{flag:'wx'});
  else process.stdout.write(output);
  if(!report.inputUnchanged||report.events.some(event=>event.status==='failed'))process.exitCode=1;
 }catch(error){
  process.stderr.write(error.message+'\n');
  process.exitCode=1;
 }
}
