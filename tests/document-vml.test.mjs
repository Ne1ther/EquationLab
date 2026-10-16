import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {createDocx,editDocx,inspectDocx,NS} from '../src/document.mjs';

const parse=xml=>new DOMParser().parseFromString(xml,'application/xml');
async function document(bytes){const zip=await JSZip.loadAsync(bytes);return parse(await zip.file('word/document.xml').async('string'));}
function templateReferencesValid(type){
  const formulas=Array.from(type.getElementsByTagNameNS(NS.v,'f')).map(e=>e.getAttribute('eqn'));
  assert.equal(formulas.length,12,'picture geometry needs every formula referenced by its path');
  const references=text=>Array.from(text.matchAll(/@(\d+)/g),m=>Number(m[1]));
  for(const ref of references(type.getAttribute('path')))assert(ref<formulas.length,'path references an undefined formula');
  for(const [index,formula]of formulas.entries())for(const ref of references(formula))assert(ref<index,'formula references itself or a later undefined result');
  // Evaluate the dependency graph: an unstroked picture must have a real
  // rectangle at small and large pixel sizes, rather than collapsing to zero.
  for(const [pixelWidth,pixelHeight]of [[16,12],[640,480]]){
    const variables={lineDrawn:0,pixelLineWidth:1,pixelWidth,pixelHeight},values=[];
    for(const formula of formulas){const [operator,...tokens]=formula.split(' '),args=tokens.map(t=>t.startsWith('@')?values[Number(t.slice(1))]:Object.hasOwn(variables,t)?variables[t]:Number(t));assert(args.every(Number.isFinite));let result;if(operator==='if')result=args[0]>0?args[1]:args[2];else if(operator==='sum')result=args[0]+args[1]-args[2];else if(operator==='prod')result=args[0]*args[1]/args[2];else assert.fail('Unexpected picture geometry operator');assert(Number.isFinite(result));values.push(result);}
    assert.equal(values[9]-values[4],21600);assert.equal(values[11]-values[5],21600);
  }
}

test('Generated picture template defines its complete VML formula graph',async()=>{
  const doc=await document(await createDocx([{latex:'x^{3}'}]));
  const types=doc.getElementsByTagNameNS(NS.v,'shapetype');assert.equal(types.length,1);
  assert.equal(types[0].getAttributeNS(NS.o,'spt'),'75');templateReferencesValid(types[0]);
});

test('Multiple equations have unique self-contained template and shape IDs',async()=>{
  const doc=await document(await createDocx([{latex:'x^{3}'},{latex:'\\frac{1}{2}'},{latex:'y_i'}]));
  const types=Array.from(doc.getElementsByTagNameNS(NS.v,'shapetype')),shapes=Array.from(doc.getElementsByTagNameNS(NS.v,'shape'));
  assert.equal(types.length,3);assert.equal(new Set(types.map(e=>e.getAttribute('id'))).size,3);assert.equal(new Set(shapes.map(e=>e.getAttribute('id'))).size,3);
  const byId=new Map(types.map(e=>[e.getAttribute('id'),e]));
  for(const shape of shapes){const id=shape.getAttribute('type').slice(1),type=byId.get(id);assert(type);assert.equal(shape.parentNode,type.parentNode,'each equation must retain its own template after moving other equations');templateReferencesValid(type);}
  // Removing one complete object must not orphan the remaining templates.
  const first=doc.getElementsByTagNameNS(NS.w,'object')[0];first.parentNode.removeChild(first);
  const survivingIds=new Set(Array.from(doc.getElementsByTagNameNS(NS.v,'shapetype'),e=>e.getAttribute('id')));
  for(const shape of Array.from(doc.getElementsByTagNameNS(NS.v,'shape')))assert(survivingIds.has(shape.getAttribute('type').slice(1)));
});

test('Editing an existing equation does not normalize its original VML template',async()=>{
  const source=await createDocx([{latex:'x^{3}'}]),zip=await JSZip.loadAsync(source);
  let xml=await zip.file('word/document.xml').async('string');
  xml=xml.replace(/<v:shapetype[\s\S]*?<\/v:shapetype>/,'<v:shapetype id="UserTemplate" coordsize="100,100" path="m0,0l100,0,100,100,0,100xe" filled="f" stroked="f"><v:path o:connecttype="rect"/></v:shapetype>').replace(/type="#_EquationLab_t75_1"/,'type="#UserTemplate"');zip.file('word/document.xml',xml);
  const original=await zip.generateAsync({type:'nodebuffer'}),object=(await inspectDocx(original)).objects[0],character=object.characters.find(e=>e.char==='3');
  const edited=await editDocx(original,0,{[character.offset]:'4'}),before=await document(original),after=await document(edited),serialize=node=>new XMLSerializer().serializeToString(node);
  assert.equal(serialize(after.getElementsByTagNameNS(NS.v,'shapetype')[0]),serialize(before.getElementsByTagNameNS(NS.v,'shapetype')[0]));
  assert.equal(after.getElementsByTagNameNS(NS.v,'shape')[0].getAttribute('type'),'#UserTemplate');assert.equal((await inspectDocx(edited)).objects[0].latex,'x^{4}');
});
