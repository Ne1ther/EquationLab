import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {createDocx,inspectDocx,arrangeDocx,replaceDocxEquation,NS} from '../src/document.mjs';
import {documentGeometry} from '../src/document-geometry.mjs';
import {renderNative} from '../src/font-renderer.mjs';
import {wordPreviewBox} from '../src/word-preview.mjs';

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

test('Word previews fit both page axes, and copy arrangement resizes the picture, original extents and baseline together',async()=>{
 const row=Array.from({length:54},(_,index)=>`x_{${index+1}}`).join('+');
 const wide=`\\begin{matrix}${Array(20).fill(row).join('\\\\')}\\end{matrix}`;
 const input=await createDocx([{latex:wide},{latex:'y_2'}],{fragment:true}),before=await inspectDocx(input);
 const natural=await renderNative(before.objects[0].ole,{raster:false});
 const dimensions=object=>{
  const result=Object.fromEntries([...object.shape.getAttribute('style').matchAll(/(width|height):([\d.]+)pt/g)].map(([,key,value])=>[key,Number(value)]));
  return {...result,depth:-Number(first(paragraph(object.element),'position').getAttributeNS(NS.w,'val'))/2};
 };
 const wideBefore=dimensions(before.objects[0]);
 assert.ok(natural.width>600,'the native sample is wider than the default 451.3 pt body');
 assert.equal(wideBefore.width,451.3);
 assert.ok(Math.abs(wideBefore.width/wideBefore.height-natural.width/natural.height)<.001);
 const smallBefore=dimensions(before.objects[1]);
 const smallNatural=await renderNative(before.objects[1].ole,{raster:false});
 assert.equal(smallBefore.width,Number(smallNatural.width.toFixed(3)));
 assert.equal(smallBefore.height,Number(smallNatural.height.toFixed(3)));

 const xml=(await before.zip.file('word/document.xml').async('string')).replace('w:w="11906" w:h="16838"','w:w="7680" w:h="6480"');
 before.zip.file('word/document.xml',xml);
 const narrow=await before.zip.generateAsync({type:'nodebuffer'}),output=await arrangeDocx(narrow,{layout:{mode:'display'}});
 const after=await inspectDocx(output),fitted=dimensions(after.objects[0]),factor=fitted.width/wideBefore.width;
 assert.ok(fitted.width<=240&&fitted.height+fitted.depth<=156&&factor<1);
 assert.ok(Math.abs(fitted.height-wideBefore.height*factor)<.002);
 assert.ok(Math.abs(fitted.depth-wideBefore.depth*factor)<=.25);
 assert.equal(Number(after.objects[0].element.parentNode.getAttributeNS(NS.w,'dxaOrig')),Math.round(fitted.width*20));
 assert.equal(Number(after.objects[0].element.parentNode.getAttributeNS(NS.w,'dyaOrig')),Math.round(fitted.height*20));
 assert.deepEqual(dimensions(after.objects[1]),smallBefore);
 for(const [index,object] of after.objects.entries()){
  assert.deepEqual(object.ole,before.objects[index].ole);
  assert.deepEqual(await after.zip.file(object.imagePath).async('nodebuffer'),await before.zip.file(before.objects[index].imagePath).async('nodebuffer'));
 }
});

test('A 200 pt formula fits the net width of its 72 pt Word table cell in both preview and replacement',async()=>{
 const source=await fixture(({paragraphs,body,insert})=>{
  const table=insert(body,`<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:type="dxa" w:w="100"/><w:right w:type="dxa" w:w="100"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="1440"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type="dxa" w:w="1440"/><w:tcMar><w:end w:type="dxa" w:w="140"/></w:tcMar></w:tcPr></w:tc></w:tr></w:tbl>`,paragraphs[0]);
  first(table,'tc').appendChild(paragraphs[0]);
 });
 const input=await inspectDocx(source,{wordPreviewLimits:true}),limits=input.objects[0].wordPreview;
 assert.equal(limits.widthTwips,1200,'72 pt minus 5 pt table margin and 7 pt cell override');
 assert.deepEqual(wordPreviewBox({width:200,height:50,depth:0},limits),{width:60,height:15,depth:0});
 const wide=Array.from({length:25},(_,i)=>`x_{${i+1}}`).join('+');
 const updated=await inspectDocx(await replaceDocxEquation(source,0,wide)),object=updated.objects[0];
 const natural=await renderNative(object.ole,{raster:false});assert.ok(natural.width>200);
 assert.match(object.shape.getAttribute('style'),/width:60\.000pt/);
 assert.equal(object.element.parentNode.getAttributeNS(NS.w,'dxaOrig'),'1200');
 assert.equal(updated.objects[1].nativeSha256,input.objects[1].nativeSha256);
});

