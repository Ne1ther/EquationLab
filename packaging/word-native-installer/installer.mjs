// Prepared independently of the frozen release. No implicit install action.
import fs from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import path from 'node:path';
import {homedir, tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const FIXED_LIBRARIES = [
  '/Library/Application Support/Equation Lab/Word/MathTypeBridgeProbe.bundle/Contents/MacOS/MathTypeBridgeProbe',
  '/Library/Application Support/Microsoft/Office365/Equation Lab/Word/MathTypeBridgeProbe.bundle/Contents/MacOS/MathTypeBridgeProbe'
];
const CLSIDS = ['0002CE03-0000-0000-C000-000000000046', '0002CE03-0000-0000-C000-000000000056'];
const digest = b => createHash('sha256').update(b).digest('hex');
const exists = p => fs.lstat(p).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; });
function fail(code, message, details) { const error = Error(message); error.code = code; error.details = details; throw error; }
async function noSymlinkAncestors(file) {
  let current = path.resolve(file);
  while (current !== path.dirname(current)) {
    try { if ((await fs.lstat(current)).isSymbolicLink()) fail('SYMLINK_TARGET', '安装路径包含符号链接，请选择真实的 Word Startup 文件夹。', {path: current}); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    current = path.dirname(current);
  }
}
export async function treeInventory(directory) {
  const files = [];
  async function walk(current) {
    for (const e of (await fs.readdir(current, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(current, e.name), stat = await fs.lstat(file);
      if (e.isSymbolicLink()) fail('ARTIFACT_SYMLINK', '原生组件中不允许外部或可变符号链接。', {path: file});
      if (e.isDirectory()) await walk(file);
      else if (e.isFile()) files.push({path: path.relative(directory, file), mode: stat.mode & 0o777, sha256: digest(await fs.readFile(file))});
      else fail('ARTIFACT_SPECIAL_FILE', '原生组件包含不支持的文件类型。');
    }
  }
  await walk(directory);
  return {sha256: digest(JSON.stringify(files)), files};
}
async function objectHash(file) {
  if (!await exists(file)) return null;
  const stat = await fs.lstat(file);
  if (stat.isSymbolicLink()) fail('SYMLINK_TARGET', '同名安装目标是符号链接，未覆盖。', {path: file});
  return stat.isDirectory() ? (await treeInventory(file)).sha256 : digest(await fs.readFile(file));
}
async function readJson(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }
async function atomicJson(file, value) {
  return atomicBytes(file, Buffer.from(JSON.stringify(value, null, 2) + '\n'));
}
async function atomicBytes(file, bytes) {
  await fs.mkdir(path.dirname(file), {recursive: true, mode: 0o700});
  const stage = file + '.' + randomUUID() + '.new';
  await fs.writeFile(stage, bytes, {mode: 0o600, flag: 'wx'});
  await fs.rename(stage, file);
}
function sourcePath(root, relative) {
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some(x => x === '..')) fail('INVALID_ARTIFACT_PATH', '组件清单包含无效路径。');
  return path.join(root, relative);
}
export async function readArtifacts(directory, verifySignature = bundle => execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], {stdio: 'pipe'})) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) fail('UNRELEASED_ARTIFACTS', '此构建尚未附带经过 Word 冷启动验收的自动启动组件。');
  let root, bytes, manifest;
  try { root = await fs.realpath(directory); bytes = await fs.readFile(path.join(root, 'artifact-manifest.json')); }
  catch (error) { if (error.code === 'ENOENT') fail('UNRELEASED_ARTIFACTS', '此构建尚未附带经过 Word 冷启动验收的自动启动组件。'); throw error; }
  try { manifest = JSON.parse(bytes); } catch { fail('INVALID_ARTIFACT_MANIFEST', 'Word 自动启动组件的发布清单无法读取。'); }
  const binding = manifest.binding ?? 'system-fixed';
  if (manifest.schema !== 'equationlab.word-native-artifacts.v1' || manifest.compiledTemplate !== true || !['system-fixed', 'startup-adjacent'].includes(binding) || binding === 'system-fixed' && !FIXED_LIBRARIES.includes(manifest.fixedLibraryPath)) fail('UNRELEASED_ARTIFACTS', '缺少经过编译与宿主验收的 Word 自动启动组件。');
  if (manifest.architecture !== 'arm64' || !(binding === 'system-fixed' ? manifest.hostValidation?.fixedPathBound : manifest.hostValidation?.dynamicPathBound) || !manifest.hostValidation?.autoExecColdStartPassed) fail('HOST_VALIDATION_REQUIRED', '原生库路径或 Word 冷启动尚未完成验收，未安装。');
  for (const value of [manifest.template?.sha256, manifest.template?.vbaProjectSha256, manifest.template?.sourceSha256, manifest.bundle?.treeSha256]) if (!/^[a-f0-9]{64}$/.test(value ?? '')) fail('INVALID_ARTIFACT_HASH', '发布组件清单的散列无效。');
  if (!manifest.template.buildId || !manifest.nativeVersion) fail('INVALID_ARTIFACT_MANIFEST', '组件缺少构建身份。');
  const bundle = sourcePath(root, manifest.bundle.path), template = sourcePath(root, manifest.template.path);
  await noSymlinkAncestors(bundle); await noSymlinkAncestors(template);
  const inventory = await treeInventory(bundle);
  if (inventory.sha256 !== manifest.bundle.treeSha256 || JSON.stringify(inventory.files) !== JSON.stringify(manifest.bundle.files)) fail('ARTIFACT_CHANGED', '原生组件文件与发布清单不一致。');
  const binarySha256 = inventory.files.find(file => file.path === 'Contents/MacOS/MathTypeBridgeProbe')?.sha256;
  if (!binarySha256 || manifest.bundle.binarySha256 && manifest.bundle.binarySha256 !== binarySha256) fail('ARTIFACT_CHANGED', '原生组件主程序与发布清单不一致。');
  manifest.bundle.binarySha256 = binarySha256;
  if (digest(await fs.readFile(template)) !== manifest.template.sha256) fail('ARTIFACT_CHANGED', 'Word 启动模板与发布清单不一致。');
  await verifySignature(bundle);
  return {manifest: {...manifest, binding}, manifestSha256: digest(bytes), root, bundle, template};
}
function productionWordProcesses() {
  const result = execFileSync('/bin/ps', ['-axo', 'pid=,comm='], {encoding: 'utf8'});
  return result.split('\n').flatMap(line => {
    const m = /^\s*(\d+)\s+(.+)$/.exec(line);
    return m && path.basename(m[2]) === 'Microsoft Word' ? [{pid: Number(m[1])}] : [];
  });
}
export function createInstaller({sandboxRoot, homeDirectory = homedir(), wordProcesses = productionWordProcesses, verifySignature, effectiveUid = () => process.geteuid(), fault = async () => {}} = {}) {
  // Test path remapping is never exposed by the stdin/CLI protocol.
  if (sandboxRoot && (!path.resolve(sandboxRoot).startsWith(realpathSync(tmpdir()) + path.sep) || !path.basename(sandboxRoot).startsWith('equationlab-installer-test-'))) fail('INVALID_TEST_ROOT', '测试仅允许本任务专属临时目录。');
  const mapped = file => sandboxRoot ? path.join(sandboxRoot, file.replace(/^\//, '')) : file;
  async function pendingUserContext(stateDirectory) {
    await noSymlinkAncestors(stateDirectory);
    const directory = path.join(stateDirectory, 'transactions'), pending = [];
    if (!await exists(directory)) return null;
    for (const entry of await fs.readdir(directory, {withFileTypes: true})) {
      if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/.test(entry.name)) continue;
      const file = path.join(directory, entry.name, 'journal.json');
      if (!await exists(file)) continue;
      await noSymlinkAncestors(file);
      const journal = await readJson(file);
      if (journal.schema === 'equationlab.word-native-transaction.v1' && journal.id === entry.name && journal.scope === 'user' && ['preparing', 'prepared', 'committing', 'rollback-conflict'].includes(journal.phase)) pending.push(journal);
    }
    return pending.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;
  }
  async function context(request, needsArtifacts = true) {
    if (request.schema !== 'equationlab.word-plugin-request.v1' || !['user', 'system-fixed'].includes(request.installationScope)) fail('INVALID_REQUEST', 'Word 插件安装请求无效。');
    if (!sandboxRoot && process.platform !== 'darwin') fail('UNSUPPORTED_PLATFORM', '原生 Word 插件仅适用于 macOS。');
    const artifacts = needsArtifacts ? await readArtifacts(request.artifactManifestDirectory, verifySignature) : null;
    const scope = request.installationScope;
    const preliminaryStatePath = path.join(homeDirectory, 'Library/Application Support/Equation Lab/word-native/current.json');
    const preliminaryState = scope === 'user' && await exists(preliminaryStatePath) ? await readJson(preliminaryStatePath) : null;
    const selectionRecord = preliminaryState ?? (scope === 'user' && !needsArtifacts ? await pendingUserContext(path.dirname(preliminaryStatePath)) : null);
    const chosenStartup = request.startupDirectory ?? selectionRecord?.startupDirectory;
    if (scope === 'user' && (!chosenStartup || request.startupDirectoryConfirmed !== true && selectionRecord?.startupDirectory !== chosenStartup || !path.isAbsolute(chosenStartup))) fail('STARTUP_SELECTION_REQUIRED', '请确认 Word 实际使用的 Startup 文件夹。安装器不会修改 Word 的文件夹设置。');
    const startup = scope === 'user' ? path.resolve(chosenStartup) : null;
    const binding = artifacts?.manifest.binding ?? selectionRecord?.binding ?? request.binding ?? 'system-fixed';
    if (scope === 'system-fixed' && binding !== 'system-fixed') fail('INVALID_SCOPE', '旁置原生组件应由当前用户安装，不需要系统安装权限。');
    const systemBundle = binding === 'startup-adjacent' ? path.join(startup, 'MathTypeBridgeProbe.bundle') : artifacts ? path.dirname(path.dirname(path.dirname(artifacts.manifest.fixedLibraryPath))) : request.fixedBundlePath ?? selectionRecord?.fixedBundlePath;
    if (binding === 'system-fixed' && (!systemBundle || !FIXED_LIBRARIES.some(p => p.startsWith(systemBundle + '/Contents/')))) fail('INVALID_SYSTEM_PATH', '固定原生组件路径无效。');
    const stateDirectory = scope === 'system-fixed' ? mapped(path.join(path.dirname(systemBundle), '.equationlab-installer')) : path.join(homeDirectory, 'Library/Application Support/Equation Lab/word-native');
    const statePath = path.join(stateDirectory, 'current.json');
    await noSymlinkAncestors(stateDirectory);
    if (startup) await noSymlinkAncestors(startup);
    const state = await exists(statePath) ? await readJson(statePath) : null;
    if (state && (state.schema !== 'equationlab.word-native-installation.v1' || state.scope !== scope)) fail('INVALID_INSTALLATION_STATE', '已有安装记录不属于此安装器，未修改。');
    if (state?.fixedBundlePath && state.fixedBundlePath !== systemBundle) fail('INSTALLATION_PATH_CHANGED', '升级不能静默切换已验收的原生库路径。请先完成旧组件卸载。');
    if (state?.startupDirectory && state.startupDirectory !== startup) fail('STARTUP_PATH_CHANGED', '现有启动模板在另一目录，请先卸载旧位置，再选择新目录。');
    const allowed = scope === 'system-fixed' ? [mapped(systemBundle)] : [path.join(startup, 'EquationLabStartup.dotm'), path.join(startup, 'EquationLabInstallContext.json'), ...(binding === 'startup-adjacent' ? [systemBundle] : [])];
    if (state?.installedFiles?.some(file => !allowed.includes(file.path))) fail('INVALID_INSTALLATION_STATE', '安装记录包含不属于本产品的目标，未修改。');
    if (state?.binding && state.binding !== binding) fail('INSTALLATION_PATH_CHANGED', '升级不能静默改变原生库加载方式，请先卸载旧组件。');
    return {artifacts, binding, scope, systemBundle, startup, stateDirectory, statePath, state};
  }
  function isApprovedLegacy(c, role, hash) { return role === 'native-bundle' && !!hash && c.artifacts?.manifest.legacyOwnedFiles?.some(x => x.role === role && x.sha256 === hash && x.owner === 'Equation Lab'); }
  async function plan(request) {
    const c = await context(request), {artifacts: a} = c;
    const targets = c.scope === 'system-fixed' ? [{path: mapped(c.systemBundle), source: a.bundle, sha256: a.manifest.bundle.treeSha256, role: 'native-bundle'}] : [{path: path.join(c.startup, 'EquationLabStartup.dotm'), source: a.template, sha256: a.manifest.template.sha256, role: 'startup-template'}, {path: path.join(c.startup, 'EquationLabInstallContext.json'), sha256: 'generated-at-commit', role: 'install-context'}];
    if (c.binding === 'startup-adjacent') targets.unshift({path: c.systemBundle, source: a.bundle, sha256: a.manifest.bundle.treeSha256, role: 'native-bundle'});
    const conflicts = [], warnings = [];
    for (const target of targets) {
      const actual = await objectHash(target.path), previous = c.state?.installedFiles?.find(f => f.path === target.path);
      target.beforeSha256 = actual;
      if (actual && (!previous || previous.sha256 !== actual || !c.state.installed)) {
        if (!previous && isApprovedLegacy(c, target.role, actual) || !c.state?.installed && isApprovedLegacy(c, target.role, actual)) warnings.push({code: 'KNOWN_LEGACY_UPGRADE', path: target.path, sha256: actual, action: 'backup-and-preserve-for-uninstall'});
        else conflicts.push({code: previous ? 'OWNED_FILE_CHANGED' : 'UNOWNED_CONFLICT', path: target.path});
      }
    }
    if (c.scope === 'user') {
      const actualNative = c.binding === 'system-fixed' ? await objectHash(mapped(c.systemBundle)) : null;
      if (c.binding === 'system-fixed' && actualNative !== a.manifest.bundle.treeSha256) conflicts.push({code: 'SYSTEM_COMPONENT_REQUIRED', path: c.systemBundle});
      if (await exists(c.startup)) for (const name of await fs.readdir(c.startup)) if (/mathtype.*\.(dotm|dot|bundle)$/i.test(name)) warnings.push({code: 'OTHER_MATHTYPE_COMPONENT', path: path.join(c.startup, name), action: 'left-unchanged'});
    }
    const stateSha256 = await exists(c.statePath) ? digest(await fs.readFile(c.statePath)) : null;
    const data = {scope: c.scope, binding: c.binding, artifactManifestSha256: a.manifestSha256, nativeVersion: a.manifest.nativeVersion, fixedBundlePath: c.systemBundle, startupDirectory: c.startup, stateSha256, targets: targets.map(({source, ...x}) => x)};
    return {ok: true, phase: 'planned', planDigest: digest(JSON.stringify(data)), ...data, wordProcesses: await wordProcesses(), conflicts, warnings, adminRequired: c.scope === 'system-fixed', restartWordRequired: true, systemSecurityChanges: false};
  }
  async function transaction(request, operation) {
    const c = await context(request, operation === 'install'), fresh = operation === 'install' ? await plan(request) : null;
    if (fresh && request.approvedPlanDigest !== fresh.planDigest) fail('PLAN_CHANGED', '组件或目标文件已变化，请刷新安装计划后重试。');
    if (fresh?.conflicts.length) fail(fresh.conflicts[0].code, '安装存在同名冲突或缺少匹配的系统原生组件，现有文件未修改。', fresh.conflicts);
    if (c.scope === 'system-fixed' && effectiveUid() !== 0) fail('ADMIN_REQUIRED', '此固定系统组件需要通过标准 macOS 安装器授权安装。');
    const running = await wordProcesses();
    if (running.length) fail('WORD_RUNNING', '请先保存文档并正常退出 Word，再重试。安装器不会强制关闭 Word。', running);
    await fs.mkdir(c.stateDirectory, {recursive: true, mode: 0o700});
    const lock = path.join(c.stateDirectory, 'lock');
    try { await fs.mkdir(lock, {mode: 0o700}); } catch (e) { if (e.code === 'EEXIST') fail('INSTALLER_BUSY', '另一个安装事务尚未完成，请先恢复或结束该事务。'); throw e; }
    await atomicJson(path.join(lock, 'owner.json'), {pid: process.pid, createdAt: new Date().toISOString()});
    const id = randomUUID(), installedAt = new Date().toISOString(), transactionDirectory = path.join(c.stateDirectory, 'transactions', id);
    let journal, committed = false;
    try {
      await fs.mkdir(transactionDirectory, {recursive: true, mode: 0o700});
      const oldStateBytes = await exists(c.statePath) ? await fs.readFile(c.statePath) : null;
      const before = c.state;
      let targets;
      if (operation === 'install') {
        const a = c.artifacts;
        targets = c.scope === 'system-fixed' ? [{path: mapped(c.systemBundle), source: a.bundle, sha256: a.manifest.bundle.treeSha256, role: 'native-bundle'}] : [{path: path.join(c.startup, 'EquationLabStartup.dotm'), source: a.template, sha256: a.manifest.template.sha256, role: 'startup-template'}];
        if (c.binding === 'startup-adjacent') targets.unshift({path: c.systemBundle, source: a.bundle, sha256: a.manifest.bundle.treeSha256, role: 'native-bundle'});
        if (c.scope === 'user') {
          const installContext = {schema: 'equationlab.word-native-install-context.v1', installId: id, installedAt, templateBuildId: a.manifest.template.buildId, templateSha256: a.manifest.template.sha256, helperVersion: a.manifest.nativeVersion, receiptPath: path.join(c.startup, '.EquationLab/native-startup-receipt.json')};
          const contextSource = path.join(transactionDirectory, 'install-context.json'), bytes = Buffer.from(JSON.stringify(installContext, null, 2) + '\n');
          await fs.writeFile(contextSource, bytes, {mode: 0o600});
          targets.push({path: path.join(c.startup, 'EquationLabInstallContext.json'), source: contextSource, sha256: digest(bytes), role: 'install-context'});
        }
      } else {
        if (!before?.installed) fail('NOT_INSTALLED', '没有此安装器管理的原生 Word 组件。');
        targets = before.installedFiles.map(x => {
          const baseline = before.baselineFiles?.find(b => b.path === x.path);
          return {...x, source: baseline?.backup ?? null, sha256: baseline?.sha256 ?? null};
        });
      }
      journal = {schema: 'equationlab.word-native-transaction.v1', id, operation, phase: 'preparing', startedAt: installedAt, scope: c.scope, binding: c.binding, startupDirectory: c.startup, fixedBundlePath: c.systemBundle, statePath: c.statePath, previousState: before, oldStateBytes: oldStateBytes?.toString('base64') ?? null, targets: []};
      for (let i = 0; i < targets.length; i++) {
        const target = targets[i]; await noSymlinkAncestors(target.path);
        const actual = await objectHash(target.path), owned = before?.installedFiles?.find(f => f.path === target.path);
        if (actual && (!before?.installed || !owned || owned.sha256 !== actual) && !(operation === 'install' && !before?.installed && isApprovedLegacy(c, target.role, actual))) fail('OWNED_FILE_CHANGED', '目标文件已被外部修改，未覆盖或删除。', {path: target.path});
        const backup = path.join(transactionDirectory, 'backup-' + i), stage = target.path + '.' + id + '.new', retained = target.path + '.' + id + '.previous';
        journal.targets.push({...target, beforeSha256: actual, backup, stage, retained, movedPrevious: false, placedNew: false});
        await atomicJson(path.join(transactionDirectory, 'journal.json'), journal);
        if (actual) { await fs.cp(target.path, backup, {recursive: true, verbatimSymlinks: true, preserveTimestamps: true}); if (await objectHash(backup) !== actual) fail('BACKUP_FAILED', '安装前备份校验失败。'); }
        await fs.mkdir(path.dirname(target.path), {recursive: true});
        if (target.source) { await fs.cp(target.source, stage, {recursive: true, verbatimSymlinks: true, preserveTimestamps: true}); if (await objectHash(stage) !== target.sha256) fail('STAGE_FAILED', '暂存组件校验失败。'); }
      }
      journal.phase = 'prepared'; await atomicJson(path.join(transactionDirectory, 'journal.json'), journal);
      await fault('prepared', journal);
      // Recheck after staging; Word may have started while files were copied.
      if ((await wordProcesses()).length) fail('WORD_RUNNING', 'Word 已启动，安装未提交。请正常退出 Word 后重试。');
      for (const target of journal.targets) {
        await noSymlinkAncestors(target.path);
        if (await objectHash(target.path) !== target.beforeSha256) fail('PLAN_CHANGED', '安装目标在提交前变化，未覆盖。');
        if (target.beforeSha256) { await fs.rename(target.path, target.retained); target.movedPrevious = true; }
        if (target.source) { await fs.rename(target.stage, target.path); target.placedNew = true; }
        journal.phase = 'committing'; await atomicJson(path.join(transactionDirectory, 'journal.json'), journal);
        await fault('target-committed', journal);
      }
      const baselineFiles = before?.baselineFiles ?? journal.targets.filter(t => t.beforeSha256 && !before?.installedFiles?.some(f => f.path === t.path)).map(t => ({path: t.path, sha256: t.beforeSha256, backup: t.backup, role: t.role, owner: 'Equation Lab legacy'}));
      const next = {schema: 'equationlab.word-native-installation.v1', scope: c.scope, binding: c.binding, installed: operation === 'install', installId: id, installedAt, nativeVersion: c.artifacts?.manifest.nativeVersion ?? before.nativeVersion, nativeBinarySha256: c.artifacts?.manifest.bundle.binarySha256 ?? before.nativeBinarySha256, artifactManifestSha256: c.artifacts?.manifestSha256 ?? before.artifactManifestSha256, templateBuildId: c.artifacts?.manifest.template.buildId ?? before.templateBuildId, fixedBundlePath: c.systemBundle, startupDirectory: c.startup, installedFiles: operation === 'install' ? targets.map(({source, ...x}) => ({...x, owner: 'Equation Lab', version: c.artifacts.manifest.nativeVersion})) : [], baselineFiles, lastTransaction: id};
      await atomicJson(c.statePath, next); await fault('state-committed', journal);
      journal.phase = 'committed'; await atomicJson(path.join(transactionDirectory, 'journal.json'), journal); committed = true;
      for (const target of journal.targets) if (target.movedPrevious) await fs.rm(target.retained, {recursive: true});
      return {ok: true, phase: operation === 'uninstall' ? 'removed' : c.scope === 'user' ? 'awaiting-word-restart' : 'system-artifacts-installed', installId: id, installedFiles: next.installedFiles, backupDirectory: transactionDirectory, restartWordRequired: true, nativeRegistrationVerified: false};
    } catch (error) {
      if (journal && !committed) {
        let rollbackError;
        for (const target of [...journal.targets].reverse()) try {
          if (target.placedNew) {
            if (await objectHash(target.path) !== target.sha256) fail('ROLLBACK_CONFLICT', '新安装文件被外部修改，已保留备份，请使用恢复工具检查。');
            await fs.rm(target.path, {recursive: true});
          }
          if (target.movedPrevious) await fs.rename(target.retained, target.path);
          if (await exists(target.stage)) await fs.rm(target.stage, {recursive: true});
        } catch (e) { rollbackError = e; }
        if (!rollbackError) {
          if (journal.oldStateBytes !== null) await atomicBytes(c.statePath, Buffer.from(journal.oldStateBytes, 'base64'));
          else if (await exists(c.statePath)) await fs.unlink(c.statePath);
        }
        journal.phase = rollbackError ? 'rollback-conflict' : 'rolled-back'; journal.error = {code: error.code ?? 'INSTALL_FAILED', message: error.message};
        await atomicJson(path.join(transactionDirectory, 'journal.json'), journal);
        if (rollbackError) fail('ROLLBACK_CONFLICT', rollbackError.message, {backupDirectory: transactionDirectory, originalError: error.message});
      }
      throw error;
    } finally { await fs.rm(lock, {recursive: true}); }
  }
  async function verify(request) {
    if (request?.schema !== 'equationlab.word-plugin-request.v1' || !['user', 'system-fixed'].includes(request.installationScope)) fail('INVALID_REQUEST', 'Word 插件安装请求无效。');
    if (!sandboxRoot && process.platform !== 'darwin') fail('UNSUPPORTED_PLATFORM', '原生 Word 插件仅适用于 macOS。');
    if (request.installationScope === 'user') {
      const pending = await pendingUserContext(path.join(homeDirectory, 'Library/Application Support/Equation Lab/word-native'));
      if (pending) fail('INSTALL_RECOVERY_REQUIRED', '上次原生 Word 插件安装未完成，请先恢复安装事务后重试。', {startupDirectory: pending.startupDirectory, binding: pending.binding});
      if (!await exists(path.join(homeDirectory, 'Library/Application Support/Equation Lab/word-native/current.json'))) return {ok: true, phase: 'not-installed', restartWordRequired: false, nativeRegistrationVerified: false};
    }
    const c = await context(request, false), state = c.state;
    if (!state?.installed) return {ok: true, phase: 'not-installed', restartWordRequired: false, nativeRegistrationVerified: false};
    for (const file of state.installedFiles) if (await objectHash(file.path) !== file.sha256) fail('INSTALLED_FILE_CHANGED', '已安装文件与记录不一致，尚不能确认 Word 接入。', {path: file.path});
    if (c.scope === 'system-fixed') return {ok: true, phase: 'system-artifacts-installed', installedFiles: state.installedFiles, nativeRegistrationVerified: false, restartWordRequired: true};
    const receiptPath = path.join(c.startup, '.EquationLab/native-startup-receipt.json');
    if (!await exists(receiptPath)) return {ok: true, phase: 'awaiting-word-restart', installedFiles: state.installedFiles, nativeRegistrationVerified: false, restartWordRequired: true};
    const receipt = await readJson(receiptPath), running = await wordProcesses();
    const templateSha256 = state.installedFiles.find(file => file.role === 'startup-template')?.sha256;
    const valid = receipt.schema === 'equationlab.word-native-startup-receipt.v1' && receipt.entryPoint === 'AutoExec' && receipt.installId === state.installId && receipt.templateBuildId === state.templateBuildId && receipt.helperVersion === state.nativeVersion && receipt.templateSha256 === templateSha256 && receipt.helperSha256 === state.nativeBinarySha256 && receipt.registrationResult === 0 && receipt.registrationState === 1 && running.some(p => p.pid === receipt.wordPID) && Date.parse(receipt.timestamp) >= Date.parse(state.installedAt) && CLSIDS.every(id => receipt.registeredCLSIDs?.includes(id));
    return {ok: true, phase: valid ? 'native-registered' : 'awaiting-word-restart', nativeRegistrationVerified: valid, restartWordRequired: !valid, installedFiles: state.installedFiles, receipt: {path: receiptPath, valid, wordPID: receipt.wordPID, helperVersion: receipt.helperVersion, timestamp: receipt.timestamp}, coldEditorWakeVerified: false};
  }
  async function restoreJournal(c, id) {
    if (!/^[0-9a-f-]{36}$/.test(id)) fail('INVALID_TRANSACTION', '事务身份无效。');
    const dir = path.join(c.stateDirectory, 'transactions', id), file = path.join(dir, 'journal.json'), journal = await readJson(file);
    const allowed = c.scope === 'system-fixed' ? [mapped(c.systemBundle)] : [path.join(c.startup, 'EquationLabStartup.dotm'), path.join(c.startup, 'EquationLabInstallContext.json'), ...(c.binding === 'startup-adjacent' ? [c.systemBundle] : [])];
    if (journal.id !== id || journal.scope !== c.scope || journal.statePath !== c.statePath || journal.targets.some((t, i) => !allowed.includes(t.path) || t.backup !== path.join(dir, 'backup-' + i) || t.stage !== t.path + '.' + id + '.new' || t.retained !== t.path + '.' + id + '.previous')) fail('INVALID_TRANSACTION', '恢复记录不属于本安装目标，未修改。');
    for (const target of journal.targets) {
      await noSymlinkAncestors(target.path);
      const actual = await objectHash(target.path), expectedAfter = target.source ? target.sha256 : null;
      if (actual !== target.beforeSha256 && actual !== expectedAfter && actual !== null) fail('ROLLBACK_CONFLICT', '目标已被外部修改，保留当前文件及备份。', {path: target.path, backupDirectory: dir});
      if (target.beforeSha256 && actual !== target.beforeSha256 && await objectHash(target.retained) !== target.beforeSha256 && await objectHash(target.backup) !== target.beforeSha256) fail('BACKUP_FAILED', '原版本备份不完整，未执行恢复。');
    }
    const trash = [];
    for (const target of [...journal.targets].reverse()) {
      const actual = await objectHash(target.path);
      if (actual !== target.beforeSha256) {
        if (actual) {
          const displaced = target.path + '.' + randomUUID() + '.rollback-current';
          await fs.rename(target.path, displaced); trash.push(displaced);
        }
        if (target.beforeSha256) {
          if (await objectHash(target.retained) === target.beforeSha256) await fs.rename(target.retained, target.path);
          else { const restore = target.path + '.' + randomUUID() + '.restore'; await fs.cp(target.backup, restore, {recursive: true, preserveTimestamps: true}); await fs.rename(restore, target.path); }
        }
      }
      if (await exists(target.stage)) await fs.rm(target.stage, {recursive: true});
    }
    if (journal.oldStateBytes !== null) await atomicBytes(c.statePath, Buffer.from(journal.oldStateBytes, 'base64'));
    else if (await exists(c.statePath)) await fs.unlink(c.statePath);
    journal.phase = 'rolled-back'; journal.recoveredAt = new Date().toISOString(); await atomicJson(file, journal);
    for (const displaced of trash) await fs.rm(displaced, {recursive: true});
    return {transaction: id, restoredVersion: journal.previousState?.nativeVersion ?? null, backupDirectory: dir};
  }
  async function recovery(request, rollbackLatest) {
    const c = await context(request, false);
    if ((await wordProcesses()).length) fail('WORD_RUNNING', '请先保存文档并正常退出 Word，再恢复安装。');
    if (c.scope === 'system-fixed' && effectiveUid() !== 0) fail('ADMIN_REQUIRED', '恢复固定系统组件需要正常管理员授权。');
    const lock = path.join(c.stateDirectory, 'lock');
    if (await exists(lock)) {
      const owner = await exists(path.join(lock, 'owner.json')) ? await readJson(path.join(lock, 'owner.json')) : null;
      let active = false;
      if (owner?.pid > 0) try { active = Number(execFileSync('/bin/ps', ['-p', String(owner.pid), '-o', 'pid='], {encoding: 'utf8'}).trim()) === owner.pid; } catch {}
      if (active) fail('INSTALLER_BUSY', '安装进程仍在运行，未接管其事务。');
      await fs.rm(lock, {recursive: true});
    }
    await fs.mkdir(lock, {recursive: true, mode: 0o700});
    await atomicJson(path.join(lock, 'owner.json'), {pid: process.pid});
    try {
      const dir = path.join(c.stateDirectory, 'transactions');
      let ids = [];
      if (rollbackLatest) {
        if (!c.state?.lastTransaction) fail('NOT_INSTALLED', '没有可回滚的安装事务。');
        ids = [c.state.lastTransaction];
      } else if (await exists(dir)) {
        const pending = [];
        for (const id of await fs.readdir(dir)) if (/^[0-9a-f-]{36}$/.test(id) && await exists(path.join(dir, id, 'journal.json'))) {
          const j = await readJson(path.join(dir, id, 'journal.json'));
          if (['preparing', 'prepared', 'committing', 'rollback-conflict'].includes(j.phase)) pending.push(j);
        }
        ids = pending.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).map(j => j.id);
      }
      const restored = []; for (const id of ids) restored.push(await restoreJournal(c, id));
      return {ok: true, phase: 'rolled-back', restored, restartWordRequired: true, nativeRegistrationVerified: false};
    } finally { await fs.rm(lock, {recursive: true}); }
  }
  return {plan, install: request => transaction(request, 'install'), uninstall: request => transaction(request, 'uninstall'), verify, rollback: request => recovery(request, true), recover: request => recovery(request, false)};
}
export function errorResponse(error, scope) {
  const denied = ['EACCES', 'EPERM'].includes(error.code);
  return {ok: false, phase: 'failed', error: {code: denied ? scope === 'user' ? 'WORD_STARTUP_ACCESS_DENIED' : 'SYSTEM_COMPONENT_ACCESS_DENIED' : error.code ?? 'INSTALL_FAILED', message: denied ? scope === 'user' ? 'macOS 尚未允许访问所选 Word Startup 文件夹。请在系统提示中允许访问，或重新选择 Word 实际使用的文件夹后重试。现有组件已按事务记录保留或恢复。' : '固定系统组件需要标准 macOS 安装器授权，未修改系统安全设置。' : error.message, ...(error.details ? {details: error.details} : {})}, restartWordRequired: false};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let request;
  try {
    let text = ''; for await (const chunk of process.stdin) { text += chunk; if (text.length > 1_048_576) fail('REQUEST_TOO_LARGE', '安装请求过大。'); }
    try { request = JSON.parse(text); } catch { fail('INVALID_REQUEST', '安装请求必须是有效 JSON。'); }
    if (!request || typeof request !== 'object' || Array.isArray(request)) fail('INVALID_REQUEST', 'Word 插件安装请求无效。');
    const installer = createInstaller();
    if (!['plan', 'install', 'uninstall', 'verify', 'rollback', 'recover'].includes(request.action)) fail('INVALID_ACTION', '未知的安装动作。');
    process.stdout.write(JSON.stringify(await installer[request.action](request)) + '\n');
  } catch (error) { process.stdout.write(JSON.stringify(errorResponse(error, request?.installationScope)) + '\n'); process.exitCode = 1; }
}
