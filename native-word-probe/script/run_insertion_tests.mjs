import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temporary=await mkdtemp(path.join(tmpdir(),'equationlab-insertion-tests-'));
try{
 const binary=path.join(temporary,'insertion-tests');
 execFileSync('/usr/bin/xcrun',['clang++','-std=c++20','-Wall','-Wextra','-Werror','-fobjc-arc','-I',path.join(root,'include'),path.join(root,'src/insertion_tests.mm'),path.join(root,'src/word_host_pump.mm'),'-framework','Foundation','-framework','AppKit','-o',binary],{stdio:'inherit'});
 execFileSync(binary,[],{stdio:'inherit'});
}finally{await rm(temporary,{recursive:true,force:true});}
