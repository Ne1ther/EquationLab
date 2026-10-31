import test from 'node:test';
import assert from 'node:assert/strict';
import {assertStopped,assertBuildSafe,dependencyIdentity,requireResolvedApplication,wordTestAction,validateWordTestConfig,requireAcceptedNativeVersion,wordReceiptMatches,WORD_TEST_DESTINATION,applicationSwapPaths,validateSwapPaths,isMissingWordTestRegistration,classifyPreviousApplication,replaceApplicationAtomically} from '../scripts/build/word-test.mjs';

const app='/Users/developer/Equation Lab/.local/word-test/Equation Lab.app';
test('build-only allows other app copies but never replaces its running test copy',()=>{
 const other=[{pid:1,executable:'/Applications/Equation Lab.app/Contents/MacOS/EquationLab'},{pid:2,executable:'/Applications/Microsoft Word.app/Contents/MacOS/Microsoft Word'}];
 assert.doesNotThrow(()=>assertStopped(other,{app}));assert.throws(()=>assertStopped(other,{app,all:true}),/先保存并退出/);
 assert.throws(()=>assertStopped([{pid:3,executable:app+'/Contents/MacOS/EquationLab'}],{app}),/先保存并退出/);
});
test('build-only refuses an in-use service-bound test path even when its App is closed',()=>{
 const word=[{pid:2,executable:'/Applications/Microsoft Word.app/Contents/MacOS/Microsoft Word'}];
 assert.throws(()=>assertBuildSafe(word,{app,serviceApp:app}),/Word 后台服务仍绑定/);
 assert.doesNotThrow(()=>assertBuildSafe(word,{app,serviceApp:'/Applications/Equation Lab.app'}));
 assert.doesNotThrow(()=>assertBuildSafe([],{app,serviceApp:app}));
});
test('the actual Applications path cannot be substituted by a staging copy',()=>{
 assert.doesNotThrow(()=>requireResolvedApplication(WORD_TEST_DESTINATION,WORD_TEST_DESTINATION));
 assert.throws(()=>requireResolvedApplication(WORD_TEST_DESTINATION,app),/不符/);
 assert.throws(()=>requireResolvedApplication(WORD_TEST_DESTINATION,null),/未知/);
});
test('seed lock identity tolerates release version stamping but rejects changed dependencies',()=>{
 const original={version:'0.6.1',packages:{'':{version:'0.6.1',dependencies:{mathlive:'1.2.3'}},'node_modules/mathlive':{version:'1.2.3',integrity:'abc'}}};
 const stamped=structuredClone(original);stamped.version=stamped.packages[''].version='0.6.2';assert.equal(dependencyIdentity(original),dependencyIdentity(stamped));
 stamped.packages['node_modules/mathlive'].integrity='changed';assert.notEqual(dependencyIdentity(original),dependencyIdentity(stamped));
});
test('configuration types and native source/accepted seed versions must match',()=>{
 const config={version:'0.6.1',build:'55',nodeVersion:'v24.21.0',bundleIdentifier:'app.equationlab.mac'};
 assert.doesNotThrow(()=>validateWordTestConfig(config));
 for(const change of [{build:55},{nodeVersion:'24.21.0'},{version:0.6},{bundleIdentifier:'local.xuchang.equationlab'}])assert.throws(()=>validateWordTestConfig({...config,...change}),/requires string/);
 assert.doesNotThrow(()=>requireAcceptedNativeVersion('0.0.18','0.0.18'));
 assert.throws(()=>requireAcceptedNativeVersion('0.0.19','0.0.18'),/未静默复用旧 helper/);
});
test('a matching process alone cannot satisfy the actual cold receipt contract',()=>{
 const startup='/Users/developer/Word',record={native:{version:'0.0.18',helperSha256:'a'.repeat(64),templateSha256:'b'.repeat(64),templateBuildId:'native-context-v13'}},state={installId:'new-install',installedAt:'2026-10-20T00:00:00Z'},word=[{pid:40}];
 const receipt={schema:'equationlab.word-native-startup-receipt.v1',entryPoint:'AutoExec',wordPID:40,installId:state.installId,helperSha256:record.native.helperSha256,helperVersion:record.native.version,templateSha256:record.native.templateSha256,templateBuildId:record.native.templateBuildId,helperPath:startup+'/MathTypeBridgeProbe.bundle/Contents/MacOS/MathTypeBridgeProbe',registrationResult:0,registrationState:1,timestamp:'2026-10-20T00:00:01Z',registeredCLSIDs:['0002CE03-0000-0000-C000-000000000046','0002CE03-0000-0000-C000-000000000056']};
 assert.equal(wordReceiptMatches(record,state,word,receipt,startup),true);
 for(const change of [{wordPID:41},{helperVersion:'0.0.17'},{helperSha256:'old'},{templateSha256:'old'},{templateBuildId:'v12'},{installId:'previous-install'},{schema:'other'},{entryPoint:'other'},{entryPoint:'LazyConnect'},{registrationState:0},{timestamp:'2026-10-19T00:00:00Z'},{registeredCLSIDs:[]},{helperPath:'/other/helper'}])assert.equal(wordReceiptMatches(record,state,word,{...receipt,...change},startup),false);
});
function operations(){const calls=[];return {calls,...Object.fromEntries(['build','preflight','deploy','verify','launch'].map(name=>[name,async()=>{calls.push(name);return name;}]))};}
test('build-only cannot invoke deployment or app launch; verify does not build',async()=>{
 const build=operations();await wordTestAction('--build-only',build);assert.deepEqual(build.calls,['build']);
 const verify=operations();await wordTestAction('--verify',verify);assert.deepEqual(verify.calls,['verify']);
});
test('run checks stopped processes twice and verifies deployment before launch',async()=>{
 const good=operations();await wordTestAction('run',good);assert.deepEqual(good.calls,['preflight','build','preflight','deploy','verify','launch','verify']);
 const busy=operations();busy.preflight=async()=>{throw Error('Word running');};await assert.rejects(wordTestAction('run',busy),/Word running/);assert.deepEqual(busy.calls,[]);
});
const swap=applicationSwapPaths('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',true);
test('Applications promotion uses same-parent paths and a hidden baseline without an App suffix',()=>{
 assert.doesNotThrow(()=>validateSwapPaths(swap));assert.equal(swap.backup.endsWith('.app'),false);
 for(const change of [{destination:'/Applications/Unknown.app'},{stage:'/tmp/Equation Lab.app'},{backup:'/Applications/Unknown'}])assert.throws(()=>validateSwapPaths({...swap,...change}),/unknown/);
});
test('only an exact -10814 scan error for the verified backup, build copy or rollback stage needs no unregister',()=>{
 for(const file of [swap.backup,app,swap.stage])assert.equal(isMissingWordTestRegistration({stdout:`failed to scan ${file}: -10814\n from spotlight`},file,file),true);
 for(const [error,removed,verified] of [[{stderr:`failed to scan ${swap.backup}: -54`},swap.backup,swap.backup],[{stderr:`failed to scan ${swap.backup}: -10814`},swap.backup,swap.backup+'-other'],[{stderr:`failed to scan ${app}: -10814`},app,swap.stage],[{stderr:'permission denied (-10814)'},swap.backup,swap.backup]])assert.equal(isMissingWordTestRegistration(error,removed,verified),false);
});
test('only the exact accepted release or recorded user-owned development copy can be replaced',()=>{
 const root='/Users/developer/Equation Lab',info={CFBundleIdentifier:'app.equationlab.mac',CFBundleExecutable:'EquationLab',EquationLabNode:'runtime/bin/node'},release={purpose:'release'},record={seed:{bundleSha256:'accepted'}};
 assert.equal(classifyPreviousApplication({info,release,uid:0,bundleSha256:'accepted'},record,root,501),'baseline');
 assert.throws(()=>classifyPreviousApplication({info,release,uid:0,bundleSha256:'changed'},record,root,501),/发行应用/);
 const tracked={...record,baselineBackup:{path:swap.backup},actualInstallation:{buildId:'old-id',bundleSha256:'managed'}};
 const previous={info:{...info,EquationLabDevelopmentBuild:'old-id',EquationLabDevelopmentRoot:root},release:{purpose:'local-word-test',developmentRoot:root,developmentBuild:'old-id'},uid:501,bundleSha256:'managed'};
 assert.equal(classifyPreviousApplication(previous,tracked,root,501),'managed');
 for(const change of [{uid:0},{bundleSha256:'tampered'},{info:{...previous.info,EquationLabDevelopmentRoot:'/other'}}])assert.throws(()=>classifyPreviousApplication({...previous,...change},tracked,root,501),/未登记或已更改/);
});
function swapOperations(fault){const calls=[];let failure;
 const ops=Object.fromEntries(['preflight','stage','verifyStage','verifyOriginal','verifyBackup','verifyCandidate','refreshRegistration','updateUserInstallation','verifyInstalled','commit','restoreUserInstallation','removePrevious','cleanupStage','cleanupWarning'].map(name=>[name,async(...args)=>{calls.push([name,...args]);if(fault===name)throw Error('failed '+name);return {installId:'new'};}]));
 ops.rename=async(from,to)=>{calls.push(['rename',from,to]);if(fault==='promote'&&from===swap.stage)throw Error('promote failed');};
 ops.failure=async value=>{calls.push(['failure']);failure=value;};return {ops,calls,get failure(){return failure;}};
}
test('the first release baseline is retained; managed previous copies are removed only after commit',async()=>{
 const baseline=swapOperations();await replaceApplicationAtomically(swap,true,baseline.ops);
 assert.equal(baseline.calls.some(([name])=>name==='removePrevious'),false);
 assert.deepEqual(baseline.calls.filter(([name])=>name==='rename'),[['rename',swap.destination,swap.backup],['rename',swap.stage,swap.destination]]);
 await assert.rejects(replaceApplicationAtomically(swap,false,{}),/retention/);
 const managed=swapOperations();await replaceApplicationAtomically(applicationSwapPaths('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',false),false,managed.ops);
 assert.ok(managed.calls.findIndex(([n])=>n==='removePrevious')>managed.calls.findIndex(([n])=>n==='commit'));
});
test('failed plugin/service deployment restores the original App and restarts its owned installation',async()=>{
 const state=swapOperations('updateUserInstallation');await assert.rejects(replaceApplicationAtomically(swap,true,state.ops),/failed updateUserInstallation/);
 assert.deepEqual(state.calls.filter(([n])=>n==='rename').slice(-2),[['rename',swap.destination,swap.stage],['rename',swap.backup,swap.destination]]);
 assert.ok(state.calls.some(([n,arg])=>n==='restoreUserInstallation'&&arg===swap.stage));assert.equal(state.failure.rolledBack,true);assert.equal(state.failure.appRestored,true);assert.equal(state.failure.serviceRestored,true);
 assert.equal(state.calls.some(([n])=>n==='removePrevious'),false);
});
test('failed promotion restores the original in place; failed restoration preserves evidence and reports failure',async()=>{
 const promotion=swapOperations('promote');await assert.rejects(replaceApplicationAtomically(swap,true,promotion.ops),/promote failed/);assert.equal(promotion.failure.rolledBack,true);
 assert.deepEqual(promotion.calls.filter(([n])=>n==='rename').at(-1),['rename',swap.backup,swap.destination]);
 const failed=swapOperations('updateUserInstallation');failed.ops.restoreUserInstallation=async()=>{throw Error('restart denied');};
 await assert.rejects(replaceApplicationAtomically(swap,true,failed.ops),/App 已恢复，自有 Word 安装恢复失败/);assert.equal(failed.failure.rolledBack,false);assert.equal(failed.failure.appRestored,true);assert.equal(failed.failure.serviceRestored,false);assert.equal(failed.calls.some(([n])=>n==='cleanupStage'),false);
});
