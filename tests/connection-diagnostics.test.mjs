import test from 'node:test';
import assert from 'node:assert/strict';
import {createConnectionDiagnostics,collectConnectionDiagnostics} from '../src/connection-diagnostics.mjs';

const now=1_800_000_000_000;
const baseline=()=>({
 app:{version:'0.6.9',build:'94'},word:{installed:true,running:true,version:'16.114.1'},expectedHelperVersion:'0.0.37',
 installation:{ok:true,phase:'native-registered',nativeRegistrationVerified:true,restartWordRequired:false,coldEditorWakeVerified:false,
  installedFiles:[{role:'native-bundle',version:'0.0.37'},{role:'startup-template',version:'0.0.37'}],receipt:{valid:true,helperVersion:'0.0.37'}},
 installationElapsedMs:12.4,service:{state:'available',version:'0.6.9',workspaceConnected:true,elapsedMs:4.8}
});
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});

test('connection diagnostics separate plugin registration from editor delivery and Word acknowledgement',()=>{
 const report=createConnectionDiagnostics(baseline(),{now});
 assert.equal(report.plugin.registrationVerified,true);
 assert.equal(report.plugin.editorWakeVerified,false);
 assert.equal(report.plugin.helper.matches,true);
 assert.equal(report.plugin.template.matches,true);
 assert.equal(report.plugin.checkElapsedMs,12);
 assert.equal(report.operation.state,'not-observed');
 assert.equal(report.operation.wordConfirmed,false);
 assert.deepEqual(report.issues,[]);
 assert.equal(report.limits.noAutomaticReplay,true);
});

test('diagnostics are a strict whitelist even when private data is nested in every source',()=>{
 const privateText='private-thesis-name-path-latex-ticket';
 const raw=baseline();
 Object.assign(raw,{documentName:privateText,path:privateText,ticket:privateText,latex:privateText,url:privateText});
 raw.installation.installedFiles[0].path=privateText;raw.installation.installedFiles[0].sha256=privateText;
 raw.installation.receipt.path=privateText;raw.installation.receipt.wordPID=1234;
 raw.installation.error={code:'UNKNOWN_'+privateText,message:privateText,details:{document:privateText}};
 raw.word.path=privateText;raw.service.error=privateText;
 raw.operation={kind:privateText,stage:privateText,state:privateText,errorCode:privateText,elapsedMs:privateText};
 raw.app.version='1.2-'+privateText;
 const report=createConnectionDiagnostics(raw,{now}),text=JSON.stringify(report);
 assert.equal(text.includes(privateText),false);
 assert.equal(text.includes('1234'),false);
 assert.equal(report.app.version,null);
 assert.equal(report.plugin.errorCode,'UNRECOGNIZED_ERROR');
 assert.equal(report.operation.stage,'not-observed');
 assert.equal(report.operation.elapsedMs,null);
 assert.deepEqual(report.privacy,{documentContentIncluded:false,documentNamesIncluded:false,pathsIncluded:false,sessionIdentifiersIncluded:false,uploaded:false});
});

test('component mismatch, stale startup, folder access and service failure have distinct actionable codes',()=>{
 const mismatch=baseline();mismatch.installation.installedFiles[0].version='0.0.36';
 assert.ok(createConnectionDiagnostics(mismatch).issues.includes('COMPONENT_VERSION_MISMATCH'));
 const startup=createConnectionDiagnostics({installation:{ok:true,phase:'startup-path-mismatch'}});
 assert.deepEqual(startup.issues,['STARTUP_PATH_MISMATCH']);
 assert.deepEqual(startup.nextActions,['verify-plugin-installation']);
 const access=createConnectionDiagnostics({installation:{ok:false,phase:'failed',error:{code:'WORD_STARTUP_ACCESS_DENIED'}}});
 assert.deepEqual(access.nextActions,['review-office-folder-access']);
 const service=createConnectionDiagnostics({service:{state:'unreachable'}});
 assert.deepEqual(service.nextActions,['check-app-service-version']);
 const reload=createConnectionDiagnostics({installation:{phase:'awaiting-word-restart',nativeRegistrationVerified:true,receipt:{valid:true}}});
 assert.equal(reload.plugin.registrationVerified,false);
 assert.deepEqual(reload.nextActions,['save-documents-and-reopen-word']);
});

test('delivered and unconfirmed never become saved; committed requires an observed receipt',()=>{
 for(const state of ['queued','delivered','unconfirmed','editing','complete']){
  const report=createConnectionDiagnostics({operation:{kind:'insert',state,receiptObserved:true}});
  assert.equal(report.operation.wordConfirmed,false,state);
 }
 assert.equal(createConnectionDiagnostics({operation:{state:'committed'}}).operation.wordConfirmed,false);
 assert.equal(createConnectionDiagnostics({operation:{state:'committed',receiptObserved:true}}).operation.wordConfirmed,true);
 const unknown=createConnectionDiagnostics({operation:{kind:'insert',state:'unconfirmed'}});
 assert.deepEqual(unknown.nextActions,['inspect-word-before-any-new-insertion']);
});

