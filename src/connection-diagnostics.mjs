import {isMainModule} from './cli-entry.mjs';

const PHASES=new Set(['not-checked','failed','not-installed','native-registered','startup-path-mismatch','awaiting-word-restart','system-artifacts-installed','installed','removed','rolled-back']);
const ERROR_CODES=new Set(['INVALID_REQUEST','UNSUPPORTED_PLATFORM','INSTALL_RECOVERY_REQUIRED','INSTALLED_FILE_CHANGED','WORD_SETTINGS_ACCESS_DENIED','WORD_STARTUP_ACCESS_DENIED','SYSTEM_COMPONENT_ACCESS_DENIED','INSTALL_FAILED','WORD_RUNNING','ADMIN_REQUIRED','INSTALLER_BUSY','STARTUP_NOT_FOUND','STARTUP_CONFLICT','ARTIFACT_INVALID','ARTIFACT_MISMATCH','INSTALLER_UNAVAILABLE','WORD_NOT_FOUND','DIAGNOSTIC_FAILED','SERVICE_UNREACHABLE','SERVICE_INCOMPATIBLE','REQUEST_NOT_DELIVERED','ACK_UNCONFIRMED','SESSION_EXPIRED']);
const STATES=new Set(['not-observed','editing','queued','delivered','unconfirmed','committed','failed','cancelled','expired']);
const STAGES=new Set(['not-observed','capture','service-request','editor-launch','editor-accepted','editing','save-request','word-delivery','word-confirmation','finished']);
const KINDS=new Set(['open','edit','insert','save','cancel','not-observed']);
const bool=value=>typeof value==='boolean'?value:null;
const version=value=>typeof value==='string'&&/^\d{1,4}(?:\.\d{1,5}){0,3}$/.test(value)?value:null;
const millis=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=86_400_000?Math.round(value):null;
const member=(set,value,fallback)=>typeof value==='string'&&set.has(value)?value:fallback;
const safeError=value=>value==null?null:member(ERROR_CODES,value,'UNRECOGNIZED_ERROR');

/** A whitelist, not a redaction pass: no arbitrary source strings survive.
 * This is a read-only observation and never authorizes retrying an insertion.
 */
export function createConnectionDiagnostics(input={}, {now=Date.now()}={}) {
 const raw=input&&typeof input==='object'?input:{},installation=raw.installation??{},word=raw.word??{},service=raw.service??{},operation=raw.operation??{};
 const phase=member(PHASES,installation.phase,'not-checked'),errorCode=safeError(installation.error?.code??(installation.ok===false?'INSTALL_FAILED':null));
 const files=Array.isArray(installation.installedFiles)?installation.installedFiles:[];
 const installedHelper=version(files.find(file=>file?.role==='native-bundle')?.version??installation.receipt?.helperVersion);
 const installedTemplate=version(files.find(file=>file?.role==='startup-template')?.version);
 const expectedHelper=version(raw.expectedHelperVersion),expectedTemplate=version(raw.expectedTemplateVersion??raw.expectedHelperVersion);
 const helperMatches=expectedHelper&&installedHelper?expectedHelper===installedHelper:null;
 const templateMatches=expectedTemplate&&installedTemplate?expectedTemplate===installedTemplate:null;
 const receiptVerified=phase==='native-registered'&&installation.ok===true&&installation.nativeRegistrationVerified===true&&installation.receipt?.valid===true;
 const serviceState=member(new Set(['not-observed','available','unreachable','incompatible']),service.state,'not-observed');
 const operationState=member(STATES,operation.state,'not-observed');
 // Delivered and complete are not acknowledgements. Only a queried receipt
 // carrying committed proves Word has confirmed this operation.
 const confirmed=operationState==='committed'&&operation.receiptObserved===true;
 const issues=[];
 if(word.installed===false)issues.push('WORD_NOT_FOUND');
 if(phase==='not-installed')issues.push('PLUGIN_NOT_INSTALLED');
 if(phase==='startup-path-mismatch')issues.push('STARTUP_PATH_MISMATCH');
 if(phase==='awaiting-word-restart')issues.push('WORD_RELOAD_REQUIRED');
 if(helperMatches===false||templateMatches===false)issues.push('COMPONENT_VERSION_MISMATCH');
 if(errorCode)issues.push(errorCode);
 if(serviceState==='unreachable')issues.push('SERVICE_UNREACHABLE');
 if(serviceState==='incompatible')issues.push('SERVICE_INCOMPATIBLE');
 if(serviceState==='available'&&service.workspaceConnected===false)issues.push('HOST_HEARTBEAT_UNCONFIRMED');
 if(operationState==='unconfirmed')issues.push('ACK_UNCONFIRMED');
 if(operationState==='delivered')issues.push('WORD_CONFIRMATION_PENDING');
 if(operation.stage==='editor-launch'&&operation.editorAccepted===false)issues.push('EDITOR_ACCEPTANCE_UNCONFIRMED');
 const nextActions=[];
 if(issues.includes('WORD_NOT_FOUND'))nextActions.push('select-word-application');
 if(issues.some(code=>['WORD_SETTINGS_ACCESS_DENIED','WORD_STARTUP_ACCESS_DENIED','SYSTEM_COMPONENT_ACCESS_DENIED'].includes(code)))nextActions.push('review-office-folder-access');
 if(issues.some(code=>['COMPONENT_VERSION_MISMATCH','PLUGIN_NOT_INSTALLED','STARTUP_PATH_MISMATCH','INSTALLED_FILE_CHANGED'].includes(code)))nextActions.push('verify-plugin-installation');
 if(issues.includes('WORD_RELOAD_REQUIRED'))nextActions.push('save-documents-and-reopen-word');
 if(issues.some(code=>['SERVICE_UNREACHABLE','SERVICE_INCOMPATIBLE'].includes(code)))nextActions.push('check-app-service-version');
 if(issues.some(code=>['WORD_CONFIRMATION_PENDING','ACK_UNCONFIRMED'].includes(code)))nextActions.push('inspect-word-before-any-new-insertion');
 return {
  schema:'equationlab.connection-diagnostics.v1',checkedAt:new Date(Number.isFinite(now)?now:Date.now()).toISOString(),
  app:{version:version(raw.app?.version),build:version(raw.app?.build)},
  word:{installed:bool(word.installed),running:bool(word.running),version:version(word.version)},
  plugin:{phase,helper:{expectedVersion:expectedHelper,installedVersion:installedHelper,matches:helperMatches},template:{expectedVersion:expectedTemplate,installedVersion:installedTemplate,matches:templateMatches},registrationVerified:receiptVerified,editorWakeVerified:installation.coldEditorWakeVerified===true,restartRequired:bool(installation.restartWordRequired),checkElapsedMs:millis(raw.installationElapsedMs),errorCode},
  service:{state:serviceState,version:version(service.version),workspaceConnected:bool(service.workspaceConnected),checkElapsedMs:millis(service.elapsedMs)},
  operation:{kind:member(KINDS,operation.kind,'not-observed'),stage:member(STAGES,operation.stage,'not-observed'),state:operationState,editorAccepted:bool(operation.editorAccepted),wordConfirmed:confirmed,receiptObserved:operation.receiptObserved===true,elapsedMs:millis(operation.elapsedMs),errorCode:safeError(operation.errorCode)},
  issues:[...new Set(issues)],nextActions:[...new Set(nextActions)],
  privacy:{documentContentIncluded:false,documentNamesIncluded:false,pathsIncluded:false,sessionIdentifiersIncluded:false,uploaded:false},
  limits:{registrationDoesNotProveEditorDelivery:true,noAutomaticReplay:true}
 };
}

