import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';

/** Compile reviewed SVGs once. The dark header keeps the approved outlines
 * and orange exponent, with light ink for contrast on native dark chrome. */
export async function buildWorkbenchAssets({root, resources}) {
 const target=join(resources,'brand');await mkdir(target,{recursive:true});
 const inputs=[
  ['EquationLab-header','design/workbench-concepts/assets/equationlab-header-mark.svg',144,96],
  ['Word','design/office-product-icons/microsoft-20251117/word_48x1.svg',64,64],
  ['Microsoft365','design/office-product-icons/microsoft-20251117/m365_48x1.svg',64,64]
 ];
 const assets=[];
 for(const [name,path,width,height] of inputs){
  const bytes=await readFile(join(root,path));
  const png=await sharp(bytes,{density:192}).resize(width,height,{fit:'inside'}).png().toBuffer();
  await writeFile(join(target,name+'.png'),png);
  assets.push({name,source:path,sourceSha256:createHash('sha256').update(bytes).digest('hex'),bytes:png.length});
  if(name==='EquationLab-header'){
   const dark=bytes.toString().replaceAll('#35383c','#f5f5f7').replaceAll('#292c30','#e8e8ed').replaceAll('#23262a','#d2d2d7').replaceAll('#77756e','#dadadd');
   await writeFile(join(target,'EquationLab-header-dark.png'),await sharp(Buffer.from(dark),{density:192}).resize(width,height,{fit:'inside'}).png().toBuffer());
  }
 }
 await writeFile(join(target,'Microsoft-product-icons-NOTICE.md'),await readFile(join(root,'design/office-product-icons/README.md'),'utf8'));
 return {assets,runtime:'cached AppKit images; no SVG rendering process'};
}
