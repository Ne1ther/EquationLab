import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {manageWordService,SERVICE_LABEL,servicePlist} from '../packaging/word-service.mjs';

async function fixture(){
 const home=await mkdtemp(join(tmpdir(),'equationlab-word-service-')),app=join(home,'Equation & Lab.app');
 for(const path of ['Contents/Resources/runtime/bin/node','Contents/Resources/engine/src/app-services.mjs']){const target=join(app,path);await mkdir(join(target,'..'),{recursive:true});await writeFile(target,'test fixture');}
 let loaded=false,failBootstrap=false;const calls=[];
 const execute=(_,args)=>{calls.push(args);if(args[0]==='print'){if(!loaded)throw Error('not loaded');return 'loaded';}if(args[0]==='bootout'){loaded=false;return '';}if(args[0]==='bootstrap'){if(failBootstrap){failBootstrap=false;throw Error('bootstrap failed');}loaded=true;return '';}};
 return {home,app,execute,calls,setFailure(){failBootstrap=true;},get loaded(){return loaded;},target:join(home,'Library/LaunchAgents',SERVICE_LABEL+'.plist'),cleanup:()=>rm(home,{recursive:true,force:true})};
}
test('User background service installs, upgrades and removes only its own agent',async()=>{
 const f=await fixture();try{
  const request={home:f.home,app:f.app,uid:501,execute:f.execute};
  assert.equal((await manageWordService(request)).installed,true);assert.equal(f.loaded,true);
  const plist=await readFile(f.target,'utf8');assert.match(plist,/Equation &amp; Lab/);assert.match(plist,/<key>KeepAlive<\/key><true\/>/);
  assert.equal((await manageWordService({...request,action:'status'})).installed,true);
  await manageWordService(request);assert.equal(f.loaded,true);
  await manageWordService({...request,action:'remove'});assert.equal(f.loaded,false);await assert.rejects(access(f.target));
 }finally{await f.cleanup();}
});
test('Failed service upgrade restores previous agent, installation record and registration',async()=>{
 const f=await fixture();try{
  const request={home:f.home,app:f.app,uid:501,execute:f.execute};await manageWordService(request);
  const original=await readFile(f.target);f.setFailure();
  await assert.rejects(manageWordService(request),/安装失败/);assert.deepEqual(await readFile(f.target),original);assert.equal(f.loaded,true);
  assert.equal((await manageWordService({...request,action:'status'})).installed,true);
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
