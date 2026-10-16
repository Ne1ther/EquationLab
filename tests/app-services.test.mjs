import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,chmod,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import https from 'node:https';
import http from 'node:http';
import {startAppServices} from '../src/app-services.mjs';
import {APP_VERSION} from '../src/version.mjs';

test('Packaged services start native transport, add verified per-machine TLS and close owned listeners',{skip:process.platform==='win32'},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'Equation Lab services '));let services;
 try{
  services=await startAppServices({supportDirectory:dir,nativePort:0,officePort:0,watchCertificates:false});
  const nativePort=services.nativeServer.address().port;
  const health=await fetch(`http://127.0.0.1:${nativePort}/api/health`).then(r=>r.json());
  assert.equal(health.app,'Equation Lab');assert.equal(health.version,APP_VERSION);assert.equal(health.tls,false);
  assert.equal(services.officeServer,null);assert.equal(services.status.office,'not-installed');
  const tls=join(dir,'tls');await mkdir(tls,{mode:0o700});
  const cert=join(tls,'localhost-cert.pem'),key=join(tls,'localhost-key.pem');
  await promisify(execFile)('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-sha256','-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-addext','basicConstraints=critical,CA:FALSE','-keyout',key,'-out',cert]);
  await chmod(key,0o600);await services.refreshTLS();assert.equal(services.status.office,'ready');
  const body=await new Promise((resolve,reject)=>{
   https.get(`https://127.0.0.1:${services.officeServer.address().port}/api/health`,{ca:undefined},r=>{r.resume();reject(Error('Untrusted test certificate unexpectedly succeeded'));}).on('error',()=>{
    readFile(cert).then(ca=>https.get(`https://127.0.0.1:${services.officeServer.address().port}/api/health`,{ca},r=>{let body='';r.on('data',c=>body+=c);r.on('end',()=>resolve(JSON.parse(body)));}).on('error',reject),reject);
   });
  });
  assert.equal(body.tls,true);
  const second=await startAppServices({supportDirectory:dir,nativePort,officePort:services.officeServer.address().port,watchCertificates:false});
  try {
   assert.equal(second.status.nativeOwnership,'external');assert.equal(second.status.officeOwnership,'external');assert.equal(second.status.office,'ready');
   await second.close();assert.equal(services.nativeServer.listening,true);assert.equal(services.officeServer.listening,true);
  }finally{await second.close();}
  await services.close();assert.equal(services.nativeServer.listening,false);assert.equal(services.officeServer.listening,false);
 }finally{await services?.close();await rm(dir,{recursive:true,force:true});}
});

test('Services reuse only a compatible native listener and never close an external listener',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'equationlab-services-shared-'));
 let first,second;
 try{
  first=await startAppServices({supportDirectory:dir,nativePort:0,watchCertificates:false});
  const port=first.nativeServer.address().port;
  second=await startAppServices({supportDirectory:dir,nativePort:port,watchCertificates:false});
  assert.equal(second.status.nativeOwnership,'external');
  await second.close();assert.equal(first.nativeServer.listening,true);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/health`)).status,200);
 }finally{await second?.close();await first?.close();await rm(dir,{recursive:true,force:true});}
});

test('Services leave an unrelated occupied port untouched',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'equationlab-services-occupied-'));
 const server=http.createServer((_,res)=>{res.end(JSON.stringify({app:'Another app'}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  await assert.rejects(startAppServices({supportDirectory:dir,nativePort:server.address().port,watchCertificates:false}),/已被占用/);
  assert.equal(server.listening,true);
 }finally{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});

test('Services reject the old 0.4.1 and 0.4.2 engines even when app and TLS fields match',async()=>{
 for(const obsoleteVersion of ['0.4.1','0.4.2']){
 assert.notEqual(APP_VERSION,obsoleteVersion);
 const dir=await mkdtemp(join(tmpdir(),'equationlab-services-old-version-'));
 const old={app:'Equation Lab',version:obsoleteVersion,tls:false};
 const server=http.createServer((_,res)=>res.end(JSON.stringify(old)));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const port=server.address().port;
  await assert.rejects(startAppServices({supportDirectory:dir,nativePort:port,watchCertificates:false}),/已被占用/);
  assert.equal(server.listening,true);
  assert.deepEqual(await fetch(`http://127.0.0.1:${port}/api/health`).then(r=>r.json()),old);
 }finally{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
 }
});
