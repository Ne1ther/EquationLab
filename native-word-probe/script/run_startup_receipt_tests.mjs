import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
const exec=promisify(execFile),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),scratch=await fs.mkdtemp(path.join(os.tmpdir(),'equationlab-receipt-tests-'));
try{
 const binary=path.join(scratch,'startup-receipt-tests');
 await exec('xcrun',['clang++','-std=c++20','-Wall','-Wextra','-Werror','-fobjc-arc',path.join(root,'src/startup_receipt_tests.mm'),'-framework','Foundation','-o',binary],{maxBuffer:2_000_000});
 const {stdout}=await exec(binary,[],{timeout:10000,maxBuffer:100000});
 const result={schema:'equationlab.startup-receipt-cli-tests.v1',...JSON.parse(stdout),timestamp:new Date().toISOString(),platform:process.platform,architecture:process.arch,sourceSha256:createHash('sha256').update(await fs.readFile(path.join(root,'src/startup_receipt.mm'))).digest('hex')};
 const evidence=path.resolve(root,'../evidence/word-native-integration/automatic-loader');await fs.mkdir(evidence,{recursive:true});await fs.writeFile(path.join(evidence,'startup-receipt-tests.json'),JSON.stringify(result,null,2)+'\n');process.stdout.write(JSON.stringify(result)+'\n');
}finally{await fs.rm(scratch,{recursive:true,force:true});}
