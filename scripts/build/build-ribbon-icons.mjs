import sharp from 'sharp';
import {mkdir} from 'node:fs/promises';
const directory=new URL('../../addin/icons/',import.meta.url);
await mkdir(directory,{recursive:true});
const paths={
 editor:'<path d="M24 22h31M31 22v36M48 22v36M23 58h13M43 58h13"/>',
 document:'<path d="M26 15h23l10 10v40H26zM49 15v12h10M34 36h17M34 45h17M34 54h12"/>',
 layout:'<path d="M28 23h24M22 39h30M28 55h24M60 35v9M58 35h2M58 44h4"/>'
};
for(const [name,path] of Object.entries(paths))for(const size of [16,32,80]){
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect x="3" y="3" width="74" height="74" rx="17" fill="#ede9fe"/><g fill="none" stroke="#6250b5" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round">${path}</g></svg>`;
 await sharp(Buffer.from(svg)).resize(size,size).png().toFile(new URL(`${name}-${size}.png`,directory).pathname);
}
