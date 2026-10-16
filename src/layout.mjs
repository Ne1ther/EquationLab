import {randomBytes, randomUUID} from 'node:crypto';
import {DOMParser} from '@xmldom/xmldom';

const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const FORMATS={1:'ARABIC',A:'ALPHABETIC',a:'alphabetic',I:'ROMAN',i:'roman'};
const SEQUENCES={E:'EquationLab',C:'ELChapter',S:'ELSection'};
const issuedNames=new Set(),issuedIds=new Set();
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');

/* Primary references:
 * https://support.microsoft.com/en-us/word/field-codes-seq-sequence-field
 * https://support.microsoft.com/en-us/word/format-field-results
 * https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.simplefield
 * https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.bookmarkstart
 * https://learn.microsoft.com/en-us/office/vba/api/word.bookmarks.add
 * https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.tabstop
 *
 * This module writes actual fields and cached results. It does not calculate
 * Word's layout or claim that an arbitrary host updates fields automatically.
 * The caller must insert chapterBreak before using #C/#S in a new document,
 * persist returned bookmarks, and mark/update the document's fields as needed.
 */
function plainText(value,label,max=1000){
 if(typeof value!=='string'||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/.test(value)||[...value].some(c=>c.codePointAt(0)>=0xd800&&c.codePointAt(0)<=0xdfff))throw Error(`Invalid ${label}`);
 return value;
}
function int(value,label,min=1,max=32767){if(!Number.isSafeInteger(value)||value<min||value>max)throw Error(`Invalid ${label}: expected an integer between ${min} and ${max}`);return value;}
function boolean(value,label){if(typeof value!=='boolean')throw Error(`Invalid ${label}: expected true or false`);return value;}
function optionsObject(value,allowed){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid layout options');
 for(const key of Object.keys(value))if(!allowed.has(key))throw Error(`Unknown layout option ${key}`);
 return value;
}
function validBookmark(name){if(typeof name!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name))throw Error('Invalid bookmark name: use a letter followed by letters, digits or underscores, at most 40 characters');return name;}
function registry(value,label){if(value!==undefined&&!(value instanceof Set))throw Error(`Invalid ${label}: expected a Set`);return value;}
function textRun(text,{hidden=false}={}){return `<w:r>${hidden?'<w:rPr><w:vanish/><w:sz w:val="2"/><w:specVanish/></w:rPr>':''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;}
function field(instruction,cached,{hidden=false}={}){return `<w:fldSimple w:instr="${esc(instruction)}" w:dirty="true">${textRun(cached,{hidden})}</w:fldSimple>`;}

function validateRuns(xml){
 plainText(xml,'equation run XML',2_000_000);
 if(!xml.trim()||/<!DOCTYPE|<!ENTITY|<\?xml/i.test(xml))throw Error('Invalid equation run XML');
 const errors=[];
 const doc=new DOMParser({onError:(_level,message)=>{errors.push(message);}}).parseFromString(`<root xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${xml}</root>`,'application/xml');
 if(errors.length)throw Error('Invalid equation run XML: '+errors.join('; '));
 const children=Array.from(doc.documentElement.childNodes);
 if(children.some(n=>n.nodeType!==1&&(n.nodeType!==3||n.textContent.trim()))||children.filter(n=>n.nodeType===1).some(n=>n.namespaceURI!==W||n.localName!=='r'))throw Error('Equation XML must contain Word runs, without paragraphs, tables or fields');
 if(!children.some(n=>n.nodeType===1))throw Error('Equation XML must contain at least one Word run');
 for(const tag of ['p','tbl','sectPr','bookmarkStart','bookmarkEnd','fldSimple','fldChar','instrText'])if(doc.getElementsByTagNameNS(W,tag).length)throw Error(`Equation run XML contains an unsupported ${tag} element`);
}
function numberFormat(pattern){
 plainText(pattern,'number format',128);
 const tokens=[],seen=new Set();let p=0;
 for(const match of pattern.matchAll(/#([CSE])([1AaIi])/g)){
  const literal=pattern.slice(p,match.index);if(literal.includes('#'))throw Error('Invalid number token; use #E1, #EA, #Ea, #EI, #Ei, and corresponding #C/#S tokens');
  if(literal)tokens.push({literal});
  if(seen.has(match[1]))throw Error('Number formats may use each counter only once');seen.add(match[1]);
  tokens.push({counter:match[1],format:match[2]});p=match.index+match[0].length;
 }
 const tail=pattern.slice(p);if(tail.includes('#'))throw Error('Invalid number token');if(tail)tokens.push({literal:tail});
 if(!seen.has('E'))throw Error('A number format requires exactly one equation counter');
 const order=tokens.filter(t=>t.counter).map(t=>'CSE'.indexOf(t.counter));if(order.some((n,i)=>i&&n<order[i-1]))throw Error('Number counters must appear in chapter, section, equation order');
 return tokens;
}
function formatNumber(n,format){
 if(format==='1')return String(n);
 if(format==='A'||format==='a'){
  // Word's ALPHABETIC sequence uses A..Z, AA, BB..ZZ, AAA.. .
  // This is deliberately different from spreadsheet column labels.
  const letter=String.fromCharCode((format==='A'?65:97)+(n-1)%26);return letter.repeat(Math.floor((n-1)/26)+1);
 }
 if(n>3999)throw Error('Roman-number cached results are supported only from 1 through 3999');
 let left=n,result='';
 for(const [value,symbol]of [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']])while(left>=value){result+=symbol;left-=value;}
 return format==='I'?result:result.toLowerCase();
}
function numberRuns(tokens,values,{resetEquation=false}={}){
 const runs=[],text=[];
 for(const token of tokens){
  if(token.literal!==undefined){runs.push(textRun(token.literal));text.push(token.literal);continue;}
  const {counter,format}=token,cached=formatNumber(values[counter],format);
  const command=counter==='E'?resetEquation?`\\r ${values.E}`:'\\n':'\\c';
  runs.push(field(`SEQ ${SEQUENCES[counter]} ${command} \\* ${FORMATS[format]}`,cached));text.push(cached);
 }
 return {xml:runs.join(''),text:text.join('')};
}
function anchor(options){
 const existing=registry(options.existingBookmarks,'existingBookmarks'),existingIds=registry(options.existingBookmarkIds,'existingBookmarkIds');
 const nameExists=name=>existing&&[...existing].some(value=>typeof value==='string'&&value.toLowerCase()===name.toLowerCase());
 const idExists=id=>existingIds&&[...existingIds].some(value=>String(value)===String(id));
 let name=options.bookmarkName;
 if(name!==undefined){validBookmark(name);if(nameExists(name))throw Error(`Bookmark ${name} already exists`);}
 else {do{name='EL_'+randomUUID().replaceAll('-','');}while(issuedNames.has(name.toLowerCase())||nameExists(name));}
 let id=options.bookmarkId;
 if(id!==undefined){int(id,'bookmarkId',0,2147483647);if(idExists(id))throw Error(`Bookmark id ${id} already exists`);}
 else {do{id=randomBytes(4).readUInt32BE(0)&0x7fffffff;}while(issuedIds.has(id)||idExists(id));}
 return {name,id,commit(){issuedNames.add(name.toLowerCase());issuedIds.add(id);existing?.add(name);existingIds?.add(id);}};
}
const LAYOUT_OPTIONS=new Set(['mode','numberFormat','equation','chapter','section','bookmarkName','bookmarkId','widthTwips','style','resetEquation','existingBookmarks','existingBookmarkIds']);

/** Return a complete paragraph containing the original native equation run.
 * mode: inline | display | numbered-right | numbered-left.
 * equation/chapter/section are CACHED values; subsequent Word field updates use
 * live SEQ counters. A reset is explicit, never inferred from the cached value.
 * Number format example: (#C1.#S1.#Ei). Formats: 1, A, a, I, i.
 * existingBookmarks/existingBookmarkIds optionally reserve document-local names
 * and ids in mutable Sets; explicit collisions are errors, not renamed anchors.
 */
export function equationLayout(runXml,options={}){
 optionsObject(options,LAYOUT_OPTIONS);validateRuns(runXml);
 const {mode='inline',numberFormat:pattern='(#E1)',equation=1,chapter=1,section=1,widthTwips=9026,style='EquationLab',resetEquation=false}=options;
 if(!['inline','display','numbered-right','numbered-left'].includes(mode))throw Error('Invalid equation layout mode');
 int(equation,'equation');int(chapter,'chapter');int(section,'section');int(widthTwips,'widthTwips',1440,31680);boolean(resetEquation,'resetEquation');
 if(typeof style!=='string'||!/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(style))throw Error('Invalid paragraph style id');
 const tokens=numberFormat(pattern),numbered=mode.startsWith('numbered-');
 if(!numbered&&(options.bookmarkName!==undefined||options.bookmarkId!==undefined||resetEquation))throw Error('Bookmarks and equation resets require a numbered layout');
 registry(options.existingBookmarks,'existingBookmarks');registry(options.existingBookmarkIds,'existingBookmarkIds');
 const spaced=mode!=='inline',center=Math.floor(widthTwips/2);
 const tabs=numbered?`<w:tabs><w:tab w:val="center" w:pos="${center}"/><w:tab w:val="right" w:pos="${widthTwips}"/></w:tabs>`:'';
 const props=`<w:pPr><w:pStyle w:val="${esc(style)}"/><w:keepNext w:val="0"/><w:keepLines/>${tabs}<w:spacing w:before="${spaced?120:0}" w:after="${spaced?120:0}"/><w:jc w:val="${mode==='display'?'center':'left'}"/></w:pPr>`;
 if(!numbered)return {xml:`<w:p>${props}${runXml}</w:p>`,bookmarkName:null,bookmarkId:null,numberText:null};
 const a=anchor(options),number=numberRuns(tokens,{E:equation,C:chapter,S:section},{resetEquation});
 const marked=`<w:bookmarkStart w:id="${a.id}" w:name="${a.name}"/>${number.xml}<w:bookmarkEnd w:id="${a.id}"/>`,tab='<w:r><w:tab/></w:r>';
 const contents=mode==='numbered-right'?tab+runXml+tab+marked:marked+tab+runXml;
 const xml=`<w:p>${props}${contents}</w:p>`;a.commit();
 return {xml,bookmarkName:a.name,bookmarkId:a.id,numberText:number.text};
}

/** Inline REF field with a real hyperlink switch. The prefix stays outside the
 * field so updates never replace user-facing prose such as "式 " or "Eq. ". */
export function equationReference(bookmarkName,options={}){
 optionsObject(options,new Set(['cachedText','prefix']));validBookmark(bookmarkName);
 const {cachedText='(?)',prefix=''}=options;plainText(cachedText,'cached reference text');plainText(prefix,'reference prefix');
 return (prefix?textRun(prefix):'')+field(`REF ${bookmarkName} \\h`,cachedText);
}

/** A real, independently referenceable Equation Lab number, without an OLE. */
export function standaloneNumber(options={}){
 optionsObject(options,new Set(['numberFormat','equation','chapter','section','bookmarkName','bookmarkId','existingBookmarks','existingBookmarkIds']));
 const {numberFormat:pattern='(#E1)',equation=1,chapter=1,section=1}=options;
 int(equation,'equation');int(chapter,'chapter');int(section,'section');
 const tokens=numberFormat(pattern),number=numberRuns(tokens,{E:equation,C:chapter,S:section}),a=anchor(options);
 const xml=`<w:p><w:pPr><w:pStyle w:val="EquationLab"/><w:jc w:val="right"/></w:pPr><w:bookmarkStart w:id="${a.id}" w:name="${a.name}"/>${number.xml}<w:bookmarkEnd w:id="${a.id}"/></w:p>`;a.commit();
 return {xml,bookmarkName:a.name,bookmarkId:a.id,numberText:number.text};
}

/** Hidden chapter/section context marker, not a page or section-layout break.
 * Place before the first numbered equation and wherever context changes. Reset
 * to zero here makes the following ordinary SEQ EquationLab field display one.
 * Hidden SEQ fields have no \* format switch, which would cancel SEQ's \h.
 */
export function chapterBreak(options={}){
 optionsObject(options,new Set(['chapter','section','resetEquation']));
 const {chapter=1,section=1,resetEquation=true}=options;int(chapter,'chapter');int(section,'section');boolean(resetEquation,'resetEquation');
 const hidden={hidden:true};
 const fields=field(`SEQ ELChapter \\r ${chapter} \\h`,String(chapter),hidden)+field(`SEQ ELSection \\r ${section} \\h`,String(section),hidden)+(resetEquation?field('SEQ EquationLab \\r 0 \\h','0',hidden):'');
 return `<w:p><w:pPr><w:keepNext w:val="0"/><w:keepLines/><w:spacing w:before="0" w:after="0" w:line="1" w:lineRule="exact"/><w:rPr><w:vanish/><w:sz w:val="2"/><w:specVanish/></w:rPr></w:pPr>${fields}</w:p>`;
}
