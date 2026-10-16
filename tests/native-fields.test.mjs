import test from 'node:test';
import assert from 'node:assert/strict';
import {makeOle,inspectOle,wrapNative,MtefReader,characters,editCharacters,oleLatex} from '../src/native.mjs';
import {renderNative} from '../src/font-renderer.mjs';
import {patchTypography} from '../src/typography-native.mjs';

function withRecord(record){
 const source=makeOle('x'),s=inspectOle(source),start=s.parsed.records.find(n=>n.type===10).start;
 const data=Buffer.concat([s.data.subarray(0,start),Buffer.from([10,1,0]),record,Buffer.from([0,0])]),header=Buffer.from(s.header);header.writeUInt32LE(data.length,8);
 return wrapNative(Buffer.concat([header,data]),source);
}
function allRecords(ole){const out=[];function walk(ns){for(const n of ns){out.push(n);if(n.children)walk(n.children);}}walk(inspectOle(ole).parsed.records);return out;}

test('Original CHAR input-status bits parse and survive exact character and preference edits',async()=>{
 // Original 0x66d520 writes 0x40/0x80; reader 0x66d620 retains their state.
 for(const status of [0x40,0x80,0xc0])for(const functionStart of [0,2]){
  const raw=Buffer.from([2,status|functionStart,129,120,0]),reader=new MtefReader(raw),record=reader.record();
  assert.equal(reader.p,raw.length);assert.equal(record.options,status|functionStart);assert.equal(record.typeface,1);assert.equal(record.code,120);
  const ole=withRecord(raw),saved=Buffer.from(ole),old=inspectOle(ole),x=characters(old.parsed)[0],edited=editCharacters(ole,{[x.offset]:'y'}),after=inspectOle(edited);
  const changed=[];for(let i=0;i<old.native.length;i++)if(old.native[i]!==after.native[i])changed.push(i);
  assert.deepEqual(changed,[28+x.offset]);assert.equal(allRecords(edited).find(n=>n.type===2).options,status|functionStart);assert.deepEqual(ole,saved);
  const prefChanged=patchTypography(ole,{fullSize:18}),a=allRecords(prefChanged).find(n=>n.type===2);
  assert.deepEqual(inspectOle(prefChanged).data.subarray(a.start,a.end),raw);
  assert.throws(()=>oleLatex(ole),/Unparsed\/bad input/);await assert.rejects(renderNative(ole),/Unparsed\/bad input/);
 }
 const ansi=withRecord(Buffer.from([2,0x44,129,120,0,120])),x=characters(inspectOle(ansi).parsed)[0],edited=editCharacters(ansi,{[x.offset]:'y'}),char=allRecords(edited).find(n=>n.type===2);
 assert.equal(char.options,0x44);assert.equal(char.code,121);assert.equal(char.fontPosition,121);
});

test('Original MATRIX alignment bytes and equal-dimension flags remain raw through editing',()=>{
 // Static recipe from 0x678fb0 -> 0x679330: 1x1, centered/base, both bit7 flags.
 const sample=Buffer.from([5,0,1,129,129,1,1,0,0,1,0,2,0,129,120,0,0,0]);
 let cases=0;
 for(const column of [0,1,2,3,4])for(const row of [0,1,2])for(const flags of [0,1,2,3]){
  const raw=Buffer.from(sample);raw[3]=column|(flags&1?128:0);raw[4]=row|(flags&2?128:0);
  const reader=new MtefReader(raw),m=reader.record();assert.equal(reader.p,raw.length);assert.equal(m.hjust,raw[3]);assert.equal(m.vjust,raw[4]);
  const ole=withRecord(raw),old=inspectOle(ole),x=characters(old.parsed)[0],edited=editCharacters(ole,{[x.offset]:'y'}),a=allRecords(edited).find(n=>n.type===5),after=inspectOle(edited);
  assert.equal(a.hjust,raw[3]);assert.equal(a.vjust,raw[4]);assert.deepEqual(a.rowPartitions,[0]);assert.deepEqual(a.colPartitions,[0]);
  const expected=Buffer.from(raw);expected[14]=121;assert.deepEqual(after.data.subarray(a.start,a.end),expected);
  const prefChanged=patchTypography(ole,{fullSize:18}),b=allRecords(prefChanged).find(n=>n.type===5),prefs=inspectOle(prefChanged);
  assert.deepEqual(prefs.data.subarray(b.start,b.end),raw);
  if(column>2||row!==1)assert.throws(()=>oleLatex(ole),/Custom matrix alignment/);
  else if(flags){const latex=oleLatex(ole);assert.match(latex,/\\mtmatrix/);assert.equal(oleLatex(makeOle(latex)),latex);}
  cases++;
 }
 assert.equal(cases,60);
});

test('New MATRIX writers use original left0 center1 right2 instead of UI display numbers',async()=>{
 for(const [latex,column,canonical]of [
  ['\\begin{array}{ll}a&b\\\\c&d\\end{array}',0,'\\begin{array}{ll}a&b\\\\c&d\\end{array}'],
  ['\\begin{matrix}a&b\\\\c&d\\end{matrix}',1,'\\begin{matrix}a&b\\\\c&d\\end{matrix}'],
  ['\\begin{array}{rr}a&b\\\\c&d\\end{array}',2,'\\begin{array}{rr}a&b\\\\c&d\\end{array}']
 ]){
  const ole=makeOle(latex),m=allRecords(ole).find(n=>n.type===5);assert.equal(m.hjust,column);assert.equal(m.vjust,1);assert.equal(oleLatex(ole),canonical);
  const rendered=await renderNative(ole);assert.ok(rendered.png.length>100);assert.doesNotMatch(rendered.svg,/data-mjx-error/);
 }
 const cases=allRecords(makeOle('\\begin{cases}a&b\\\\c&d\\end{cases}')).find(n=>n.type===5);assert.equal(cases.hjust,0);
});
