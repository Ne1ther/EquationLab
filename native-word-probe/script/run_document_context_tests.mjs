import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import JSZip from 'jszip';
const exec=promisify(execFile),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'equationlab-document-context-'));
try{
 const binary=path.join(scratch,'document-context-tests');
 const zip=new JSZip();
 for(const [name,value] of [['_rels/.rels','<Relationships/>'],['[Content_Types].xml','<Types/>'],['word/document.xml','<document/>'],['word/embeddings/equation.bin','OLE fixture']])zip.file(name,value,{createFolders:false});
 const fixture=path.join(scratch,'source.docx');await fs.writeFile(fixture,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
 await exec('xcrun',['clang++','-std=c++20','-Wall','-Wextra','-Werror','-fobjc-arc','-I',path.join(root,'include'),path.join(root,'src/document_context_tests.mm'),'-framework','AppKit',path.join(root,'src/word_host_pump.mm'),'-framework','Foundation','-o',binary],{maxBuffer:2_000_000});
 const {stdout}=await exec(binary,[fixture],{timeout:10000,maxBuffer:100000});process.stdout.write(stdout);
}finally{await fs.rm(scratch,{recursive:true,force:true});}
