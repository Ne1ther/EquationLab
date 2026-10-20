import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {makeOle,inspectOle} from '../../src/native.mjs';
import {nativeSessionOperation} from '../../src/word-native-session.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const evidencePath=process.env.PROBE_SESSION_CLEANUP_EVIDENCE||path.join(root,'evidence/word-native-integration/session-cleanup-test.json');
const temp=await mkdtemp(path.join(os.tmpdir(),'equationlab-session-cleanup-'));
const formula=Array.from({length:32},(_,i)=>`x_{${i+1}}^{2}`).join('+');
const native=inspectOle(makeOle(formula)).native;
if(native.length<=239)throw Error('The generated native fixture does not initialize the full probe runtime');
const nativePath=path.join(temp,'cleanup-native.bin');await writeFile(nativePath,native);
const counts={open:0,complete:0,cancel:0,poll:0,ack:0,ackStates:[],terminalCancelRejected:0,errors:[]};
let holdNextOpen=false,completeNextOpen=false,heldOpen=null;
function reply(res,status,value){if(res.destroyed)return;const body=JSON.stringify(value);res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','content-length':Buffer.byteLength(body)});res.end(body);}
const nativeServer=http.createServer(async(req,res)=>{
  let operation='';
  try{
    let text='';for await(const chunk of req)text+=chunk;
    operation=req.url.replace(/^\/api\//,'');
    if(operation==='native-open')counts.open++;
    else if(operation==='native-complete')counts.complete++;
    else if(operation==='native-cancel')counts.cancel++;
    else if(operation==='native-poll')counts.poll++;
    else if(operation==='native-ack')counts.ack++;
    else throw Error('Unexpected native operation');
    const body=JSON.parse(text),result=await nativeSessionOperation(operation,body);
    if(operation==='native-ack')counts.ackStates.push((await nativeSessionOperation('native-status',{ticket:body.ticket,session:body.session})).state);
    if(operation==='native-open'&&completeNextOpen){
      completeNextOpen=false;
      counts.complete++;
      await nativeSessionOperation('native-complete',{
        ticket:result.ticket,session:body.session,native:body.native,
        pdf:Buffer.from('%PDF-1.4\n').toString('base64'),width:1,height:1
      });
    }
    if(operation==='native-open'&&holdNextOpen){holdNextOpen=false;heldOpen={res,result};return;}
    reply(res,200,result);
  }catch(error){
    if(operation==='native-cancel'&&error.message==='Native session is no longer editing')counts.terminalCancelRejected++;
    else counts.errors.push({path:req.url,message:error.message});
    reply(res,400,{error:error.message});
  }
});
const controlServer=http.createServer(async(req,res)=>{
  try{
    let text='';for await(const chunk of req)text+=chunk;
    const {command}=JSON.parse(text);
    if(command==='hold-next-open'){holdNextOpen=true;reply(res,200,{ok:true});}
    else if(command==='complete-next-open'){holdNextOpen=true;completeNextOpen=true;reply(res,200,{ok:true});}
    else if(command==='open-held')reply(res,200,{held:!!heldOpen});
    else if(command==='release-open'){
      if(!heldOpen)throw Error('No held native-open response');
      const held=heldOpen;heldOpen=null;reply(held.res,200,held.result);reply(res,200,{ok:true});
    }else if(command==='counts')reply(res,200,counts);
    else throw Error('Unknown test control');
  }catch(error){reply(res,400,{error:error.message});}
});
async function randomPort(server){
  for(let attempt=0;attempt<8;attempt++){
    await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',resolve).once('error',reject));
    const port=server.address().port;
    await new Promise(resolve=>server.close(resolve));
    if(port!==37952)return port;
  }
  throw Error('Could not allocate a random port outside the managed service port');
}
const nativePort=await randomPort(nativeServer),controlPort=await randomPort(controlServer);
if(nativePort===controlPort)throw Error('Native and control endpoints must use separate ports');
await Promise.all([
  new Promise((resolve,reject)=>nativeServer.listen(nativePort,'127.0.0.1',resolve).once('error',reject)),
  new Promise((resolve,reject)=>controlServer.listen(controlPort,'127.0.0.1',resolve).once('error',reject))
]);
let output='',errorOutput='',exitCode=1;
try{
  const child=spawn(path.join(root,'native-word-probe/script/build_framework_probe.sh'),[
    '--isolated-wlm',nativePath,String(nativePort),String(controlPort)
  ],{cwd:root,env:{...process.env,PROBE_CANCEL_SLOTS_ONLY:'1'},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',chunk=>{output+=chunk;if(output.length>2_000_000)child.kill();});
  child.stderr.on('data',chunk=>{errorOutput+=chunk;if(errorOutput.length>2_000_000)child.kill();});
  const timeout=setTimeout(()=>child.kill('SIGKILL'),60000);
  exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  clearTimeout(timeout);
}finally{
  nativeServer.closeAllConnections();controlServer.closeAllConnections();
  await Promise.all([
    new Promise(resolve=>nativeServer.close(resolve)),
    new Promise(resolve=>controlServer.close(resolve))
  ]);
  const helperPath=path.join(root,'native-word-probe/build/MathTypeBridgeProbe.bundle/Contents/MacOS/MathTypeBridgeProbe');
  const helper=await readFile(helperPath).catch(()=>Buffer.alloc(0));
  const drainedLine=errorOutput.split('\n').find(line=>line.startsWith('CANCEL_SLOT_DRAINED '));
  let drained=null,markerParseError=null;
  try{if(drainedLine)drained=JSON.parse(drainedLine.slice('CANCEL_SLOT_DRAINED '.length));}catch(error){markerParseError=error.message;}
  const result={
    at:new Date().toISOString(),
    status:exitCode===0?'passed':'failed',
    service:'src/word-native-session.mjs nativeSessionOperation',
    ports:{native:nativePort,control:controlPort,managed37952Used:false},
    probe:{exitCode,completedOwners:drained?.completedCleanups??null,generatedNativeBytes:native.length,markerParseError},
    httpCounts:counts,
    helperSha256:helper.length?createHash('sha256').update(helper).digest('hex'):null,
    testOutput:errorOutput.split('\n').filter(line=>line.includes('CANCEL_SLOT_')).slice(-4)
  };
  const {mkdir}=await import('node:fs/promises');await mkdir(path.dirname(evidencePath),{recursive:true});
  await writeFile(evidencePath,JSON.stringify(result,null,2)+'\n');
  await rm(temp,{recursive:true,force:true});
  process.stdout.write(JSON.stringify(result)+'\n');
  if(exitCode!==0)process.stderr.write(errorOutput+'\n'+output+'\n');
}
process.exitCode=exitCode??1;
