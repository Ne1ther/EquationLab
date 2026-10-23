import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {manageWordService,SERVICE_LABEL,servicePlist} from '../packaging/word-service.mjs';

async function fixture(){
 const home=await mkdtemp(join(tmpdir(),'equationlab-word-service-')),app=join(home,'Equation & Lab.app');
 for(const path of ['Contents/Resources/runtime/bin/node','Contents/Resources/engine/src/app-services.mjs']){const target=join(app,path);await mkdir(join(target,'..'),{recursive:true});await writeFile(target,'test fixture');}
 let loaded=false,failBootstrap=false,failKickstart=false;const calls=[];
 const execute=(_,args)=>{calls.push(args);if(args[0]==='print'){if(!loaded)throw Error('not loaded');return 'loaded';}if(args[0]==='bootout'){loaded=false;return '';}if(args[0]==='bootstrap'){if(failBootstrap){failBootstrap=false;throw Error('bootstrap failed');}loaded=true;return '';}if(args[0]==='kickstart'){if(failKickstart){failKickstart=false;throw Error('kickstart failed');}loaded=true;return '';}};
 return {home,app,execute,calls,setFailure(){failBootstrap=true;},setKickstartFailure(){failKickstart=true;},setLoaded(value){loaded=value;},get loaded(){return loaded;},target:join(home,'Library/LaunchAgents',SERVICE_LABEL+'.plist'),cleanup:()=>rm(home,{recursive:true,force:true})};
}
test('User Word service installs, upgrades and removes only its own agent',async()=>{
 const f=await fixture();try{
  const request={home:f.home,app:f.app,uid:501,execute:f.execute};
  assert.equal((await manageWordService(request)).installed,true);assert.equal(f.loaded,true);
  const plist=await readFile(f.target,'utf8');assert.match(plist,/Equation &amp; Lab/);assert.match(plist,/<key>KeepAlive<\/key><true\/>/);
  assert.match(plist,/<key>ProcessType<\/key><string>Interactive<\/string>/);
  assert.equal((await manageWordService({...request,action:'status'})).installed,true);
  await manageWordService(request);assert.equal(f.loaded,true);
  await manageWordService({...request,action:'remove'});assert.equal(f.loaded,false);await assert.rejects(access(f.target));
 }finally{await f.cleanup();}
});
test('Failed changed-configuration upgrade restores previous agent, installation record and registration',async()=>{
 const f=await fixture();try{
  const request={home:f.home,app:f.app,uid:501,execute:f.execute};await manageWordService(request);
  const original=await readFile(f.target);const app2=join(f.home,'Restored Equation Lab.app');
  for(const path of ['Contents/Resources/runtime/bin/node','Contents/Resources/engine/src/app-services.mjs']){const target=join(app2,path);await mkdir(join(target,'..'),{recursive:true});await writeFile(target,'test fixture');}
  f.setFailure();
  await assert.rejects(manageWordService({...request,app:app2}),/安装失败/);assert.deepEqual(await readFile(f.target),original);assert.equal(f.loaded,true);
  assert.equal((await manageWordService({...request,action:'status'})).installed,true);
 }finally{await f.cleanup();}
});
test('Restored app with the same owned plist restarts the loaded job through kickstart only',async()=>{
 const f=await fixture();try{
  const request={home:f.home,app:f.app,uid:501,execute:f.execute};await manageWordService(request);
  const appBytes=await Promise.all(['Contents/Resources/runtime/bin/node','Contents/Resources/engine/src/app-services.mjs'].map(path=>readFile(join(f.app,path))));
  await rm(f.app,{recursive:true,force:true});
  for(const [index,path] of ['Contents/Resources/runtime/bin/node','Contents/Resources/engine/src/app-services.mjs'].entries()){const target=join(f.app,path);await mkdir(join(target,'..'),{recursive:true});await writeFile(target,appBytes[index]);}
  const before=f.calls.length;await manageWordService(request);const commands=f.calls.slice(before).map(args=>args[0]);
  assert.deepEqual(commands,['print','kickstart','print']);assert.equal(f.loaded,true);
 }finally{await f.cleanup();}
});
test('Same owned plist bootstraps directly when its job is unloaded',async()=>{
 const f=await fixture();try{
  const request={home:f.home,app:f.app,uid:501,execute:f.execute};await manageWordService(request);f.setLoaded(false);
  const before=f.calls.length;await manageWordService(request);const commands=f.calls.slice(before).map(args=>args[0]);
  assert.deepEqual(commands,['print','bootstrap','print']);assert.equal(f.loaded,true);
 }finally{await f.cleanup();}
});
test('Changed app configuration replaces and bootstraps the owned job',async()=>{
 const f=await fixture();try{
  const request={home:f.home,app:f.app,uid:501,execute:f.execute};await manageWordService(request);
  const app2=join(f.home,'Equation Lab 2.app');for(const path of ['Contents/Resources/runtime/bin/node','Contents/Resources/engine/src/app-services.mjs']){const target=join(app2,path);await mkdir(join(target,'..'),{recursive:true});await writeFile(target,'test fixture');}
  const before=f.calls.length;await manageWordService({...request,app:app2});const commands=f.calls.slice(before).map(args=>args[0]);
  assert.deepEqual(commands,['print','bootout','bootstrap','print']);assert.equal((await readFile(f.target,'utf8')).includes(app2),true);assert.equal(f.loaded,true);
 }finally{await f.cleanup();}
});
test('Failed same-configuration kickstart preserves owned files and registration',async()=>{
 const f=await fixture();try{
  const request={home:f.home,app:f.app,uid:501,execute:f.execute};await manageWordService(request);
  const plist=await readFile(f.target),recordPath=join(f.home,'Library/Application Support/Equation Lab/word-service-install.json'),record=await readFile(recordPath);
  f.setKickstartFailure();await assert.rejects(manageWordService(request),/安装失败/);
  assert.deepEqual(await readFile(f.target),plist);assert.deepEqual(await readFile(recordPath),record);assert.equal(f.calls.at(-1)[0],'kickstart');assert.equal(f.loaded,true);
 }finally{await f.cleanup();}
});
test('Failed direct bootstrap of an unloaded same-configuration job preserves ownership files',async()=>{
 const f=await fixture();try{
  const request={home:f.home,app:f.app,uid:501,execute:f.execute};await manageWordService(request);f.setLoaded(false);
  const plist=await readFile(f.target),recordPath=join(f.home,'Library/Application Support/Equation Lab/word-service-install.json'),record=await readFile(recordPath);
  f.setFailure();await assert.rejects(manageWordService(request),/安装失败/);
  assert.deepEqual(await readFile(f.target),plist);assert.deepEqual(await readFile(recordPath),record);assert.equal(f.loaded,false);
 }finally{await f.cleanup();}
});
test('Externally modified agent is preserved during install and uninstall',async()=>{
 const f=await fixture();try{
  const request={home:f.home,app:f.app,uid:501,execute:f.execute};await manageWordService(request);await writeFile(f.target,'user edit');
  const count=f.calls.length;
  await assert.rejects(manageWordService(request),/外部修改/);await assert.rejects(manageWordService({...request,action:'remove'}),/外部修改/);
  assert.equal(f.calls.length,count);assert.equal(await readFile(f.target,'utf8'),'user edit');assert.equal(f.loaded,true);
 }finally{await f.cleanup();}
});
test('Agent paths reject control characters and escape valid XML metacharacters',()=>{
 assert.throws(()=>servicePlist('/Applications/Bad\nApp.app','/tmp/support'),/绝对路径/);
 assert.throws(()=>servicePlist('relative.app','/tmp/support'),/绝对路径/);
 assert.match(servicePlist('/Applications/Equation Lab.app','/tmp/<support>'),/&lt;support&gt;/);
});
