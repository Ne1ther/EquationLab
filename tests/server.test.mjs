import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {localServer} from '../src/server.mjs';
import {APP_VERSION} from '../src/version.mjs';

test('Local native Word service restricts hosts and origins and serves only its API',async()=>{
 const server=localServer({port:0});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const health=await fetch(base+'/api/health').then(r=>r.json());assert.equal(health.app,'Equation Lab');assert.equal(health.version,APP_VERSION);assert.equal('tls' in health,false);
  const request={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({latex:'x^{2}'})};
  assert.equal((await fetch(base+'/api/validate',{...request,headers:{...request.headers,Origin:'https://unrelated.invalid'}})).status,403);
  const rebindingStatus=await new Promise((resolve,reject)=>{const req=http.request(base+'/api/health',{headers:{Host:'unrelated.invalid'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});assert.equal(rebindingStatus,403);
  assert.equal((await fetch(base+'/api/validate',request)).status,404);
  assert.equal((await fetch(base+'/api/event',request)).status,404);
  for(const path of ['/','/taskpane.html','/taskpane.js','/commands.html','/vendor/mathlive.min.js','/icons/inline-32.png','/icons/../../src/native.mjs'])assert.equal((await fetch(base+path)).status,404,path);
  const nativeRequest={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket:'0'.repeat(64)})};
  const response=await fetch(base+'/api/native-open',nativeRequest);assert.equal(response.status,400);assert.match((await response.json()).error,/37952/);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
