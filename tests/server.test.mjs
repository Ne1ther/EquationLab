import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import {localServer} from '../src/server.mjs';

test('Local Word service rejects other origins/hosts and serves offline equation assets',async()=>{
 const server=localServer({port:0});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  assert.equal((await fetch(base+'/api/health').then(r=>r.json())).app,'Equation Lab');
  const request={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({latex:'x^{2}'})};
  assert.equal((await fetch(base+'/api/validate',{...request,headers:{...request.headers,Origin:'https://unrelated.invalid'}})).status,403);
  const rebindingStatus=await new Promise((resolve,reject)=>{const req=http.request(base+'/api/health',{headers:{Host:'unrelated.invalid'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});assert.equal(rebindingStatus,403);
  assert.ok((await fetch(base+'/api/validate',request).then(r=>r.json())).nativeBytes>0);
  assert.equal((await fetch(base+'/vendor/mathlive.min.js')).status,200);
  assert.match(await fetch(base+'/commands.html').then(r=>r.text()),/appsforoffice\.microsoft\.com/);
  const icon=await fetch(base+'/icons/editor-32.png');assert.equal(icon.status,200);assert.equal(icon.headers.get('content-type'),'image/png');
  assert.equal((await fetch(base+'/icons/../../src/native.mjs')).status,404);
  assert.equal((await fetch(base+'/vendor/../src/native.mjs')).status,404);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
