import test from 'node:test';
import assert from 'node:assert/strict';
import {makeOle,inspectOle,wrapNative,oleLatex,replaceOleLatex,characters,editCharacters} from '../src/native.mjs';
import {renderNative,nativePdf} from '../src/font-renderer.mjs';
import {vectorPdfRequest,vectorInkBounds} from '../src/vector-pdf.mjs';
import {createDocx,inspectDocx,replaceDocxEquation,hash} from '../src/document.mjs';

// An original synthetic expression, encoded with the old fixed-size Symbol
// CHAR pair: MTCode 2329/232A and Symbol positions E1/F1. No document fixture.
function oldFixedAngles(latex){
 const modern=makeOle(latex),{parsed,data,header}=inspectOle(modern),records=[];
 function walk(nodes){for(const n of nodes){if(n.type===2&&[0x27e8,0x27e9].includes(n.code))records.push(n);if(n.children)walk(n.children);}}
 walk(parsed.records);assert.ok(records.length>0);
 const pieces=[];let offset=0;
 for(const n of records){
  assert.equal(n.options,0);assert.equal(n.typeface,6);
  pieces.push(data.subarray(offset,n.start));const record=Buffer.from(data.subarray(n.start,n.end));
  record[1]|=4;record.writeUInt16LE(n.code===0x27e8?0x2329:0x232a,n.codeOffset-n.start);
  pieces.push(record,Buffer.from([n.code===0x27e8?0xe1:0xf1]));offset=n.end;
 }
 pieces.push(data.subarray(offset));const mtef=Buffer.concat(pieces),h=Buffer.from(header);h.writeUInt32LE(mtef.length,8);
 return {modern,old:wrapNative(Buffer.concat([h,mtef]),modern)};
}
const angleState=ole=>characters(inspectOle(ole).parsed).filter(n=>[0x2329,0x232a,0x27e8,0x27e9].includes(n.code)).map(({code,typeface,fontPosition})=>({code,typeface,fontPosition}));

test('Old fixed-size MathType angles decode as mathematical brackets and no-op saves retain the entire OLE',()=>{
 const {modern,old}=oldFixedAngles('\\langle u+v\\rangle+\\frac{1}{3}'),before=Buffer.from(old),latex=oleLatex(old);
 assert.equal(latex,oleLatex(modern));assert.match(latex,/\\langle u\+v\\rangle/);
 assert.deepEqual(angleState(old),[{code:0x2329,typeface:6,fontPosition:0xe1},{code:0x232a,typeface:6,fontPosition:0xf1}]);
 assert.deepEqual(replaceOleLatex(old,latex),before);assert.deepEqual(editCharacters(old,{}),before);assert.deepEqual(old,before);
});

test('Old and modern fixed angles use the same real Symbol outlines in vector SVG and PDF',async()=>{
 const {modern,old}=oldFixedAngles('\\langle u+v\\rangle+\\frac{1}{3}'),before=Buffer.from(old);
 const oldPreview=await renderNative(old,{raster:false}),modernPreview=await renderNative(modern,{raster:false});
 assert.equal(oldPreview.svg,modernPreview.svg);assert.deepEqual(oldPreview.warnings,[]);
 assert.ok(oldPreview.faces.some(face=>face.font==='Symbol'&&face.postscript==='Symbol'));
 assert.ok(oldPreview.faces.every(face=>face.font==='Symbol'||face.font==='Times New Roman'));
 assert.match(oldPreview.svg,/data-c="3008"/);assert.match(oldPreview.svg,/data-c="3009"/);
 assert.doesNotMatch(oldPreview.svg,/<(?:text|image)\b|data-mjx-error/);
 const box=/viewBox="([^"]+)"/.exec(oldPreview.svg)[1].split(/\s+/).map(Number),ink=vectorInkBounds(vectorPdfRequest(oldPreview.svg,1,1));
 assert.ok(ink[0]>=box[0]&&ink[1]>=box[1]&&ink[2]<=box[0]+box[2]&&ink[3]<=box[1]+box[3]);
 const pdf=Buffer.from((await nativePdf(old)).pdf,'base64');assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.doesNotMatch(pdf.toString('latin1'),/\/Subtype\s*\/Image\b/);
 assert.deepEqual(old,before);
});