async function responseJSON(response) {
 if(!response.ok)throw Error('HTTP response unavailable');
 const maximum=524288,declared=Number(response.headers?.get('content-length'));
 if(declared>maximum)throw Error('Response too large');
 const reader=response.body?.getReader();
 if(!reader){const text=await response.text();if(Buffer.byteLength(text)>maximum)throw Error('Response too large');return JSON.parse(text);}
 const chunks=[];let length=0;
 try {while(true){const next=await reader.read();if(next.done)break;length+=next.value.byteLength;if(length>maximum){await reader.cancel();throw Error('Response too large');}chunks.push(Buffer.from(next.value));}}
 finally {reader.releaseLock();}
 return JSON.parse(Buffer.concat(chunks,length).toString('utf8'));
}

/** Probe only the known local read endpoints. Callers cannot select a URL,
 * port, operation or request body; a ticket is used only to query its receipt.
 */
export async function collectConnectionDiagnostics(input={}, {fetchImpl=globalThis.fetch,now=Date.now,timeoutMs=2000}={}) {
 const started=now(),raw=input&&typeof input==='object'?input:{},service={state:'unreachable'},operation={...(raw.operation??{})};
 const deadline=Number.isSafeInteger(timeoutMs)&&timeoutMs>=1&&timeoutMs<=5000?timeoutMs:2000;
 const query=async(path,payload)=>responseJSON(await fetchImpl('http://127.0.0.1:37952/api/'+path,{method:payload===undefined?'GET':'POST',...(payload===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),signal:AbortSignal.timeout(deadline)}));
 try {
  const health=await query('health');service.version=version(health.version);
  if(health.app!=='Equation Lab'||!service.version||version(raw.app?.version)&&service.version!==raw.app.version)service.state='incompatible';
  else {
   service.state='available';
   await Promise.all([
    query('native-document-workspace-status',{}).then(status=>{service.workspaceConnected=bool(status.connected);}).catch(()=>{}),
    /^[a-f0-9]{64}$/.test(raw.ticket??'')?query('native-status',{ticket:raw.ticket}).then(receipt=>{
     if(STATES.has(receipt.state)&&receipt.state!=='not-observed'){
      operation.state=receipt.state;operation.receiptObserved=true;
      if(['queued','delivered','unconfirmed'].includes(receipt.state))operation.stage='word-confirmation';
      if(['committed','failed','cancelled','expired'].includes(receipt.state))operation.stage='finished';
     }
    }).catch(()=>{}):Promise.resolve()
   ]);
  }
 }catch{/* Only a stable state is exported; no network error text or URL. */}
 service.elapsedMs=Math.max(0,now()-started);
 return createConnectionDiagnostics({...raw,service,operation},{now:now()});
}

if(await isMainModule(import.meta.url)) {
 try {
  let input='';for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>1_048_576)throw Error('Input too large');}
  const result=await collectConnectionDiagnostics(JSON.parse(input||'{}'));
  process.stdout.write(JSON.stringify(result)+'\n');
 }catch{process.stdout.write(JSON.stringify(createConnectionDiagnostics({installation:{phase:'failed',error:{code:'DIAGNOSTIC_FAILED'}}}))+'\n');process.exitCode=1;}
}
