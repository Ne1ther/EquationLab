import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, access, symlink, rm, realpath, readlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pruneDependencies} from '../packaging/prune-dependencies.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'equationlab-pruning-test-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  for (const [name, version] of Object.entries({'mathjax-full':'3.2.2', mathlive:'0.111.1', sharp:'0.35.5', jszip:'3.10.1', cfb:'1.2.2', pako:'1.0.11'})) {
    await mkdir(join(directory, name), {recursive: true});
    await writeFile(join(directory, name, 'package.json'), JSON.stringify({name, version}));
    await writeFile(join(directory, name, 'LICENSE'), 'license');
  }
  const put = async path => {await mkdir(join(directory, path, '..'), {recursive: true}); await writeFile(join(directory, path), path);};
  return {directory, put};
}

test('package pruning retains runtime modules, fonts, native binaries, data and licenses byte for byte', async t => {
  const {directory, put} = await fixture(t);
  const keep = ['mathjax-full/js/input/tex/AllPackages.js', 'mathjax-full/js/output/svg/fonts/tex.js',
    'mathlive/mathlive.min.js', 'mathlive/mathlive.min.mjs', 'mathlive/fonts/KaTeX_Main.woff2', 'mathlive/sounds/click.wav',
    'sharp/dist/index.mjs', 'sharp/dist/index.cjs', '@img/sharp-darwin-arm64/lib/sharp.node',
    '@img/sharp-libvips-darwin-arm64/lib/libvips.dylib', 'speech-rule-engine/lib/mathmaps/en.json',
    'jszip/lib/index.js', 'cfb/cfb.js', 'pako/lib/inflate.js', 'mathjax-full/LICENSE',
    'mathjax-full/components/src/node-main/node-main.js', 'mathjax-full/components/src/startup/init.js',
    'mathjax-full/components/src/startup/lib/startup.js', 'mathjax-full/components/src/source.js'];
  const remove = ['mathjax-full/es5/tex-svg.js', 'mathjax-full/ts/input/tex.ts',
    'mathjax-full/js/input/tex.js.map', 'sharp/src/pipeline.cc', 'sharp/dist/index.d.mts', 'mathlive/mathlive.js',
    'mathlive/mathlive.mjs', 'jszip/dist/jszip.min.js', 'cfb/types/index.d.ts'];
  for (const path of [...keep, ...remove]) await put(path);
  const before = await Promise.all(keep.map(path => readFile(join(directory, path))));
  const report = await pruneDependencies(directory);
  assert.equal(report.removedFiles, remove.length); assert.ok(report.removedBytes > 0);
  for (const [index, path] of keep.entries()) assert.deepEqual(await readFile(join(directory, path)), before[index]);
  for (const path of remove) await assert.rejects(access(join(directory, path)));
});

test('declared main, browser, bin and production export targets survive without metadata rewriting', async t => {
  const {directory, put} = await fixture(t);
  const metadata = {name:'jszip',version:'3.10.1',main:'./dist/main',browser:{'./dist/main':'./dist/browser.js'},
    bin:{zip:'./dist/cli.js'},exports:{'.':{browser:{production:'./dist/production.mjs',development:'./dist/dev.js'},
      types:'./dist/index.d.ts',default:'./dist/main.js'},'./plugins/*':'./dist/plugins/*.mjs'}};
  const bytes=JSON.stringify(metadata);await writeFile(join(directory,'jszip/package.json'),bytes);
  const keep=['dist/main.js','dist/browser.js','dist/cli.js','dist/production.mjs','dist/plugins/a.mjs','dist/plugins/b.mjs'];
  for(const path of [...keep,'dist/dev.js','dist/index.d.ts','dist/unreferenced.js'])await put('jszip/'+path);
  await pruneDependencies(directory);
  for(const path of keep)await access(join(directory,'jszip',path));
  for(const path of ['dist/dev.js','dist/index.d.ts','dist/unreferenced.js'])await assert.rejects(access(join(directory,'jszip',path)));
  assert.equal(await readFile(join(directory,'jszip/package.json'),'utf8'),bytes);
});

test('internal npm .bin links protect their exact target and stay relocatable', async t => {
  const {directory,put}=await fixture(t);await put('pako/dist/runner.js');await put('pako/dist/unused.js');
  await mkdir(join(directory,'.bin'));await symlink('../pako/dist/runner.js',join(directory,'.bin/runner'));
  const report=await pruneDependencies(directory);
  assert.equal(report.protection.internalLinks,1);assert.equal(await readlink(join(directory,'.bin/runner')),'../pako/dist/runner.js');
  assert.equal(await realpath(join(directory,'.bin/runner')),await realpath(join(directory,'pako/dist/runner.js')));
  await assert.rejects(access(join(directory,'pako/dist/unused.js')));
});

