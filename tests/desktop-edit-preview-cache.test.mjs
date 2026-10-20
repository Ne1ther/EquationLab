import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rename,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {desktopRequest} from '../src/desktop-rpc.mjs';
import {inspectDocx,replaceDocxEquation,hash} from '../src/document.mjs';
import {editCharacters,inspectOle,oleLatex,patchRuler,replaceOleLatex} from '../src/native.mjs';
import {patchTypography} from '../src/typography-native.mjs';

const fixture=new URL('../docs/examples/equation-lab-30-formulas.docx',import.meta.url);
async function scratch(t){const directory=await mkdtemp(join(tmpdir(),'equationlab-edit-preview-cache-'));t.after(()=>rm(directory,{recursive:true,force:true}));return join(directory,'source.docx');}

test('Cached edit previews keep source OLE bytes unchanged across structural, character, ruler and typography previews',async t=>{
 const input=await scratch(t),sourceBytes=await readFile(fixture),source=await inspectDocx(sourceBytes),object=source.objects[0];
 await writeFile(input,sourceBytes);assert.equal(source.objects.length,30);assert.ok(object.characters.some(c=>c.editable));
 const latex='\\frac{x}{y}',typography={fullSize:18},ruler=[{position:1536,type:3}];
 const rebuilt=patchRuler(patchTypography(replaceOleLatex(object.ole,latex),typography),ruler);
 const rebuildResult=await desktopRequest({action:'editPreview',payload:{input,index:0,mode:'rebuild',latex,typography,ruler}});
 assert.equal(rebuildResult.nativeSha256,hash(inspectOle(rebuilt).native));assert.equal(rebuildResult.latex,oleLatex(rebuilt));

 const character=object.characters.find(c=>c.editable&&c.editCategory==='letter'),replacements={[character.offset]:character.char==='s'?'p':'s'},charTypography={fullSize:16};
 const edited=patchTypography(editCharacters(object.ole,replacements),charTypography);
 const characterResult=await desktopRequest({action:'editPreview',payload:{input,index:0,mode:'characters',replacements,typography:charTypography}});
 assert.equal(characterResult.nativeSha256,hash(inspectOle(edited).native));assert.equal(characterResult.latex,oleLatex(edited));

 const unchanged=await desktopRequest({action:'editPreview',payload:{input,index:0,mode:'characters',replacements:{[character.offset]:character.char}}});
 assert.equal(unchanged.nativeSha256,object.nativeSha256,'later preview must still read the original cached Native');
 assert.equal(unchanged.latex,object.latex);
 assert.deepEqual(await readFile(input),sourceBytes,'preview transforms must not write into the source DOCX');
});

test('Edit preview invalidates cached DOCX data after the same path is atomically replaced',async t=>{
 const input=await scratch(t),sourceBytes=await readFile(fixture),source=await inspectDocx(sourceBytes),index=0;
 await writeFile(input,sourceBytes);
 const initial=await desktopRequest({action:'editPreview',payload:{input,index,mode:'characters',replacements:{}}});
 assert.equal(initial.nativeSha256,source.objects[index].nativeSha256);

 const newLatex='s=s_{0}+at',replacementBytes=await replaceDocxEquation(sourceBytes,index,newLatex),replacement=await inspectDocx(replacementBytes);
 assert.notEqual(replacement.objects[index].nativeSha256,source.objects[index].nativeSha256);
 const oldStat=await stat(input,{bigint:true}),next=input+'.replacement';
 await writeFile(next,replacementBytes);await rename(next,input);
 const newStat=await stat(input,{bigint:true});assert.notEqual(newStat.ino,oldStat.ino,'atomic path replacement must change the cached file identity');

 const character=replacement.objects[index].characters.find(c=>c.editable&&c.char==='s'),replacements={[character.offset]:'p'};
 const expected=editCharacters(replacement.objects[index].ole,replacements);
 const result=await desktopRequest({action:'editPreview',payload:{input,index,mode:'characters',replacements}});
 assert.equal(result.nativeSha256,hash(inspectOle(expected).native),'preview must use the replacement document Native, not the old parsed cache');
 assert.equal(result.latex,oleLatex(expected));
 assert.deepEqual(await readFile(input),replacementBytes,'preview must leave the replacement DOCX untouched');
});
