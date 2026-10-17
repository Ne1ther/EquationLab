// Prepare an unsigned fixed-path package recipe; never run Installer/pkgbuild.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readArtifacts,isMainModule} from './installer.mjs';
const xml = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export async function prepareFixedPackage({artifactDirectory, nodeRuntime, nodeLicense, output}) {
  const artifacts = await readArtifacts(artifactDirectory);
  if (artifacts.manifest.binding !== 'system-fixed') throw Error('The host-accepted adjacent loader uses the per-user app installer and needs no fixed-system package.');
  const version = artifacts.manifest.nativeVersion;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Invalid component version.');
  const target = path.resolve(output); await fs.mkdir(target, {recursive: true});
  if ((await fs.readdir(target)).length) throw Error('Prepare into a new empty directory.');
  execFileSync('/usr/bin/codesign', ['--verify', '--strict', nodeRuntime], {stdio: 'pipe'});
  const scripts = path.join(target, 'Scripts'); await fs.mkdir(path.join(scripts, 'runtime'), {recursive: true});
  await fs.cp(artifacts.root, path.join(scripts, 'artifacts'), {recursive: true});
  await fs.copyFile(nodeRuntime, path.join(scripts, 'runtime/node')); await fs.chmod(path.join(scripts, 'runtime/node'), 0o755);
  await fs.copyFile(nodeLicense, path.join(scripts, 'runtime/Node-LICENSE.txt'));
  await fs.copyFile(fileURLToPath(new URL('./installer.mjs', import.meta.url)), path.join(scripts, 'installer.mjs'));
  await fs.writeFile(path.join(scripts, 'commit-system.mjs'), `import path from 'node:path';\nimport {createInstaller} from './installer.mjs';\nconst request={schema:'equationlab.word-plugin-request.v1',installationScope:'system-fixed',artifactManifestDirectory:path.join(import.meta.dirname,'artifacts')};\nconst installer=createInstaller(),plan=await installer.plan(request);\nif(plan.conflicts.length)throw Error(JSON.stringify(plan.conflicts));\nprocess.stdout.write(JSON.stringify(await installer.install({...request,approvedPlanDigest:plan.planDigest}))+'\\n');\n`);
  await fs.writeFile(path.join(scripts, 'postinstall'), '#!/bin/bash\nset -euo pipefail\nTASK_SCRIPTS="$(cd "$(dirname "$0")" && pwd)"\n"$TASK_SCRIPTS/runtime/node" "$TASK_SCRIPTS/commit-system.mjs"\n', {mode: 0o755});
  const identifier = 'app.equationlab.word-native.system', component = 'EquationLabNativeComponent.pkg', product = `EquationLab-WordNative-${version}-unsigned-candidate.pkg`;
  const distribution = `<?xml version="1.0" encoding="utf-8"?>\n<installer-gui-script minSpecVersion="1"><title>Equation Lab 原生 Word 系统组件</title><options customize="never" rootVolumeOnly="true"/><domains enable_anywhere="false" enable_currentUserHome="false" enable_localSystem="true"/><choices-outline><line choice="native"/></choices-outline><choice id="native" title="Equation Lab 原生 Word 系统组件"><pkg-ref id="${identifier}"/></choice><pkg-ref id="${identifier}" version="${xml(version)}" onConclusion="none">${component}</pkg-ref></installer-gui-script>\n`;
  await fs.writeFile(path.join(target, 'Distribution.xml'), distribution);
  const plan = {schema: 'equationlab.fixed-system-pkg-preparation.v1', preparedOnly: true, packageBuilt: false, installed: false, signed: false, notarized: false, requiresNormalAdministratorAuthorization: true, fixedLibraryPath: artifacts.manifest.fixedLibraryPath, perUserStartupInstalled: false, commands: [
    ['/usr/bin/pkgbuild', '--nopayload', '--scripts', scripts, '--identifier', identifier, '--version', version, path.join(target, component)],
    ['/usr/bin/productbuild', '--distribution', path.join(target, 'Distribution.xml'), '--package-path', target, path.join(target, product)]
  ], boundaries: ['This is a fallback system component candidate, not the final application release.', 'It does not infer a user HOME, install into Word Startup as root, launch Word/app, trust a certificate, or change any macro/Gatekeeper policy.', 'The scripts invoke the same hash-checked backup/rollback transaction; a running Word process blocks commit.', 'The app must separately install the compiled global template for the confirmed current user.', 'Unsigned package creation, package installation and notarization are separate stages.']};
  await fs.writeFile(path.join(target, 'build-plan.json'), JSON.stringify(plan, null, 2) + '\n');
  return plan;
}
if (isMainModule(import.meta.url)) {
  let text = ''; for await (const chunk of process.stdin) text += chunk;
  process.stdout.write(JSON.stringify(await prepareFixedPackage(JSON.parse(text))) + '\n');
}
