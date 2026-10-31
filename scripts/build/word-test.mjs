// Helper for scripts/build_and_run.sh; Swift is built by that existing entry.
// Build-only touches only .local/word-test. Deployment is an explicit run phase.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {constants} from 'node:fs';
import {readArtifacts} from '../../packaging/word-native-installer/installer.mjs';
import {buildMathLiveEditor} from '../../packaging/mathlive-editor.mjs';
import {buildWorkbenchAssets} from '../../packaging/workbench-assets.mjs';
import {buildTemplatePreviews} from './build-template-previews.mjs';

const exec=promisify(execFile),sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const command=async(file,args,options={})=>{const {input,...settings}=options,pending=exec(file,args,{maxBuffer:4_000_000,...settings});if(input!==undefined)pending.child.stdin.end(input);return (await pending).stdout.trim();};
const readJson=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const present=async file=>fs.lstat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
export const WORD_TEST_BUNDLE_ID='app.equationlab.mac';
export const WORD_TEST_DESTINATION='/Applications/Equation Lab.app';
export const wordTestPaths=root=>({directory:path.join(root,'.local/word-test'),app:path.join(root,'.local/word-test/Equation Lab.app'),destination:WORD_TEST_DESTINATION,record:path.join(root,'.local/word-test/deployment.json')});
export function validateWordTestConfig(config){if(typeof config.version!=='string'||!/^\d+\.\d+\.\d+(?:[-.][A-Za-z0-9.-]+)?$/.test(config.version)||typeof config.build!=='string'||!/^\d+$/.test(config.build)||typeof config.nodeVersion!=='string'||!/^v\d+\.\d+\.\d+$/.test(config.nodeVersion)||config.bundleIdentifier!==WORD_TEST_BUNDLE_ID)throw Error('Word test requires string release version/build/nodeVersion and the shipping bundle identifier.');}
export function requireAcceptedNativeVersion(sourceVersion,seedVersion){if(typeof sourceVersion!=='string'||sourceVersion!==seedVersion)throw Error(`原生源码版本 ${sourceVersion} 与已验收 seed ${seedVersion} 不同；请先提供匹配的新宿主验收组件，未静默复用旧 helper。`);}
export function wordReceiptMatches(record,state,word,receipt,startup){return receipt.schema==='equationlab.word-native-startup-receipt.v1'&&receipt.entryPoint==='AutoExec'&&word.some(p=>p.pid===receipt.wordPID)&&receipt.installId===state.installId&&receipt.helperSha256===record.native.helperSha256&&receipt.helperVersion===record.native.version&&receipt.templateSha256===record.native.templateSha256&&receipt.templateBuildId===record.native.templateBuildId&&receipt.helperPath===path.join(startup,'MathTypeBridgeProbe.bundle/Contents/MacOS/MathTypeBridgeProbe')&&receipt.registrationResult===0&&receipt.registrationState===1&&Date.parse(receipt.timestamp)>=Date.parse(state.installedAt)&&['0002CE03-0000-0000-C000-000000000046','0002CE03-0000-0000-C000-000000000056'].every(id=>receipt.registeredCLSIDs?.includes(id));}
export function dependencyIdentity(lock){const copy=structuredClone(lock);delete copy.version;if(copy.packages?.[''])delete copy.packages[''].version;return sha(JSON.stringify(copy));}
export function assertStopped(processes,{app,all=false}={}){
 const blocked=processes.filter(p=>all?['EquationLab','Microsoft Word'].includes(path.basename(p.executable)):p.executable===path.join(app,'Contents/MacOS/EquationLab'));
 if(blocked.length)throw Error('请先保存并退出 Microsoft Word 和 Equation Lab，再运行 Word 测试；未停止任何进程。'+JSON.stringify(blocked));
}
export function assertBuildSafe(processes,{app,serviceApp}={}){
 assertStopped(processes,{app});
 if(serviceApp===app&&processes.some(p=>path.basename(p.executable)==='Microsoft Word'))throw Error('Word 后台服务仍绑定此测试副本，请先保存并退出 Microsoft Word 再构建；未停止任何进程。');
}
export function requireResolvedApplication(app,resolved){if(resolved!==app)throw Error(`实际应用路径 ${resolved??'未知'} 与 ${app} 不符；未视为部署成功。`);}
export function applicationSwapPaths(id,retainBaseline){return {destination:WORD_TEST_DESTINATION,stage:`/Applications/.Equation Lab.word-test-stage-${id}.app`,backup:`/Applications/.Equation Lab.word-test-${retainBaseline?'baseline':'previous'}-${id}`};}
export function validateSwapPaths(paths){
 if(paths.destination!==WORD_TEST_DESTINATION||!/^\/Applications\/\.Equation Lab\.word-test-stage-[a-f0-9-]{36}\.app$/.test(paths.stage)||!/^\/Applications\/\.Equation Lab\.word-test-(?:baseline|previous)-[a-f0-9-]{36}$/.test(paths.backup))throw Error('Refusing unknown deployment destination/stage/backup.');
}
// The caller must verify the exact backup/candidate before unregistering it.
export function isMissingWordTestRegistration(error,removed,verifiedPath){
 return removed===verifiedPath&&`${error.stdout??''}\n${error.stderr??''}`.split(/\r?\n/).some(line=>line.trim()===`failed to scan ${removed}: -10814`);
}
export function classifyPreviousApplication(previous,record,root,uid){
 const {info,release}=previous;
 if(info.CFBundleIdentifier!==WORD_TEST_BUNDLE_ID||info.CFBundleExecutable!=='EquationLab'||info.EquationLabNode!=='runtime/bin/node')throw Error('拒绝覆盖未知 Applications 应用。');
 if(info.EquationLabDevelopmentBuild){
  if(previous.uid!==uid||!record.baselineBackup||info.EquationLabDevelopmentRoot!==root||release.developmentRoot!==root||release.purpose!=='local-word-test'||release.developmentBuild!==info.EquationLabDevelopmentBuild||record.actualInstallation?.buildId!==info.EquationLabDevelopmentBuild||record.actualInstallation?.bundleSha256!==previous.bundleSha256)throw Error('拒绝覆盖未登记或已更改的开发应用。');
  return 'managed';
 }
 if(record.baselineBackup||record.seed.bundleSha256!==previous.bundleSha256||release.purpose!=='release')throw Error('拒绝覆盖与已验收 seed 不符的发行应用。');
 return 'baseline';
}
// All filesystem/service actions are injected so failure boundaries can be
// tested without touching Applications, LaunchServices, Word or launchd.
export async function replaceApplicationAtomically(paths,retainBaseline,ops){
 validateSwapPaths(paths);if(retainBaseline!==paths.backup.includes('.word-test-baseline-'))throw Error('Refusing baseline retention/backup path mismatch.');let oldMoved=false,newMoved=false,result;
 try{
  await ops.preflight();await ops.stage();await ops.verifyStage();await ops.preflight();await ops.verifyOriginal();
  await ops.rename(paths.destination,paths.backup);oldMoved=true;
  await ops.rename(paths.stage,paths.destination);newMoved=true;
  await ops.refreshRegistration(paths.backup);result=await ops.updateUserInstallation();
  await ops.verifyInstalled(result);await ops.commit(result);
 }catch(error){
  const rollbackErrors=[];let appRestored=!oldMoved,serviceRestored=!oldMoved;
  if(oldMoved)try{
   await ops.preflight();await ops.verifyBackup();
   if(newMoved){await ops.verifyCandidate();await ops.rename(paths.destination,paths.stage);}
   await ops.rename(paths.backup,paths.destination);appRestored=true;
   await ops.restoreUserInstallation(paths.stage);serviceRestored=true;
  }catch(rollbackError){rollbackErrors.push(rollbackError.message);}
  const rolledBack=appRestored&&serviceRestored;
  await ops.failure({error:error.message,rolledBack,appRestored,serviceRestored,rollbackErrors,backup:paths.backup,stage:paths.stage});
  if(rolledBack)await ops.cleanupStage();
  throw Error(error.message+(rollbackErrors.length?`；App ${appRestored?'已恢复':'恢复失败'}，自有 Word 安装${serviceRestored?'已恢复':'恢复失败'}，已保留恢复记录：`+rollbackErrors.join('；'):'；原 App 和自有 Word 安装已保留或恢复。'));
 }
 if(!retainBaseline)await ops.removePrevious().catch(error=>ops.cleanupWarning(error.message));
 await ops.cleanupStage();return result;
}
export async function wordTestAction(mode,operations){
 if(mode==='--build-only')return operations.build();
 if(mode==='--verify')return operations.verify();
 if(mode!=='run')throw Error('Word test supports run, --build-only or --verify.');
 await operations.preflight();await operations.build();await operations.preflight();
 await operations.deploy();await operations.verify();await operations.launch();return operations.verify();
}
async function processes(){const text=await command('/bin/ps',['-ww','-axo','pid=,comm=']);return text.split('\n').flatMap(line=>{const match=/^\s*(\d+)\s+(.+)$/.exec(line);return match?[{pid:Number(match[1]),executable:match[2]}]:[];});}
async function plist(file){return JSON.parse(await command('/usr/bin/plutil',['-convert','json','-o','-',file]));}
async function atomicJson(file,value){await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});const temp=file+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});await fs.rename(temp,file);}
async function inventory(directory){
 const files=[];
 async function visit(current){for(const entry of (await fs.readdir(current,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  const file=path.join(current,entry.name),name=path.relative(directory,file),stat=await fs.lstat(file);
  if(stat.isSymbolicLink()){const target=await fs.realpath(file);if(!target.startsWith(directory+path.sep))throw Error('External symlink in test bundle: '+name);files.push([name,'link',await fs.readlink(file)]);}
  else if(stat.isDirectory())await visit(file);
  else if(stat.isFile())files.push([name,stat.mode&0o777,sha(await fs.readFile(file))]);
  else throw Error('Unsupported test bundle file: '+name);
 }}
 await visit(directory);return {sha256:sha(JSON.stringify(files)),files:files.length};
}
async function assertLocalPaths(root){for(const directory of [path.join(root,'.local'),wordTestPaths(root).directory]){const stat=await present(directory);if(stat&&(!stat.isDirectory()||stat.isSymbolicLink()))throw Error('Word test directory must be a real local folder: '+directory);}}
async function assertBuildTargetIdle(app){const service=await readJson(path.join(os.homedir(),'Library/Application Support/Equation Lab/word-service-install.json')).catch(error=>{if(error.code==='ENOENT')return null;throw error;});assertBuildSafe(await processes(),{app,serviceApp:service?.app});}
async function seedApplication(root,config){
 const sourceVersion=(await plist(path.join(root,'native-word-probe/Info.plist'))).CFBundleShortVersionString;
 const candidates=process.env.EQUATIONLAB_WORD_TEST_SEED?[path.resolve(process.env.EQUATIONLAB_WORD_TEST_SEED)]:[path.join(root,`dist/${config.version}-build${config.build}/Equation Lab.app`),'/Applications/Equation Lab.app'];
 const failures=[];
 for(const app of candidates)try{
  const canonical=await fs.realpath(app),info=await plist(path.join(canonical,'Contents/Info.plist'));
  if(info.CFBundleIdentifier!==WORD_TEST_BUNDLE_ID||info.EquationLabNode!=='runtime/bin/node')throw Error('not a complete shipping bundle');
  await command('/usr/bin/codesign',['--verify','--deep','--strict',canonical]);
  const resources=path.join(canonical,'Contents/Resources'),native=await readArtifacts(path.join(resources,'native-word-artifacts'));
  if(native.manifest.binding!=='startup-adjacent')throw Error('requires accepted user Startup artifacts');
  requireAcceptedNativeVersion(sourceVersion,native.manifest.nativeVersion);
  const release=await readJson(path.join(resources,'release-manifest.json'));
  if(typeof release.runtime?.version!=='string'||release.runtime.version!==config.nodeVersion)throw Error('seed runtime manifest does not match the configured Node version');
  const lock=await readJson(path.join(resources,'engine/package-lock.json'));
  if(dependencyIdentity(lock)!==dependencyIdentity(await readJson(path.join(root,'package-lock.json'))))throw Error('production dependencies changed; prepare a complete seed matching package-lock.json');
  const runtime=path.join(resources,'runtime/bin/node');if(await command(runtime,['--version'])!==config.nodeVersion)throw Error('bundled Node runtime version differs');
  for(const file of ['installer/word-native-installer/automatic-install.mjs','engine/src/desktop-rpc.mjs','engine/node_modules/mathlive/package.json','licenses/Node-LICENSE.txt'])if(!(await fs.stat(path.join(resources,file))).isFile())throw Error('missing resource '+file);
  return {app:canonical,info,native,sourceNativeVersion:sourceVersion,bundleSha256:(await inventory(canonical)).sha256,runtimeSha256:sha(await fs.readFile(runtime)),lockSha256:sha(await fs.readFile(path.join(resources,'engine/package-lock.json')))};
 }catch(error){failures.push({app,error:error.message});}
 throw Error('没有可复用的完整已验收 App；未下载运行时或构建安装包。'+JSON.stringify(failures));
}
export async function buildWordTestBundle({root,buildDirectory}){
 if(process.geteuid()===0)throw Error('Word development tests run as the normal macOS user, without sudo.');
 root=path.resolve(root);await assertLocalPaths(root);const paths=wordTestPaths(root);
 await assertBuildTargetIdle(paths.app);
 const config=await readJson(path.join(root,'packaging/release.json'));validateWordTestConfig(config);const seed=await seedApplication(root,config);
 await fs.mkdir(paths.directory,{recursive:true,mode:0o700});
 const id=crypto.randomUUID(),stage=path.join(paths.directory,`.Equation Lab.${id}.app`),previous=path.join(paths.directory,`.previous.${id}.app`);
 let movedPrevious=false,published=false,committed=false;
 try{
  await fs.cp(seed.app,stage,{recursive:true,dereference:false,verbatimSymlinks:true,preserveTimestamps:true});
  const resources=path.join(stage,'Contents/Resources'),engine=path.join(resources,'engine');
  const copyTree=async(source,target)=>{await fs.rm(target,{recursive:true,force:true});await fs.cp(source,target,{recursive:true,dereference:false});};
  await fs.copyFile(path.join(buildDirectory,'EquationLab'),path.join(stage,'Contents/MacOS/EquationLab'));
  await fs.copyFile(path.join(buildDirectory,'EquationFontMetrics'),path.join(engine,'bin/EquationFontMetrics'));
  await copyTree(path.join(root,'src'),path.join(engine,'src'));
  await copyTree(path.join(root,'assets/fonts'),path.join(engine,'fonts'));
  for(const file of await fs.readdir(path.join(resources,'web')))if(/\.(html|css|js)$/.test(file))await fs.unlink(path.join(resources,'web',file));
  for(const file of await fs.readdir(path.join(root,'desktop')))if(/\.(html|css|js)$/.test(file))await fs.copyFile(path.join(root,'desktop',file),path.join(resources,'web',file));
  const enginePackage=await readJson(path.join(root,'package.json')),engineLock=await readJson(path.join(root,'package-lock.json'));
  enginePackage.version=config.version;engineLock.version=config.version;if(engineLock.packages?.[''])engineLock.packages[''].version=config.version;
  await fs.writeFile(path.join(engine,'package.json'),JSON.stringify(enginePackage,null,2)+'\n');
  await fs.writeFile(path.join(engine,'package-lock.json'),JSON.stringify(engineLock,null,2)+'\n');
  await fs.writeFile(path.join(engine,'src/version.mjs'),`// Generated for the local Word development bundle.\nexport const APP_VERSION=${JSON.stringify(config.version)};\n`);
  await fs.cp(path.join(root,'assets/licenses'),path.join(resources,'licenses'),{recursive:true});
  for(const file of ['LICENSE','THIRD_PARTY_NOTICES.md'])await fs.copyFile(path.join(root,file),path.join(resources,'licenses',file));
  await fs.copyFile(path.join(root,'packaging/word-service.mjs'),path.join(resources,'installer/word-service.mjs'));
  await fs.copyFile(path.join(root,'packaging/word-native-installer/installer.mjs'),path.join(resources,'installer/word-native-installer.mjs'));
  for(const file of ['installer.mjs','automatic-install.mjs','build-automatic-pkg.mjs'])await fs.copyFile(path.join(root,'packaging/word-native-installer',file),path.join(resources,'installer/word-native-installer',file));
  // The release seed deliberately prunes MathLive's unminified build input.
  // Use the existing npm-ci checkout to rebuild the adapter, while retaining
  // the seed's locked production dependencies inside the standalone bundle.
  await buildMathLiveEditor({root,mathliveDirectory:path.join(root,'node_modules/mathlive'),output:path.join(resources,'web/vendor/mathlive.min.js')});
  await buildWorkbenchAssets({root,resources});
  await buildTemplatePreviews(path.join(resources,'template-previews'));
  const icons=await readJson(path.join(root,'design/equation-lab-icons/v6/manifest.json'));await fs.copyFile(path.join(root,'design/equation-lab-icons/v6',icons.icns),path.join(resources,'EquationLab.icns'));
  const info={...seed.info,CFBundleShortVersionString:config.version,CFBundleVersion:config.build,EquationLabDevelopmentBuild:id,EquationLabDevelopmentRoot:root};
  await fs.writeFile(path.join(stage,'Contents/Info.plist'),JSON.stringify(info));await command('/usr/bin/plutil',['-convert','xml1',path.join(stage,'Contents/Info.plist')]);
  await fs.copyFile(path.join(resources,'release-manifest.json'),path.join(resources,'seed-release-manifest.json'));
  await fs.writeFile(path.join(resources,'release-manifest.json'),JSON.stringify({equationlabBundle:true,purpose:'local-word-test',version:config.version,build:config.build,developmentBuild:id,developmentRoot:root,runtime:{version:config.nodeVersion,sha256:seed.runtimeSha256},seed:seed.app,nativeArtifactsManifestSha256:seed.native.manifestSha256,actualWordUsed:false},null,2)+'\n');
  await command('/usr/bin/codesign',['--force','--sign','-',path.join(engine,'bin/EquationFontMetrics')]);
  await command('/usr/bin/codesign',['--force','--sign','-',stage]);
  await command('/usr/bin/codesign',['--verify','--deep','--strict',stage]);
  const native=await readArtifacts(path.join(resources,'native-word-artifacts'));
  if(native.manifestSha256!==seed.native.manifestSha256||sha(await fs.readFile(path.join(resources,'runtime/bin/node')))!==seed.runtimeSha256)throw Error('Accepted native inputs or bundled runtime changed during build.');
  const validation=JSON.parse(await command(path.join(resources,'runtime/bin/node'),[path.join(engine,'src/desktop-rpc.mjs')],{cwd:os.tmpdir(),input:JSON.stringify({action:'validate',payload:{latex:'\\frac{a+c}{\\sqrt{x^2+y^2}}'}}),env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin'},timeout:30000}));
  if(!validation.ok||!validation.data?.nativeBytes||!validation.data.svg?.includes('<svg'))throw Error('Bundled equation engine failed its standalone check.');
  const engineVersion=await command(path.join(resources,'runtime/bin/node'),['--input-type=module','-e','const {pathToFileURL}=await import("node:url");const {APP_VERSION}=await import(pathToFileURL(process.argv[1]));process.stdout.write(APP_VERSION);',path.join(engine,'src/version.mjs')],{cwd:os.tmpdir(),env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin'}});
  if(engineVersion!==config.version)throw Error('Bundled engine and App versions differ.');
  const previousRecord=await readJson(paths.record).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  const built={schema:'equationlab.word-test-deployment.v1',id,status:'built-not-deployed',builtAt:new Date().toISOString(),buildApp:paths.app,app:paths.destination,developmentRoot:root,bundleIdentifier:WORD_TEST_BUNDLE_ID,version:config.version,build:config.build,configuration:'release',appExecutableSha256:sha(await fs.readFile(path.join(stage,'Contents/MacOS/EquationLab'))),bundle:await inventory(stage),runtime:{version:config.nodeVersion,sha256:seed.runtimeSha256},seed:{app:seed.app,version:seed.info.CFBundleShortVersionString,build:seed.info.CFBundleVersion,bundleSha256:seed.bundleSha256,lockSha256:seed.lockSha256},native:{version:native.manifest.nativeVersion,sourceVersion:seed.sourceNativeVersion,reusedAcceptedArtifacts:true,helperSha256:native.manifest.bundle.binarySha256,templateSha256:native.manifest.template.sha256,templateBuildId:native.manifest.template.buildId,artifactManifestSha256:native.manifestSha256},checks:{strictSignature:true,relocatedEngine:true,engineVersionBound:true,nativeInputsPreserved:true,bundledRuntimePreserved:true,actualWordUsed:false,installerRun:false,launchServicesModified:false},baselineBackup:previousRecord?.baselineBackup??null,actualInstallation:previousRecord?.actualInstallation??null,deployment:null};
  // Recheck just before replacing a previous user test copy. Never overwrite
  // a running editor, even when the build was started with --build-only.
  await assertBuildTargetIdle(paths.app);
  if(await present(paths.app)){await fs.rename(paths.app,previous);movedPrevious=true;}
  await fs.rename(stage,paths.app);published=true;
  await atomicJson(paths.record,built);committed=true;if(movedPrevious)await fs.rm(previous,{recursive:true,force:true}).catch(error=>console.error('旧测试副本清理失败，已保留：'+error.message));
  return built;
 }catch(error){if(!committed){if(published)await fs.rm(paths.app,{recursive:true,force:true});if(movedPrevious)await fs.rename(previous,paths.app);}throw error;}
 finally{await fs.rm(stage,{recursive:true,force:true});}
}

async function workspaceState(){
 const code='import AppKit\nimport Foundation\nlet id="app.equationlab.mac"\nlet running=NSRunningApplication.runningApplications(withBundleIdentifier:id).map{["pid":Int($0.processIdentifier),"app":$0.bundleURL?.path ?? ""] as [String:Any]}\nlet value:[String:Any] = ["resolved":NSWorkspace.shared.urlForApplication(withBundleIdentifier:id)?.path ?? "", "running":running]\nprint(String(data:try JSONSerialization.data(withJSONObject:value),encoding:.utf8)!)';
 return JSON.parse(await command('/usr/bin/swift',['-e',code],{timeout:30000}));
}
async function verifyCandidate(app,record){
 const stat=await fs.lstat(app),info=await plist(path.join(app,'Contents/Info.plist'));
 if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||info.CFBundleIdentifier!==WORD_TEST_BUNDLE_ID||info.EquationLabDevelopmentBuild!==record.id||info.EquationLabDevelopmentRoot!==record.developmentRoot||info.CFBundleVersion!==record.build||info.CFBundleShortVersionString!==record.version)throw Error('测试 App 的路径、owner 或构建 UUID 不符，请重新构建。');
 await command('/usr/bin/codesign',['--verify','--deep','--strict',app]);
 if((await inventory(app)).sha256!==record.bundle.sha256)throw Error('测试 App 已在构建后更改，请重新构建。');
 const native=await readArtifacts(path.join(app,'Contents/Resources/native-word-artifacts'));
 if(native.manifestSha256!==record.native.artifactManifestSha256)throw Error('测试 App 的原生组件已更改。');
}
async function verifyStoredBaseline(baseline){
 if(!baseline)return;
 if(!/^\/Applications\/\.Equation Lab\.word-test-baseline-[a-f0-9-]{36}$/.test(baseline.path))throw Error('拒绝未知基线备份路径。');
 const stat=await fs.lstat(baseline.path);
 if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==baseline.ownerUid||(await inventory(baseline.path)).sha256!==baseline.bundleSha256)throw Error('原发行版基线备份已改变，未覆盖。');
}
async function verifyWordTest(root,{deployed=true,recordOverride,persist=true}={}){
 const paths=wordTestPaths(root),record=recordOverride??await readJson(paths.record);
 if(record.schema!=='equationlab.word-test-deployment.v1'||record.buildApp!==paths.app||record.app!==paths.destination||record.developmentRoot!==root)throw Error('测试构建记录不符，请重新 --word-test --build-only。');
 await verifyCandidate(deployed?paths.destination:paths.app,record);
 if(!deployed)return {bundleVerified:true,record};
 if(!record.deployment||record.deployment.buildId!==record.id||record.actualInstallation?.buildId!==record.id||record.actualInstallation?.bundleSha256!==record.bundle.sha256)throw Error('当前构建尚未部署到 Applications。');
 await verifyStoredBaseline(record.baselineBackup);
 const workspace=await workspaceState();requireResolvedApplication(paths.destination,workspace.resolved);
 const support=path.join(os.homedir(),'Library/Application Support/Equation Lab'),state=await readJson(path.join(support,'word-native/current.json')),service=await readJson(path.join(support,'word-service-install.json'));
 if(state.scope!=='user'||state.installed!==true||state.installId!==record.deployment.installId||state.nativeVersion!==record.native.version||state.nativeBinarySha256!==record.native.helperSha256||state.templateBuildId!==record.native.templateBuildId||service.app!==paths.destination||!(Date.parse(service.installedAt)>=Date.parse(record.deployment.publishedAt)))throw Error('当前 Word 插件或用户服务没有重新绑定此次 Applications 构建。');
 const startup=state.startupDirectory;
 if(sha(await fs.readFile(path.join(startup,'MathTypeBridgeProbe.bundle/Contents/MacOS/MathTypeBridgeProbe')))!==record.native.helperSha256||sha(await fs.readFile(path.join(startup,'EquationLabStartup.dotm')))!==record.native.templateSha256)throw Error('实际 Startup 组件哈希不符。');
 const serviceFile=path.join(os.homedir(),'Library/LaunchAgents/app.equationlab.word-service.plist');
 if(sha(await fs.readFile(serviceFile))!==service.plistSha256)throw Error('用户后台服务配置已更改。');
 const serviceInfo=await plist(serviceFile),resources=path.join(paths.destination,'Contents/Resources');
 if(JSON.stringify(serviceInfo.ProgramArguments)!==JSON.stringify([path.join(resources,'runtime/bin/node'),path.join(resources,'engine/src/app-services.mjs')]))throw Error('用户服务实际执行路径不符。');
 const loaded=await command('/bin/launchctl',['print',`gui/${process.getuid()}/app.equationlab.word-service`]);
 if(!loaded.includes(path.join(resources,'runtime/bin/node'))||!loaded.includes(path.join(resources,'engine/src/app-services.mjs')))throw Error('launchd 未运行此测试副本的服务。');
 const servicePID=Number(/\bpid = (\d+)/.exec(loaded)?.[1]);if(!servicePID)throw Error('Word 用户服务尚未运行。');
 const listeners=await command('/usr/sbin/lsof',['-nP','-iTCP:37952','-sTCP:LISTEN','-Fp']).catch(()=> '');
 if(!listeners.split('\n').includes('p'+servicePID))throw Error('Word 端口不属于此次重启的用户服务，未停止其他进程。');
 const health=await fetch('http://127.0.0.1:37952/api/health',{signal:AbortSignal.timeout(1500)}).then(r=>r.ok?r.json():null).catch(()=>null);
 if(health?.app!=='Equation Lab'||health.version!==record.version)throw Error('Word 用户服务健康状态或版本不符。');
 for(const app of workspace.running)if(app.app!==paths.destination)throw Error('仍有其他 Equation Lab 副本运行：'+JSON.stringify(app));
 const word=(await processes()).filter(p=>path.basename(p.executable)==='Microsoft Word');let wordHostVerified=false;
 if(word.length){const receipt=await readJson(path.join(startup,'.EquationLab/native-startup-receipt.json'));wordHostVerified=wordReceiptMatches(record,state,word,receipt,startup);if(!wordHostVerified)throw Error('Word 进程存在，但冷启动回执不匹配本次安装，不能视为已加载正确版本。');}
 const verification={checkedAt:new Date().toISOString(),buildApp:paths.app,app:paths.destination,buildId:record.id,bundleVerified:true,deploymentVerified:true,launchServicesTarget:workspace.resolved,servicePID,servicePortOwned:true,serviceVersion:health.version,appPIDs:workspace.running.map(app=>app.pid),wordHostVerified,startup,native:record.native,baselineBackup:record.baselineBackup};
 if(persist)await atomicJson(paths.record,{...record,verification});return verification;
}
async function preflight(root){
 if(process.geteuid()===0)throw Error('不要用 sudo 运行 Word 开发测试。');await assertLocalPaths(root);assertStopped(await processes(),{app:wordTestPaths(root).destination,all:true});
 const directory=await fs.lstat('/Applications');if(!directory.isDirectory()||directory.isSymbolicLink())throw Error('Applications 必须是真实文件夹。');
 await fs.access('/Applications',constants.W_OK).catch(()=>{throw Error('当前用户没有 /Applications 父目录写权限；未要求密码或使用 sudo。');});
}
async function updateExisting(app){
 const resources=path.join(app,'Contents/Resources'),installed=JSON.parse(await command(path.join(resources,'runtime/bin/node'),[path.join(resources,'installer/word-native-installer/automatic-install.mjs'),'--update-existing'],{timeout:90000}));
 if(!installed.automatic||!installed.installId)throw Error('用户插件更新未返回已提交安装身份。');return installed;
}
async function deploy(root){
 await preflight(root);const paths=wordTestPaths(root),{record}=await verifyWordTest(root,{deployed:false});await verifyStoredBaseline(record.baselineBackup);
 const originalStat=await fs.lstat(paths.destination);if(!originalStat.isDirectory()||originalStat.isSymbolicLink())throw Error('拒绝覆盖未知 Applications 目标。');
 await command('/usr/bin/codesign',['--verify','--deep','--strict',paths.destination]);await readArtifacts(path.join(paths.destination,'Contents/Resources/native-word-artifacts'));
 const original={info:await plist(path.join(paths.destination,'Contents/Info.plist')),release:await readJson(path.join(paths.destination,'Contents/Resources/release-manifest.json')),uid:originalStat.uid,bundleSha256:(await inventory(paths.destination)).sha256};
 const kind=classifyPreviousApplication(original,record,root,process.getuid()),swap=applicationSwapPaths(crypto.randomUUID(),kind==='baseline');
 for(const file of [swap.stage,swap.backup])if(await present(file))throw Error('拒绝使用已存在的 staging/backup：'+file);
 let stageCreated=false,publishedAt,pending;
 const verifyOriginalAt=async file=>{const stat=await fs.lstat(file);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==original.uid||(await inventory(file)).sha256!==original.bundleSha256)throw Error('原 App 或本轮备份已改变，未覆盖：'+file);};
 const refreshRegistration=async removed=>{
  const registry='/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
  if(removed!==swap.backup&&removed!==swap.stage)throw Error('拒绝注销本轮 staging/backup 之外的路径。');
  if(removed===swap.backup)await verifyOriginalAt(removed);else await verifyCandidate(removed,record);
  try{await command(registry,['-u',removed]);}catch(error){if(!isMissingWordTestRegistration(error,removed,removed))throw error;}
  await verifyCandidate(paths.app,record);
  try{await command(registry,['-u',paths.app]);}catch(error){if(!isMissingWordTestRegistration(error,paths.app,paths.app))throw error;}
  await command(registry,['-f',paths.destination]);requireResolvedApplication(paths.destination,(await workspaceState()).resolved);
 };
 const cleanupStage=async()=>{const stat=await present(swap.stage);if(stat){if(!stageCreated||!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid())throw Error('拒绝清理未知 staging。');await fs.rm(swap.stage,{recursive:true});}};
 await atomicJson(paths.record,{...record,deploymentAttempt:{...swap,kind,originalOwnerUid:original.uid,originalSha256:original.bundleSha256,startedAt:new Date().toISOString()}});
 return replaceApplicationAtomically(swap,kind==='baseline',{
  preflight:()=>preflight(root),stage:async()=>{stageCreated=true;await fs.cp(paths.app,swap.stage,{recursive:true,dereference:false,verbatimSymlinks:true,preserveTimestamps:true,errorOnExist:true,force:false});},
  verifyStage:()=>verifyCandidate(swap.stage,record),verifyOriginal:()=>verifyOriginalAt(swap.destination),verifyBackup:()=>verifyOriginalAt(swap.backup),verifyCandidate:()=>verifyCandidate(swap.destination,record),
  rename:async(from,to)=>{if(await present(to))throw Error('拒绝覆盖已存在的目标：'+to);await fs.rename(from,to);if(to===swap.destination)publishedAt=new Date().toISOString();},
  refreshRegistration,updateUserInstallation:()=>updateExisting(swap.destination),
  verifyInstalled:async installed=>{
   const baselineBackup=record.baselineBackup??{path:swap.backup,ownerUid:original.uid,bundleSha256:original.bundleSha256,version:original.info.CFBundleShortVersionString,build:original.info.CFBundleVersion,createdAt:new Date().toISOString()};
   pending={...record,status:'deployed',baselineBackup,actualInstallation:{app:swap.destination,buildId:record.id,bundleSha256:record.bundle.sha256,ownerUid:process.getuid()},deployment:{publishedAt,installedAt:new Date().toISOString(),buildId:record.id,installId:installed.installId,startup:installed.startup,app:swap.destination,buildApp:paths.app,helperSha256:record.native.helperSha256,templateSha256:record.native.templateSha256,previousBackup:kind==='managed'?swap.backup:null}};
   pending.verification=await verifyWordTest(root,{recordOverride:pending,persist:false});
  },commit:()=>atomicJson(paths.record,pending),
  restoreUserInstallation:async failed=>{await refreshRegistration(failed);await updateExisting(swap.destination);},
  removePrevious:async()=>{if(original.uid!==process.getuid()||kind!=='managed')throw Error('拒绝删除非本用户的旧开发副本。');await verifyOriginalAt(swap.backup);await fs.rm(swap.backup,{recursive:true});},cleanupStage,
  cleanupWarning:async warning=>{const current=await readJson(paths.record);await atomicJson(paths.record,{...current,cleanupWarning:warning});},
  failure:result=>atomicJson(paths.record,{...record,status:'deployment-failed',deploymentAttempt:{...swap,kind,...result}})
 });
}
async function launchWordTest(app){
 await command('/usr/bin/open',['-n',app]);
 for(let attempt=0;attempt<30;attempt++){const state=await workspaceState();if(state.running.some(p=>p.app===app))return;if(state.running.length)throw Error('启动了其他 Equation Lab 副本，未视为测试成功。');await new Promise(resolve=>setTimeout(resolve,100));}
 throw Error('open 已返回，但未确认准确路径的测试 App 在运行。');
}
// Computer Use can launch the verified bundle after this deployment completes.
export {deploy as deployWordTestBundle};
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const [mode,rootArg,buildDirectory]=process.argv.slice(2),root=path.resolve(rootArg??'.'),paths=wordTestPaths(root);
  const result=mode==='preflight'?await preflight(root):await wordTestAction(mode,{build:()=>buildWordTestBundle({root,buildDirectory}),preflight:()=>preflight(root),deploy:()=>deploy(root),verify:()=>verifyWordTest(root),launch:()=>launchWordTest(paths.destination)});
  if(result)console.log(JSON.stringify(result));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
