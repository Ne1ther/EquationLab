import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'equationlab-object-identity-'));
try{
 const binary=path.join(scratch,'object-identity-tests');
 await exec('xcrun',['clang++','-std=c++20','-Wall','-Wextra','-Werror','-I',path.join(root,'include'),path.join(root,'src/object_identity_tests.cpp'),'-o',binary],{maxBuffer:2_000_000});
 const {stdout}=await exec(binary,[],{timeout:10000,maxBuffer:100000});process.stdout.write(stdout);
}finally{await fs.rm(scratch,{recursive:true,force:true});}
