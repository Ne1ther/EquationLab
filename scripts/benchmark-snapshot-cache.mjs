#!/usr/bin/env node
// Controlled-GC cache retention probe; no Word, GUI, document mutation or body output.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),exec=promisify(execFile);
const sha=b=>createHash('sha256').update(b).digest('hex');
const memory=()=>Object.fromEntries(Object.entries(process.memoryUsage()));
const stats=values=>{const a=[...values].sort((a,b)=>a-b);return {samples:a.length,medianMs:a[Math.ceil(a.length*.5)-1],maxMs:a.at(-1)};};
const args=process.argv.slice(2);
if(args[0]==='--case'){
 const config=JSON.parse(await fs.readFile(args[1],'utf8')),rpc=await import('../src/desktop-rpc.mjs');
 if(!Array.isArray(config.inputs)||config.inputs.length<1||config.inputs.length>4)throw Error('Use one to four immutable inputs');
 const sources=['scripts/benchmark-snapshot-cache.mjs','src/desktop-rpc.mjs','src/document.mjs',...(rpc.documentSnapshotCacheStats?['src/document-snapshot-cache.mjs']:[])];
 const identities=async()=>Object.fromEntries(await Promise.all(sources.map(async p=>[p,sha(await fs.readFile(path.join(root,p)))])));
 const beforeSources=await identities(),beforeInput=await Promise.all(config.inputs.map(async p=>sha(await fs.readFile(p))));
 const signatures=[],timings=[];let count=0;
 global.gc?.();const initialMemory=memory();
 for(let round=0;round<3;round++){
  for(const [index,input]of config.inputs.entries()){
   const start=performance.now();let result=await rpc.desktopRequest({action:'inspect',payload:{path:input,thumbnails:false}});
   const elapsedMs=performance.now()-start,signature=sha(Buffer.from(JSON.stringify(result.objects.map(o=>[o.nativeSha256,o.layout]))));
   if(round===0)signatures[index]=signature;else if(signatures[index]!==signature)throw Error('Snapshot identity changed');
   count=result.objects.length;result=null;timings.push({round,index,elapsedMs});
  }
  await new Promise(resolve=>setImmediate(resolve));global.gc?.();
 }
 const retainedMemory=memory(),afterInput=await Promise.all(config.inputs.map(async p=>sha(await fs.readFile(p))));
 const output={schema:'equationlab.snapshot-cache-benchmark.v1',at:new Date().toISOString(),node:process.version,documents:config.inputs.length,equationsPerDocument:count,rounds:3,cold:stats(timings.filter(t=>!t.round).map(t=>t.elapsedMs)),warm:stats(timings.filter(t=>t.round).map(t=>t.elapsedMs)),timings,initialMemory,retainedMemory,maxRssBytes:process.resourceUsage().maxRSS*1024,cacheStats:rpc.documentSnapshotCacheStats?.()??null,sourceHashes:beforeSources,sourceHashesAfter:await identities(),inputsUnchanged:beforeInput.every((h,i)=>h===afterInput[i]),inputHashes:beforeInput,semanticSignatures:signatures,scope:'Backend list/cache only, explicit GC between passes; excludes Word, app UI and renderer work. RSS is the whole probe, not cache size.',hostVerified:false};
 process.stdout.write(JSON.stringify(output));
}else{
 if(args.length!==4||args[0]!=='--inputs'||args[2]!=='--output')throw Error('Use --inputs JSON --output NEW_JSON');
 const list=JSON.parse(await fs.readFile(args[1],'utf8'));
 const configPath=args[3]+'.config.json';await fs.mkdir(path.dirname(args[3]),{recursive:true});
 await fs.writeFile(configPath,JSON.stringify({inputs:list.inputs},null,2),{flag:'wx'});
 const child=spawn(process.execPath,['--expose-gc',fileURLToPath(import.meta.url),'--case',configPath],{cwd:root,stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='',peak=0,samples=0,measuring=false,stoppedFor=null;
 const stop=reason=>{stoppedFor??=reason;child.kill('SIGTERM');};
 const sample=async()=>{if(measuring)return;measuring=true;try{const {stdout:rows}=await exec('ps',['-axo','pid=,ppid=,rss=']);const parsed=rows.trim().split('\n').map(l=>l.trim().split(/\s+/).map(Number));const pids=new Set([process.pid]);let changed=true;while(changed){changed=false;for(const [pid,ppid]of parsed)if(pids.has(ppid)&&!pids.has(pid)){pids.add(pid);changed=true;}}const bytes=parsed.filter(([pid])=>pids.has(pid)).reduce((s,r)=>s+r[2]*1024,0);peak=Math.max(peak,bytes);samples++;if(bytes>2*1024**3)stop('total-process-tree-rss-limit');}finally{measuring=false;}};
 const interval=setInterval(()=>void sample().catch(()=>{}),100),timer=setTimeout(()=>stop('case-time-limit'),180000);void sample().catch(()=>{});
 child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>1000000)stop('output-limit');});child.stderr.on('data',chunk=>{stderr+=chunk;});
 const exit=await new Promise(resolve=>{child.once('error',error=>resolve({error:error.message}));child.once('close',(code,signal)=>resolve({code,signal}));});
 clearInterval(interval);clearTimeout(timer);
 const output=exit.code===0&&!stoppedFor?{...JSON.parse(stdout),processTreeMemory:{overallPeakSampledRssBytes:peak,samples,samplePeriodMs:100},exit}:{failed:true,exit,stoppedFor,stderr};
 await fs.writeFile(args[3],JSON.stringify(output,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({failed:output.failed===true,documents:output.documents,warm:output.warm,retainedMemory:output.retainedMemory,maxRssMiB:(output.maxRssBytes??0)/1048576},null,2));
 if(output.failed||output.inputsUnchanged===false)process.exitCode=1;
}
