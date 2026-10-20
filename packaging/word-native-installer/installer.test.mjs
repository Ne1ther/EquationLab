import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createInstaller, FIXED_LIBRARIES, treeInventory, errorResponse, readArtifacts, requireRibbonVerifiedArtifact} from './installer.mjs';
import {installAutomatically} from './automatic-install.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');

async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'equationlab-installer-test-')));
  const home = path.join(root, 'Fixture User'), startup = path.join(home, 'Word Startup'), fixedBundlePath = path.dirname(path.dirname(path.dirname(FIXED_LIBRARIES[0])));
  let running = [];
  const common = {sandboxRoot: root, homeDirectory: home, wordProcesses: async () => running, verifySignature: async () => {}, effectiveUid: () => 0};
  const installer = createInstaller(common);
  async function artifacts(version = '0.0.5') {
    const directory = path.join(root, 'artifact-' + version), bundle = path.join(directory, 'MathTypeBridgeProbe.bundle');
    await fs.mkdir(path.join(bundle, 'Contents/MacOS'), {recursive: true});
    await fs.writeFile(path.join(bundle, 'Contents/MacOS/MathTypeBridgeProbe'), 'NONEXECUTABLE UNIT FIXTURE ' + version, {mode: 0o755});
    await fs.writeFile(path.join(bundle, 'Contents/Info.plist'), 'UNIT FIXTURE');
    const template = Buffer.from('NONEXECUTABLE SIMULATED COMPILED TEMPLATE ' + version);
    await fs.writeFile(path.join(directory, 'EquationLabStartup.dotm'), template);
    const inventory = await treeInventory(bundle), manifest = {schema: 'equationlab.word-native-artifacts.v1', compiledTemplate: true, architecture: 'arm64', fixedLibraryPath: FIXED_LIBRARIES[0], nativeVersion: version, bundle: {path: 'MathTypeBridgeProbe.bundle', treeSha256: inventory.sha256, files: inventory.files}, template: {path: 'EquationLabStartup.dotm', sha256: hash(template), vbaProjectSha256: hash('SIMULATED VBA CACHE'), sourceSha256: hash('SIMULATED SOURCE'), buildId: 'fixture-' + version}, hostValidation: {fixedPathBound: true, autoExecColdStartPassed: true}};
    await fs.writeFile(path.join(directory, 'artifact-manifest.json'), JSON.stringify(manifest));
    return directory;
  }
  const source = await artifacts();
  const request = scope => ({schema: 'equationlab.word-plugin-request.v1', installationScope: scope, artifactManifestDirectory: source, fixedBundlePath, startupDirectory: startup, startupDirectoryConfirmed: true});
  async function install(scope, directory = source, api = installer) { const r = {...request(scope), artifactManifestDirectory: directory}, plan = await api.plan(r); return api.install({...r, approvedPlanDigest: plan.planDigest}); }
  return {root, home, startup, common, installer, request, source, artifacts, install, setRunning: value => { running = value; }, cleanup: () => fs.rm(root, {recursive: true, force: true})};
}
async function scoped(fn) { const f = await fixture(); try { await fn(f); } finally { await f.cleanup(); } }

