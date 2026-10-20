import {isMainModule} from './cli-entry.mjs';
import {localServer} from './server.mjs';
import {APP_VERSION} from './version.mjs';

function listen(server,port){
 return new Promise((resolve,reject)=>{
  const failed=error=>{server.removeListener('listening',ready);reject(error);};
  const ready=()=>{server.removeListener('error',failed);resolve();};
  server.once('error',failed);server.once('listening',ready);server.listen(port,'127.0.0.1');
 });
}
const stop=server=>!server?.listening?Promise.resolve():new Promise(resolve=>server.close(resolve));

/** Start the local-only native Word transport without taking over an occupied port. */
export async function startAppServices({nativePort=37952}={}){
 const nativeServer=localServer({port:nativePort});
 let nativeOwned=true;
 try{await listen(nativeServer,nativePort);}catch(error){
  if(error.code!=='EADDRINUSE')throw error;
  const health=await fetch(`http://127.0.0.1:${nativePort}/api/health`,{signal:AbortSignal.timeout(1500)}).then(r=>r.ok?r.json():null).catch(()=>null);
  if(health?.app!=='Equation Lab'||health.version!==APP_VERSION)throw Error(`本机端口 ${nativePort} 已被占用，请关闭之前的 Equation Lab 后重试`);
  nativeOwned=false;
 }
 let closed=false;
 return {
  nativeServer,
  status:{version:APP_VERSION,native:'ready',nativeOwnership:nativeOwned?'owned':'external'},
  async close(){if(closed)return;closed=true;if(nativeOwned)await stop(nativeServer);}
 };
}

if(await isMainModule(import.meta.url)){
 try{
  const services=await startAppServices();
  if(services.status.nativeOwnership==='external')await services.close();
  const close=()=>services.close().finally(()=>process.exit(0));process.once('SIGTERM',close);process.once('SIGINT',close);
 }catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
