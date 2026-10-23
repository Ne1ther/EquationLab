import {execFileSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const scratch=await mkdtemp(path.join(tmpdir(),'equationlab-word-document-requests-'));
try{
 const binary=path.join(scratch,'tests');
 execFileSync('/usr/bin/xcrun',['clang++','-std=c++20','-Wall','-Wextra','-Werror','-fobjc-arc','-DEL_WORD_DOCUMENT_REQUESTS_TESTING','-I',path.join(root,'include'),path.join(root,'src/word_document_requests_tests.mm'),'-framework','Foundation','-o',binary],{stdio:'inherit'});
 execFileSync(binary,[],{stdio:'inherit',timeout:15000});
}finally{await rm(scratch,{recursive:true,force:true});}
