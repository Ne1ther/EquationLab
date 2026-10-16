import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {automaticStartup,ownedWebManifest,installAutomatically} from '../packaging/word-native-installer/automatic-install.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
async function fixture(){
 const home=await fs.realpath(await fs.mkdtemp(path.join(tmpdir(),'equationlab-automatic-install-')));
 const support=path.join(home,'Library/Application Support/Equation Lab');await fs.mkdir(support,{recursive:true});
 return {home,support,user:{home,username:'fixture',uid:process.getuid(),gid:process.getgid()},cleanup:()=>fs.rm(home,{recursive:true,force:true})};
}
test('automatic installation uses the previous recorded startup path and preserves unrelated add-ins',async()=>{
 const f=await fixture();try{
  const startup=path.join(f.home,'custom office startup');await fs.mkdir(startup);await fs.writeFile(path.join(startup,'Zotero.dotm'),'external template');
  await fs.mkdir(path.join(f.support,'word-native'));await fs.writeFile(path.join(f.support,'word-native/current.json'),JSON.stringify({schema:'equationlab.word-native-installation.v1',scope:'user',startupDirectory:startup}));
  assert.equal(await automaticStartup(f.home),startup);
  const result=await installAutomatically({user:f.user,checkOnly:true,wordRunning:()=>false,installer:{verify:async()=>({phase:'awaiting-word-restart'}),plan:async request=>{assert.equal(request.startupDirectory,startup);return {conflicts:[]};}}});
  assert.equal(result.startup,startup);assert.equal(await fs.readFile(path.join(startup,'Zotero.dotm'),'utf8'),'external template');
 }finally{await f.cleanup();}
});
test('Word running blocks an automatic install before writing or planning',async()=>{
 const f=await fixture();try{let called=false;await assert.rejects(installAutomatically({user:f.user,wordRunning:()=>true,installer:{plan:()=>{called=true;}}}),/退出 Microsoft Word/);assert.equal(called,false);assert.deepEqual(await fs.readdir(f.support),[]);}finally{await f.cleanup();}
});
test('old sideload migration requires the exact owned manifest and preserves external changes',async()=>{
 const f=await fixture();try{
  const manifest=path.join(f.home,'Library/Containers/com.microsoft.Word/Data/Documents/wef/EquationLab.xml');await fs.mkdir(path.dirname(manifest),{recursive:true});await fs.writeFile(manifest,'own XML');
  await fs.writeFile(path.join(f.support,'word-plugin-install.json'),JSON.stringify({manifest,manifestSha256:hash('own XML')}));
  assert.equal((await ownedWebManifest(f.home)).manifest,manifest);await fs.writeFile(manifest,'external XML');
  await assert.rejects(ownedWebManifest(f.home),/外部修改/);assert.equal(await fs.readFile(manifest,'utf8'),'external XML');
 }finally{await f.cleanup();}
});
test('a background service failure rolls back the committed native upgrade and leaves old web manifest intact',async()=>{
 const f=await fixture();try{
  const startup=await automaticStartup(f.home);let rollback=false;
  const api={verify:async()=>({phase:'not-installed'}),plan:async()=>({conflicts:[],planDigest:'fixture'}),install:async()=>{await fs.writeFile(path.join(startup,'EquationLabStartup.dotm'),'new template');return {installedFiles:[{path:path.join(startup,'EquationLabStartup.dotm')}],backupDirectory:path.join(f.support,'word-native')};},rollback:async()=>{rollback=true;await fs.unlink(path.join(startup,'EquationLabStartup.dotm'));}};
  await assert.rejects(installAutomatically({user:f.user,installer:api,wordRunning:()=>false,service:async()=>{throw Error('service failed');}}),/service failed/);
  assert.equal(rollback,true);await assert.rejects(fs.access(path.join(startup,'EquationLabStartup.dotm')));
 }finally{await f.cleanup();}
});
