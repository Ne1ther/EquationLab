import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {detectWordStartup} from '../packaging/word-native-installer/installer.mjs';
import {automaticStartup,ownedWebManifest,installAutomatically} from '../packaging/word-native-installer/automatic-install.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
async function fixture(){
 const home=await fs.realpath(await fs.mkdtemp(path.join(tmpdir(),'equationlab-automatic-install-')));
 const support=path.join(home,'Library/Application Support/Equation Lab');await fs.mkdir(support,{recursive:true});
 return {home,support,user:{home,username:'fixture',uid:process.getuid(),gid:process.getgid()},cleanup:()=>fs.rm(home,{recursive:true,force:true})};
}
async function wordSetting(f,directory){
 const base=path.join(f.home,'Library/Group Containers/UBF8T346G9.Office');await fs.mkdir(path.join(base,'MicrosoftRegistrationDB'),{recursive:true});
 const database=path.join(base,'MicrosoftRegistrationDB/test.reg');
 const value=directory===null?'':`INSERT INTO HKEY_CURRENT_USER_values VALUES(76,'STARTUP-PATH',2,'${directory.replaceAll("'","''")}');`;
 execFileSync('/usr/bin/sqlite3',[database],{input:`CREATE TABLE HKEY_CURRENT_USER(node_id INTEGER PRIMARY KEY,parent_id INTEGER,name TEXT); CREATE TABLE HKEY_CURRENT_USER_values(node_id INTEGER,name TEXT,type INTEGER,value BLOB); INSERT INTO HKEY_CURRENT_USER VALUES(71,0,'Software'),(72,71,'Microsoft'),(73,72,'Office'),(74,73,'16.0'),(75,74,'Word'),(76,75,'Options'); ${value}`});
 await fs.symlink(database,path.join(base,'MicrosoftRegistrationDB.reg'));
 return database;
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
test('first installation finds each existing Office localized Startup layout without creating another folder',async()=>{
 for(const suffix of ['User Content.localized/Startup.localized/Word','User Content.localized/Startup/Word','User Content/Startup.localized/Word','User Content/Startup/Word']){
  const f=await fixture();try{
   const startup=path.join(f.home,'Library/Group Containers/UBF8T346G9.Office',suffix);
   await fs.mkdir(startup,{recursive:true});await fs.writeFile(path.join(startup,'Zotero.dotm'),'external template');
   assert.equal(await automaticStartup(f.home),startup);
   assert.equal(await fs.readFile(path.join(startup,'Zotero.dotm'),'utf8'),'external template');
   assert.deepEqual(await fs.readdir(f.support),[]);
  }finally{await f.cleanup();}
 }
});
test('custom Word Startup is read from its versioned database without changing it', {skip:process.platform!=='darwin'},async()=>{
 const f=await fixture();try{
  const startup=path.join(f.home,"Word's 自定义启动目录");
  const database=await wordSetting(f,startup+'/'),before=await fs.readFile(database);
  assert.deepEqual(await detectWordStartup(f.home),{directory:startup,configurationAvailable:true,custom:true});
  assert.equal(await automaticStartup(f.home),startup);
  assert.deepEqual(await fs.readFile(database),before);
 }finally{await f.cleanup();}
});
test('denied Word settings access asks for scoped consent instead of guessing a Startup folder', {skip:process.platform!=='darwin'||process.getuid()===0},async()=>{
 const f=await fixture();let database;try{
  database=await wordSetting(f,path.join(f.home,'custom startup'));
  await fs.chmod(database,0);
  await assert.rejects(detectWordStartup(f.home),error=>error.code==='WORD_SETTINGS_ACCESS_DENIED'&&/允许访问 Word 文件夹/.test(error.message));
  await assert.rejects(automaticStartup(f.home),error=>error.code==='WORD_SETTINGS_ACCESS_DENIED');
 }finally{if(database)await fs.chmod(database,0o600);await f.cleanup();}
});
test('changed Word Startup selects the actual location, but removal still targets the owned old location', {skip:process.platform!=='darwin'},async()=>{
 const f=await fixture();try{
  const old=path.join(f.home,'old startup'),current=path.join(f.home,'current Word startup');await wordSetting(f,current);
  await fs.mkdir(path.join(f.support,'word-native'));
  const record=path.join(f.support,'word-native/current.json');
  const data={schema:'equationlab.word-native-installation.v1',scope:'user',installed:true,startupDirectory:old};
  await fs.writeFile(record,JSON.stringify(data));
  assert.equal(await automaticStartup(f.home),current);
  assert.equal(await automaticStartup(f.home,{forRemoval:true}),old);
  await fs.writeFile(record,JSON.stringify({...data,installed:false,installedFiles:[]}));
  assert.equal(await automaticStartup(f.home),current);
 }finally{await f.cleanup();}
});
test('resetting Word Startup uses its default instead of a stale custom installation record', {skip:process.platform!=='darwin'},async()=>{
 const f=await fixture();try{
  await wordSetting(f,null);await fs.mkdir(path.join(f.support,'word-native'));
  await fs.writeFile(path.join(f.support,'word-native/current.json'),JSON.stringify({schema:'equationlab.word-native-installation.v1',scope:'user',installed:true,startupDirectory:path.join(f.home,'previous custom startup')}));
  assert.equal(await automaticStartup(f.home),path.join(f.home,'Library/Group Containers/UBF8T346G9.Office/User Content.localized/Startup.localized/Word'));
 }finally{await f.cleanup();}
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