test('collect probes only fixed read endpoints and strips workspace data and the current ticket',async()=>{
 const ticket='a'.repeat(64),calls=[];
 const report=await collectConnectionDiagnostics({...baseline(),ticket,url:'https://example.invalid/private'}, {now:()=>now,fetchImpl:async(url,options)=>{
  calls.push({url,options});
  if(url.endsWith('/health'))return json({app:'Equation Lab',version:'0.6.9'});
  if(url.endsWith('workspace-status'))return json({connected:true,active:{name:'SECRET-DOC',identity:'PRIVATE-IDENTITY'},documents:[{name:'SECRET-DOC'}]});
  return json({state:'delivered',path:'PRIVATE-PATH',ticket});
 }});
 assert.deepEqual(calls.map(c=>c.url).sort(),[
  'http://127.0.0.1:37952/api/health','http://127.0.0.1:37952/api/native-document-workspace-status','http://127.0.0.1:37952/api/native-status'
 ].sort());
 assert.equal(calls[0].options.method,'GET');
 assert.deepEqual(JSON.parse(calls.find(c=>c.url.endsWith('/native-status')).options.body),{ticket});
 assert.equal(report.operation.state,'delivered');
 assert.equal(report.operation.wordConfirmed,false);
 assert.equal(report.service.workspaceConnected,true);
 for(const privateValue of [ticket,'SECRET-DOC','PRIVATE-IDENTITY','PRIVATE-PATH','example.invalid'])assert.equal(JSON.stringify(report).includes(privateValue),false);
 assert.equal(calls.some(c=>/cancel|complete|insert|ack$/.test(c.url)),false);
});

test('a confirmed status receipt is the only live probe that establishes committed',async()=>{
 const report=await collectConnectionDiagnostics({...baseline(),ticket:'b'.repeat(64),operation:{kind:'insert',state:'delivered'}},{now:()=>now,fetchImpl:async url=>
  json(url.endsWith('/health')?{app:'Equation Lab',version:'0.6.9'}:url.endsWith('workspace-status')?{connected:true}:{state:'committed'})});
 assert.equal(report.operation.wordConfirmed,true);
 assert.equal(report.operation.stage,'finished');
});

test('occupied or old service is incompatible and receives no ticket or workspace request',async()=>{
 for(const health of [{app:'Unrelated service',version:'0.6.9'},{app:'Equation Lab',version:'0.6.8'}]){
  const calls=[];
  const report=await collectConnectionDiagnostics({...baseline(),ticket:'c'.repeat(64)},{now:()=>now,fetchImpl:async(url,options)=>{calls.push({url,options});return json(health);}});
  assert.equal(calls.length,1);
  assert.equal(calls[0].options.body,undefined);
  assert.equal(report.service.state,'incompatible');
  assert.ok(report.issues.includes('SERVICE_INCOMPATIBLE'));
 }
});

test('service outage exports no exception text and does not cancel or replay the operation',async()=>{
 const calls=[];
 const report=await collectConnectionDiagnostics({...baseline(),ticket:'d'.repeat(64),operation:{kind:'insert',state:'unconfirmed'}},{now:()=>now,fetchImpl:async(url)=>{calls.push(url);throw Error('PRIVATE-URL PRIVATE-PATH');}});
 assert.equal(calls.length,1);
 assert.equal(report.service.state,'unreachable');
 assert.equal(report.operation.state,'unconfirmed');
 assert.equal(report.operation.wordConfirmed,false);
 assert.equal(JSON.stringify(report).includes('PRIVATE'),false);
});

test('missing receipt and heartbeat are unknown rather than evidence of failure or closure',async()=>{
 const report=await collectConnectionDiagnostics({...baseline(),ticket:'e'.repeat(64),operation:{kind:'edit',state:'editing'}},{now:()=>now,fetchImpl:async url=>{
  if(url.endsWith('/health'))return json({app:'Equation Lab',version:'0.6.9'});
  return new Response('PRIVATE-ERROR',{status:400});
 }});
 assert.equal(report.service.state,'available');
 assert.equal(report.service.workspaceConnected,null);
 assert.equal(report.operation.state,'editing');
 assert.equal(report.operation.receiptObserved,false);
 assert.equal(report.operation.wordConfirmed,false);
});

test('malformed tickets are never sent, unexpected or oversized responses remain unconfirmed',async()=>{
 const calls=[];
 const report=await collectConnectionDiagnostics({...baseline(),ticket:'../private',operation:{state:'queued'}},{now:()=>now,fetchImpl:async url=>{
  calls.push(url);
  return url.endsWith('/health')?json({app:'Equation Lab',version:'0.6.9'}):new Response('x'.repeat(524289));
 }});
 assert.equal(calls.length,2);
 assert.equal(report.operation.state,'queued');
 assert.equal(report.service.workspaceConnected,null);
});