test('an internal directory link preserves its referenced subtree', async t => {
  const {directory,put}=await fixture(t);await put('pako/dist/one.js');await put('pako/dist/two.js');
  await symlink('pako/dist',join(directory,'runtime-alias'));await pruneDependencies(directory);
  await access(join(directory,'runtime-alias/one.js'));await access(join(directory,'runtime-alias/two.js'));
});

test('absolute internal links and broken links fail before removal', async t => {
  for(const mode of ['absolute','broken']){
    const {directory,put}=await fixture(t);await put('pako/dist/removable.js');await mkdir(join(directory,'.bin'));
    await symlink(mode==='absolute'?join(directory,'pako/dist/removable.js'):'../pako/dist/missing.js',join(directory,'.bin/runner'));
    await assert.rejects(pruneDependencies(directory),mode==='absolute'?/Absolute.*relocatable/:/Broken/);
    await access(join(directory,'pako/dist/removable.js'));
  }
});

test('licenses, notices, font, sound, dictionary and binary resources override curated removal', async t => {
  const {directory,put}=await fixture(t);
  const keep=['mathjax-full/es5/NOTICE.txt','mathjax-full/es5/LICENSE.txt','mathjax-full/ts/COPYING',
    'jszip/dist/third_party-notices.md','pako/dist/fonts/test.woff2','mathlive/types/sounds/click.wav',
    'speech-rule-engine/lib/mathmaps/en.json','sharp/src/sharp.node','sharp/install/libvips.dylib'];
  for(const path of keep)await put(path);await pruneDependencies(directory);
  for(const path of keep)assert.equal(await readFile(join(directory,path),'utf8'),path);
});

test('duplicate MathJax browser data and TS font sources do not retain the es5/build trees',async t=>{
  const {directory,put}=await fixture(t);
  const remove=['mathjax-full/ts/output/svg/fonts/tex/normal.ts','mathjax-full/es5/output/svg/fonts/tex.js',
    'mathjax-full/es5/sre/mathmaps/en.json','mathjax-full/js/output/svg/fonts/tex.js.map'];
  const keep=['mathjax-full/js/output/svg/fonts/tex.js','speech-rule-engine/lib/mathmaps/en.json','mathlive/fonts/main.woff2'];
  for(const path of [...keep,...remove])await put(path);await pruneDependencies(directory);
  for(const path of keep)await access(join(directory,path));for(const path of remove)await assert.rejects(access(join(directory,path)));
});

test('only directories emptied by this removal plan are removed',async t=>{
  const {directory,put}=await fixture(t);await mkdir(join(directory,'unrelated-empty'));
  await mkdir(join(directory,'mathlive/fonts'),{recursive:true});await put('mathjax-full/ts/removable.ts');
  await pruneDependencies(directory);await access(join(directory,'unrelated-empty'));await access(join(directory,'mathlive/fonts'));
  await assert.rejects(access(join(directory,'mathjax-full/ts')));
});

test('a missing declared runtime entry fails before any removal',async t=>{
  const {directory,put}=await fixture(t);await put('pako/dist/removable.js');
  await writeFile(join(directory,'mathjax-full/package.json'),JSON.stringify({name:'mathjax-full',version:'3.2.2',main:'./components/missing.js'}));
  await assert.rejects(pruneDependencies(directory),/Missing declared runtime entry/);await access(join(directory,'pako/dist/removable.js'));
});

test('pruning is idempotent and refuses the development dependency tree',async t=>{
  const {directory,put}=await fixture(t);await put('pako/dist/removable.js');await put('mathlive/mathlive.min.js');
  await pruneDependencies(directory);const again=await pruneDependencies(directory);assert.equal(again.removedFiles,0);
  await assert.rejects(pruneDependencies(new URL('../node_modules',import.meta.url)),/Source development/);
});

test('unaudited versions and external symlinks fail before any removal', async t => {
  const {directory, put} = await fixture(t); await put('mathjax-full/es5/tex-svg.js');
  await writeFile(join(directory, 'sharp/package.json'), JSON.stringify({name:'sharp', version:'999.0.0'}));
  await assert.rejects(pruneDependencies(directory), /Unaudited/);
  await access(join(directory, 'mathjax-full/es5/tex-svg.js'));
  await writeFile(join(directory, 'sharp/package.json'), JSON.stringify({name:'sharp', version:'0.35.5'}));
  await symlink(tmpdir(), join(directory, 'external'));
  await assert.rejects(pruneDependencies(directory), /symlink/);
  await access(join(directory, 'mathjax-full/es5/tex-svg.js'));
});
