// Read-only packaged-resource validation. No GUI, Word or actual installation.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const args = process.argv.slice(2);
function required(name) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw Error('Missing ' + name);
  return path.resolve(args[index + 1]);
}
const app = required('--app'), output = required('--output');
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], {stdio: 'pipe'});
const resources = path.join(app, 'Contents/Resources');
const code = String.raw`
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
const resources=process.argv[1],engine=path.join(resources,'engine');
const {APP_VERSION}=await import(pathToFileURL(path.join(engine,'src/version.mjs')));
const {startAppServices}=await import(pathToFileURL(path.join(engine,'src/app-services.mjs')));
const installer=path.join(resources,'installer/word-native-installer.mjs');
const {readArtifacts}=await import(pathToFileURL(installer));
const artifacts=path.join(resources,'native-word-artifacts');
const temp=await fs.mkdtemp(path.join(tmpdir(),'equationlab-packaged-installer-verify-'));
let server,services;const checks={};
async function listener(version){
  const health={app:'Equation Lab',version,tls:false};
  server=http.createServer((_,res)=>res.end(JSON.stringify(health)));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {health,port:server.address().port};
}
try{
  for(const obsoleteVersion of ['0.4.1','0.4.2'].filter(version=>version!==APP_VERSION)){
    const old=await listener(obsoleteVersion);
    await assert.rejects(startAppServices({supportDirectory:temp,nativePort:old.port,watchCertificates:false}),/已被占用/);
    assert.deepEqual(await fetch('http://127.0.0.1:'+old.port+'/api/health').then(r=>r.json()),old.health);
    checks['old'+obsoleteVersion.replaceAll('.','')+'EngineRejected']=true;checks.oldListenerPreserved=true;
    await new Promise(resolve=>server.close(resolve));server=null;
  }
  const current=await listener(APP_VERSION);
  services=await startAppServices({supportDirectory:temp,nativePort:current.port,watchCertificates:false});
  assert.equal(services.status.nativeOwnership,'external');
  await services.close();services=null;assert.equal(server.listening,true);
  checks.matchingVersionReused=true;checks.externalListenerPreserved=true;
  await new Promise(resolve=>server.close(resolve));server=null;
  const available=await fs.access(path.join(artifacts,'artifact-manifest.json')).then(()=>true,()=>false);
  if(available){const prepared=await readArtifacts(artifacts);checks.nativeArtifactsVerified=true;checks.nativeVersion=prepared.manifest.nativeVersion;}
  else{
    const availability=JSON.parse(await fs.readFile(path.join(artifacts,'availability.json'),'utf8'));
    assert.equal(availability.available,false);assert.equal(availability.hostValidated,false);
    const request={schema:'equationlab.word-plugin-request.v1',action:'plan',installationScope:'user',artifactManifestDirectory:artifacts,startupDirectory:path.join(temp,'Unused Startup'),startupDirectoryConfirmed:true};
    const result=spawnSync(process.execPath,[installer],{input:JSON.stringify(request),encoding:'utf8'});
    assert.equal(result.status,1);const response=JSON.parse(result.stdout);
    assert.equal(response.error.code,'UNRELEASED_ARTIFACTS');
    await assert.rejects(fs.access(request.startupDirectory));
    checks.nativeArtifactsAvailable=false;checks.unvalidatedInstallRefused=true;checks.startupUntouched=true;
  }
  process.stdout.write(JSON.stringify({engineVersion:APP_VERSION,nodeVersion:process.version,checks}));
}finally{
  await services?.close();if(server?.listening)await new Promise(resolve=>server.close(resolve));
  await fs.rm(temp,{recursive:true,force:true});
}
`;
const result = JSON.parse(execFileSync(path.join(resources, 'runtime/bin/node'), ['--input-type=module', '-e', code, resources], {encoding: 'utf8', env: {PATH: '/usr/bin:/bin:/usr/sbin:/sbin'}, timeout: 30_000}));
const report = {schema: 'equationlab.packaged-native-installer-cli.v1', createdAt: new Date().toISOString(), app, ...result, strictSignature: true, actualWordUsed: false, actualInstallPerformed: false, securitySettingsChanged: false};
await fs.mkdir(path.dirname(output), {recursive: true});
await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
