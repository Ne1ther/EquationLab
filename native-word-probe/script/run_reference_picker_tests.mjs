import {execFileSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const scratch=await mkdtemp(path.join(tmpdir(),'equationlab-reference-picker-'));
try{
 const binary=path.join(scratch,'tests');
 execFileSync('/usr/bin/xcrun',['clang++','-std=c++20','-Wall','-Wextra','-Werror','-fobjc-arc','-I',path.join(root,'include'),path.join(root,'src/reference_picker_tests.mm'),'-framework','AppKit','-framework','Foundation','-o',binary],{stdio:'inherit'});
 execFileSync(binary,[],{stdio:'inherit',timeout:15000});
}finally{await rm(scratch,{recursive:true,force:true});}
