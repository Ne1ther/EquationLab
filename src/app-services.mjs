import {readFile,lstat,mkdir} from 'node:fs/promises';
import {watch} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {isMainModule} from './cli-entry.mjs';
import {X509Certificate} from 'node:crypto';
import https from 'node:https';
import {localServer} from './server.mjs';
import {APP_VERSION} from './version.mjs';

export function appSupportDirectory(){
 return process.env.EQUATIONLAB_DATA_DIR||join(homedir(),'Library/Application Support/Equation Lab');
}

async function credentials(directory){
 const certPath=join(directory,'tls','localhost-cert.pem'),keyPath=join(directory,'tls','localhost-key.pem');
 let certStat,keyStat;
 try{[certStat,keyStat]=await Promise.all([lstat(certPath),lstat(keyPath)]);}catch(error){if(error.code==='ENOENT')return null;throw error;}
 if(!certStat.isFile()||certStat.isSymbolicLink()||!keyStat.isFile()||keyStat.isSymbolicLink()||(keyStat.mode&0o077))throw Error('Word 本机证书文件或私钥权限无效，请重新安装插件');
 const [cert,key]=await Promise.all([readFile(certPath),readFile(keyPath)]);
 const parsed=new X509Certificate(cert);
 if(parsed.ca||!parsed.checkHost('localhost')||!parsed.checkIP('127.0.0.1')||Date.parse(parsed.validFrom)>Date.now()||Date.parse(parsed.validTo)<=Date.now())throw Error('Word 本机证书无效或已过期，请重新安装插件');
 return {cert,key};
}

function listen(server,port){
 return new Promise((resolve,reject)=>{
  const failed=error=>{server.removeListener('listening',ready);reject(error);};
  const ready=()=>{server.removeListener('error',failed);resolve();};
  server.once('error',failed);server.once('listening',ready);server.listen(port,'127.0.0.1');
 });
}
const stop=server=>!server?.listening?Promise.resolve():new Promise(resolve=>server.close(resolve));

function officeHealth(port,certificate){
 return new Promise(resolve=>{
  const request=https.get(`https://127.0.0.1:${port}/api/health`,{ca:certificate,timeout:1500},response=>{
   let body='';response.on('data',chunk=>{body+=chunk;if(body.length>4096)request.destroy();});
   response.on('end',()=>{try{resolve(response.statusCode===200?JSON.parse(body):null);}catch{resolve(null);}});
  });
  request.on('timeout',()=>request.destroy());request.on('error',()=>resolve(null));
 });
}

/** One app-owned child provides both the native Word transport and, only after
 * the user installs this machine's certificate, the HTTPS Office task pane.
 * No repository writes, bundled private key, port eviction or remote listener.
 */
export async function startAppServices({supportDirectory=appSupportDirectory(),nativePort=37952,officePort=37951,watchCertificates=true,onStatus=()=>{}}={}){
 await mkdir(supportDirectory,{recursive:true,mode:0o700});
 const nativeServer=localServer({port:nativePort});
 let nativeOwned=true;
 try{await listen(nativeServer,nativePort);}catch(error){
  if(error.code!=='EADDRINUSE')throw error;
  const health=await fetch(`http://127.0.0.1:${nativePort}/api/health`,{signal:AbortSignal.timeout(1500)}).then(r=>r.ok?r.json():null).catch(()=>null);
  if(health?.app!=='Equation Lab'||health.version!==APP_VERSION||health.tls!==false)throw Error(`本机端口 ${nativePort} 已被占用，请关闭之前的 Equation Lab 后重试`);
  nativeOwned=false;
 }
 let officeServer=null,closed=false,rootWatcher,tlsWatcher,refresh=Promise.resolve();
 const status={version:APP_VERSION,native:'ready',nativeOwnership:nativeOwned?'owned':'external',office:'not-installed',officeOwnership:'none'};
 const publish=()=>onStatus({...status});
 async function refreshTLS(){
  if(closed)return {...status};
  try{
   const tls=await credentials(supportDirectory);
   if(closed)return {...status};
   if(!tls){await stop(officeServer);officeServer=null;status.office='not-installed';publish();return {...status};}
   if(officeServer){officeServer.setSecureContext(tls);status.office='ready';publish();return {...status};}
   const next=localServer({port:officePort,tls});
   try{await listen(next,officePort);}catch(error){
    const health=error.code==='EADDRINUSE'?await officeHealth(officePort,tls.cert):null;
    const compatible=health?.app==='Equation Lab'&&health.version===APP_VERSION&&health.tls===true;
    status.office=compatible?'ready':error.code==='EADDRINUSE'?'port-occupied':'unavailable';
    status.officeOwnership=compatible?'external':'none';publish();return {...status};
   }
   if(closed){await stop(next);return {...status};}
   officeServer=next;status.office='ready';status.officeOwnership='owned';publish();
  }catch{status.office='certificate-invalid';publish();}
  return {...status};
 }
 const schedule=()=>{refresh=refresh.then(refreshTLS,refreshTLS);};
 function watchTLS(){
  if(!watchCertificates||closed||tlsWatcher)return;
  try{tlsWatcher=watch(join(supportDirectory,'tls'),{persistent:false},schedule);tlsWatcher.on('error',()=>{tlsWatcher?.close();tlsWatcher=null;});}catch{/* The explicit installer creates this directory later. */}
 }
 if(watchCertificates){
  rootWatcher=watch(supportDirectory,{persistent:false},(_,name)=>{if(String(name)==='tls'){watchTLS();schedule();}});
  rootWatcher.on('error',()=>{rootWatcher?.close();rootWatcher=null;});
  watchTLS();
 }
 await refreshTLS();
 return {
  nativeServer,get officeServer(){return officeServer;},get status(){return {...status};},refreshTLS,
  async close(){closed=true;rootWatcher?.close();tlsWatcher?.close();await refresh.catch(()=>{});await Promise.all([nativeOwned?stop(nativeServer):Promise.resolve(),stop(officeServer)]);}
 };
}

if(await isMainModule(import.meta.url)){
 try{
  const services=await startAppServices({onStatus:status=>process.stdout.write(JSON.stringify({app:'Equation Lab',...status})+'\n')});
  if(services.status.nativeOwnership==='external'&&services.status.officeOwnership!=='owned')await services.close();
  const close=()=>services.close().finally(()=>process.exit(0));process.once('SIGTERM',close);process.once('SIGINT',close);
 }catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
