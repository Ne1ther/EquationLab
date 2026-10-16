import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import {makeOle,inspectOle,oleLatex} from '../src/native.mjs';
import {renderNative} from '../src/font-renderer.mjs';

const directory=await mkdtemp(join(tmpdir(),'equation-editable-macro-test-'));
let mathlive;
// The parser is bundled with custom-element class declarations. No element or
// DOM is instantiated; this inert base lets us exercise the actual parser/AST.
const previousHTMLElement=globalThis.HTMLElement;globalThis.HTMLElement=class {};
try {
 const source=await readFile(new URL('../node_modules/mathlive/mathlive.mjs',import.meta.url),'utf8');
 const expose=`\nexport function equationTestParse(text,definitions){const context={...getDefaultContext()};const macros=normalizeMacroDictionary(definitions);context.getMacro=token=>getMacroDefinition(token,macros);return new Atom({type:'root',mode:'math',body:parseLatex(text,{context,parseMode:'math',mathstyle:'displaystyle'})});}\n`;
 const file=join(directory,'mathlive-test.mjs');await writeFile(file,source+expose);mathlive=await import(pathToFileURL(file));
} catch(error) {await rm(directory,{recursive:true,force:true});throw Error(`MathLive parser fixture failed: ${error.message}`);}
test.after(async()=>{if(previousHTMLElement===undefined)delete globalThis.HTMLElement;else globalThis.HTMLElement=previousHTMLElement;await rm(directory,{recursive:true,force:true});});
const context=vm.createContext({window:{}});
vm.runInContext(await readFile(new URL('../desktop/catalog-macros.js',import.meta.url),'utf8'),context);
vm.runInContext(await readFile(new URL('../desktop/editable-macros.js',import.meta.url),'utf8'),context);
const sourceDefinitions={sfrac:{args:2,def:'{}^{#1}\\!/\\!{}_{#2}',expand:false},sout:{args:1,def:'\\enclose{horizontalstrike}{#1}',expand:false},overbracket:{args:1,def:'\\overbrace{#1}',expand:false},underbracket:{args:1,def:'\\underbrace{#1}',expand:false},eltab:{args:0,def:'\\hspace{1em}',expand:false},...context.window.equationCatalogMacros};
const definitions=context.window.prepareEquationMacros(sourceDefinitions);
function parse(text){const root=mathlive.equationTestParse(context.window.safeEquationMacroLatex(text),definitions);return {root,mf:{_mathfield:{model:{root}}},value:()=>root.bodyToLatex({expandMacro:false})};}
function direct(node){return [...Object.values(node._branches||{}).flat(),...(node._rows||[]).flat(2)].filter(Boolean);}
function all(root){const result=[];function walk(n){result.push(n);for(const c of direct(n))walk(c);}walk(root);return result;}
function editLiteral(root,from,to){const atom=all(root).find(n=>n.value===from&&n.type!=='first');assert.ok(atom,`literal ${from} exists`);atom.value=to;atom.command=to;atom.isDirty=true;return atom;}
const tex=String.raw;

test('Every quick-access entry survives actual MathLive parsing and native preview',async()=>{
 const app=await readFile(new URL('../desktop/app.js',import.meta.url),'utf8');
 const literal=/const groups=(\{[\s\S]*?\n\});/.exec(app)?.[1];assert.ok(literal);
 const groups=vm.runInNewContext('('+literal+')');
 for(const [category,entries]of Object.entries(groups))for(const [label,latex]of entries){
  const state=parse(latex.replaceAll('#0','x').replaceAll('#?','n'));context.window.syncEquationMacros(state.mf);
  try{await renderNative(makeOle(state.value()),{raster:false});}catch(error){throw Error(`${category}/${label}: ${state.value()}: ${error.message}`);}
 }
});

