import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectOle,latexAst,oleLatex,oleRenderLatex,replaceOleLatex} from '../src/native.mjs';
import {makeNewOle} from '../src/new-formula.mjs';
import {createDocx,inspectDocx} from '../src/document.mjs';
import {nativePdf,renderNative} from '../src/font-renderer.mjs';

const mathliveDirectory=await mkdtemp(join(tmpdir(),'equationlab-native-complex-'));let mathlive;
const previousHTMLElement=globalThis.HTMLElement;globalThis.HTMLElement=class {};
try{
 const source=await readFile(new URL('../node_modules/mathlive/mathlive.mjs',import.meta.url),'utf8');
 const expose=`\nexport function equationTestParse(text){const context={...getDefaultContext()};return new Atom({type:'root',mode:'math',body:parseLatex(text,{context,parseMode:'math',mathstyle:'displaystyle'})});}\n`;
 const file=join(mathliveDirectory,'mathlive-test.mjs');await writeFile(file,source+expose);mathlive=await import(pathToFileURL(file));
}catch(error){await rm(mathliveDirectory,{recursive:true,force:true});throw Error(`MathLive parser fixture failed: ${error.message}`);}
if(previousHTMLElement===undefined)delete globalThis.HTMLElement;else globalThis.HTMLElement=previousHTMLElement;
test.after(async()=>rm(mathliveDirectory,{recursive:true,force:true}));

function records(ole){
 const {parsed}=inspectOle(ole),found=[];const walk=items=>{for(const n of items){found.push(n);if(n.children)walk(n.children);}};walk(parsed.records);return found;
}
function assertPdf(pdf){assert.equal(Buffer.from(pdf.pdf,'base64').subarray(0,5).toString(),'%PDF-');}

test('generic dots remain native and the complex Schrodinger input reaches preview/PDF',async()=>{
 const latex=String.raw`i\hbar\frac{\partial}{\partial t}\Psi(\mathbf{r}_1,\dots,\mathbf{r}_N,t) = \left[-\frac{\hbar^2}{2m}\sum_{i=1}^{N}\nabla_i^2 + V(\mathbf{r}_1,\dots,\mathbf{r}_N,t)\right]\Psi(\mathbf{r}_1,\dots,\mathbf{r}_N,t)`,ole=makeNewOle(latex),decoded=oleLatex(ole);
 assert.match(decoded,/\\ldots/);assert.ok(records(ole).some(n=>n.type===2&&n.code===0x2026),'ellipsis is stored as a native character');
 const preview=await renderNative(ole,{raster:false});assert.ok(preview.width>100);assertPdf(await nativePdf(ole));
});

test('cases row spacing is encoded in PILE MTEF, keeps its ruler on roundtrip, and affects native preview',async()=>{
 const latex=String.raw`f(x) = \begin{cases}\dfrac{\sin x}{x}, & x \neq 0 \\[6pt]1, & x = 0\end{cases}`,withoutGap=latex.replace('\\\\[6pt]','\\\\'),ole=makeNewOle(latex),pile=records(ole).find(n=>n.type===4&&n.children?.some(c=>c.type===1&&c.lineSpacing===191));
 assert.ok(pile,'a PILE uses the MTEF explicit LINE spacing field');assert.equal(pile.ruler?.tabs?.[0]?.position,768);assert.equal(pile.children.find(c=>c.type===1&&c.lineSpacing===191).lineSpacing,191);
 const decoded=oleLatex(ole);assert.match(decoded,/\\begin\{cases\}/);assert.match(decoded,/\\\\\[5\.96875bp\]/);assert.doesNotMatch(decoded,/\\el(?:rows|ruler)/);
 const mathliveValue=mathlive.equationTestParse(decoded).bodyToLatex({expandMacro:false});assert.match(mathliveValue,/\\begin\{cases\}/);assert.doesNotMatch(mathliveValue,/\\el(?:rows|ruler)/,'desktop MathLive receives ordinary LaTeX only');
 const rebuilt=makeNewOle(decoded),rebuiltPile=records(rebuilt).find(n=>n.type===4&&n.children?.some(c=>c.type===1&&c.lineSpacing===191));assert.equal(rebuiltPile?.children.find(c=>c.type===1&&c.lineSpacing===191).lineSpacing,191);assert.deepEqual(rebuiltPile?.ruler?.tabs,pile.ruler.tabs);
 const mathliveSaved=makeNewOle(mathliveValue),mathlivePile=records(mathliveSaved).find(n=>n.type===4&&n.children?.some(c=>c.type===1&&c.lineSpacing===191));assert.equal(mathlivePile?.children.find(c=>c.type===1&&c.lineSpacing===191).lineSpacing,191);assert.deepEqual(mathlivePile?.ruler?.tabs,pile.ruler.tabs);
 const edited=replaceOleLatex(ole,decoded.replace('f(x)','g(x)')),editedPile=records(edited).find(n=>n.type===4&&n.children?.some(c=>c.type===1&&c.lineSpacing===191));assert.match(oleLatex(edited),/^g\(x\)/);assert.equal(editedPile?.children.find(c=>c.type===1&&c.lineSpacing===191).lineSpacing,191);assert.deepEqual(editedPile?.ruler?.tabs,pile.ruler.tabs);
 const rendererLatex=oleRenderLatex(ole,n=>String.fromCharCode(n.code));assert.match(rendererLatex,/\\elrows\{191\}/);assert.match(rendererLatex,/\\elruler\{768\}\{0\}\{2\}/,'native preview retains its internal layout macros');
 const preview=await renderNative(ole,{raster:false}),plain=await renderNative(makeNewOle(withoutGap),{raster:false});assert.ok(preview.height>plain.height+4,'the requested six-point gap remains visible');assertPdf(await nativePdf(ole));
 const docx=await createDocx([{ole,label:'Cases'}],{fragment:true}),readback=await inspectDocx(docx);assert.equal(readback.objects.length,1);assert.equal(readback.objects[0].parseError,undefined);assert.equal(readback.objects[0].previewError,undefined);assert.equal(readback.objects[0].latex,decoded);
});