test('Table grid sums the actual spanned columns and respects the enclosing section and row margins',async()=>{
 const source=await fixture(async({zip,paragraphs,body,insert})=>{
  const style='<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:tblPr><w:tblCellMar><w:end w:type="dxa" w:w="100"/></w:tblCellMar></w:tblPr></w:style>';
  zip.file('word/styles.xml',(await zip.file('word/styles.xml').async('string')).replace('</w:styles>',style+'</w:styles>'));
  const table=insert(body,`<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${[300,500,700,1100,2600].map(w=>`<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid><w:tr><w:tblPrEx><w:tblCellMar><w:start w:type="dxa" w:w="120"/></w:tblCellMar></w:tblPrEx><w:trPr><w:gridBefore w:val="1"/></w:trPr><w:tc><w:p/></w:tc><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:tcMar><w:start w:type="nil"/></w:tcMar></w:tcPr></w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl>`,paragraphs[0]);
  const cells=nodes(table,'tc');cells[1].appendChild(paragraphs[0]);cells[2].appendChild(paragraphs[1]);
  body.replaceChild(insert(body.ownerDocument.createDocumentFragment(),section(6000,1000,1000,0,'<w:cols w:num="2" w:space="400"/>')),finalSection(body));
 });
 const {objects}=await inspectDocx(source,{wordPreviewLimits:true});
 assert.equal(objects[0].wordPreview.widthTwips,1580,'span the 700 and 1100 twip columns after the grid offset');
 assert.equal(objects[1].wordPreview.widthTwips,1800,'larger cell remains constrained by its section column');
});

test('A known fixed cell with no net room cannot fall back to a wider old frame',async()=>{
 const source=await fixture(({paragraphs,body,insert})=>{
  const table=insert(body,'<w:tbl><w:tr><w:tc><w:tcPr><w:tcW w:type="dxa" w:w="230"/></w:tcPr></w:tc></w:tr></w:tbl>',paragraphs[0]);
  first(table,'tc').appendChild(paragraphs[0]);
 });
 const {objects}=await inspectDocx(source,{wordPreviewLimits:true});
 assert.ok(objects[0].wordPreview.oldFrame.width>.05);
 assert.equal(objects[0].wordPreview.widthTwips,1,'the built-in 115 twip margins consume the fixed width');
});

test('An unresolved automatic or percentage cell blocks preview growth beyond the old frame',async()=>{
 for(const type of ['auto','pct']){
  const source=await fixture(({paragraphs,body,insert})=>{
   const table=insert(body,`<w:tbl><w:tblPr><w:tblLayout w:type="autofit"/></w:tblPr><w:tblGrid><w:gridCol w:w="8000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:type="${type}" w:w="${type==='auto'?0:5000}"/></w:tcPr></w:tc></w:tr></w:tbl>`,paragraphs[0]);
   first(table,'tc').appendChild(paragraphs[0]);
   const object=first(paragraphs[0],'object');
   const shape=Array.from(object.childNodes).find(n=>n.namespaceURI===NS.v&&n.localName==='shape');
   shape.setAttribute('style',type==='auto'?'width:52pt;height:22pt':'width:52pt');
  });
  const {objects}=await inspectDocx(source,{wordPreviewLimits:true});
  const limits=objects[0].wordPreview;
  assert.equal(limits.widthTwips,1040,type);
  assert.deepEqual(wordPreviewBox({width:200,height:50,depth:0},limits),{width:52,height:13,depth:0});
  assert.deepEqual(wordPreviewBox({width:30,height:10,depth:0},limits),{width:30,height:10,depth:0});
 }
});

test('A cell without tcW uses its 400 pt grid only with an explicit or inherited fixed layout',async()=>{
 const style=(id,properties,base='',isDefault=false)=>`<w:style w:type="table" w:styleId="${id}"${isDefault?' w:default="1"':''}>${base?`<w:basedOn w:val="${base}"/>`:''}${properties}</w:style>`;
 const layout=value=>value?`<w:tblLayout w:type="${value}"/>`:'';
 const fixed=style('FixedGrid','<w:tblPr>'+layout('fixed')+'</w:tblPr>');
 const inherited=style('InheritedGrid','','FixedGrid');
 const auto=style('AutoGrid','<w:tblPr>'+layout('autofit')+'</w:tblPr>','FixedGrid');
 const whole=style('WholeGrid','<w:tblStylePr w:type="wholeTable"><w:tblPr>'+layout('fixed')+'</w:tblPr></w:tblStylePr>');
 const defaultFixed=style('DefaultFixedGrid','','FixedGrid',true);
 const cases=[
  {label:'fixed',direct:'fixed',width:400},
  {label:'autofit',direct:'autofit',width:52},
  {label:'omitted',width:52},
  {label:'basedOn fixed',tableStyle:'InheritedGrid',width:400},
  {label:'autofit overrides style',direct:'autofit',tableStyle:'InheritedGrid',width:52},
  {label:'derived style overrides base',tableStyle:'AutoGrid',width:52},
  {label:'wholeTable style',tableStyle:'WholeGrid',width:400},
  {label:'default table style',defaultStyle:defaultFixed,width:400},
 ];
 for(const {label,direct,tableStyle,defaultStyle='',width} of cases){
  const source=await fixture(async({zip,paragraphs,body,insert})=>{
   const styles=await zip.file('word/styles.xml').async('string');
   zip.file('word/styles.xml',styles.replace('</w:styles>',fixed+inherited+auto+whole+defaultStyle+'</w:styles>'));
   const reference=tableStyle?`<w:tblStyle w:val="${tableStyle}"/>`:'';
   const table=insert(body,`<w:tbl><w:tblPr>${reference}${layout(direct)}<w:tblCellMar><w:left w:type="dxa" w:w="0"/><w:right w:type="dxa" w:w="0"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="8000"/></w:tblGrid><w:tr><w:tc/></w:tr></w:tbl>`,paragraphs[0]);
   first(table,'tc').appendChild(paragraphs[0]);
   first(paragraphs[0],'object').getElementsByTagNameNS(NS.v,'shape')[0].setAttribute('style','width:52pt;height:22pt');
  });
  const {objects:[object]}=await inspectDocx(source,{wordPreviewLimits:true});
  assert.equal(object.wordPreview.widthTwips,width*20,label);
  assert.equal(wordPreviewBox({width:200,height:50,depth:0},object.wordPreview).width,Math.min(width,200),label);
  if(label==='omitted'){
   const wide=Array.from({length:25},(_,i)=>`x_{${i+1}}`).join('+');
   const {objects:[replacement]}=await inspectDocx(await replaceDocxEquation(source,0,wide));
   assert.match(replacement.shape.getAttribute('style'),/width:52\.000pt/);
   assert.equal(replacement.element.parentNode.getAttributeNS(NS.w,'dxaOrig'),'1040');
  }
 }
});

