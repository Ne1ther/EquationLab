import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';

/** The pinned, readable upstream bundle keeps this adapter independent of
 * minifier naming. Fail closed if npm or upstream render structure changes.
 */
export async function buildMathLiveEditor({root,mathliveDirectory,output}){
 const pkg=JSON.parse(await readFile(join(mathliveDirectory,'package.json'),'utf8'));
 if(pkg.version!=='0.111.1')throw Error('Radical adapter requires MathLive 0.111.1');
 const source=await readFile(join(mathliveDirectory,'mathlive.js'),'utf8');
 if(createHash('sha256').update(source).digest('hex')!=='fefddd750806bbc275d347f33c33e29518aecdce7bc949b76f8ee49d0a6bc282')throw Error('MathLive radical adapter source digest mismatch');
 const marker='  // src/core/skip-box.ts';
 if(source.split(marker).length!==2||!source.includes('var SurdAtom = class _SurdAtom extends Atom'))throw Error('MathLive radical adapter render hook mismatch');
 const renderMarker='  // src/editor-mathfield/render.ts';
 if(source.split(renderMarker).length!==2)throw Error('MathLive editor render hook mismatch');
 // A retained WKWebView can lose a queued animation frame while hidden.
 // Run that pending paint on reveal without replacing the editor or focusing it.
 const revealHook=`
  globalThis.flushEquationMathfieldRender = (element) => {
    const editor = element?._mathfield;
    if (!editor?.dirty || !editor.field || !isValidMathfield(editor)) return;
    editor.atomBoundsCache = new Map();
    render(editor);
    editor.resizeObserver.observe(editor.field);
    editor.resizeObserverStarted = true;
  };
`;
 const contour=await readFile(join(root,'src','radical-contour.mjs'),'utf8');
 if(contour.split('export function radicalContour(').length!==2)throw Error('Radical contour browser export mismatch');
 const adapter=await readFile(join(root,'desktop','radical-rendering.js'),'utf8');
 const prelude=contour.replace('export function radicalContour(','globalThis.equationRadicalContour=function radicalContour(')+'\n;\n'+adapter+'\n';
 const bundle=prelude+source.replace(marker,'  globalThis.installEquationRadicalRenderer(SurdAtom.prototype);\n\n'+marker)
  .replace(renderMarker,renderMarker+'\n'+revealHook);
 await writeFile(output,bundle);return {version:pkg.version,upstreamSha256:createHash('sha256').update(source).digest('hex'),continuousRadical:true};
}