test('Prepared macro bodies expose editable argument regions while zero-argument tabs remain atomic',()=>{
 assert.equal(definitions.mtmatrix.captureSelection,false);assert.equal(definitions.eltab.captureSelection,true);
 assert.match(definitions.mtmatrix.def,/equationlab-owner=mtmatrix,equationlab-arg=4/);
 assert.doesNotMatch(definitions.mtmatrix.def,/equationlab-arg=1/);
 const {root}=parse(tex`\mtmatrix{129}{129}{4}{\begin{matrix}a&b\\c&d\end{matrix}}`);
 const macro=all(root).find(n=>n.type==='macro'&&n.command==='\\mtmatrix');assert.equal(macro.captureSelection,false);
 const a=all(root).find(n=>n.value==='a');assert.equal(a.inCaptureSelection,false);
});
test('A real matrix-cell AST edit updates its saved macro argument and preserves all hidden native settings',async()=>{
 const state=parse(tex`\mtmatrix{129}{129}{4}{\begin{bmatrix}a&b\\c&d\end{bmatrix}}`),before=state.value();editLiteral(state.root,'a','z');
 assert.equal(state.value(),before,'MathLive itself demonstrably keeps stale macroArgs');
 const result=context.window.syncEquationMacros(state.mf);assert.ok(result.changed>0);
 const value=state.value();assert.match(value,/\\mtmatrix\{129\}\{129\}\{4\}/);assert.match(value,/z\s*&\s*b/);assert.doesNotMatch(value,/htmlData|equationlab-/);
 const ole=makeOle(value);await renderNative(ole,{raster:false});let matrix;function walk(ns){for(const n of ns){if(n.type===5)matrix=n;if(n.children)walk(n.children);}}walk(inspectOle(ole).parsed.records);assert.equal(matrix.hjust,129);assert.equal(matrix.vjust,129);assert.match(oleLatex(ole),/z&b/);
 assert.equal(context.window.syncEquationMacros(state.mf).changed,0,'a second synchronization is idempotent');
});
test('Nested same-name macros and the editable sfrac helper commit inside-out without leaking markers',async()=>{
 const state=parse(tex`\mtfrac{3}{\mtfrac{6}{a}{b}}{c}`);editLiteral(state.root,'a','z');context.window.syncEquationMacros(state.mf);
 const value=state.value();assert.match(value,/\\mtfrac\{3\}\{\\mtfrac\{6\}\{z\}\{b\}\}\{c\}/);assert.doesNotMatch(value,/htmlData|equationlab-/);await renderNative(makeOle(value),{raster:false});
});
test('Actual MathLive array insertion commits the new column and retains matrix flags',async()=>{
 const state=parse(tex`\mtmatrix{129}{129}{4}{\begin{bmatrix}a&b\\c&d\end{bmatrix}}`),array=all(state.root).find(n=>n.type==='array');
 array.addColumnAfter(0);context.window.syncEquationMacros(state.mf);const value=state.value();assert.doesNotMatch(value,/htmlData|equationlab-/);
 const ole=makeOle(value);let matrix;function walk(ns){for(const n of ns){if(n.type===5)matrix=n;if(n.children)walk(n.children);}}walk(inspectOle(ole).parsed.records);assert.equal(matrix.cols,3);assert.equal(matrix.rows,2);assert.equal(matrix.hjust,129);assert.equal(matrix.vjust,129);await renderNative(ole,{raster:false});
});
test('Edits to EMB bodies, double-arrow annotations and custom operator bounds preserve native identity',async()=>{
 for(const [text,from,to,record]of [[tex`\mtembU{x}`,'x','y',{type:6,embellishment:22}],[tex`\mtdoublearrow{13}{a}{b}`,'b','q',{type:3,selector:14,variation:13}],[tex`\mtbigop{21}{48}{\oplus}{x}{a}{b}`,'b','q',{type:3,selector:21,variation:48}]]){
  const state=parse(text);editLiteral(state.root,from,to);context.window.syncEquationMacros(state.mf);const value=state.value();assert.match(value,new RegExp(to));assert.doesNotMatch(value,/htmlData|equationlab-/);const ole=makeOle(value),records=[];function walk(ns){for(const n of ns){records.push(n);if(n.children)walk(n.children);}}walk(inspectOle(ole).parsed.records);assert.ok(records.some(n=>Object.entries(record).every(([key,v])=>n[key]===v)));await renderNative(ole,{raster:false});
 }
});
test('All expanded integral bodies and visible limits remain editable without changing native options or variation',async()=>{
 const catalog=JSON.parse(await readFile(new URL('../src/template-catalog.json',import.meta.url),'utf8'));
 for(const item of catalog.items.filter(i=>i.nativeDefinition&&i.variation>=256)){
  const state=parse(item.sample);editLiteral(state.root,'x','z');if(item.variation&16)editLiteral(state.root,'a','q');if(item.variation&32)editLiteral(state.root,'b','r');
  context.window.syncEquationMacros(state.mf);const value=state.value();assert.match(value,/\{1\}\{z\}/);assert.doesNotMatch(value,/htmlData|equationlab-/);
  const ole=makeOle(value),record=inspectOle(ole).parsed.records.flatMap(n=>n.children??[]).find(n=>n.type===3&&n.selector===15);assert.equal(record.variation,item.variation);assert.equal(record.templateOptions,1);await renderNative(ole,{raster:false});
 }
});
test('Instance value/setValue/insert wrappers normalize legacy empty arguments before the real parser sees them',()=>{
 class Field {
  constructor(){this.setValue('');}
  get value(){return this._mathfield.model.root.bodyToLatex({expandMacro:false});}
  set value(text){this.setValue(text);}
  setValue(text,options){this.lastOptions=options;this._mathfield={model:{root:mathlive.equationTestParse(text,definitions)}};return 'set-result';}
  insert(text,options){this.lastInsertOptions=options;this.setValue(this.value+text);return 'insert-result';}
 }
 const field=new Field();context.window.installEquationMacroEditing(field);context.window.installEquationMacroEditing(field);
 field.value=tex`\mtdoublearrow{9}{}{b}`;context.window.syncEquationMacros(field);assert.match(field.value,/\\mtdoublearrow\{9\}\{\{\}\}\{b\}/);assert.doesNotThrow(()=>makeOle(field.value));
 assert.equal(field.setValue(tex`\mtbigop{21}{32}{\oplus}{x}{}{b}`,{silenceNotifications:true}),'set-result');context.window.syncEquationMacros(field);assert.doesNotThrow(()=>makeOle(field.value));
 assert.equal(field.insert(tex`+\mtdoublearrow{5}{a}{}`,{selectionMode:'after'}),'insert-result');context.window.syncEquationMacros(field);assert.doesNotThrow(()=>makeOle(field.value));
 assert.equal(context.window.safeEquationMacroLatex(tex`\unmanaged{}{}+\eltab`),tex`\unmanaged{}{}+\eltab`);
 assert.equal(context.window.safeEquationMacroLatex(tex`\text{\mtdoublearrow{9}{}{b}}+\textrm{\mtembA{}}`),tex`\text{\mtdoublearrow{9}{}{b}}+\textrm{\mtembA{}}`);
});
test('Escaped braces, empty arguments and internal marker promotion remain safe to serialize',async()=>{
 const state=parse(tex`\mtdoublearrow{13}{\text{\{a\}}}{}`);editLiteral(state.root,'a','z');context.window.syncEquationMacros(state.mf);
 const value=state.value();assert.match(value,/\\mtdoublearrow\{13\}/);assert.match(value,/\\\{z\\\}/);assert.doesNotMatch(value,/htmlData|equationlab-/);await renderNative(makeOle(value),{raster:false});
 const marked=all(state.root).find(n=>n.command==='\\htmlData');assert.ok(marked);assert.doesNotMatch(marked._serialize({}),/htmlData|equationlab-/,'a promoted marker serializes only content');
});
test('Every enabled catalogue sample retains native template or EMB identity after real MathLive synchronization',async()=>{
 const catalog=JSON.parse(await readFile(new URL('../src/template-catalog.json',import.meta.url),'utf8'));
 for(const item of catalog.items.filter(i=>i.sourceStatus==='verified-local'&&(i.nativeDefinition||i.embellishment))){const state=parse(item.sample);context.window.syncEquationMacros(state.mf);const value=state.value();assert.doesNotMatch(value,/htmlData|equationlab-/,item.id);let ole;try{ole=makeOle(value);}catch(error){throw Error(`${item.id} ${value}: ${error.message}`);}const native=[];function walk(ns){for(const n of ns){native.push(n);if(n.children)walk(n.children);}}walk(inspectOle(ole).parsed.records);if(item.nativeDefinition)assert.ok(native.some(n=>n.type===3&&n.selector===item.selector&&n.variation===item.variation),item.originalToken);if(item.embellishment)assert.ok(native.some(n=>n.type===6&&n.embellishment===item.embellishment),item.originalToken);await renderNative(ole,{raster:false});}
});
