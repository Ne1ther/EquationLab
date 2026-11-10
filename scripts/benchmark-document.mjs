#!/usr/bin/env node
// Offline, bounded backend benchmark. Documents and reports stay in the chosen
// local output directory; report JSON contains counts/hashes, never body text.
// Example: node scripts/benchmark-document.mjs --output .local/document-benchmark
// Add --document /path/to/an/authorized-copy.docx to include a private local copy.
import {readFile,writeFile,mkdir,copyFile,stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {isMainModule} from '../src/cli-entry.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),execFileAsync=promisify(execFile);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const round=n=>Math.round(n*1000)/1000;
const sourceFiles=['scripts/benchmark-document.mjs','src/render-scheduler.mjs','src/desktop-rpc.mjs','src/document.mjs','src/document-audit.mjs','src/document-typography.mjs','src/document-numbering-plan.mjs','src/font-renderer.mjs'];
const memory=()=>Object.fromEntries(Object.entries(process.memoryUsage()).map(([key,value])=>[key,value]));
const fail=error=>({name:['Error','TypeError','RangeError','SyntaxError'].includes(error?.name)?error.name:'Error',.../^[A-Z_0-9]{1,40}$/.test(error?.code??'')?{code:error.code}:{}});
async function sourceIdentity(){return Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,sha(await readFile(join(root,file)))])));}

export function summarizeTimings(entries){
 const completed=entries.filter(entry=>entry.outcome==='fulfilled'),superseded=entries.filter(entry=>entry.outcome==='superseded').length;
 const distribution=field=>{const values=completed.map(entry=>entry[field]).sort((a,b)=>a-b);return values.length?{samples:values.length,min:round(values[0]),median:round(values[Math.ceil(values.length*.5)-1]),p95:round(values[Math.ceil(values.length*.95)-1]),max:round(values.at(-1))}:{samples:0};};
 return {requested:entries.length,completed:completed.length,superseded,rejected:entries.filter(entry=>entry.outcome==='rejected').length,queuedMs:distribution('queuedMs'),executionMs:distribution('executionMs'),elapsedMs:distribution('elapsedMs')};
}

