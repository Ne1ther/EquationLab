// Packaged Ribbon resources/numbering verification using private ephemeral ports.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const args = process.argv.slice(2);
function required(name) { const i = args.indexOf(name); if (i < 0 || !args[i + 1]) throw Error('Missing ' + name); return path.resolve(args[i + 1]); }
const app = required('--app'), output = required('--output'), resources = path.join(app, 'Contents/Resources');
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], {stdio: 'pipe'});
const code = String.raw`
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const resources=process.argv[1],engine=path.join(resources,'engine'),require=createRequire(path.join(engine,'package.json'));
const {DOMParser}=require('@xmldom/xmldom');
const {APP_VERSION}=await import(pathToFileURL(path.join(engine,'src/version.mjs')));
const {startAppServices}=await import(pathToFileURL(path.join(engine,'src/app-services.mjs')));
await import(pathToFileURL(path.join(engine,'addin/command-registry.js')));
const registry=globalThis.EquationLabCommands;
const xml=await fs.readFile(path.join(engine,'addin/manifest.xml'),'utf8'),doc=new DOMParser().parseFromString(xml,'application/xml');
const all=name=>[...doc.getElementsByTagName(name)],manifestVersion=all('Version')[0].textContent;
assert.equal(manifestVersion,APP_VERSION+'.3');assert.equal(all('Group').length,5);assert.equal(all('Control').length,20);assert.equal(registry.commands.length,19);
assert.equal(all('TaskpaneId')[0].textContent,'Office.AutoShowTaskpaneWithDocument');
assert.match(xml,/SharedRuntime" MinVersion="1.1/);assert.equal(all('Runtime')[0].getAttribute('resid'),'Taskpane.Url');assert.equal(all('Runtime')[0].getAttribute('lifetime'),'long');assert.equal(all('FunctionFile')[0].getAttribute('resid'),'Taskpane.Url');
for(const command of registry.commands)assert.ok(all('FunctionName').some(node=>node.textContent===command.functionName));
const temp=await fs.mkdtemp(path.join(tmpdir(),'equationlab-packaged-ribbon-'));
let services;
try{
 services=await startAppServices({supportDirectory:temp,nativePort:0,officePort:0,watchCertificates:false});
 const origin='http://127.0.0.1:'+services.nativeServer.address().port;
 assert.equal((await fetch(origin+'/api/health').then(response=>response.json())).version,APP_VERSION);
 const served=[];
 for(const file of ['taskpane.html','taskpane.js','taskpane.css','commands.js','command-registry.js','word-actions.js']){
  const response=await fetch(origin+'/'+file);assert.equal(response.status,200,file);assert.ok((await response.arrayBuffer()).byteLength>100);served.push(file);
 }
 const icons=all('bt:Image').filter(node=>node.hasAttribute('DefaultValue'));
 for(const icon of icons){const pathname=new URL(icon.getAttribute('DefaultValue')).pathname,response=await fetch(origin+pathname);assert.equal(response.status,200,pathname);const bytes=Buffer.from(await response.arrayBuffer()),expected=Number(icon.getAttribute('id').split('.').at(-1));assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(bytes.readUInt32BE(16),expected);assert.equal(bytes.readUInt32BE(20),expected);}
 for(const blocked of ['/build-ribbon.mjs','/icons/lucide/sources.json'])assert.equal((await fetch(origin+blocked)).status,404);
 const number=await fetch(origin+'/api/number',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({layout:{numberFormat:'(#E1)',equation:4},initializeContext:true})});
 assert.equal(number.status,200);const result=await number.json();assert.match(result.ooxml,/SEQ EquationLab/);assert.match(result.ooxml,/bookmarkStart/);assert.doesNotMatch(result.ooxml,/OLEObject|MTEqn/);
 const numberingDoc=new DOMParser().parseFromString(result.ooxml,'application/xml');
 assert.match([...numberingDoc.getElementsByTagName('w:t')].map(node=>node.textContent).join(''),/\(4\)/);
 const release=JSON.parse(await fs.readFile(path.join(resources,'release-manifest.json')));
 const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
 assert.equal(release.iconAssets.version,6);assert.equal(release.iconAssets.opticalProfiles,true);assert.equal(release.iconAssets.selection,'configured-default');assert.equal(sha(await fs.readFile(path.join(resources,'EquationLab.icns'))),release.iconAssets.icnsSha256);
 process.stdout.write(JSON.stringify({appVersion:APP_VERSION,manifestVersion,groups:5,commands:19,explicitPaneOpener:true,sharedRuntime:'1.1',servedFiles:served,iconVariants:icons.length,independentNumberField:true,iconVersion:6,icnsSha256:release.iconAssets.icnsSha256,defaultOpticalBrandVerified:true,nativeIntegrationAvailable:release.nativeWordIntegration.available}));
}finally{await services?.close();await fs.rm(temp,{recursive:true,force:true});}
`;
const data = JSON.parse(execFileSync(path.join(resources, 'runtime/bin/node'), ['--input-type=module', '-e', code, resources], {encoding: 'utf8', maxBuffer: 4_000_000, env: {PATH: '/usr/bin:/bin:/usr/sbin:/sbin'}, timeout: 30_000}));
const report = {schema: 'equationlab.packaged-ribbon-cli.v1', createdAt: new Date().toISOString(), app, ...data, strictSignature: true, actualWordUsed: false, actualInstallPerformed: false, serviceScope: 'Private ephemeral ports and temporary support directory; no running app listener touched.'};
await fs.mkdir(path.dirname(output), {recursive: true}); await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
