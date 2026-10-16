import test from 'node:test';
import assert from 'node:assert/strict';
import {DOMParser} from '@xmldom/xmldom';
import {equationLayout,equationReference,chapterBreak} from '../src/layout.mjs';

const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const run='<w:r><w:rPr><w:position w:val="-3"/></w:rPr><w:object><o:OLEObject ProgID="Equation.DSMT4" r:id="rOle1"/></w:object></w:r>';
function parse(xml){const errors=[];const doc=new DOMParser({onError:(level,msg)=>{if(level==='error'||level==='fatalError')errors.push(msg);}}).parseFromString(`<w:document xmlns:w="${W}" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${xml}</w:body></w:document>`,'application/xml');assert.deepEqual(errors,[]);return doc;}
function elements(doc,name){return Array.from(doc.getElementsByTagNameNS(W,name));}
function fields(xml){return elements(parse(xml),'fldSimple').map(n=>({instruction:n.getAttributeNS(W,'instr'),cached:n.textContent,dirty:n.getAttributeNS(W,'dirty'),node:n}));}
function attr(n,name){return n.getAttributeNS(W,name);}

// This evaluates only the small documented SEQ/REF subset emitted here. It is a
// structural test of live counter instructions, not a substitute for Word UI QA.
function evaluateSequenceDocument(xml){
 const doc=parse(xml),counters=new Map(),bookmarks=new Map(),results=[];let active=null,marked='';
 for(const p of elements(doc,'p'))for(const n of Array.from(p.childNodes)){
  if(n.nodeType!==1)continue;
  if(n.localName==='bookmarkStart'){active=attr(n,'name');marked='';continue;}
  if(n.localName==='bookmarkEnd'){bookmarks.set(active,marked);active=null;continue;}
  let visible='';
  if(n.localName==='fldSimple'){
   const instruction=attr(n,'instr'),seq=/^SEQ (EquationLab|ELChapter|ELSection) (.*)$/.exec(instruction);
   if(seq){const [,name,switches]=seq,reset=/\\r (\d+)/.exec(switches);let value;
    if(reset)value=Number(reset[1]);else if(/\\c(?:\s|$)/.test(switches))value=counters.get(name);else value=(counters.get(name)||0)+1;
    assert.notEqual(value,undefined,'chapter/section fields require an earlier marker');counters.set(name,value);
    if(!/\\h(?:\s|$)/.test(switches))visible=String(value);
   }else{const ref=/^REF ([A-Za-z][A-Za-z0-9_]*) \\h$/.exec(instruction);assert.ok(ref,instruction);visible=bookmarks.get(ref[1]);results.push({reference:ref[1],value:visible});}
  }else if(n.localName==='r')visible=elements(n,'t').map(t=>t.textContent).join('');
  if(active)marked+=visible;
 }
 return {counters,bookmarks,results};
}

test('Inline and display retain native object runs and use complete paragraph layouts',()=>{
 const inline=equationLayout(run),display=equationLayout(run,{mode:'display'});
 assert.ok(inline.xml.includes(run));assert.ok(display.xml.includes(run));
 assert.equal(elements(parse(inline.xml),'p').length,1);assert.equal(attr(elements(parse(inline.xml),'jc')[0],'val'),'left');
 assert.equal(attr(elements(parse(display.xml),'jc')[0],'val'),'center');
 assert.equal(inline.bookmarkName,null);assert.equal(display.numberText,null);assert.equal(fields(display.xml).length,0);
 for(const layout of [inline,display]){const doc=parse(layout.xml);assert.equal(attr(elements(doc,'keepNext')[0],'val'),'0');assert.equal(elements(doc,'keepLines').length,1);assert.equal(elements(doc,'tbl').length,0);}
});

