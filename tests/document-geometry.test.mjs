import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {createDocx,inspectDocx,arrangeDocx,NS} from '../src/document.mjs';
import {documentGeometry} from '../src/document-geometry.mjs';

const parse=xml=>new DOMParser().parseFromString(xml,'application/xml');
const serialize=node=>new XMLSerializer().serializeToString(node);
const nodes=(node,name)=>Array.from(node.getElementsByTagNameNS(NS.w,name));
const first=(node,name)=>nodes(node,name)[0];
const finalSection=body=>Array.from(body.childNodes).find(n=>n.namespaceURI===NS.w&&n.localName==='sectPr');
const paragraph=object=>{let node=object;while(node.localName!=='p')node=node.parentNode;return node;};
const section=(width=11906,left=1440,right=1440,gutter=0,extra='')=>`<w:sectPr><w:pgSz w:w="${width}" w:h="16838"/><w:pgMar w:top="1440" w:bottom="1440" w:left="${left}" w:right="${right}" w:gutter="${gutter}"/>${extra}</w:sectPr>`;
let base;
test.before(async()=>{base=await createDocx(['a','b','c','d'].map(latex=>({latex,layout:{mode:'numbered-right'}})),{fragment:true,references:[{target:0},{target:1},{target:2}]});});
async function fixture(change){
 const zip=await JSZip.loadAsync(base),doc=parse(await zip.file('word/document.xml').async('string'));
 const paragraphs=Array.from(doc.getElementsByTagNameNS(NS.o,'OLEObject')).map(paragraph),body=first(doc,'body');
 const insert=(parent,xml,before=null)=>parent.insertBefore(doc.importNode(parse(`<root xmlns:w="${NS.w}">${xml}</root>`).documentElement.firstChild,true),before);
 await change({zip,doc,paragraphs,body,insert});
 zip.file('word/document.xml',serialize(doc));return zip.generateAsync({type:'nodebuffer'});
}
function tabs(object){const p=paragraph(object.element);return nodes(first(p,'tabs'),'tab').filter(n=>n.getAttributeNS(NS.w,'val')!=='clear').map(n=>[n.getAttributeNS(NS.w,'val'),Number(n.getAttributeNS(NS.w,'pos'))]);}

test('copy arrangement uses each target section, landscape dimensions and equal column width without changing Native or references',async()=>{
 const source=await fixture(({paragraphs,body,insert})=>{
  first(paragraphs[0],'ind').setAttributeNS(NS.w,'w:left','720');first(paragraphs[0],'ind').setAttributeNS(NS.w,'w:start','720');first(paragraphs[0],'ind').setAttributeNS(NS.w,'w:right','360');first(paragraphs[0],'ind').setAttributeNS(NS.w,'w:end','360');
  insert(body,`<w:p><w:pPr>${section(11906,1800,1200,360)}</w:pPr></w:p>`,paragraphs[1]);
  insert(body,`<w:p><w:pPr>${section(16838,1440,1440,0).replace('<w:pgSz','<w:pgSz w:orient="landscape"')}</w:pPr></w:p>`,paragraphs[2]);
  first(paragraphs[2],'ind').setAttributeNS(NS.w,'w:left','200');first(paragraphs[2],'ind').setAttributeNS(NS.w,'w:start','200');first(paragraphs[2],'ind').setAttributeNS(NS.w,'w:right','300');first(paragraphs[2],'ind').setAttributeNS(NS.w,'w:end','300');
  body.replaceChild(insert(body.ownerDocument.createDocumentFragment(),section(12240,1080,1080,360,'<w:cols w:num="2" w:space="720"/>')),finalSection(body));
 });
 const before=await inspectDocx(source),unchanged=serialize(paragraph(before.objects[3].element));
 const output=await arrangeDocx(source,{indices:[0,1,2],layout:{mode:'numbered-left',widthTwips:9000}}),after=await inspectDocx(output);
 assert.deepEqual(after.objects.slice(0,3).map(tabs),[[['center',4453],['right',8186]],[['center',6979],['right',13958]],[['center',2200],['right',4200]]]);
 assert.deepEqual(after.objects.map(o=>[o.nativeSha256,o.layout.bookmarkName,o.layout.numberText,o.layout.referenceCount]),before.objects.map(o=>[o.nativeSha256,o.layout.bookmarkName,o.layout.numberText,o.layout.referenceCount]));
 assert.equal(serialize(paragraph(after.objects[3].element)),unchanged);
 assert.deepEqual(nodes(after.doc,'sectPr').map(serialize),nodes(before.doc,'sectPr').map(serialize));
 assert.deepEqual(nodes(after.doc,'fldSimple').filter(n=>/^REF /.test(n.getAttributeNS(NS.w,'instr'))).map(serialize),nodes(before.doc,'fldSimple').filter(n=>/^REF /.test(n.getAttributeNS(NS.w,'instr'))).map(serialize));
 for(const path of Object.keys(before.zip.files).filter(path=>!before.zip.files[path].dir&&!['word/document.xml','word/styles.xml'].includes(path)))assert.deepEqual(await after.zip.file(path).async('nodebuffer'),await before.zip.file(path).async('nodebuffer'),path);
});

