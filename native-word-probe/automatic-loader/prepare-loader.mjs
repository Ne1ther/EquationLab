import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

export const LIBRARY_CANDIDATES=Object.freeze({
 product:'/Library/Application Support/Equation Lab/Word/MathTypeBridgeProbe.bundle/Contents/MacOS/MathTypeBridgeProbe',
 office:'/Library/Application Support/Microsoft/Office365/Equation Lab/Word/MathTypeBridgeProbe.bundle/Contents/MacOS/MathTypeBridgeProbe'
});
const sourceURL=new URL('EquationLabStartupLoader.bas',import.meta.url);
const hash=b=>createHash('sha256').update(b).digest('hex');

export async function prepareLoader({variant='product',outputDirectory}={}){
 if(!Object.hasOwn(LIBRARY_CANDIDATES,variant))throw Error('Unknown fixed-path variant');
 const original=await fs.readFile(sourceURL,'utf8'),library=LIBRARY_CANDIDATES[variant];
 const source=original.replaceAll(LIBRARY_CANDIDATES.product,library);
 if((source.match(/Private Declare PtrSafe Function/g)||[]).length!==2)throw Error('Unexpected loader declarations');
 if(/\/Users\/|VBProject|VBComponents|AppleScript|MacScript|Shell\s*\(/i.test(source))throw Error('Nonportable or forbidden bootstrap action');
 if(!/^Public Sub AutoExec\(\)/m.test(source))throw Error('Missing startup entry point');
 const declarations=[...source.matchAll(/Declare PtrSafe Function (\w+) Lib "([^"]+)" Alias "([^"]+)"/g)].map(m=>({name:m[1],library:m[2],symbol:m[3]}));
 if(declarations.some(d=>d.library!==library))throw Error('Inconsistent fixed library identity');
 const contract={schema:'equationlab.word-startup-loader-design.v1',variant,library,module:'EquationLabStartupLoader',template:'EquationLabStartup.dotm',sourceSha256:hash(source),declarations,autoEntry:'AutoExec',appBundleIdentifier:'app.equationlab.mac',nativeEndpoint:'http://127.0.0.1:37952',sourceOnly:true,compiledTemplateAvailable:false,installed:false,validatedInWord:false,requirements:['Compile this independently authored source into a real Word-created macro-enabled global template during the developer build, not on the user machine.','The fixed native-library path must pass real Word sandbox/binding and AutoExec-main-thread registration tests.','Install the compiled template into the actual current-user Word Startup directory without changing that setting.','Preserve macro security policy; Office may require explicit user trust or refuse automatic macros.','Never rewrite VBA source in a signed release template at installation time.'],rollback:'Remove only manifest-owned startup template/bundle; clean Word exit/restart removes retained process factories.'};
 if(outputDirectory){const target=path.resolve(outputDirectory);await fs.mkdir(target,{recursive:true});await fs.writeFile(path.join(target,'EquationLabStartupLoader.bas'),source);await fs.writeFile(path.join(target,'template-build-contract.json'),JSON.stringify(contract,null,2)+'\n');}
 return {source,contract};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),variant=args.includes('--office-path')?'office':'product',at=args.indexOf('--output');
 if(at<0||!args[at+1])throw Error('Usage: node prepare-loader.mjs --output <new staging directory> [--office-path]');
 const {contract}=await prepareLoader({variant,outputDirectory:args[at+1]});console.log(JSON.stringify(contract));
}
