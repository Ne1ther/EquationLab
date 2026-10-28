import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {ribbonArtwork,ribbonSvg} from './icon-artwork.mjs';

const directory=path.join(import.meta.dirname,'icons');
await fs.mkdir(path.join(directory,'svg'),{recursive:true});
for(const name of Object.keys(ribbonArtwork)){
 await fs.writeFile(path.join(directory,'svg',name+'.svg'),ribbonSvg(name));
 for(const size of [16,32,80]){
  // Small marks get a stronger optical weight; all sizes render from vectors.
  await sharp(Buffer.from(ribbonSvg(name,{small:size===16})),{density:96*size/24})
   .resize(size,size).png().toFile(path.join(directory,`${name}-${size}.png`));
 }
}
console.log(JSON.stringify({icons:Object.keys(ribbonArtwork).length,sizes:[16,32,80],fontIndependent:true}));
