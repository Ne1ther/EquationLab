import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const directory=await mkdtemp(join(tmpdir(),'equationlab-pdf-extents-')),root=resolve(import.meta.dirname,'..');
try{
 const binary=join(directory,'pdf-extent-tests');
 execFileSync('/usr/bin/xcrun',['clang++','-std=c++20','-Wall','-Wextra','-Werror','-I',join(root,'include'),join(root,'src/pdf_extent_tests.cpp'),'-framework','CoreFoundation','-framework','CoreGraphics','-o',binary],{stdio:'inherit'});
 process.stdout.write(execFileSync(binary,{encoding:'utf8'}));
}finally{await rm(directory,{recursive:true,force:true});}