async function benchmarkCase(config){
 const [{inspectDocx},{desktopRequest},{createRenderScheduler},{warmNativeRenderer,nativeRendererStats}]=await Promise.all([
  import('../src/document.mjs'),import('../src/desktop-rpc.mjs'),import('../src/render-scheduler.mjs'),import('../src/font-renderer.mjs')
 ]);
 const stages=[],timings=[],scheduler=createRenderScheduler(),identity=await sourceIdentity();
 const stage=async(name,work)=>{
  const before=memory(),cpu=process.cpuUsage(),utilization=performance.eventLoopUtilization(),start=performance.now();
  const counts=await work(),elapsedMs=performance.now()-start,used=process.cpuUsage(cpu),after=memory(),loop=performance.eventLoopUtilization(utilization);
  stages.push({name,elapsedMs:round(elapsedMs),cpuMs:round((used.user+used.system)/1000),eventLoopUtilization:round(loop.utilization),memoryBefore:before,memoryAfter:after,counts:counts??{}});
  return counts;
 };
 const queued=(kind,run,{priority=0,key=null,checkpointPreview=false}={})=>scheduler.enqueue(run,{priority,key,checkpointPreview,onTiming:value=>timings.push({kind,...Object.fromEntries(Object.entries(value).map(([key,value])=>[key,typeof value==='number'?round(value):value]))})});
 const request=(action,payload,context)=>desktopRequest({action,payload},context);
 let bytes,objects;
 await stage('read-local-file',async()=>{bytes=await readFile(config.input);return {bytes:bytes.length};});
 const inputSha256=sha(bytes);
 await stage('parse-fresh',async()=>{({objects}=await inspectDocx(bytes));return {equations:objects.length,parseErrors:objects.filter(o=>o.parseError).length,previewErrors:objects.filter(o=>o.previewError).length,uniqueNative: new Set(objects.map(o=>o.nativeSha256).filter(Boolean)).size};});
 const indices=objects.map((_,index)=>index);
 // Keep only the formula count here. Requests below exercise the production
 // snapshot cache independently of the fresh parse above.
 objects=null;bytes=null;
 await stage('renderer-warmup',async()=>{await warmNativeRenderer();return nativeRendererStats();});
 await stage('initial-list-no-thumbnails',async()=>{const result=await queued('initial-list',()=>request('inspect',{path:config.input,thumbnails:false}));return {equations:result.objects.length,images:result.objects.filter(o=>o.image).length};});
 await stage('cached-list-no-thumbnails',async()=>{const result=await queued('cached-list',()=>request('inspect',{path:config.input,thumbnails:false}));return {equations:result.objects.length};});
 const typography=context=>request('documentTypographyPreflight',{input:config.input,options:{indices,typography:{fullSize:14}}},context);
 const numbering=context=>request('documentNumberingPreflight',{input:config.input,options:{scope:'all',numberFormat:'(#C1.#E1)'}},context);
 if(config.scenario!=='sidebar'){
 await stage('readonly-audit',async()=>{const result=await queued('audit',()=>request('documentAudit',{input:config.input}));return result.summary;});
 await stage('readonly-typography-preflight',async()=>{const result=await queued('typography-preflight',typography);return result.summary;});
 await stage('readonly-numbering-preflight',async()=>{const result=await queued('numbering-preflight',numbering);return result.summary;});
 }
 const firstBatch=indices.slice(0,4),thumbnail=batch=>request('inspect',{path:config.input,onlyIndices:batch});
 if(config.scenario!=='sidebar'){
 for(const [prefix,preflight]of [['contended',typography],['numbering-contended',numbering]])await stage(prefix+'-readonly-preview-thumbnails',async()=>{
  const rounds=config.contentionRounds??5;
  for(let roundIndex=0;roundIndex<rounds;roundIndex++){
   let started;const began=new Promise(resolve=>started=resolve);
   const active=queued(prefix+'-preflight',async context=>{started();return preflight(context);});
   await began;
   const pending=[queued(prefix+'-thumbnails',()=>thumbnail(firstBatch),{priority:2})];
   for(let index=0;index<8;index++)pending.push(queued(prefix+'-preview',()=>request('validate',{latex:`x^{${index+1}}+1`}),{priority:1,key:'benchmark-preview',checkpointPreview:true}));
   await Promise.all([active,...pending]);
  }
  return {preflights:rounds,thumbnailRequests:rounds,previewRequests:8*rounds};
 });
 }else await stage('prime-first-thumbnail-batch',async()=>{const result=await queued('prime-thumbnails',()=>thumbnail(firstBatch),{priority:2});return {images:result.objects.filter(o=>o.image).length};});
 await stage('thumbnails-all-in-batches-of-four',async()=>{
  let images=0,requests=0;
  for(let index=0;index<indices.length;index+=4){const result=await queued('thumbnail-batch',()=>thumbnail(indices.slice(index,index+4)),{priority:2});images+=result.objects.filter(o=>o.image).length;requests++;}
  return {requests,equations:indices.length,images};
 });
 if(config.scenario!=='sidebar')await stage('uncontended-preview-series',async()=>{for(let index=0;index<8;index++)await queued('uncontended-preview',()=>request('validate',{latex:`y^{${index+1}}+2`}),{priority:1});return {previewRequests:8};});
 const finalSha256=sha(await readFile(config.input)),groups=Object.fromEntries([...new Set(timings.map(t=>t.kind))].map(kind=>[kind,summarizeTimings(timings.filter(t=>t.kind===kind))]));
 return {schema:'equationlab.document-benchmark-case.v1',label:config.label,scenario:config.scenario??'all',node:process.version,platform:process.platform,arch:process.arch,sourceHashes:identity,sourceHashesAfter:await sourceIdentity(),input:{bytes:(await stat(config.input)).size,sha256:inputSha256,sha256After:finalSha256,unchanged:inputSha256===finalSha256},stages,timings,groups,renderer:nativeRendererStats(),nodeMemory:{final:memory(),maxRssBytes:process.resourceUsage().maxRSS*1024,boundary:'Node process only; excludes native font helper. The parent separately samples the worker process tree.'},hostVerified:false};
}