test('plan is read-only and user integration requires the fixed native component', () => scoped(async f => {
  const plan = await f.installer.plan(f.request('user'));
  assert.equal(plan.phase, 'planned'); assert.equal(plan.conflicts[0].code, 'SYSTEM_COMPONENT_REQUIRED');
  await assert.rejects(fs.access(f.startup)); await assert.rejects(fs.access(path.join(f.home, 'Library')));
}));
test('first app status query needs no Startup selection and remains read-only', () => scoped(async f => {
  const result = await f.installer.verify({schema: 'equationlab.word-plugin-request.v1', installationScope: 'user'});
  assert.equal(result.phase, 'not-installed'); assert.equal(result.nativeRegistrationVerified, false);
  await assert.rejects(fs.access(f.home));
}));
test('QA builds without approved native resources show an actionable unavailable state', () => scoped(async f => {
  await assert.rejects(readArtifacts(undefined), {code: 'UNRELEASED_ARTIFACTS'});
  await assert.rejects(readArtifacts(path.join(f.root, 'not-yet-prepared')), {code: 'UNRELEASED_ARTIFACTS'});
  await fs.mkdir(path.join(f.root, 'empty-artifact-directory'));
  await assert.rejects(readArtifacts(path.join(f.root, 'empty-artifact-directory')), {code: 'UNRELEASED_ARTIFACTS'});
}));
test('fixed-system and per-user transactions remain separate and preserve unrelated files', () => scoped(async f => {
  const system = await f.install('system-fixed'); assert.equal(system.phase, 'system-artifacts-installed');
  await fs.mkdir(f.startup, {recursive: true}); await fs.writeFile(path.join(f.startup, 'ThirdParty.dotm'), 'unchanged');
  const user = await f.install('user'); assert.equal(user.phase, 'awaiting-word-restart'); assert.equal(user.installedFiles.length, 2);
  assert.equal(await fs.readFile(path.join(f.startup, 'ThirdParty.dotm'), 'utf8'), 'unchanged');
  const context = JSON.parse(await fs.readFile(path.join(f.startup, 'EquationLabInstallContext.json')));
  assert.equal(context.installId, user.installId); assert.equal(context.templateBuildId, 'fixture-0.0.5');
  assert.equal((await f.installer.verify(f.request('user'))).nativeRegistrationVerified, false);
}));
test('unowned filename conflicts are never overwritten even when the name is ours', () => scoped(async f => {
  await f.install('system-fixed'); await fs.mkdir(f.startup, {recursive: true});
  const destination = path.join(f.startup, 'EquationLabStartup.dotm'); await fs.writeFile(destination, 'USER OWNED');
  const r = f.request('user'), plan = await f.installer.plan(r); assert.equal(plan.conflicts[0].code, 'UNOWNED_CONFLICT');
  await assert.rejects(f.installer.install({...r, approvedPlanDigest: plan.planDigest}), {code: 'UNOWNED_CONFLICT'});
  assert.equal(await fs.readFile(destination, 'utf8'), 'USER OWNED');
}));
test('running Word blocks mutation without closing the process', () => scoped(async f => {
  const r = f.request('system-fixed'), plan = await f.installer.plan(r); f.setRunning([{pid: 12345}]);
  await assert.rejects(f.installer.install({...r, approvedPlanDigest: plan.planDigest}), {code: 'WORD_RUNNING'});
}));
test('Word starting during staging aborts and removes staged files', () => scoped(async f => {
  const api = createInstaller({...f.common, fault: async phase => { if (phase === 'prepared') f.setRunning([{pid: 12345}]); }});
  await assert.rejects(f.install('system-fixed', f.source, api), {code: 'WORD_RUNNING'});
  const parent = path.join(f.root, 'Library/Application Support/Equation Lab/Word');
  assert.deepEqual((await fs.readdir(parent)).filter(name => name.endsWith('.new') || name.endsWith('.bundle')), []);
}));
test('upgrade preserves exact previous bytes and explicit rollback restores both scopes', () => scoped(async f => {
  await f.install('system-fixed'); const first = await f.install('user');
  const original = await fs.readFile(path.join(f.startup, 'EquationLabStartup.dotm'));
  const next = await f.artifacts('0.0.6'); await f.install('system-fixed', next); await f.install('user', next);
  assert.notDeepEqual(await fs.readFile(path.join(f.startup, 'EquationLabStartup.dotm')), original);
  await f.installer.rollback(f.request('user')); await f.installer.rollback(f.request('system-fixed'));
  assert.deepEqual(await fs.readFile(path.join(f.startup, 'EquationLabStartup.dotm')), original);
  const state = JSON.parse(await fs.readFile(path.join(f.home, 'Library/Application Support/Equation Lab/word-native/current.json')));
  assert.equal(state.installId, first.installId); assert.equal(state.nativeVersion, '0.0.5');
}));
test('failure after target placement restores previous artifact and installation state', () => scoped(async f => {
  await f.install('system-fixed'); await f.install('user');
  const file = path.join(f.startup, 'EquationLabStartup.dotm'), original = await fs.readFile(file);
  const stateFile = path.join(f.home, 'Library/Application Support/Equation Lab/word-native/current.json'), oldState = await fs.readFile(stateFile);
  const next = await f.artifacts('0.0.6'); await f.install('system-fixed', next);
  const api = createInstaller({...f.common, fault: async phase => { if (phase === 'target-committed') { const e = Error('simulated denied access'); e.code = 'EACCES'; throw e; } }});
  await assert.rejects(f.install('user', next, api), {code: 'EACCES'});
  assert.deepEqual(await fs.readFile(file), original); assert.deepEqual(await fs.readFile(stateFile), oldState);
}));
test('state-commit failure also rolls back both user files', () => scoped(async f => {
  await f.install('system-fixed'); await f.install('user');
  const file = path.join(f.startup, 'EquationLabInstallContext.json'), original = await fs.readFile(file);
  const next = await f.artifacts('0.0.6'); await f.install('system-fixed', next);
  const api = createInstaller({...f.common, fault: async phase => { if (phase === 'state-committed') throw Error('simulated state failure'); }});
  await assert.rejects(f.install('user', next, api)); assert.deepEqual(await fs.readFile(file), original);
}));
test('uninstall removes only hash-matching owned files and remains reversible', () => scoped(async f => {
  await f.install('system-fixed'); await f.install('user'); await fs.writeFile(path.join(f.startup, 'Normal.dotm'), 'protected');
  assert.equal((await f.installer.uninstall(f.request('user'))).phase, 'removed');
  await assert.rejects(fs.access(path.join(f.startup, 'EquationLabStartup.dotm')));
  assert.equal(await fs.readFile(path.join(f.startup, 'Normal.dotm'), 'utf8'), 'protected');
  await f.installer.rollback(f.request('user')); assert.ok(await fs.readFile(path.join(f.startup, 'EquationLabStartup.dotm')));
}));
test('externally changed owned file is preserved during uninstall and rollback', () => scoped(async f => {
  await f.install('system-fixed'); await f.install('user'); const file = path.join(f.startup, 'EquationLabStartup.dotm');
  await fs.writeFile(file, 'USER MODIFIED');
  await assert.rejects(f.installer.uninstall(f.request('user')), {code: 'OWNED_FILE_CHANGED'});
  await assert.rejects(f.installer.rollback(f.request('user')), {code: 'ROLLBACK_CONFLICT'});
  assert.equal(await fs.readFile(file, 'utf8'), 'USER MODIFIED');
}));
test('plan digest prevents a stale commit after destination changes', () => scoped(async f => {
  await f.install('system-fixed'); const r = f.request('user'), plan = await f.installer.plan(r);
  await fs.mkdir(f.startup, {recursive: true}); await fs.writeFile(path.join(f.startup, 'EquationLabStartup.dotm'), 'raced');
  await assert.rejects(f.installer.install({...r, approvedPlanDigest: plan.planDigest}), {code: 'PLAN_CHANGED'});
}));
test('artifact corruption and source-only loader are rejected before installation', () => scoped(async f => {
  await fs.appendFile(path.join(f.source, 'EquationLabStartup.dotm'), 'corrupted');
  await assert.rejects(readArtifacts(f.source, async () => {}), {code: 'ARTIFACT_CHANGED'});
  const manifestPath = path.join(f.source, 'artifact-manifest.json'), m = JSON.parse(await fs.readFile(manifestPath)); m.compiledTemplate = false;
  await fs.writeFile(manifestPath, JSON.stringify(m)); await assert.rejects(f.installer.plan(f.request('system-fixed')), {code: 'UNRELEASED_ARTIFACTS'});
}));
test('legacy frozen artifacts remain readable but cannot be repackaged without Ribbon acceptance', () => scoped(async f => {
  const accepted = await readArtifacts(f.source, async () => {});
  assert.equal(accepted.manifest.hostValidation.ribbonVerified, undefined);
  assert.throws(() => requireRibbonVerifiedArtifact(accepted), {code: 'HOST_VALIDATION_REQUIRED'});
  const ribbonAccepted={...accepted,manifest:{...accepted.manifest,hostValidation:{...accepted.manifest.hostValidation,ribbonVerified:true}}};
  assert.equal(requireRibbonVerifiedArtifact(ribbonAccepted),ribbonAccepted);
}));
test('symlink Startup path is rejected without writing through it', () => scoped(async f => {
  const other = path.join(f.root, 'Other'); await fs.mkdir(other); await fs.mkdir(f.home, {recursive: true}); await fs.symlink(other, f.startup);
  await assert.rejects(f.installer.plan(f.request('user')), {code: 'SYMLINK_TARGET'}); assert.deepEqual(await fs.readdir(other), []);
}));
test('normal permissions map to actionable errors without security bypass guidance', () => {
  const e = Error('denied'); e.code = 'EPERM'; const result = errorResponse(e, 'user');
  assert.equal(result.error.code, 'WORD_STARTUP_ACCESS_DENIED'); assert.doesNotMatch(result.error.message, /完全磁盘|Gatekeeper|sudo|关闭保护/);
});
test('file installation and app health never substitute for a fresh AutoExec receipt', () => scoped(async f => {
  await f.install('system-fixed'); const installed = await f.install('user');
  const dir = path.join(f.startup, '.EquationLab'); await fs.mkdir(dir);
  const receipt = {schema: 'equationlab.word-native-startup-receipt.v1', entryPoint: 'AutoExec', installId: installed.installId, templateBuildId: 'fixture-0.0.5', helperVersion: '0.0.5', templateSha256: hash(await fs.readFile(path.join(f.source, 'EquationLabStartup.dotm'))), helperSha256: hash(await fs.readFile(path.join(f.source, 'MathTypeBridgeProbe.bundle/Contents/MacOS/MathTypeBridgeProbe'))), registrationResult: 0, registrationState: 1, wordPID: 1234, wordVersion: '16.fixture', registeredCLSIDs: ['0002CE03-0000-0000-C000-000000000046', '0002CE03-0000-0000-C000-000000000056'], timestamp: new Date(Date.now() + 1).toISOString()};
  const file = path.join(dir, 'native-startup-receipt.json'); await fs.writeFile(file, JSON.stringify(receipt));
  assert.equal((await f.installer.verify(f.request('user'))).nativeRegistrationVerified, false);
  f.setRunning([{pid: 1234}]); const ready = await f.installer.verify(f.request('user'));
  assert.equal(ready.phase, 'native-registered'); assert.equal(ready.coldEditorWakeVerified, false);
  const acceptedHash = receipt.helperSha256; receipt.helperSha256 = '0'.repeat(64); await fs.writeFile(file, JSON.stringify(receipt)); assert.equal((await f.installer.verify(f.request('user'))).nativeRegistrationVerified, false); receipt.helperSha256 = acceptedHash;
  receipt.installId = 'old-install'; await fs.writeFile(file, JSON.stringify(receipt)); assert.equal((await f.installer.verify(f.request('user'))).nativeRegistrationVerified, false);
}));
test('crashed staged install recovers from its own journal without touching unrelated files', () => scoped(async f => {
  const child = `import{createInstaller}from${JSON.stringify(new URL('./installer.mjs', import.meta.url).href)};const r=JSON.parse(process.argv[1]),root=process.argv[2],home=process.argv[3];const i=createInstaller({sandboxRoot:root,homeDirectory:home,wordProcesses:async()=>[],verifySignature:async()=>{},effectiveUid:()=>0,fault:async p=>{if(p==='target-committed')process.exit(66)}});const plan=await i.plan(r);await i.install({...r,approvedPlanDigest:plan.planDigest});`;
  let status; try { execFileSync(process.execPath, ['--input-type=module', '-e', child, JSON.stringify(f.request('system-fixed')), f.root, f.home]); } catch (e) { status = e.status; }
  assert.equal(status, 66);
  const recovered = await f.installer.recover(f.request('system-fixed')); assert.equal(recovered.restored.length, 1);
  await assert.rejects(fs.access(path.join(f.root, f.request('system-fixed').fixedBundlePath.slice(1))));
}));
async function makeDynamic(directory, extra = {}) {
  const file = path.join(directory, 'artifact-manifest.json'), m = JSON.parse(await fs.readFile(file));
  m.binding = 'startup-adjacent'; m.fixedLibraryPath = null; m.hostValidation.dynamicPathBound = true; Object.assign(m, extra);
  await fs.writeFile(file, JSON.stringify(m)); return m;
}
test('host-accepted adjacent loader installs all three own artifacts without admin or system writes', () => scoped(async f => {
  await makeDynamic(f.source); const api = createInstaller({...f.common, effectiveUid: () => 501});
  const result = await f.install('user', f.source, api); assert.equal(result.installedFiles.length, 3);
  assert.ok(await fs.readFile(path.join(f.startup, 'MathTypeBridgeProbe.bundle/Contents/MacOS/MathTypeBridgeProbe')));
  await assert.rejects(fs.access(path.join(f.root, 'Library'))); assert.equal((await api.plan(f.request('user'))).adminRequired, false);
}));
test('dynamic CLI proof without real Word binding cannot enable a production install', () => scoped(async f => {
  const m = await makeDynamic(f.source); m.hostValidation.dynamicPathBound = false;
  await fs.writeFile(path.join(f.source, 'artifact-manifest.json'), JSON.stringify(m));
  await assert.rejects(f.installer.plan(f.request('user')), {code: 'HOST_VALIDATION_REQUIRED'});
}));
test('first adjacent install crash is detected and recovered using its own confirmed journal path', () => scoped(async f => {
  await makeDynamic(f.source);
  await fs.mkdir(f.startup, {recursive: true}); await fs.writeFile(path.join(f.startup, 'Other.dotm'), 'preserve');
  const child = `import{createInstaller}from${JSON.stringify(new URL('./installer.mjs', import.meta.url).href)};const r=JSON.parse(process.argv[1]),root=process.argv[2],home=process.argv[3];const i=createInstaller({sandboxRoot:root,homeDirectory:home,wordProcesses:async()=>[],verifySignature:async()=>{},effectiveUid:()=>501,fault:async p=>{if(p==='target-committed')process.exit(66)}});const plan=await i.plan(r);await i.install({...r,approvedPlanDigest:plan.planDigest});`;
  let status; try { execFileSync(process.execPath, ['--input-type=module', '-e', child, JSON.stringify(f.request('user')), f.root, f.home]); } catch (e) { status = e.status; }
  assert.equal(status, 66);
  const minimal = {schema: 'equationlab.word-plugin-request.v1', installationScope: 'user'};
  await assert.rejects(f.installer.verify(minimal), {code: 'INSTALL_RECOVERY_REQUIRED'});
  const recovered = await f.installer.recover(minimal); assert.equal(recovered.restored.length, 1);
  assert.deepEqual(await fs.readdir(f.startup), ['Other.dotm']);
  assert.equal((await f.installer.verify(minimal)).phase, 'not-installed');
}));
test('known exact legacy native bundle migrates with backup and uninstall restores it byte for byte', () => scoped(async f => {
  const old = await f.artifacts('0.0.4'), oldBundle = path.join(old, 'MathTypeBridgeProbe.bundle'), oldTree = await treeInventory(oldBundle);
  await fs.mkdir(f.startup, {recursive: true}); const destination = path.join(f.startup, 'MathTypeBridgeProbe.bundle'); await fs.cp(oldBundle, destination, {recursive: true});
  await makeDynamic(f.source, {legacyOwnedFiles: [{owner: 'Equation Lab', role: 'native-bundle', sha256: oldTree.sha256}]});
  const plan = await f.installer.plan(f.request('user')); assert.equal(plan.conflicts.length, 0); assert.ok(plan.warnings.some(w => w.code === 'KNOWN_LEGACY_UPGRADE'));
  await f.install('user'); assert.notEqual((await treeInventory(destination)).sha256, oldTree.sha256);
  await f.installer.uninstall(f.request('user')); assert.equal((await treeInventory(destination)).sha256, oldTree.sha256);
  await assert.rejects(fs.access(path.join(f.startup, 'EquationLabStartup.dotm')));
  await f.installer.rollback(f.request('user')); assert.notEqual((await treeInventory(destination)).sha256, oldTree.sha256);
}));
test('modified legacy bundle is not adopted by name or original code identity', () => scoped(async f => {
  const old = await f.artifacts('0.0.4'), oldBundle = path.join(old, 'MathTypeBridgeProbe.bundle'), oldTree = await treeInventory(oldBundle);
  await fs.mkdir(f.startup, {recursive: true}); const destination = path.join(f.startup, 'MathTypeBridgeProbe.bundle'); await fs.cp(oldBundle, destination, {recursive: true});
  await fs.appendFile(path.join(destination, 'Contents/MacOS/MathTypeBridgeProbe'), 'external');
  await makeDynamic(f.source, {legacyOwnedFiles: [{owner: 'Equation Lab', role: 'native-bundle', sha256: oldTree.sha256}]});
  const plan = await f.installer.plan(f.request('user')); assert.equal(plan.conflicts[0].code, 'UNOWNED_CONFLICT');
}));
test('a fully removed adjacent installation can move to the new Startup and rollback without touching third-party files', () => scoped(async f => {
  await makeDynamic(f.source);await f.install('user');
  await fs.writeFile(path.join(f.startup,'Zotero.dotm'),'keep old add-in');
  const next=path.join(f.home,'New Word Startup');await fs.mkdir(next);
  await fs.writeFile(path.join(next,'ThirdParty.dotm'),'keep new add-in');
  const request={...f.request('user'),startupDirectory:next};
  await assert.rejects(f.installer.plan(request),{code:'INSTALLATION_PATH_CHANGED'});
  await f.installer.uninstall(f.request('user'));
  const removed=await fs.readFile(path.join(f.home,'Library/Application Support/Equation Lab/word-native/current.json'));
  const plan=await f.installer.plan(request);assert.deepEqual(plan.conflicts,[]);
  await f.installer.install({...request,approvedPlanDigest:plan.planDigest});
  assert.equal((await f.installer.verify(request)).phase,'awaiting-word-restart');
  await f.installer.rollback(request);
  assert.deepEqual(await fs.readFile(path.join(f.home,'Library/Application Support/Equation Lab/word-native/current.json')),removed);
  await assert.rejects(fs.access(path.join(next,'EquationLabStartup.dotm')));
  assert.equal(await fs.readFile(path.join(f.startup,'Zotero.dotm'),'utf8'),'keep old add-in');
  assert.equal(await fs.readFile(path.join(next,'ThirdParty.dotm'),'utf8'),'keep new add-in');
}));
async function customStartup(f) {
  const startup=path.join(f.home,'Actual Word Startup'),base=path.join(f.home,'Library/Group Containers/UBF8T346G9.Office');
  await fs.mkdir(startup,{recursive:true});await fs.mkdir(base,{recursive:true});
  execFileSync('/usr/bin/sqlite3',[path.join(base,'MicrosoftRegistrationDB.reg')],{input:`CREATE TABLE HKEY_CURRENT_USER(node_id INTEGER,parent_id INTEGER,name TEXT); CREATE TABLE HKEY_CURRENT_USER_values(node_id INTEGER,name TEXT,type INTEGER,value BLOB); INSERT INTO HKEY_CURRENT_USER VALUES(1,0,'Software'),(2,1,'Microsoft'),(3,2,'Office'),(4,3,'16.0'),(5,4,'Word'),(6,5,'Options'); INSERT INTO HKEY_CURRENT_USER_values VALUES(6,'STARTUP-PATH',2,'${startup.replaceAll("'","''")}');`});
  return startup;
}
const automaticRequest=f=>({artifacts:f.source,user:{home:f.home,username:'fixture',uid:process.getuid(),gid:process.getgid()},installer:f.installer,wordRunning:()=>false,service:async()=>{}});
test('automatic relocation preflight is read-only and refuses an occupied destination before removing the old plugin', {skip:process.platform!=='darwin'},()=>scoped(async f=>{
  await makeDynamic(f.source);await f.install('user');const startup=await customStartup(f);
  const record=path.join(f.home,'Library/Application Support/Equation Lab/word-native/current.json'),before=await fs.readFile(record);
  const result=await installAutomatically({...automaticRequest(f),checkOnly:true});assert.equal(result.migrateFrom,f.startup);assert.equal(result.startup,startup);
  assert.deepEqual(await fs.readFile(record),before);assert.deepEqual(await fs.readdir(startup),[]);
  await fs.writeFile(path.join(startup,'EquationLabStartup.dotm'),'unowned template');
  await assert.rejects(installAutomatically(automaticRequest(f)),/同名组件/);
  assert.deepEqual(await fs.readFile(record),before);assert.equal(await fs.readFile(path.join(startup,'EquationLabStartup.dotm'),'utf8'),'unowned template');
  await fs.access(path.join(f.startup,'EquationLabStartup.dotm'));
}));
test('automatic update relocates owned components to the real Word Startup and preserves add-ins in both directories', {skip:process.platform!=='darwin'},()=>scoped(async f=>{
  await makeDynamic(f.source);await f.install('user');const startup=await customStartup(f);
  await fs.writeFile(path.join(f.startup,'Zotero.dotm'),'old add-in');await fs.writeFile(path.join(startup,'ThirdParty.dotm'),'new add-in');
  const result=await installAutomatically(automaticRequest(f));assert.equal(result.migratedFrom,f.startup);
  assert.equal(result.startup,startup);assert.equal(result.installedFiles.length,3);
  await assert.rejects(fs.access(path.join(f.startup,'EquationLabStartup.dotm')));
  await fs.access(path.join(startup,'EquationLabStartup.dotm'));
  assert.equal(await fs.readFile(path.join(f.startup,'Zotero.dotm'),'utf8'),'old add-in');assert.equal(await fs.readFile(path.join(startup,'ThirdParty.dotm'),'utf8'),'new add-in');
}));
test('a service failure after relocation restores the exact old installation and removes new owned components', {skip:process.platform!=='darwin'},()=>scoped(async f=>{
  await makeDynamic(f.source);await f.install('user');const startup=await customStartup(f);
  const record=path.join(f.home,'Library/Application Support/Equation Lab/word-native/current.json'),before=await fs.readFile(record);
  const template=await fs.readFile(path.join(f.startup,'EquationLabStartup.dotm'));
  await assert.rejects(installAutomatically({...automaticRequest(f),service:async()=>{throw Error('service failed after relocation');}}),/service failed after relocation/);
  assert.deepEqual(await fs.readFile(record),before);assert.deepEqual(await fs.readFile(path.join(f.startup,'EquationLabStartup.dotm')),template);
  await assert.rejects(fs.access(path.join(startup,'EquationLabStartup.dotm')));
}));
test('a file-placement failure during relocation restores the original installation', {skip:process.platform!=='darwin'},()=>scoped(async f=>{
  await makeDynamic(f.source);await f.install('user');const startup=await customStartup(f);
  const record=path.join(f.home,'Library/Application Support/Equation Lab/word-native/current.json'),before=await fs.readFile(record);
  const api=createInstaller({...f.common,fault:async(phase,journal)=>{if(phase==='target-committed'&&journal.startupDirectory===startup)throw Error('destination write failed');}});
  await assert.rejects(installAutomatically({...automaticRequest(f),installer:api}),/destination write failed/);
  assert.deepEqual(await fs.readFile(record),before);await fs.access(path.join(f.startup,'EquationLabStartup.dotm'));
  await assert.rejects(fs.access(path.join(startup,'EquationLabStartup.dotm')));
}));