test('Character edits preserve old bracket codes and positions; structural edits keep public angle semantics',async()=>{
 const {old}=oldFixedAngles('\\langle u+v\\rangle+\\frac{1}{3}'),u=characters(inspectOle(old).parsed).find(n=>n.char==='u'),edited=editCharacters(old,{[u.offset]:'w'});
 assert.deepEqual(angleState(edited),angleState(old));assert.match(oleLatex(edited),/\\langle w\+v\\rangle/);
 assert.deepEqual((await renderNative(edited,{raster:false})).warnings,[]);
 const rebuilt=replaceOleLatex(old,oleLatex(old)+'+\\sqrt{z}'),decoded=oleLatex(rebuilt);
 assert.match(decoded,/\\langle u\+v\\rangle/);assert.match(decoded,/\\sqrt\{z\}/);
 assert.deepEqual((await renderNative(rebuilt,{raster:false})).warnings,[]);assert.ok((await nativePdf(rebuilt)).pdf);
 assert.deepEqual(replaceOleLatex(rebuilt,decoded),rebuilt);
});

test('The Symbol outline alias does not replace the declared outlines of another native font',async()=>{
 const source=makeOle('\\ell\\ell'),original=inspectOle(source),native=Buffer.from(original.native);
 const glyphs=characters(original.parsed);assert.equal(glyphs.length,2);assert.ok(glyphs.every(n=>n.typeface<0));
 for(const [i,n]of glyphs.entries())native.writeUInt16LE(0x2329+i,28+n.offset);
 const stix=wrapNative(native,source),before=Buffer.from(stix),preview=await renderNative(stix,{raster:false});
 assert.match(preview.svg,/data-c="2329"/);assert.match(preview.svg,/data-c="232A"/);assert.doesNotMatch(preview.svg,/data-c="300[89]"/);
 assert.ok(preview.faces.some(face=>face.font==='STIX Two Math'));assert.equal(oleLatex(stix),'\\langle \\rangle ');assert.deepEqual(stix,before);
});

test('DOCX readback and save preserve old bracket OLEs and unrelated formula objects',async()=>{
 const {old}=oldFixedAngles('\\frac{\\langle u+v\\rangle}{3}'),base=await createDocx([{latex:'x'},{latex:'y'}]),parsed=await inspectDocx(base);
 parsed.zip.file(parsed.objects[0].path,old);const input=await parsed.zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}),opened=await inspectDocx(input);
 assert.equal(opened.objects[0].previewError,undefined);assert.match(opened.objects[0].latex,/\\langle u\+v\\rangle/);
 const noop=await inspectDocx(await replaceDocxEquation(input,0,opened.objects[0].latex));
 assert.deepEqual(noop.objects[0].ole,old);assert.equal(noop.objects[1].nativeSha256,opened.objects[1].nativeSha256);
 const edited=await inspectDocx(await replaceDocxEquation(input,0,opened.objects[0].latex+'+2'));
 assert.match(edited.objects[0].latex,/\\langle u\+v\\rangle/);assert.equal(hash(edited.objects[1].ole),hash(opened.objects[1].ole));
});

test('Stretching angle templates keep their existing public LaTeX and native bytes',async()=>{
 const source=makeOle('\\left\\langle\\frac{u}{v}\\right\\rangle'),before=Buffer.from(source),latex=oleLatex(source);
 assert.match(latex,/\\left\\langle/);assert.match(latex,/\\right\\rangle/);
 assert.deepEqual(replaceOleLatex(source,latex),before);assert.deepEqual((await renderNative(source,{raster:false})).warnings,[]);assert.deepEqual(source,before);
});
