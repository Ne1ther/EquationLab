import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {makeNewOle,MATHTYPE_FACTORY_SOURCE} from '../../src/new-formula.mjs';
import {nativePdf} from '../../src/font-renderer.mjs';

// Build-time only: render the actual insertion catalog with factory typography.
// No per-frame preview processes, hand-spaced Unicode radicals or network I/O.
export async function buildTemplatePreviews(output){
 const source=await readFile(new URL('../../desktop/app.js',import.meta.url),'utf8'),literal=/const groups=(\{[\s\S]*?\n\});/.exec(source)?.[1];
 if(!literal)throw Error('Template catalog not found');
 const groups=vm.runInNewContext('('+literal+')',Object.create(null),{timeout:1000}),index={};
 await mkdir(output,{recursive:true});
 for(const [category,items]of Object.entries(groups))for(const [number,[,latex]]of items.entries()){
  const id=category+':'+number,example=latex.replaceAll('#0','x').replaceAll('#?','n'),file=createHash('sha256').update(id).digest('hex').slice(0,16)+'.pdf';
  let preview;try{preview=await nativePdf(makeNewOle(example));}catch(error){throw Error(`Template ${id} (${example}): ${error.message}`,{cause:error});}
  await writeFile(join(output,file),Buffer.from(preview.pdf,'base64'));index[id]=file;
 }
 const catalog=JSON.parse(await readFile(new URL('../../src/template-catalog.json',import.meta.url),'utf8'));
 const previewItems=catalog.items.filter(item=>item.sourceStatus==='verified-local');
 for(const item of previewItems){
  const file=createHash('sha256').update(item.id).digest('hex').slice(0,16)+'.pdf';
  const ole=makeNewOle(item.sample);
  let preview;try{preview=await nativePdf(ole);}catch(error){throw Error(`Catalog ${item.id} (${item.sample}): ${error.message}`,{cause:error});}
  await writeFile(join(output,file),Buffer.from(preview.pdf,'base64'));index[item.id]=file;
 }
 await writeFile(join(output,'index.json'),JSON.stringify(index,null,2)+'\n');
 await writeFile(join(output,'source.json'),JSON.stringify({factory:MATHTYPE_FACTORY_SOURCE,catalogSha256:createHash('sha256').update(literal).digest('hex'),count:Object.keys(index).length,catalogItems:previewItems.length,pendingPreviewOnly:previewItems.filter(item=>item.sourceStatus==='pending-runtime').length},null,2)+'\n');
 return {count:Object.keys(index).length,output};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await buildTemplatePreviews(resolve(process.argv[2]||'design/template-previews'))));