async function processTreeRss(pid,orchestratorPid){
 const {stdout}=await execFileAsync('ps',['-axo','pid=,ppid=,rss='],{maxBuffer:1_000_000});
 const rows=stdout.trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number)).filter(row=>row.length===3&&row.every(Number.isFinite));
 const subtree=rootPid=>{const pids=new Set([rootPid]);let changed=true;while(changed){changed=false;for(const [child,parent]of rows)if(pids.has(parent)&&!pids.has(child)){pids.add(child);changed=true;}}const selected=rows.filter(([child])=>pids.has(child));return {bytes:selected.reduce((sum,row)=>sum+row[2]*1024,0),processes:selected.length};};
 return {...subtree(pid),overall:subtree(orchestratorPid)};
}

async function runChild(config,output){
 const path=join(output,config.label+'.config.json');await writeFile(path,JSON.stringify(config,null,2));
 const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--case',path],{cwd:root,stdio:['ignore','pipe','pipe']});
 let stdout='',stderrBytes=0,peakBytes=0,overallPeakBytes=0,maxProcesses=0,samples=0,sampling=false,stoppedFor=null;
 const stop=reason=>{stoppedFor??=reason;child.kill('SIGTERM');};
 const timer=setTimeout(()=>stop('case-time-limit'),180_000);
 const sample=async()=>{if(sampling)return;sampling=true;try{const value=await processTreeRss(child.pid,process.pid);samples++;peakBytes=Math.max(peakBytes,value.bytes);overallPeakBytes=Math.max(overallPeakBytes,value.overall.bytes);maxProcesses=Math.max(maxProcesses,value.processes);if(value.overall.bytes>2*1024**3)stop('total-process-tree-rss-limit');}catch{}finally{sampling=false;}};
 const interval=setInterval(()=>void sample(),100);void sample();
 child.stdout.on('data',data=>{stdout+=data;if(stdout.length>5_000_000)stop('output-limit');});
 child.stderr.on('data',data=>{stderrBytes+=data.length;});
 const exit=await new Promise(resolve=>{child.once('error',error=>resolve({error:fail(error)}));child.once('exit',(code,signal)=>resolve({code,signal}));});
 clearInterval(interval);clearTimeout(timer);
 const processTreeMemory={samplePeriodMs:100,samples,peakSampledRssBytes:peakBytes,overallPeakSampledRssBytes:overallPeakBytes,maxProcesses,boundary:'peakSampledRssBytes sums the case and descendants, including the font helper. overallPeakSampledRssBytes also includes the orchestrator and its other descendants. Sampling may miss brief peaks; shared pages can be counted more than once. Excludes Word and the app.'};
 if(exit.code!==0||stoppedFor)return {label:config.label,failed:true,exit,stoppedFor,stderrBytes,processTreeMemory};
 try{return {...JSON.parse(stdout),processTreeMemory,stderrBytes};}catch{return {label:config.label,failed:true,reason:'invalid-case-report',stderrBytes,processTreeMemory};}
}

export function parseArguments(args){
 const options={counts:[1,30,300],scenario:'all',output:join(root,'.local','document-benchmark-'+new Date().toISOString().replace(/[:.]/g,'-'))};
 for(let index=0;index<args.length;index++){
  const arg=args[index],value=args[index+1];
  if(!['--output','--document','--counts','--case','--scenario','--reuse-report'].includes(arg)||!value)throw Error('Expected --output DIR, --document AUTHORIZED_COPY, --counts 1,30,300|none, --reuse-report REPORT, or --scenario all|sidebar');
  index++;
  if(arg==='--counts')options.counts=value==='none'?[]:value.split(',').map(Number);
  else if(arg==='--scenario')options.scenario=value;
  else if(arg==='--reuse-report')options.reuseReport=resolve(value);
  else options[arg.slice(2)]=resolve(value);
 }
 if((!options.counts.length&&!options.document&&!options.reuseReport)||options.counts.length>4||new Set(options.counts).size!==options.counts.length||options.counts.some(count=>!Number.isSafeInteger(count)||count<1||count>300))throw Error('Use one to four unique synthetic counts between 1 and 300, or none with a document');
 if(options.document&&options.reuseReport)throw Error('Use either frozen report inputs or a new document, not both');
 if(!['all','sidebar'].includes(options.scenario))throw Error('Unknown benchmark scenario');
 return options;
}

