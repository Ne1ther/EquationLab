import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocx,inspectDocx,hash,NS} from '../src/document.mjs';
import {preflightNumbering} from '../src/document-numbering-plan.mjs';

function node(doc,name,text,attrs={}){const n=doc.createElementNS(NS.w,'w:'+name);for(const [k,v]of Object.entries(attrs))n.setAttributeNS(NS.w,'w:'+k,v);if(text!==undefined)n.appendChild(doc.createTextNode(text));return n;}
function run(doc,child){const r=node(doc,'r');r.appendChild(child);return r;}
async function fixture({complex=false,wrapper='ins',mode='numbered-right',deleted=false}={}){
 const bytes=await createDocx(['x','y'].map(latex=>({latex,layout:{mode,chapter:3,section:2,numberFormat:'(#C1.#S1.#E1)'}})),{references:[{target:0}]});
 const parsed=await inspectDocx(bytes),doc=parsed.doc;
 if(complex)for(const f of Array.from(doc.getElementsByTagNameNS(NS.w,'fldSimple'))){
  const code=f.getAttributeNS(NS.w,'instr'),elements=[run(doc,node(doc,'fldChar',undefined,{fldCharType:'begin'})),run(doc,node(doc,'instrText',code.slice(0,7))),run(doc,node(doc,'instrText',code.slice(7))),run(doc,node(doc,'fldChar',undefined,{fldCharType:'separate'})),...Array.from(f.childNodes).map(n=>n.cloneNode(true)),run(doc,node(doc,'fldChar',undefined,{fldCharType:'end'}))];
  for(const n of elements)f.parentNode.insertBefore(n,f);f.parentNode.removeChild(f);
 }
 let id=10;
 for(const o of parsed.objects){let p=o.element;while(p.localName!=='p')p=p.parentNode;
  for(const n of Array.from(p.childNodes).filter(n=>n.nodeType===1&&n.localName!=='pPr')){const w=node(doc,wrapper,undefined,{id:String(id++),author:'Synthetic'});p.replaceChild(w,n);w.appendChild(n);}
  if(deleted){const start=p.getElementsByTagNameNS(NS.w,'bookmarkStart')[0],w=node(doc,'del',undefined,{id:String(id++),author:'Synthetic'});w.appendChild(run(doc,node(doc,'t','99')));w.appendChild(node(doc,'fldSimple',undefined,{instr:'SEQ EquationLab \\r 99 \\* ARABIC'}));start.parentNode.insertBefore(w,start.nextSibling);}
 }
 if(deleted){
  const p=doc.getElementsByTagNameNS(NS.w,'p')[0],w=node(doc,'moveFrom',undefined,{id:'90',author:'Synthetic'});
  w.appendChild(node(doc,'fldSimple',undefined,{instr:'SEQ ELChapter \\r 99 \\h'}));p.appendChild(w);
  const block=node(doc,'moveFrom',undefined,{id:'91',author:'Synthetic'}),removed=node(doc,'p');
  removed.appendChild(node(doc,'fldSimple',undefined,{instr:'SEQ ELSection \\r 99 \\h'}));block.appendChild(removed);p.parentNode.insertBefore(block,p.nextSibling);
 }
 parsed.zip.file('word/document.xml',doc.toString());return parsed.zip.generateAsync({type:'nodebuffer'});
}

for(const complex of [false,true])for(const wrapper of ['ins','moveTo'])test(`Current numbering spans ${wrapper} wrappers with ${complex?'split complex':'simple'} fields`,async()=>{
 const input=await fixture({complex,wrapper}),before=hash(input),d=await inspectDocx(input);
 assert.deepEqual(d.objects.map(o=>o.layout.numberText),['(3.2.1)','(3.2.2)']);
 assert.deepEqual(d.objects.map(o=>o.layout.numberFormat),['(#C1.#S1.#E1)','(#C1.#S1.#E1)']);
 assert.deepEqual(d.objects.map(o=>[o.layout.chapter,o.layout.section,o.layout.equation]),[[3,2,1],[3,2,2]]);
 assert.ok(d.objects.every(o=>o.layout.mode==='numbered-right'));assert.equal(d.objects[0].layout.referenceCount,1);
 assert.equal(hash(input),before);
});

test('Deleted and moved-from numbering is not presented as current text or used as a reset',async()=>{
 const d=await inspectDocx(await fixture({complex:true,deleted:true,mode:'numbered-left'}));
 assert.deepEqual(d.objects.map(o=>o.layout.numberText),['(3.2.1)','(3.2.2)']);
 assert.ok(d.objects.every(o=>o.layout.mode==='numbered-left'&&o.layout.numberFormat==='(#C1.#S1.#E1)'));
 assert.deepEqual(d.objects.map(o=>o.layout.equation),[1,2]);assert.equal(d.objects[0].layout.chapter,3);
});

test('Reading tracked numbers does not authorize rewriting tracked paragraphs',async()=>{
 const input=await fixture({complex:true}),before=hash(input),d=await inspectDocx(input);
 const plan=await preflightNumbering(input,{scope:'all',numberFormat:'[#E1]'});
 assert.ok(plan.targets.every(t=>t.status==='skipped'));
 assert.equal(hash(input),before);assert.ok(d.objects.every(o=>o.nativeSha256));
});
