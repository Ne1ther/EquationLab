import {realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

// Node canonicalizes import URLs; macOS /var and /private/var are aliases.
export async function isMainModule(url){
 if(!process.argv[1])return false;
 try{return await realpath(process.argv[1])===await realpath(fileURLToPath(url));}catch{return false;}
}
