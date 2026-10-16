import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

const root=resolve(import.meta.dirname,'../..'),temporary=await mkdtemp(join(tmpdir(),'equationlab-catalog-check-'));
try{
 const executable=join(temporary,'catalog-check');
 execFileSync('/usr/bin/xcrun',['swiftc','-O','-swift-version','5',
  'macos/Models/FeatureCatalog.swift','macos/Models/WorkbenchState.swift',
  'tests/fixtures/catalog-library-before37.swift','scripts/build/check-catalog-library.swift','-o',executable],{cwd:root,stdio:['ignore','pipe','pipe'],timeout:120000});
 process.stdout.write(execFileSync(executable,[join(root,'src/template-catalog.json')],{cwd:root,encoding:'utf8',timeout:60000}));
}finally{await rm(temporary,{recursive:true,force:true});}