async function main(options){
 if(options.case){process.stdout.write(JSON.stringify(await benchmarkCase(JSON.parse(await readFile(options.case,'utf8')))));return;}
 await mkdir(join(options.output,'fixtures'),{recursive:true});
 const startedAt=new Date().toISOString(),identity=await sourceIdentity(),head=(await execFileAsync('git',['rev-parse','HEAD'],{cwd:root})).stdout.trim(),fixtures=[],preparation=[];
 const {createDocx}=await import('../src/document.mjs');
 if(options.reuseReport){
  const bytes=await readFile(options.reuseReport),baseline=JSON.parse(bytes),labels=new Set();
  if(baseline.schema!=='equationlab.document-benchmark.v1'||!Array.isArray(baseline.cases)||baseline.cases.length<1||baseline.cases.length>4)throw Error('Invalid bounded baseline report');
  for(const entry of baseline.cases){
   if(entry.failed||!/^[-a-z0-9]+$/.test(entry.label)||labels.has(entry.label))throw Error('Invalid baseline case');labels.add(entry.label);
   const config=JSON.parse(await readFile(join(resolve(options.reuseReport,'..'),entry.label+'.config.json'))),content=await readFile(config.input);
   if(sha(content)!==entry.input?.sha256)throw Error('Frozen benchmark input changed');
   fixtures.push({label:entry.label,input:config.input});preparation.push({label:entry.label,bytes:content.length,sha256:sha(content),reused:true});
  }
 }else for(const count of options.counts){
  const start=performance.now(),label='synthetic-'+String(count).padStart(3,'0'),input=join(options.output,'fixtures',label+'.docx');
  const bytes=await createDocx(Array.from({length:count},(_,index)=>({latex:`x_{${index+1}}^2+${index+1}`,layout:{mode:'numbered-right',numberFormat:'(#C1.#E1)',chapter:1}})),{numberingFamily:'mathtype'});
  await writeFile(input,bytes,{flag:'wx'});fixtures.push({label,input});preparation.push({label,elapsedMs:round(performance.now()-start),bytes:bytes.length,sha256:sha(bytes),equations:count,layout:'single column, default A4 page; one numbered formula per paragraph'});
 }
 let privateInput;
 if(options.document&&!options.reuseReport){
  const bytes=await readFile(options.document),input=join(options.output,'fixtures','local-document.docx');
  privateInput={sha256:sha(bytes),bytes:bytes.length};await copyFile(options.document,input,constants.COPYFILE_EXCL);fixtures.push({label:'local-document',input});
 }
 const cases=[];
 for(const fixture of fixtures){const result=await runChild({...fixture,scenario:options.scenario},options.output);cases.push(result);await writeFile(join(options.output,fixture.label+'.json'),JSON.stringify(result,null,2)+'\n');process.stdout.write(JSON.stringify({label:fixture.label,failed:result.failed===true,equations:result.stages?.find(s=>s.name==='parse-fresh')?.counts.equations,processTreePeakMiB:round((result.processTreeMemory?.peakSampledRssBytes??0)/1024**2)})+'\n');if(result.stoppedFor)break;}
 if(privateInput)privateInput.unchanged=privateInput.sha256===sha(await readFile(options.document));
 const report={schema:'equationlab.document-benchmark.v1',startedAt,completedAt:new Date().toISOString(),head,node:process.version,platform:process.platform,arch:process.arch,rounds:1,sourceHashes:identity,sourceHashesAfter:await sourceIdentity(),privateInput,reusedReport:options.reuseReport?{sha256:sha(await readFile(options.reuseReport))}:undefined,preparation,cases,limits:{caseTimeoutMs:180_000,totalProcessTreeRssBytes:2*1024**3,rounds:1,contentionRounds:5,thumbnailBatch:4,previewBurst:8},scope:'Offline backend parse, production readonly tools, thumbnail rendering and scheduler contention. No Word, GUI, installation, document mutation, or editable/paint-ready measurement.',hostVerified:false};
 await writeFile(join(options.output,'report.json'),JSON.stringify(report,null,2)+'\n');
 if(cases.some(result=>result.failed)||privateInput?.unchanged===false)process.exitCode=1;
}

if(await isMainModule(import.meta.url))try{await main(parseArguments(process.argv.slice(2)));}catch(error){process.stderr.write(JSON.stringify({failed:true,error:fail(error)})+'\n');process.exitCode=1;}