test('Left and right numbered equations use tab stops and bookmark only their numbers',()=>{
 for(const mode of ['numbered-left','numbered-right']){
  const layout=equationLayout(run,{mode,widthTwips:9000,equation:9}),doc=parse(layout.xml),tabs=elements(doc,'tabs')[0];
  assert.equal(layout.numberText,'(9)');assert.ok(layout.bookmarkName.length<=40);
  assert.deepEqual(elements(tabs,'tab').map(n=>[attr(n,'val'),attr(n,'pos')]),[['center','4500'],['right','9000']]);
  assert.equal(elements(doc,'tbl').length,0);assert.equal(elements(doc,'bookmarkStart').length,1);
  assert.equal(attr(elements(doc,'bookmarkStart')[0],'id'),attr(elements(doc,'bookmarkEnd')[0],'id'));
  const p=elements(doc,'p')[0],nodes=Array.from(p.childNodes),start=nodes.findIndex(n=>n.localName==='bookmarkStart'),end=nodes.findIndex(n=>n.localName==='bookmarkEnd'),object=nodes.findIndex(n=>n.nodeType===1&&elements(n,'object').length);
  assert.ok(object<start||object>end,'reference anchor must exclude the equation object');
  assert.equal(mode==='numbered-left',start<object);assert.equal(mode==='numbered-right',start>object);
  assert.deepEqual(fields(layout.xml).map(f=>[f.instruction,f.cached,f.dirty]),[['SEQ EquationLab \\n \\* ARABIC','9','true']]);
 }
});

test('Chapter/section numbering uses nearest live context fields and each format switch',()=>{
 const mixed=equationLayout(run,{mode:'numbered-right',numberFormat:'(#CA.#Si.#EI)',chapter:2,section:4,equation:9});
 assert.equal(mixed.numberText,'(B.iv.IX)');
 assert.deepEqual(fields(mixed.xml).map(f=>f.instruction),['SEQ ELChapter \\c \\* ALPHABETIC','SEQ ELSection \\c \\* roman','SEQ EquationLab \\n \\* ROMAN']);
 for(const [format,value,number]of [['1',29,'29'],['A',1,'A'],['A',26,'Z'],['A',27,'AA'],['A',28,'BB'],['a',28,'bb'],['I',49,'XLIX'],['i',49,'xlix']]){
  const result=equationLayout(run,{mode:'numbered-left',numberFormat:`(#E${format})`,equation:value});assert.equal(result.numberText,`(${number})`);
 }
});

test('Chapter markers reset actual Word sequences while keeping marker results hidden',()=>{
 const xml=chapterBreak({chapter:3,section:2}),doc=parse(xml),f=fields(xml);
 assert.deepEqual(f.map(n=>n.instruction),['SEQ ELChapter \\r 3 \\h','SEQ ELSection \\r 2 \\h','SEQ EquationLab \\r 0 \\h']);
 assert.ok(f.every(n=>n.dirty==='true'&&!n.instruction.includes('\\*')),'format switches would cancel the SEQ hidden switch');
 assert.equal(elements(doc,'vanish').length,4);assert.equal(elements(doc,'specVanish').length,4);assert.equal(attr(elements(doc,'spacing')[0],'line'),'1');
 assert.equal(fields(chapterBreak({chapter:3,section:4,resetEquation:false})).length,2);
 const restart=equationLayout(run,{mode:'numbered-right',resetEquation:true,equation:8});assert.match(fields(restart.xml)[0].instruction,/SEQ EquationLab \\r 8 /);
});

test('Inserting equations changes live sequence results and references without changing bookmarks',()=>{
 const existing=equationLayout(run,{mode:'numbered-right',numberFormat:'(#C1.#E1)',chapter:1,equation:1,bookmarkName:'EL_Stable',bookmarkId:700});
 const inserted=equationLayout(run,{mode:'numbered-left',numberFormat:'(#C1.#E1)',chapter:1,equation:99});
 const afterChapter=equationLayout(run,{mode:'numbered-right',numberFormat:'(#C1.#E1)',chapter:2,equation:99});
 const doc=chapterBreak()+inserted.xml+existing.xml+chapterBreak({chapter:2,section:1})+afterChapter.xml+`<w:p>${equationReference(existing.bookmarkName,{cachedText:'(1.1)',prefix:'式 '})}</w:p>`;
 const evaluated=evaluateSequenceDocument(doc);
 assert.equal(evaluated.bookmarks.get(existing.bookmarkName),'(1.2)');assert.equal(evaluated.bookmarks.get(afterChapter.bookmarkName),'(2.1)');
 assert.deepEqual(evaluated.results,[{reference:'EL_Stable',value:'(1.2)'}]);
 const f=fields(equationReference(existing.bookmarkName,{cachedText:'(1.1)',prefix:'式 '}));assert.equal(f[0].instruction,'REF EL_Stable \\h');assert.equal(f[0].cached,'(1.1)');
});