for(const [settings,expected]of [['<w:mirrorMargins/>',8546],['<w:gutterAtTop/>',8906],['<w:mirrorMargins/><w:gutterAtTop/>',8546]])test(`gutter placement follows document settings ${settings}`,async()=>{
 const source=await fixture(async({zip,body,insert})=>{
  body.replaceChild(insert(body.ownerDocument.createDocumentFragment(),section(11906,1800,1200,360)),finalSection(body));
  zip.file('word/settings.xml',(await zip.file('word/settings.xml').async('string')).replace('<w:updateFields',settings+'<w:updateFields'));
 });
 const result=await inspectDocx(await arrangeDocx(source,{indices:[0],layout:{mode:'numbered-right'}}));
 assert.deepEqual(tabs(result.objects[0]),[['center',Math.floor(expected/2)],['right',expected]]);
});

test('paragraph style defaults and basedOn indents are resolved, direct indents override them and inherited tabs are cleared',async()=>{
 const source=await fixture(async({zip,paragraphs})=>{
  const props=first(paragraphs[0],'pPr');props.removeChild(first(props,'ind'));
  props.appendChild(paragraphs[0].ownerDocument.importNode(parse(`<w:ind xmlns:w="${NS.w}" w:right="360"/>`).documentElement,true));
  const styles=parse(await zip.file('word/styles.xml').async('string'));
  first(first(styles,'style'),'basedOn').setAttributeNS(NS.w,'w:val','EquationBody');
  for(const xml of ['<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:pPr><w:ind w:left="240" w:right="120"/><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr></w:style>','<w:style w:type="paragraph" w:styleId="EquationBody"><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="600"/></w:pPr></w:style>'])styles.documentElement.appendChild(styles.importNode(parse(`<root xmlns:w="${NS.w}">${xml}</root>`).documentElement.firstChild,true));
  zip.file('word/styles.xml',serialize(styles));
 });
 const result=await inspectDocx(await arrangeDocx(source,{indices:[0],layout:{mode:'numbered-right'}})),p=paragraph(result.objects[0].element);
 assert.deepEqual(tabs(result.objects[0]),[['center',4633],['right',8666]]);
 assert.equal(first(p,'ind').getAttributeNS(NS.w,'left'),'600');assert.equal(first(p,'ind').getAttributeNS(NS.w,'right'),'360');
 assert.ok(nodes(first(p,'tabs'),'tab').some(n=>n.getAttributeNS(NS.w,'val')==='clear'&&n.getAttributeNS(NS.w,'pos')==='720'));
});

