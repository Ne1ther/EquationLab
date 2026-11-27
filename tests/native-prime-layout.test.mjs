import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import JSZip from 'jszip';
import sharp from 'sharp';
import {inspectOle,oleLatex,replaceOleLatex} from '../src/native.mjs';
import {makeNewOle} from '../src/new-formula.mjs';
import {renderNative} from '../src/font-renderer.mjs';
import {hash} from '../src/document.mjs';
import {vectorPdfRequest,vectorInkBounds} from '../src/vector-pdf.mjs';
import {localLegacyOptions} from './helpers/local-legacy-evidence.mjs';

const tex=String.raw;
const identity=tex`\begin{matrix}Identity=x&Identity'=1\end{matrix}`;

function near(actual,expected,tolerance,label){
 assert.ok(Math.abs(actual-expected)<tolerance,`${label}: expected ${expected} ± ${tolerance}, got ${actual}`);
}

function identityGeometry(preview,continued){
 const {vector}=vectorPdfRequest(preview.svg,preview.width,preview.height),pt=preview.fullSize/1000;
 const [firstI,,,,,,,firstY,firstEquals,firstX,secondI,,,,,,,secondY,prime,secondEquals,one,zero]=vector;
 assert.equal(vector.length,continued?22:21);
 near((firstY.matrix[4]-firstI.matrix[4])*pt,31.3125,.12,'Identity left cell I-to-y step');
 near((secondY.matrix[4]-secondI.matrix[4])*pt,31.3125,.32,'Identity right cell I-to-y step');
 near((firstX.matrix[4]-firstEquals.matrix[4])*pt,9.9375,.25,'relation-to-variable origin distance');
 near((one.matrix[4]-secondEquals.matrix[4])*pt,8.0625,.15,'relation-to-digit origin distance');
 near((prime.matrix[4]-secondY.matrix[4])*pt,5.625,.08,'prime offset to the right of y');
 near((secondY.matrix[5]-prime.matrix[5])*pt,.6875,.08,'prime lift over the y baseline');
 near(prime.matrix[0]*preview.fullSize,12,.01,'native Symbol prime point size');
 if(continued){
  near((zero.matrix[4]-one.matrix[4])*pt,6,.03,'continuous decimal digits in the matrix cell');
  assert.equal(one.matrix[5],zero.matrix[5]);
 }
 return vector;
}

async function checkIdentityGeometry(source){
 const input=Buffer.from(source);
 const original=await renderNative(source,{raster:false}),edited=replaceOleLatex(source,oleLatex(source).replace(/=1(?=\\end\{matrix\})/,'=10'));
 const continued=await renderNative(edited,{raster:false});
 const before=identityGeometry(original,false),after=identityGeometry(continued,true);
 for(const row of [before,after]){
  const bounds=row.map(glyph=>vectorInkBounds({vector:[glyph]}));
  for(const [base,next] of [[17,18],[18,19],[19,20],...(row.length===22?[[20,21]]:[])]){
   assert.ok(bounds[base][2]<bounds[next][0],`Visible glyphs ${base} and ${next} overlap`);
  }
 }
 assert.deepEqual(source,input);
 return original;
}

async function overlapPixels(preview){
 // The italic ink may share horizontal bounds. Verify the strokes stay
 // disjoint by rasterizing alternating glyphs on one shared pixel grid.
 const dom=new DOMParser().parseFromString(preview.svg,'image/svg+xml'),serializer=new XMLSerializer();
 const mask=async parity=>{
  const clone=dom.cloneNode(true);
  for(const [index,node] of Array.from(clone.getElementsByTagName('use')).entries()){
   if(index%2!==parity)node.parentNode.removeChild(node);
  }
  return sharp(Buffer.from(serializer.serializeToString(clone))).resize({width:1600}).ensureAlpha().raw().toBuffer();
 };
 const [even,odd]=await Promise.all([mask(0),mask(1)]);
 assert.equal(even.length,odd.length);
 let overlap=0;
 // Fractional coverage at both edges can come from the antialiasing filter.
 // Require both masks to cover at least half a pixel to count it as ink.
 for(let i=3;i<even.length;i+=4)if(even[i]>=128&&odd[i]>=128)overlap++;
 return overlap;
}

test('Identity matrix redraw keeps original letter, relation and full-size prime placements without colliding italic pairs',async()=>{
 const preview=await checkIdentityGeometry(makeNewOle(identity));
 assert.equal(await overlapPixels(preview),0,'Identity has compact but separate visible strokes');
 for(const pair of ['fY','fV','kJ']){
  const rendered=await renderNative(makeNewOle(pair),{raster:false});
  assert.ok(rendered.faces.some(face=>face.postscript==='TimesNewRomanPS-ItalicMT'));
  assert.equal(await overlapPixels(rendered),0,`${pair} has no visible ink overlap`);
 }
});

test('The original MathType Identity matrix redraws and rebuilds from the historical Word copy',localLegacyOptions,async()=>{
 const file=new URL('../.local/word-catalog-skill-20261120/skill-编号完成.docx',import.meta.url);
 const zip=await JSZip.loadAsync(await readFile(file)),source=await zip.file('word/embeddings/oleObject6.bin').async('nodebuffer');
 assert.equal(hash(inspectOle(source).native),'f8b0c78efdf8c4ebbe07473f6a326205a5324a6f0b8aecf63119e6b2513443f5');
 await checkIdentityGeometry(source);
});

test('Repeated native prime ink retains the base size, while an explicit prime keeps its script size',async()=>{
 for(const count of [1,2,3]){
  const preview=await renderNative(makeNewOle("y"+"'".repeat(count)),{raster:false});
  const [base,...marks]=vectorPdfRequest(preview.svg,preview.width,preview.height).vector;
  assert.equal(marks.length,count);
  assert.ok(preview.faces.some(face=>face.postscript==='Symbol'));
  for(const [i,mark] of marks.entries()){
   assert.equal(mark.matrix[0],base.matrix[0]);
   assert.equal(mark.matrix[5],marks[0].matrix[5]);
   if(i)assert.ok(marks[i-1].matrix[4]<mark.matrix[4]);
  }
 }
 const explicit=await renderNative(makeNewOle(tex`y^{\prime}`),{raster:false});
 const [base,mark]=vectorPdfRequest(explicit.svg,explicit.width,explicit.height).vector;
 assert.ok(mark.matrix[0]<base.matrix[0]*.7);
});
