import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {startAppServices} from '../src/app-services.mjs';
import {APP_VERSION} from '../src/version.mjs';

test('App services start and close the owned native Word listener',async()=>{
 const services=await startAppServices({nativePort:0});
 try{
  const port=services.nativeServer.address().port,health=await fetch(`http://127.0.0.1:${port}/api/health`).then(r=>r.json());
  assert.equal(health.app,'Equation Lab');assert.equal(health.version,APP_VERSION);assert.equal('tls' in health,false);
  assert.deepEqual(services.status,{version:APP_VERSION,native:'ready',nativeOwnership:'owned'});
 }finally{await services.close();}
 assert.equal(services.nativeServer.listening,false);
});

test('Services reuse only a compatible native listener and never close an external listener',async()=>{
 let first,second;
 try{
  first=await startAppServices({nativePort:0});const port=first.nativeServer.address().port;
  second=await startAppServices({nativePort:port});assert.equal(second.status.nativeOwnership,'external');
  await second.close();assert.equal(first.nativeServer.listening,true);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/health`)).status,200);
 }finally{await second?.close();await first?.close();}
});

test('Services leave an unrelated occupied port untouched',async()=>{
 const server=http.createServer((_,res)=>{res.end(JSON.stringify({app:'Another app'}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  await assert.rejects(startAppServices({nativePort:server.address().port}),/已被占用/);assert.equal(server.listening,true);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('Services reject obsolete native service versions',async()=>{
 for(const obsoleteVersion of ['0.4.1','0.4.2']){
  assert.notEqual(APP_VERSION,obsoleteVersion);
  const old={app:'Equation Lab',version:obsoleteVersion};
  const server=http.createServer((_,res)=>res.end(JSON.stringify(old)));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
   const port=server.address().port;await assert.rejects(startAppServices({nativePort:port}),/已被占用/);assert.equal(server.listening,true);
   assert.deepEqual(await fetch(`http://127.0.0.1:${port}/api/health`).then(r=>r.json()),old);
  }finally{await new Promise(resolve=>server.close(resolve));}
 }
});