for(const [settings,expected]of [['<w:mirrorMargins/>',8546],['<w:gutterAtTop/>',8906],['<w:mirrorMargins/><w:gutterAtTop/>',8546]])test(`gutter placement follows document settings ${settings}`,async()=>{
 const source=await fixture(async({zip,body,insert})=>{
  body.replaceChild(insert(body.ownerDocument.createDocumentFragment(),section(11906,1800,1200,360)),finalSection(body));
  zip.file('word/settings.xml',(await zip.file('word/settings.xml').async('string')).replace('</w:settings>',settings+'</w:settings>'));
 });
 const result=await inspectDocx(await arrangeDocx(source,{indices:[0],layout:{mode:'numbered-right'}}));
 assert.deepEqual(tabs(result.objects[0]),[['center',Math.floor(expected/2)],['right',expected]]);
});

test('copy arrangement uses the related styles and settings when they have relocated',async()=>{
 const source=await fixture(async({zip,paragraphs,body,insert})=>{
  body.replaceChild(insert(body.ownerDocument.createDocumentFragment(),section(11906,1800,1200,360)),finalSection(body));
  const props=first(paragraphs[0],'pPr');props.removeChild(first(props,'ind'));
  const styles=parse(await zip.file('word/styles.xml').async('string'));
  first(first(styles,'style'),'basedOn').setAttributeNS(NS.w,'w:val','Normal');
  const inherited=parse(`<w:style xmlns:w="${NS.w}" w:type="paragraph" w:default="1" w:styleId="Normal"><w:pPr><w:ind w:left="600" w:right="120"/></w:pPr></w:style>`);
  styles.documentElement.appendChild(styles.importNode(inherited.documentElement,true));
  const settings=(await zip.file('word/settings.xml').async('string')).replace('</w:settings>','<w:gutterAtTop/></w:settings>');
  const relPath='word/_rels/document.xml.rels',rels=await zip.file(relPath).async('string');
  zip.file(relPath,rels.replace('Target="styles.xml"','Target="prefs/body-styles.xml"').replace('Target="settings.xml"','Target="prefs/body-settings.xml"'));
  const types=await zip.file('[Content_Types].xml').async('string');
  zip.file('[Content_Types].xml',types.replace('/word/styles.xml','/word/prefs/body-styles.xml').replace('/word/settings.xml','/word/prefs/body-settings.xml'));
  zip.remove('word/styles.xml');zip.remove('word/settings.xml');
  zip.file('word/prefs/body-styles.xml',serialize(styles));zip.file('word/prefs/body-settings.xml',settings);
 });
 const before=await inspectDocx(source);
 const result=await inspectDocx(await arrangeDocx(source,{indices:[0],layout:{mode:'numbered-right'}}));
 assert.deepEqual(tabs(result.objects[0]),[['center',4693],['right',8786]]);
 const indent=first(paragraph(result.objects[0].element),'ind');
 assert.equal(indent.getAttributeNS(NS.w,'left'),'600');
 assert.equal(indent.getAttributeNS(NS.w,'right'),'120');
 assert.deepEqual(result.objects.map(o=>o.nativeSha256),before.objects.map(o=>o.nativeSha256));
 for(const name of ['body-styles.xml','body-settings.xml']){
  const path='word/prefs/'+name;
  assert.equal(await result.zip.file(path).async('string'),await before.zip.file(path).async('string'));
 }
 assert.equal(result.zip.file('word/styles.xml'),null);
 assert.equal(result.zip.file('word/settings.xml'),null);
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
