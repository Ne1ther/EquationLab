import {readFile, writeFile, mkdir, mkdtemp, cp, copyFile, chmod, rename, rm, readdir, lstat, realpath, symlink, access, open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, dirname, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createDiskImage,createApplicationZip} from './disk-image.mjs';
import {readArtifacts} from './word-native-installer/installer.mjs';
import {buildIconAssets} from './icon-assets.mjs';
import {buildWorkbenchAssets} from './workbench-assets.mjs';
import {pruneDependencies} from './prune-dependencies.mjs';
import {buildAutomaticPackage} from './word-native-installer/build-automatic-pkg.mjs';
import {writeUpdateManifest} from './update-manifest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(join(root,'packaging','release.json'),'utf8'));
const args = process.argv.slice(2);
const option = (name, fallback) => { const i=args.indexOf(name); return i<0?fallback:args[i+1]; };
const version = option('--version',config.version);
const build = option('--build',config.build);
const nodeVersion = option('--node-version',config.nodeVersion);
const output = resolve(option('--output',join(root,'dist')));
const purpose = option('--purpose','release');
const appOnly = args.includes('--app-only');
const identity = process.env.EQUATIONLAB_SIGN_IDENTITY || '-';
if (args.includes('--help')) {
  console.log(`Usage: scripts/package_release.sh [--version ${config.version}] [--build ${config.build}] [--purpose release|qa] [--app-only] [--skip-build] [--no-dmg] [--output NEW_EMPTY_PATH] [--node-version ${config.nodeVersion}]`);
  console.log('EQUATIONLAB_NATIVE_WORD_ARTIFACTS_DIR supplies a frozen, host-accepted compiled Startup template + signed native bridge. It is required for release; QA may omit it and cannot install native integration.');
  console.log('The configured default is v6 optical SVG/PNG/ICNS. EQUATIONLAB_ICON_ASSETS_DIR overrides it with a prepared directory or v5/v6 alias.');
  console.log('Optional: EQUATIONLAB_SIGN_IDENTITY="Developer ID Application: …". No credentials or notarization are performed automatically.');
  process.exit(0);
}
if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('This release builder currently targets Apple Silicon on macOS.');
if(!/^\d+\.\d+\.\d+(?:[-.][A-Za-z0-9.-]+)?$/.test(version)||!/^\d+$/.test(build)||!/^v\d+\.\d+\.\d+$/.test(nodeVersion))throw Error('Invalid release version.');
if(!['qa','release'].includes(purpose))throw Error('Purpose must be qa or release.');
const exists = path=>access(path).then(()=>true,()=>false);
function run(binary, argv, options={}) {
  return execFileSync(binary,argv,{cwd:root,encoding:'utf8',maxBuffer:12_000_000,stdio:['pipe','pipe','pipe'],...options});
}
function progress(message){console.log(`[package] ${message}`);}
async function walk(dir){const all=[];for(const entry of await readdir(dir,{withFileTypes:true})){const file=join(dir,entry.name);all.push(file);if(entry.isDirectory())all.push(...await walk(file));}return all;}
async function isMachO(file){const handle=await open(file,'r');try{const header=Buffer.alloc(4);await handle.read(header,0,4,0);return ['feedface','cefaedfe','feedfacf','cffaedfe','cafebabe','bebafeca','cafebabf','bfbafeca'].includes(header.toString('hex'));}finally{await handle.close();}}
const xml = s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const nativeArtifactsDirectory = process.env.EQUATIONLAB_NATIVE_WORD_ARTIFACTS_DIR;
if(purpose==='release'&&!nativeArtifactsDirectory)throw Error('A release requires EQUATIONLAB_NATIVE_WORD_ARTIFACTS_DIR with real Word cold-start acceptance. Use --purpose qa for an explicitly unavailable installation candidate.');
if(purpose==='release'&&!process.env.EQUATIONLAB_UPDATE_PRIVATE_KEY)throw Error('A release requires EQUATIONLAB_UPDATE_PRIVATE_KEY to sign its update manifest.');
const preparedNativeArtifacts = nativeArtifactsDirectory ? await readArtifacts(resolve(nativeArtifactsDirectory)) : null;
if(await exists(output)&&(await readdir(output)).length)throw Error(`Use a new empty output directory; frozen applications and packages are never replaced: ${output}`);
await mkdir(output,{recursive:true});
const temp = await realpath(await mkdtemp(join(tmpdir(),'equationlab-release-')));
const stage = join(temp,'Equation Lab.app');
const contents=join(stage,'Contents'),resources=join(contents,'Resources'),engine=join(resources,'engine');
const report={version,build,purpose,architecture:'arm64',minimumMacOS:config.minimumMacOS,createdAt:new Date().toISOString(),signing:{kind:identity==='-'?'ad-hoc':'Developer ID',notarized:false},checks:{}};
const approvedNativeRoot=join(resources,'native-word-artifacts');
const withinApprovedNative=file=>file===approvedNativeRoot||file.startsWith(approvedNativeRoot+sep);
try {
  progress(`Preparing Equation Lab ${version} (${build}), arm64`);
  if(!args.includes('--skip-build'))run('/usr/bin/swift',['build','-c','release'],{stdio:'inherit'});
  const bin=run('/usr/bin/swift',['build','-c','release','--show-bin-path']).trim();
  for(const name of ['EquationLab','EquationFontMetrics'])if(!await exists(join(bin,name)))throw Error(`Missing release executable: ${name}`);
  await mkdir(join(contents,'MacOS'),{recursive:true});
  await mkdir(join(engine,'bin'),{recursive:true});
  await copyFile(join(bin,'EquationLab'),join(contents,'MacOS','EquationLab'));
  await copyFile(join(bin,'EquationFontMetrics'),join(engine,'bin','EquationFontMetrics'));
  for(const executable of [join(contents,'MacOS','EquationLab'),join(engine,'bin','EquationFontMetrics')])run('/usr/bin/strip',['-S',executable]);

  let runtimeSource;
  if(process.env.EQUATIONLAB_NODE_RUNTIME_CACHE){
    runtimeSource=resolve(process.env.EQUATIONLAB_NODE_RUNTIME_CACHE);
    const cache=JSON.parse(await readFile(join(runtimeSource,'runtime-cache.json'),'utf8'));
    if(cache.schema!=='equationlab.node-runtime-cache.v1'||cache.version!==nodeVersion)throw Error('Node runtime cache version mismatch.');
    for(const [file,digest] of Object.entries(cache.files??{})){
      if(!['bin/node','LICENSE'].includes(file)||createHash('sha256').update(await readFile(join(runtimeSource,file))).digest('hex')!==digest)throw Error('Node runtime cache digest mismatch.');
    }
    if(!cache.files?.['bin/node']||!cache.files?.LICENSE||run(join(runtimeSource,'bin/node'),['--version']).trim()!==nodeVersion)throw Error('Incomplete Node runtime cache.');
    report.runtime={version:nodeVersion,source:cache.source,archiveSha256:cache.archiveSha256,cacheFiles:cache.files};
    progress(`Reusing verified Node.js ${nodeVersion} runtime cache`);
  }else{
  progress(`Downloading official Node.js ${nodeVersion} and verifying SHA-256`);
  const archiveName=`node-${nodeVersion}-darwin-arm64.tar.gz`;
  const base=`https://nodejs.org/dist/${nodeVersion}/`;
  const archive=join(temp,archiveName),sums=join(temp,'SHASUMS256.txt');
  const curlOptions=['--http1.1','--fail','--location','--silent','--show-error','--proto','=https','--tlsv1.2','--connect-timeout','20','--max-time','600','--retry','2'];
  if(process.env.EQUATIONLAB_NODE_ARCHIVE)await copyFile(resolve(process.env.EQUATIONLAB_NODE_ARCHIVE),archive);
  else run('/usr/bin/curl',[...curlOptions,base+archiveName,'--output',archive]);
  run('/usr/bin/curl',[...curlOptions,base+'SHASUMS256.txt','--output',sums]);
  const expected=(await readFile(sums,'utf8')).split('\n').find(line=>line.endsWith(`  ${archiveName}`))?.split(/\s+/)[0];
  const actual=createHash('sha256').update(await readFile(archive)).digest('hex');
  if(!expected||actual!==expected)throw Error('Node.js archive SHA-256 mismatch.');
  report.runtime={version:nodeVersion,source:base+archiveName,archiveSha256:actual};
  run('/usr/bin/tar',['-xzf',archive,'-C',temp]);
  runtimeSource=join(temp,`node-${nodeVersion}-darwin-arm64`);
  }
  const runtime=join(resources,'runtime','bin');
  await mkdir(runtime,{recursive:true});
  await copyFile(join(runtimeSource,'bin','node'),join(runtime,'node'));
  await chmod(join(runtime,'node'),0o755);
  await mkdir(join(resources,'licenses'),{recursive:true});
  await copyFile(join(runtimeSource,'LICENSE'),join(resources,'licenses','Node-LICENSE.txt'));

  progress('Installing locked production JavaScript dependencies in the bundle');
  // The selected bundle version also governs health compatibility. An app
  // with a new version must never silently reuse an older service.
  const enginePackage=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
  const engineLock=JSON.parse(await readFile(join(root,'package-lock.json'),'utf8'));
  report.sourceVersion=enginePackage.version;
  enginePackage.version=version;engineLock.version=version;
  if(engineLock.packages?.[''])engineLock.packages[''].version=version;
  await writeFile(join(engine,'package.json'),JSON.stringify(enginePackage,null,2)+'\n');
  await writeFile(join(engine,'package-lock.json'),JSON.stringify(engineLock,null,2)+'\n');
  const bundledNode=join(runtime,'node');
  const npmCli=process.env.EQUATIONLAB_NODE_RUNTIME_CACHE
    ? await realpath(run('/usr/bin/which',['npm']).trim())
    : join(runtimeSource,'lib','node_modules','npm','bin','npm-cli.js');
  report.buildTools={npmVersion:run(bundledNode,[npmCli,'--version']).trim(),npmSource:process.env.EQUATIONLAB_NODE_RUNTIME_CACHE?'local build tool':'verified Node distribution'};
  const npmEnvironment=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^npm_config_/i.test(key)&&!['NODE_PATH','NODE_OPTIONS'].includes(key)));
  run(bundledNode,[npmCli,'ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund','--update-notifier=false','--userconfig',join(temp,'user.npmrc'),'--globalconfig',join(temp,'global.npmrc'),'--cache',join(temp,'npm-cache'),'--registry','https://registry.npmjs.org'],{cwd:engine,stdio:'inherit',env:{...npmEnvironment,PATH:`${join(runtimeSource,'bin')}:/usr/bin:/bin:/usr/sbin:/sbin`}});
  for(const directory of ['src','addin'])await cp(join(root,directory),join(engine,directory),{recursive:true,dereference:false});
  await mkdir(join(resources,'licenses'),{recursive:true});
  for(const file of ['LICENSE','THIRD_PARTY_NOTICES.md'])await copyFile(join(root,file),join(resources,'licenses',file));
  await cp(join(root,'assets','licenses'),join(resources,'licenses'),{recursive:true,dereference:false});
  await cp(join(root,'assets','fonts'),join(engine,'fonts'),{recursive:true,dereference:false});
  await writeFile(join(engine,'src','version.mjs'),`// Generated from the application release version.\nexport const APP_VERSION=${JSON.stringify(version)};\n`);
  const addinManifestPath=join(engine,'addin','manifest.xml'),addinManifest=await readFile(addinManifestPath,'utf8');
  const officeVersion=addinManifest.match(/<Version>\d+\.\d+\.\d+\.(\d+)<\/Version>/);
  if(!officeVersion)throw Error('The Office manifest version field is missing.');
  report.officeManifestVersion=`${version.match(/^\d+\.\d+\.\d+/)[0]}.${officeVersion[1]}`;
  await writeFile(addinManifestPath,addinManifest.replace(/<Version>\d+\.\d+\.\d+\.\d+<\/Version>/,`<Version>${report.officeManifestVersion}</Version>`));
  await mkdir(join(resources,'web','vendor'),{recursive:true});
  for(const file of await readdir(join(root,'desktop')))if(/\.(html|css|js)$/.test(file))await copyFile(join(root,'desktop',file),join(resources,'web',file));
  await copyFile(join(engine,'node_modules','mathlive','mathlive.min.js'),join(resources,'web','vendor','mathlive.min.js'));
  await cp(join(engine,'node_modules','mathlive','fonts'),join(resources,'web','vendor','fonts'),{recursive:true});
  const {buildTemplatePreviews}=await import('../scripts/build/build-template-previews.mjs');
  report.templatePreviews=await buildTemplatePreviews(join(resources,'template-previews'));
  report.templatePreviews={count:report.templatePreviews.count,factory:'Times+Symbol 12.eqp',format:'vector PDF'};
  progress('Removing audited development-only dependency files');
  const pruning = await pruneDependencies(join(engine, 'node_modules'));
  await writeFile(join(resources, 'dependency-pruning.json'), JSON.stringify(pruning, null, 2)+'\n');
  report.dependencyPruning = {...pruning, removed: undefined};
  await mkdir(join(resources,'installer'),{recursive:true});
  await copyFile(join(root,'packaging','install-word-plugin.mjs'),join(resources,'installer','install-word-plugin.mjs'));
  await copyFile(join(root,'packaging','word-service.mjs'),join(resources,'installer','word-service.mjs'));
  await copyFile(join(root,'packaging','word-native-installer','installer.mjs'),join(resources,'installer','word-native-installer.mjs'));
  await mkdir(join(resources,'installer','word-native-installer'),{recursive:true});
  for(const file of ['installer.mjs','automatic-install.mjs','build-automatic-pkg.mjs'])await copyFile(join(root,'packaging','word-native-installer',file),join(resources,'installer','word-native-installer',file));
  await mkdir(approvedNativeRoot,{recursive:true});
  if(preparedNativeArtifacts){
    // Keep host-accepted native bytes/signatures unchanged. Signing the outer app
    // must not silently replace the exact native image named by the acceptance.
    await cp(preparedNativeArtifacts.bundle,join(approvedNativeRoot,preparedNativeArtifacts.manifest.bundle.path),{recursive:true,dereference:false,verbatimSymlinks:true,preserveTimestamps:true});
    await copyFile(preparedNativeArtifacts.template,join(approvedNativeRoot,preparedNativeArtifacts.manifest.template.path));
    await copyFile(join(preparedNativeArtifacts.root,'artifact-manifest.json'),join(approvedNativeRoot,'artifact-manifest.json'));
    const copied=await readArtifacts(approvedNativeRoot);
    if(copied.manifestSha256!==preparedNativeArtifacts.manifestSha256)throw Error('Prepared native artifact manifest changed while copying.');
    report.nativeWordIntegration={available:true,hostValidated:true,binding:copied.manifest.binding,helperVersion:copied.manifest.nativeVersion,templateBuildId:copied.manifest.template.buildId,artifactManifestSha256:copied.manifestSha256,installed:false,signaturePreserved:true};
  }else{
    await writeFile(join(approvedNativeRoot,'availability.json'),JSON.stringify({schema:'equationlab.word-native-availability.v1',available:false,hostValidated:false,reason:'compiled-template-and-word-cold-start-acceptance-required'},null,2)+'\n');
    report.nativeWordIntegration={available:false,hostValidated:false,installed:false,reason:'compiled-template-and-word-cold-start-acceptance-required'};
  }
  // The independently written native Word bridge, if prepared by its owner,
  // is supplied as an explicit curated directory rather than a source tree.
  const wordPlugin=process.env.EQUATIONLAB_WORD_PLUGIN_DIR;
  if(wordPlugin){
    const prepared=await realpath(wordPlugin);
    await cp(prepared,join(resources,'word-plugin'),{recursive:true,dereference:false,verbatimSymlinks:true});
    report.wordPluginPrepared=true;
    const metadata=JSON.parse(await readFile(join(prepared,'component-manifest.json'),'utf8'));
    if(metadata.automaticInstallation!==false||metadata.automaticClassRegistration!==false)throw Error('The preview native bridge must require explicit manual activation.');
    report.nativeWordBridge={version:metadata.version,sourceBinarySha256:metadata.sourceBinarySha256,automaticInstallation:false,automaticClassRegistration:false,windowsValidation:false};
  }

  progress('Preparing native ICNS and checking each optical asset slot');
  const iconOverride=process.env.EQUATIONLAB_ICON_ASSETS_DIR;
  report.iconAssets={...await buildIconAssets({root,resources,temporaryDirectory:temp,assetDirectory:iconOverride||resolve(root,config.iconAssetsDirectory||'design/equation-lab-icons/v6')}),selection:iconOverride?'environment':'configured-default'};
  report.workbenchAssets=await buildWorkbenchAssets({root,resources});
  const plist=`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>EquationLab</string>
<key>CFBundleIdentifier</key><string>${xml(config.bundleIdentifier)}</string>
<key>CFBundleName</key><string>Equation Lab</string><key>CFBundleDisplayName</key><string>Equation Lab</string>
<key>CFBundlePackageType</key><string>APPL</string><key>CFBundleIconFile</key><string>EquationLab.icns</string>
<key>CFBundleShortVersionString</key><string>${xml(version)}</string><key>CFBundleVersion</key><string>${xml(build)}</string>
<key>LSMinimumSystemVersion</key><string>${xml(config.minimumMacOS)}</string><key>NSPrincipalClass</key><string>NSApplication</string>
<key>NSHighResolutionCapable</key><true/><key>EquationLabNode</key><string>runtime/bin/node</string>
<key>NSAppDataUsageDescription</key><string>安装和检查 Equation Lab Word 插件的固定顶栏与公式编辑组件。</string>
<key>CFBundleURLTypes</key><array><dict><key>CFBundleURLName</key><string>app.equationlab.word-edit</string><key>CFBundleURLSchemes</key><array><string>equationlab</string></array><key>CFBundleTypeRole</key><string>Editor</string></dict></array>
</dict></plist>\n`;
  await writeFile(join(contents,'Info.plist'),plist);
  run('/usr/bin/plutil',['-lint',join(contents,'Info.plist')]);

  const notices=['Equation Lab third-party notices','',`Node.js ${nodeVersion}: see licenses/Node-LICENSE.txt.`, 'JavaScript dependencies and fonts retain their distributed licenses in engine/node_modules.', 'STIX Two Math: SIL Open Font License 1.1; see engine/fonts/OFL-STIX.txt and engine/fonts/source.json.',''];
  for(const file of await walk(join(engine,'node_modules')))if(file.endsWith('/package.json'))try{const p=JSON.parse(await readFile(file,'utf8'));if(p.name&&p.version)notices.push(`${p.name} ${p.version} — ${typeof p.license==='string'?p.license:JSON.stringify(p.license||'See package license')}`);}catch{}
  await writeFile(join(resources,'THIRD_PARTY_NOTICES.txt'),[...new Set(notices)].join('\n')+'\n');

  progress('Checking relocation, private-data exclusion, and native dependencies');
  const files=await walk(stage),canonicalStage=await realpath(stage);let externalLinks=0;const machos=[];
  for(const file of files){
    const stat=await lstat(file);
    if(stat.isSymbolicLink()){const target=await realpath(file);if(!target.startsWith(canonicalStage+sep)){externalLinks++;throw Error(`External symlink: ${relative(stage,file)}`);}continue;}
    if(!stat.isFile())continue;
    const rel=relative(stage,file);
    if(/(?:^|\/)(?:\.local|vendor-artifacts|\.git|\.env)(?:\/|$)/.test(rel)||/(?:localhost-(?:key|cert)\.pem|\.p12|\.pfx|\.key)$/.test(rel))throw Error(`Private artifact in bundle: ${rel}`);
    if(/\.(?:mjs|js|css|html|json|plist)$/.test(rel)){
      const text=await readFile(file,'utf8');
      if(/\/Users\/[\p{L}\p{N}._-]+\//u.test(text)||text.includes('/opt/homebrew/')){
        // MathJax 3.2.2 ships this exact SEF with its upstream XSL build URI.
        // Preserve third-party runtime bytes; accept only the audited file and
        // digest. All other files and modified copies retain the path check.
        const upstream='Contents/Resources/engine/node_modules/mathjax-full/js/input/mathml/mml3/mml3.sef.json';
        const digest=createHash('sha256').update(await readFile(file)).digest('hex');
        if(rel!==upstream||digest!=='38acbd5de4dd0260eaa657ac35baa6ccc26dacc3cec8a1085612f0f577447663')throw Error(`Developer-local path in bundle: ${rel}`);
        report.checks.upstreamBuildMetadata={path:rel,sha256:digest,modified:false};
      }
    }
    if(await isMachO(file)){
      const deps=run('/usr/bin/otool',['-L',file]);
      if(deps.split('\n').slice(1).some(line=>/^\s+\/(?!usr\/lib\/|System\/Library\/)/.test(line)))throw Error(`Non-system native dependency in ${rel}:\n${deps}`);
      machos.push(file);
    }
  }
  report.checks.externalSymlinks=externalLinks;
  report.checks.nativeBinaryCount=machos.length;
  report.checks.privateKeysIncluded=false;
  // Retain Node's exported symbols for runtime compatibility; strip
  // only local symbols. Do this before nested signing, never after signing.
  const runtimeBytesBefore=(await lstat(bundledNode)).size;
  const exportsBefore=run('/usr/bin/nm',['-gjU',bundledNode]).split('\n').sort().join('\n');
  run('/usr/bin/strip',['-x',bundledNode]);
  const exportsAfter=run('/usr/bin/nm',['-gjU',bundledNode]).split('\n').sort().join('\n');
  if(exportsBefore!==exportsAfter)throw Error('Node exported symbols changed during stripping.');
  report.runtime.stripping={mode:'local-symbols-only',beforeBytes:runtimeBytesBefore,afterBytes:(await lstat(bundledNode)).size,exportedSymbolsUnchanged:true,exportsSha256:createHash('sha256').update(exportsAfter).digest('hex')};
  progress(`Signing ${machos.length} nested binaries (${report.signing.kind})`);
  const signingBase=['--force','--sign',identity];
  const timeOptions=identity==='-'?['--timestamp=none']:['--timestamp','--options','runtime'];
  for(const file of machos.filter(file=>!withinApprovedNative(file)).sort((a,b)=>b.length-a.length))run('/usr/bin/codesign',[...signingBase,...timeOptions,...(file===bundledNode?['--entitlements',join(root,'packaging','node-entitlements.plist')]:[]),file]);
  for(const nested of files.filter(file=>/\.(?:bundle|framework)$/.test(file)&&!withinApprovedNative(file)).sort((a,b)=>b.length-a.length))if((await lstat(nested)).isDirectory())run('/usr/bin/codesign',[...signingBase,...timeOptions,nested]);
  if(preparedNativeArtifacts)await readArtifacts(approvedNativeRoot);
  // Real RPC uses Node + Sharp + MathJax + CoreText helper, with spaces in the
  // relocated app path and no access to the source node_modules directory.
  const probe=run(bundledNode,[join(engine,'src','desktop-rpc.mjs')],{cwd:temp,input:JSON.stringify({action:'validate',payload:{latex:'\\frac{a+c}{\\sqrt{x^2+y^2}}'}}),env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',TMPDIR:tmpdir()},timeout:30000});
  const result=JSON.parse(probe);
  if(!result.ok||!result.data?.svg?.includes('<svg')||!result.data?.nativeBytes)throw Error(`Bundled equation engine failed: ${JSON.stringify(result)}`);
  report.checks.relocatedEngine={passed:true,nativeBytes:result.data.nativeBytes,characters:result.data.characters,latex:result.data.latex};
  const boundVersion=run(bundledNode,['--input-type=module','-e','const{pathToFileURL}=await import("node:url");const{APP_VERSION}=await import(pathToFileURL(process.argv[1]));process.stdout.write(APP_VERSION);',join(engine,'src','version.mjs')],{cwd:temp,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin'}});
  if(boundVersion!==version)throw Error('Bundled engine/app version mismatch.');
  report.checks.engineVersionBound={passed:true,version:boundVersion};
  if(preparedNativeArtifacts){
    report.wordPackageDelivery={mode:'on-demand',builder:'installer/word-native-installer/build-automatic-pkg.mjs',kinds:['word','remove']};
  }
  await writeFile(join(resources,'release-manifest.json'),JSON.stringify({equationlabBundle:true,...report},null,2)+'\n');

  progress(`Signing the application (${report.signing.kind})`);
  run('/usr/bin/codesign',[...signingBase,...timeOptions,stage]);
  run('/usr/bin/codesign',['--verify','--deep','--strict','--verbose=2',stage]);
  report.checks.codesign=true;
  const assessment=spawnSync('/usr/sbin/spctl',['--assess','--type','execute','--verbose=2',stage],{encoding:'utf8'});
  report.signing.acceptedUnderCurrentSystemPolicy=assessment.status===0;
  report.signing.policyOverrideDetected=/override=security disabled/i.test(assessment.stderr||assessment.stdout||'');
  report.signing.gatekeeperAccepted=assessment.status===0&&!report.signing.policyOverrideDetected;
  report.signing.distributionTrustConfirmed=false;
  report.signing.gatekeeperOutput=(assessment.stderr||assessment.stdout||'').trim().replaceAll(stage,'Equation Lab.app');

  const finalApp=join(output,'Equation Lab.app');
  if(await exists(finalApp))throw Error(`Refusing to replace an existing application: ${finalApp}`);
  await rename(stage,finalApp);
  report.artifacts={app:'Equation Lab.app'};
  if(preparedNativeArtifacts){
    progress('Building the complete App and Word installer');
    report.automaticInstaller=await buildAutomaticPackage({app:finalApp,artifacts:join(finalApp,'Contents/Resources/native-word-artifacts'),output,version,kind:'full'});
    report.artifacts.pkg=report.automaticInstaller.file;
    if(purpose==='release') {
      report.updateManifest=await writeUpdateManifest({root,output,packageFile:report.artifacts.pkg,version,build,minimumMacOS:config.minimumMacOS,privateKeyFile:process.env.EQUATIONLAB_UPDATE_PRIVATE_KEY});
      report.artifacts.updateManifest=report.updateManifest.file;
    }
  }
  if(!appOnly){
    progress('Creating and verifying an installable ZIP archive');
    Object.assign(report.artifacts,await createApplicationZip({app:finalApp,output,version,adHoc:identity==='-'}));
    report.checks.zipExtractionSignatureVerified=true;
  }
  await writeFile(join(output,`Equation-Lab-${version}-packaging-report.json`),JSON.stringify(report,null,2)+'\n');
  if(!appOnly&&!args.includes('--no-dmg')){
    progress('Creating read-only drag-to-install disk image');
    const {validation,...imageArtifact}=await createDiskImage({app:finalApp,output,version,adHoc:identity==='-'});
    Object.assign(report.artifacts,imageArtifact);report.checks.dmgReadOnlyEngine=validation;
    report.checks.dmgVerified=true;
  }
  await writeFile(join(output,`Equation-Lab-${version}-packaging-report.json`),JSON.stringify(report,null,2)+'\n');
  progress(`Ready: ${join(output,report.artifacts.pkg||report.artifacts.dmg||report.artifacts.app)}`);
  progress(identity==='-'?'Ad-hoc developer preview; no Developer ID identity or notarization.':'Developer ID signed; notarization must still be completed separately.');
} finally { await rm(temp,{recursive:true,force:true}); }
