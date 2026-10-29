import {mkdir,readFile,writeFile,rename,unlink,lstat} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

export const SERVICE_LABEL='app.equationlab.word-service';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const xml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const run=(command,args)=>execFileSync(command,args,{encoding:'utf8',timeout:15000,stdio:['ignore','pipe','pipe']});
const optionalFile=async file=>{try{const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Word 后台服务安装文件不是普通文件');return await readFile(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}};

export function servicePlist(app,support){
 if(!isAbsolute(app)||!isAbsolute(support)||[app,support].some(value=>/[\u0000-\u001f]/.test(value)))throw Error('后台服务需要有效的绝对路径');
 const resources=join(app,'Contents/Resources'),node=join(resources,'runtime/bin/node'),script=join(resources,'engine/src/app-services.mjs');
 // Word waits for these user-initiated HTTP requests. Background throttles
 // document parsing; Adaptive cannot boost this service without XPC activity.
 return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${SERVICE_LABEL}</string>
<key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(script)}</string></array>
<key>WorkingDirectory</key><string>${xml(join(resources,'engine'))}</string>
<key>EnvironmentVariables</key><dict><key>EQUATIONLAB_DATA_DIR</key><string>${xml(support)}</string><key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>5</integer>
<key>ProcessType</key><string>Interactive</string>
<key>StandardOutPath</key><string>${xml(join(support,'logs/word-service.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(support,'logs/word-service-error.log'))}</string>
</dict></plist>\n`;
}

// Manage only our hash-bound user agent. Unknown files and other processes are
// never displaced; launchd starts the app's signed, bundled Node runtime.
export async function manageWordService({action='install',app,home=homedir(),uid=process.getuid(),execute=run}={}){
 const support=join(home,'Library/Application Support/Equation Lab'),directory=join(home,'Library/LaunchAgents');
 const target=join(directory,SERVICE_LABEL+'.plist'),record=join(support,'word-service-install.json'),domain=`gui/${uid}`,service=`${domain}/${SERVICE_LABEL}`;
 const current=await optionalFile(target),oldRecord=await optionalFile(record);
 let state;try{state=oldRecord?JSON.parse(oldRecord):null;}catch{throw Error('Word 后台服务安装记录损坏');}
 if(current&&(!state||state.label!==SERVICE_LABEL||state.plistSha256!==digest(current)))throw Error('后台服务文件已被外部修改，未覆盖或移除');
 if(action==='status')return {installed:!!current,app:state?.app};
 const loaded=()=>{try{execute('/bin/launchctl',['print',service]);return true;}catch{return false;}};
 const wasLoaded=loaded();
 if(wasLoaded&&!current)throw Error('发现未登记的同名后台服务，未停止或覆盖');
 if(action==='remove'){
  if(loaded())execute('/bin/launchctl',['bootout',service]);
  if(current)await unlink(target);
  if(oldRecord)await unlink(record);
  return {installed:false};
 }
 if(action!=='install')throw Error('未知后台服务操作');
 const plist=servicePlist(app,support);
 for(const file of [join(app,'Contents/Resources/runtime/bin/node'),join(app,'Contents/Resources/engine/src/app-services.mjs')]){
  if(!(await lstat(file)).isFile())throw Error('应用缺少内置 Word 服务');
 }
 await mkdir(directory,{recursive:true,mode:0o700});await mkdir(join(support,'logs'),{recursive:true,mode:0o700});
 const temporary=target+`.${process.pid}.tmp`;
 const recordTemporary=record+`.${process.pid}.tmp`;
 const recordSuccessfulInstall=async()=>{
  const next={schema:'equationlab.word-service-install.v1',label:SERVICE_LABEL,app,plistSha256:digest(plist),installedAt:new Date().toISOString()};
  try{await writeFile(recordTemporary,JSON.stringify(next,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(recordTemporary,record);}
  finally{await unlink(recordTemporary).catch(()=>{});}
 };
 const bootstrap=async()=>{for(let attempt=0;;attempt++){try{return execute('/bin/launchctl',['bootstrap',domain,target]);}catch(error){if(attempt>=15||!String(error.stderr??error.message).includes('Bootstrap failed: 5:'))throw error;await delay(200);}}};
 // If the exact hash-owned configuration is already installed, keep the
 // launchd job registered. A deleted and restored app can leave launchd with
 // the old job definition; kickstart reloads it without bootout/bootstrap's
 // transient "service already loaded" failure.
 if(current&&current.equals(Buffer.from(plist))){
  try{
   if(wasLoaded)execute('/bin/launchctl',['kickstart','-k',service]);
   else await bootstrap();
   if(!loaded())throw Error('macOS 未启动 Word 后台服务');
   await recordSuccessfulInstall();
   return {installed:true,label:SERVICE_LABEL,app};
  }catch(error){throw Error('Word 后台服务安装失败：'+error.message);}
 }
 try{
  if(wasLoaded)execute('/bin/launchctl',['bootout',service]);
  await writeFile(temporary,plist,{mode:0o600,flag:'wx'});await rename(temporary,target);
  await bootstrap();
  if(!loaded())throw Error('macOS 未启动 Word 后台服务');
  await recordSuccessfulInstall();
  return {installed:true,label:SERVICE_LABEL,app};
 }catch(error){
  try{if(loaded())execute('/bin/launchctl',['bootout',service]);}catch{}
  if(current)await writeFile(target,current,{mode:0o600});else await unlink(target).catch(()=>{});
  if(oldRecord)await writeFile(record,oldRecord,{mode:0o600});else await unlink(record).catch(()=>{});
  if(wasLoaded&&current)try{await bootstrap();}catch{}
  throw Error('Word 后台服务安装失败：'+error.message);
 }finally{await unlink(temporary).catch(()=>{});}
}