test('a continuous section inherits omitted page properties from the following section, not the preceding section',async()=>{
 const source=await fixture(({paragraphs,body,insert})=>{
  insert(body,`<w:p><w:pPr>${section(11906,1440,1440)}</w:pPr></w:p>`,paragraphs[1]);
  insert(body,'<w:p><w:pPr><w:sectPr><w:type w:val="continuous"/><w:cols w:num="2" w:space="720"/></w:sectPr></w:pPr></w:p>',paragraphs[2]);
  body.replaceChild(insert(body.ownerDocument.createDocumentFragment(),section(16838,1440,1440)),finalSection(body));
 });
 const result=await inspectDocx(await arrangeDocx(source,{indices:[1],layout:{mode:'numbered-right'}}));
 assert.deepEqual(tabs(result.objects[1]),[['center',3309],['right',6619]]);
});

for(const [label,change]of [
 ['table',({paragraphs,body,insert})=>{const table=insert(body,'<w:tbl><w:tr><w:tc/></w:tr></w:tbl>',paragraphs[0]);first(table,'tc').appendChild(paragraphs[0]);}],
 ['unequal columns',({body,insert})=>{first(body,'sectPr').appendChild(insert(body.ownerDocument.createDocumentFragment(),'<w:cols w:equalWidth="0"><w:col w:w="4000"/><w:col w:w="4306"/></w:cols>'));}],
 ['missing page width',({body})=>first(body,'pgSz').removeAttributeNS(NS.w,'w')],
 ['invalid margin units',({body})=>first(body,'pgMar').setAttributeNS(NS.w,'w:left','72pt')],
 ['insufficient width',({body})=>first(body,'pgMar').setAttributeNS(NS.w,'w:left','11000')],
 ['unknown column gap',({body,insert})=>first(body,'sectPr').appendChild(insert(body.ownerDocument.createDocumentFragment(),'<w:cols w:num="2"/>'))],
 ['character indent',({paragraphs})=>first(paragraphs[0],'ind').setAttributeNS(NS.w,'w:leftChars','100')],
 ['vertical section',({body,insert})=>first(body,'sectPr').appendChild(insert(body.ownerDocument.createDocumentFragment(),'<w:textDirection w:val="tbRl"/>'))]
])test(`copy arrangement rejects ${label} instead of using the blank-document width`,async()=>{
 const source=await fixture(change),before=Buffer.from(source);
 await assert.rejects(arrangeDocx(source,{indices:[0],layout:{mode:'numbered-right'}}),/无法确定公式可用宽度/);
 assert.deepEqual(source,before);
});

test('isolated equation layout clears inherited first-line and hanging indents without rejecting ordinary body styles',async()=>{
 for(const [name,value] of [['firstLine','240'],['firstLineChars','200'],['hanging','240'],['hangingChars','200']]){
  const source=await fixture(({paragraphs})=>first(paragraphs[0],'ind').setAttributeNS(NS.w,'w:'+name,value));
  const arranged=await inspectDocx(await arrangeDocx(source,{indices:[0],layout:{mode:'numbered-right'}}));
  const ind=first(arranged.objects[0].element.parentNode.parentNode.parentNode,'ind');
  assert.equal(ind.getAttributeNS(NS.w,name),'0');
  assert.equal(arranged.objects[0].nativeSha256,(await inspectDocx(source)).objects[0].nativeSha256);
 }
});

test('geometry rejects style cycles and paragraphs outside the main document body',()=>{
 const doc=parse(`<w:document xmlns:w="${NS.w}"><w:body><w:p><w:pPr><w:pStyle w:val="A"/></w:pPr></w:p>${section()}</w:body></w:document>`),styles=parse(`<w:styles xmlns:w="${NS.w}"><w:style w:type="paragraph" w:styleId="A"><w:basedOn w:val="B"/></w:style><w:style w:type="paragraph" w:styleId="B"><w:basedOn w:val="A"/></w:style></w:styles>`);
 assert.throws(()=>documentGeometry(doc,{styles})(first(doc,'p')),/循环继承/);
 assert.throws(()=>documentGeometry(parse(`<w:hdr xmlns:w="${NS.w}"><w:p/></w:hdr>`))(first(doc,'p')),/不是正文容器/);
});