test('gathered gaps use standard LaTeX and survive MathLive and native reopen',()=>{
 const original=makeNewOle(String.raw`\begin{gathered}x=1\\[6pt]y=2\end{gathered}`),decoded=oleLatex(original),pile=records(original).find(n=>n.type===4&&n.children?.some(c=>c.type===1&&c.lineSpacing===191));
 assert.match(decoded,/\\begin\{gathered\}/);assert.match(decoded,/\\\\\[5\.96875bp\]/);assert.doesNotMatch(decoded,/\\el(?:rows|ruler)/);
 const mathliveValue=mathlive.equationTestParse(decoded).bodyToLatex({expandMacro:false}),reopened=makeNewOle(mathliveValue),reopenedPile=records(reopened).find(n=>n.type===4&&n.children?.some(c=>c.type===1&&c.lineSpacing===191));
 assert.equal(pile?.children.find(c=>c.type===1&&c.lineSpacing===191).lineSpacing,191);assert.equal(reopenedPile?.children.find(c=>c.type===1&&c.lineSpacing===191).lineSpacing,191);assert.equal(reopenedPile?.ruler,undefined);
 const bp=makeNewOle(String.raw`\begin{gathered}x\\[6bp]y\end{gathered}`),bpPile=records(bp).find(n=>n.type===4&&n.children?.some(c=>c.type===1&&c.lineSpacing===192));assert.ok(bpPile,'one PostScript bp maps to exactly 32 native units');
});

test('custom row spacing on matrix records is rejected instead of silently discarded',()=>{
 assert.throws(()=>makeNewOle(String.raw`\begin{pmatrix}a&b\\[6pt]c&d\end{pmatrix}`),/supported only for cases and gathered piles/);
});

test('displaystyle in a fraction denominator preserves display size and stacked operator limits',async()=>{
 const bayes=String.raw`P(A_i \mid B) = \frac{P(B \mid A_i)\,P(A_i)}{\displaystyle\sum_{j=1}^{n} P(B \mid A_j)\,P(A_j)}`,display=makeNewOle(bayes),plain=makeNewOle(bayes.replace('\\displaystyle',''));
 const decoded=oleLatex(display),mathliveValue=mathlive.equationTestParse(decoded).bodyToLatex({expandMacro:false});assert.match(decoded,/\\displaystyle/);assert.match(mathliveValue,/\\displaystyle/);
 const sum=records(display).find(n=>n.type===3&&n.selector===16);assert.ok(sum);assert.equal(sum.variation&0x40,0x40,'the MTEF summation stores stacked limits');
 const countType10=ole=>records(ole).filter(n=>n.type===10).length;assert.ok(countType10(display)>countType10(plain),'displaystyle writes a full-size native SIZE record in the denominator');
 const reopenedDisplay=makeNewOle(mathliveValue),reopenedSum=records(reopenedDisplay).find(n=>n.type===3&&n.selector===16);assert.ok(reopenedSum.variation&0x40,'displaystyle survives decode, MathLive parse and native save');assert.ok(countType10(reopenedDisplay)>countType10(makeNewOle(oleLatex(plain))));
 const displayIntegral=makeNewOle(String.raw`\tfrac{x}{\displaystyle\int_0^1 t\,dt}`),textIntegral=makeNewOle(String.raw`\tfrac{x}{\int_0^1 t\,dt}`),integral=records(displayIntegral).find(n=>n.type===3&&n.selector===15),inline=records(textIntegral).find(n=>n.type===3&&n.selector===15);
 assert.ok(integral.variation&0x40,'displaystyle selects stacked integral limits');assert.equal(inline.variation&0x40,0,'textstyle retains side limits');
 const preview=await renderNative(display,{raster:false});assert.ok(preview.width>40);assertPdf(await nativePdf(display));
});

test('Laplace text annotation stays outside the integral body after native decoding',async()=>{
 const latex=String.raw`\mathcal{L}\{\,f(t)\,\}(s) = \int_{0^{-}}^{\infty} e^{-st} f(t)\,dt\quad\text{（拉普拉斯变换）}`,ole=makeNewOle(latex),decoded=oleLatex(ole),ast=latexAst(decoded),items=ast.kind==='seq'?ast.items:[],integral=items.find(n=>n.kind==='bigop'&&n.command==='int');
 assert.ok(integral);const containsText=n=>n?.kind==='text'||n?.items?.some(containsText)||n?.body&&containsText(n.body);assert.equal(!!containsText(integral.body),false);
 assert.ok(items.some(n=>n.kind==='text'),'the Chinese explanation remains a separate trailing text item');
 const preview=await renderNative(ole,{raster:false});assert.ok(preview.width>50);assertPdf(await nativePdf(ole));
});
