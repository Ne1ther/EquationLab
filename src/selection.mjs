import {DOMParser} from '@xmldom/xmldom';
import {fromFlatOpc,NS} from './document.mjs';
import JSZip from 'jszip';

const word2010='http://schemas.microsoft.com/office/word/2010/wordml';
const xmlns='http://www.w3.org/2000/xmlns/';
function canonicalXml(bytes,part){
 const errors=[];
 const root=new DOMParser({onError:(level,message)=>{if(level==='error'||level==='fatalError')errors.push(message);}}).parseFromString(bytes.toString(),'application/xml').documentElement;
 if(errors.length)throw Error('选区 XML 无效');
 function visit(node){
  if(node.nodeType===1){
   if(part==='word/settings.xml'&&node.namespaceURI===NS.w&&node.localName==='rsids')return null;
   const attrs=Array.from(node.attributes).filter(a=>{
    if(a.namespaceURI===xmlns)return false;
    // Mac Word regenerates these identifiers on every getOoxml export.
    // Location is checked separately with a tracked Word.Range before writing.
    if(a.namespaceURI===NS.w&&/^rsid(R|RPr|Del|P|RDefault|Sect)$/.test(a.localName))return false;
    if(a.namespaceURI===word2010&&((node.namespaceURI===NS.w&&node.localName==='p'&&a.localName==='paraId')||(['pict','object'].includes(node.localName)&&node.namespaceURI===NS.w&&a.localName==='anchorId')))return false;
    if(node.namespaceURI===NS.o&&node.localName==='OLEObject'&&!a.namespaceURI&&a.localName==='ObjectID')return false;
    return true;
   }).map(a=>[a.namespaceURI??'',a.localName,a.value]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
   const children=Array.from(node.childNodes).filter(n=>!(n.nodeType===3&&/^\s*$/.test(n.nodeValue)&&Array.from(node.childNodes).some(c=>c.nodeType===1))).map(visit).filter(v=>v!==null);
   return [node.namespaceURI??'',node.localName,attrs,children];
  }
  return node.nodeType===3||node.nodeType===4?['text',node.nodeValue]:null;
 }
 return JSON.stringify(visit(root));
}

/** Full package comparison, ignoring only observed Word export identifiers.
 * This checks content; clients must also verify the original range's location. */
export async function compareSelection(original,current){
 const left=await JSZip.loadAsync(await fromFlatOpc(original)),right=await JSZip.loadAsync(await fromFlatOpc(current));
 const names=[...new Set([...Object.keys(left.files),...Object.keys(right.files)])].filter(n=>!left.files[n]?.dir&&!right.files[n]?.dir).sort(),differences=[];
 for(const name of names){
  const a=left.file(name),b=right.file(name);
  if(!a||!b){differences.push(name);continue;}
  const x=await a.async('nodebuffer'),y=await b.async('nodebuffer');if(x.equals(y))continue;
  if(name.endsWith('.xml')||name.endsWith('.rels')){if(canonicalXml(x,name)===canonicalXml(y,name))continue;}
  differences.push(name);
 }
 return {equal:!differences.length,differences};
}
