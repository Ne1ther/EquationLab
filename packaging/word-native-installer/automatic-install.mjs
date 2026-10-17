// System Installer entry point. Installs the compiled global template for the
// logged-in user; does not change Office security, Normal.dotm, or other add-ins.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {homedir,userInfo} from 'node:os';
import {createInstaller,detectWordStartup,isMainModule} from './installer.mjs';
import {manageWordService} from '../word-service.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex');
const present=async p=>{try{return await fs.lstat(p);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
const run=(file,args)=>execFileSync(file,args,{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']}).trim();
// dscl emits a plist; convert through an explicit stdin, never shell text.
export function loggedInUser(){
 const username=run('/usr/bin/stat',['-f','%Su','/dev/console']);
 if(!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(username)||['root','loginwindow','_mbsetupuser'].includes(username))throw Error('请登录 macOS 用户账户后重新安装 Equation Lab。');
 const bytes=execFileSync('/usr/bin/dscl',['-plist','.','-read','/Users/'+username,'NFSHomeDirectory','UniqueID','PrimaryGroupID']);
 const values=JSON.parse(execFileSync('/usr/bin/plutil',['-convert','json','-o','-','--','-'],{input:bytes,encoding:'utf8'}));
 const home=values['dsAttrTypeStandard:NFSHomeDirectory']?.[0],uid=Number(values['dsAttrTypeStandard:UniqueID']?.[0]),gid=Number(values['dsAttrTypeStandard:PrimaryGroupID']?.[0]);
 if(!path.isAbsolute(home??'')||home==='/'||!Number.isSafeInteger(uid)||uid<500||!Number.isSafeInteger(gid)||gid<0)throw Error('无法确认当前用户的安装位置。');
 return {username,home,uid,gid};
}
export async function automaticStartup(home,{forRemoval=false}={}){
 const state=path.join(home,'Library/Application Support/Equation Lab/word-native/current.json');
 let data;
 if(await present(state)){
  data=JSON.parse(await fs.readFile(state,'utf8'));
  if(data.schema!=='equationlab.word-native-installation.v1'||data.scope!=='user'||!path.isAbsolute(data.startupDirectory??''))throw Error('现有 Word 插件安装记录无效。');
  if(forRemoval)return data.startupDirectory;
 }
 const actual=await detectWordStartup(home);
 if(data&&!actual.configurationAvailable)return data.startupDirectory;
 return actual.directory;
}
async function ensureOwnedDirectories(file,user){
 const missing=[];let current=file;
 while(current!==user.home){const stat=await present(current);if(stat){if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('安装目录不是普通文件夹：'+current);break;}missing.push(current);current=path.dirname(current);if(current===path.dirname(current))throw Error('安装位置不在用户目录内。');}
 for(const directory of missing.reverse()){await fs.mkdir(directory,{mode:0o700});if(process.geteuid()===0)await fs.chown(directory,user.uid,user.gid);}
}
async function ownTree(file,user){
 const stat=await present(file);if(!stat)return;
 if(stat.isSymbolicLink())throw Error('安装文件包含符号链接。');
 if(process.geteuid()===0)await fs.chown(file,user.uid,user.gid);
 if(stat.isDirectory())for(const child of await fs.readdir(file))await ownTree(path.join(file,child),user);
}
export async function ownedWebManifest(home){
 const record=path.join(home,'Library/Application Support/Equation Lab/word-plugin-install.json');
 if(!await present(record))return null;
 const state=JSON.parse(await fs.readFile(record,'utf8')),manifest=path.join(home,'Library/Containers/com.microsoft.Word/Data/Documents/wef/EquationLab.xml');
 if(state.manifest!==manifest||!/^[a-f0-9]{64}$/.test(state.manifestSha256??''))throw Error('旧版加载项安装记录不匹配，未修改。');
 const stat=await present(manifest);if(!stat)return null;
 if(!stat.isFile()||stat.isSymbolicLink()||hash(await fs.readFile(manifest))!==state.manifestSha256)throw Error('旧版加载项已被外部修改，未覆盖。');
 return {record,manifest,state};
}
function wordIsRunning(){return run('/bin/ps',['-axo','comm=']).split('\n').some(line=>path.basename(line.trim())==='Microsoft Word');}
export async function installAutomatically({action='install',app='/Applications/Equation Lab.app',artifacts,user=loggedInUser(),checkOnly=false,installer,service,wordRunning=wordIsRunning}={}){
 if(wordRunning())throw Error('请先保存文档并退出 Microsoft Word，然后重新运行安装器。');
 const resolvedHome=await fs.realpath(user.home);if(resolvedHome!==user.home)throw Error('用户目录包含符号链接，未安装。');
 const startup=await automaticStartup(user.home,{forRemoval:action==='remove'});
 if(startup!==user.home&&!startup.startsWith(user.home+path.sep))throw Error('Word Startup 必须位于当前用户目录。');
 const api=installer??createInstaller({homeDirectory:user.home});
 const request={schema:'equationlab.word-plugin-request.v1',installationScope:'user',startupDirectory:startup,startupDirectoryConfirmed:true,artifactManifestDirectory:artifacts};
 const statePath=path.join(user.home,'Library/Application Support/Equation Lab/word-native/current.json');
 const state=await present(statePath)?JSON.parse(await fs.readFile(statePath,'utf8')):null;
 const moving=action==='install'&&state?.installed===true&&path.resolve(state.startupDirectory)!==startup;
 if(moving&&!state.startupDirectory.startsWith(user.home+path.sep))throw Error('旧 Word Startup 不在当前用户目录内，未迁移。');
 const oldRequest=moving?{...request,startupDirectory:state.startupDirectory}:null;
 const previous=await api.verify(oldRequest??request).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
 const web=await ownedWebManifest(user.home);
 const serviceStatus=await manageWordService({action:'status',home:user.home,uid:user.uid});
 if(action==='install'){
  const nativeState=path.join(user.home,'Library/Application Support/Equation Lab/word-native');
  const ownTargets=async directory=>{for(const name of ['EquationLabStartup.dotm','EquationLabInstallContext.json','MathTypeBridgeProbe.bundle'])await ownTree(path.join(directory,name),user);};
  // Validate the owned old installation and frozen inputs before removing it.
  // A name match at the new location never establishes ownership.
  const preflight=await api.plan(oldRequest??request);
  if(preflight.conflicts.length)throw Error('已有同名 Word 组件不属于本安装记录：'+JSON.stringify(preflight.conflicts));
  if(moving)for(const name of ['EquationLabStartup.dotm','EquationLabInstallContext.json','MathTypeBridgeProbe.bundle']){
   if(await present(path.join(startup,name)))throw Error('Word 新启动目录存在同名组件，未覆盖：'+name);
  }
  if(checkOnly)return {ok:true,startup,user:user.username,previous:previous?.phase,backgroundInstalled:serviceStatus.installed,...(moving?{migrateFrom:state.startupDirectory}:{})};
  const webRecordBytes=web?await fs.readFile(web.record):null;
  let webRemoved=false,oldRemoved=false,committed;
  try{
  if(moving){await api.uninstall(oldRequest);oldRemoved=true;await ownTree(nativeState,user);}
  const plan=moving?await api.plan(request):preflight;
  if(plan.conflicts.length)throw Error('Word 新启动目录存在组件冲突，未覆盖。');
  await ensureOwnedDirectories(startup,user);
  await ensureOwnedDirectories(nativeState,user);
  committed=await api.install({...request,approvedPlanDigest:plan.planDigest});
  await ownTree(nativeState,user);for(const file of committed.installedFiles)await ownTree(file.path,user);
  await ensureOwnedDirectories(path.join(startup,'.EquationLab'),user);
  if(service)await service({user,app});else if(process.geteuid()===0){
   const node=path.join(app,'Contents/Resources/runtime/bin/node'),script=path.join(app,'Contents/Resources/installer/word-native-installer/automatic-install.mjs');
   run('/usr/bin/sudo',['-u',user.username,'--',node,script,'--service-only','--home',user.home,'--uid',String(user.uid),'--app',app]);
  }else await manageWordService({home:user.home,uid:user.uid,app});
  if(web){
   const backup=path.join(committed.backupDirectory,'previous-web-manifest.xml');await fs.copyFile(web.manifest,backup);await ownTree(backup,user);
   await fs.unlink(web.manifest);webRemoved=true;
   const record={...web.state,migratedToNative:true,migratedAt:new Date().toISOString(),manifestBackup:backup};await fs.writeFile(web.record,JSON.stringify(record,null,2)+'\n',{mode:0o600});await ownTree(web.record,user);
  }
  return {...committed,user:user.username,startup,automatic:true,...(moving?{migratedFrom:state.startupDirectory}:{})};
  }catch(error){
   try{
    if(webRemoved){await fs.copyFile(path.join(committed.backupDirectory,'previous-web-manifest.xml'),web.manifest);await fs.writeFile(web.record,webRecordBytes,{mode:0o600});await ownTree(web.manifest,user);await ownTree(web.record,user);}
    if(committed){await api.rollback(request);await ownTree(nativeState,user);await ownTargets(startup);}
    if(oldRemoved){await api.rollback(oldRequest);await ownTree(nativeState,user);await ownTargets(state.startupDirectory);}
   }catch(rollbackError){throw Error('Word 插件安装未完成，恢复失败，已保留事务备份：'+rollbackError.message+'；原错误：'+error.message);}
   throw error;
  }
 }
 if(action!=='remove')throw Error('未知安装操作。');
 if(checkOnly)return {ok:true,user:user.username,startup,previous:previous?.phase};
 if(previous?.phase!=='not-installed')await api.uninstall(request);
 await ownTree(path.join(user.home,'Library/Application Support/Equation Lab/word-native'),user);
 if(service)await service({action:'remove',user,app});else await manageWordService({action:'remove',home:user.home,uid:user.uid});
 return {ok:true,removed:true,user:user.username,appRetained:true};
}
if(isMainModule(import.meta.url)){
 const args=process.argv.slice(2),value=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
 try{
  let result;
  if(args.includes('--service-only')){
   const uid=Number(value('--uid'));if(uid!==process.getuid())throw Error('后台服务用户不匹配。');
   result=await manageWordService({app:value('--app'),home:value('--home'),uid});
  }else if(args.includes('--update-existing')){
   const home=homedir(),record=path.join(home,'Library/Application Support/Equation Lab/word-native/current.json');
   const state=JSON.parse(await fs.readFile(record,'utf8'));
   if(process.geteuid()===0||state.schema!=='equationlab.word-native-installation.v1'||state.scope!=='user'||state.installed!==true)throw Error('现有用户安装记录不存在，请使用完整系统安装包。');
   const app=path.resolve(import.meta.dirname,'../../../..');if(!app.endsWith('.app'))throw Error('自动更新仅由已安装的 Equation Lab App 提供。');
   result=await installAutomatically({app,artifacts:path.join(app,'Contents/Resources/native-word-artifacts'),user:{home,uid:process.getuid(),gid:process.getgid(),username:userInfo().username}});
  }else{
   if(process.geteuid()!==0)throw Error('请通过 Equation Lab 系统安装包安装 Word 插件。');
   result=await installAutomatically({action:args.includes('--remove')?'remove':'install',app:value('--app','/Applications/Equation Lab.app'),artifacts:value('--artifacts',path.resolve(import.meta.dirname,'../artifacts')),checkOnly:args.includes('--check')});
  }
  process.stdout.write(JSON.stringify(result)+'\n');
 }catch(error){process.stderr.write('Equation Lab：'+error.message+'\n');process.exitCode=1;}
}