test('Automatic bookmarks are unique; caller registries reject explicit collisions',()=>{
 const names=new Set(),ids=new Set();
 for(let i=0;i<250;i++){const result=equationLayout(run,{mode:'numbered-right',existingBookmarks:names,existingBookmarkIds:ids});assert.ok(/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(result.bookmarkName));}
 assert.equal(names.size,250);assert.equal(ids.size,250);
 const options={mode:'numbered-right',bookmarkName:'EL_StableCase',bookmarkId:5,existingBookmarks:names,existingBookmarkIds:ids};
 equationLayout(run,options);assert.throws(()=>equationLayout(run,{...options,bookmarkName:'el_stablecase',bookmarkId:6}),/already exists/);
 assert.throws(()=>equationLayout(run,{...options,bookmarkName:'AnotherName'}),/already exists/);
 const before=[names.size,ids.size];assert.throws(()=>equationLayout(run,{...options,bookmarkName:'NewName',bookmarkId:8,numberFormat:'(#EI)',equation:4000}),/Roman/);assert.deepEqual([names.size,ids.size],before);
});

test('Stable anchor identity can be reused during replacement without encoding its number in its name',()=>{
 const first=equationLayout(run,{mode:'numbered-right',equation:1,bookmarkName:'EL_Physics',bookmarkId:42});
 const replacement=equationLayout(run,{mode:'numbered-left',equation:37,bookmarkName:first.bookmarkName,bookmarkId:first.bookmarkId});
 assert.equal(replacement.bookmarkName,first.bookmarkName);assert.equal(replacement.bookmarkId,first.bookmarkId);assert.equal(replacement.numberText,'(37)');
 assert.equal(fields(equationReference(first.bookmarkName))[0].instruction,'REF EL_Physics \\h');
});

test('Text prefixes and number literals are escaped as text, never field instructions',()=>{
 const ref=equationReference('EL_Safe',{cachedText:'<1&2>',prefix:'式 < & "'}),doc=parse(ref);
 assert.equal(doc.documentElement.textContent,'式 < & "<1&2>');assert.equal(fields(ref)[0].instruction,'REF EL_Safe \\h');
 const layout=equationLayout(run,{mode:'numbered-right',numberFormat:'< #E1 & >'});assert.equal(layout.numberText,'< 1 & >');assert.equal(fields(layout.xml).length,1);parse(layout.xml);
});

test('Invalid fields, bookmark names, geometry, options and structural XML are rejected',()=>{
 for(const options of [{mode:'floating'},{widthTwips:0},{widthTwips:2.5},{equation:0},{section:'2'},{style:'Invalid Style'},{fontSize:12},{resetEquation:'yes'},{mode:'display',bookmarkName:'EL_NoNumber'},{mode:'numbered-right',bookmarkName:'1bad'},{mode:'numbered-right',bookmarkName:'A'.repeat(41)},{mode:'numbered-right',bookmarkId:-1},{mode:'numbered-right',existingBookmarks:[]},{mode:'numbered-right',numberFormat:'(#E2)'},{mode:'numbered-right',numberFormat:'(#E1.#E1)'},{mode:'numbered-right',numberFormat:'(#E1.#C1)'},{mode:'numbered-right',numberFormat:'(#C1)'}])assert.throws(()=>equationLayout(run,options),undefined,JSON.stringify(options));
 for(const xml of ['', '<w:p>'+run+'</w:p>','<w:tbl/>','<w:r><w:t x=bad>q</w:t></w:r>','<w:r><w:t>x</w:r>','text','<!DOCTYPE foo>'+run,'<w:r><w:bookmarkStart w:id="1" w:name="EL_bad"/></w:r>'])assert.throws(()=>equationLayout(xml),undefined,xml);
 for(const name of ['Bad name','1bad','EL_bad" \\h', 'A'.repeat(41)])assert.throws(()=>equationReference(name));
 assert.throws(()=>equationReference('EL_OK',{suffix:'wrong'}));assert.throws(()=>chapterBreak({chapter:0}));assert.throws(()=>chapterBreak({resetEquation:'no'}));assert.throws(()=>chapterBreak({sectionBreak:true}));
});
