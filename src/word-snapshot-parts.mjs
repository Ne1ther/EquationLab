import JSZip from 'jszip';
import path from 'node:path';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {NS,MAX_FLAT_OPC_BYTES} from './document.mjs';
const typesNS='http://schemas.openxmlformats.org/package/2006/content-types';
const serialize=node=>new XMLSerializer().serializeToString(node);
function xml(text){if(typeof text!=='string'||/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('Invalid Word snapshot XML');return new DOMParser({onError(level,message){throw Error('Invalid Word snapshot XML: '+message);}}).parseFromString(text,'application/xml');}
function safeName(name){return typeof name==='string'&&name.length>0&&name.length<1024&&!name.startsWith('/')&&!/[\\\x00:]/.test(name)&&!name.split('/').some(s=>s==='.'||s==='..'||!s);}
function ownerOfRels(name){if(name==='_rels/.rels')return '';const dir=path.posix.dirname(name);if(path.posix.basename(dir)!=='_rels'||!name.endsWith('.rels'))throw Error('Invalid Word relationship part');return path.posix.join(path.posix.dirname(dir),path.posix.basename(name).slice(0,-5));}
function targetPart(owner,target){const name=target.startsWith('/')?target.slice(1):path.posix.normalize(path.posix.join(path.posix.dirname(owner),target));if(!safeName(name))throw Error('Invalid Word relationship target');return name;}
/** Private read/edit snapshot, assembled from consecutive main-story ranges.
 * Each range owns its relationship namespace. No merged package is written back
 * to Word: save-back still replaces one checked OLE owner at its live Range.
 */
export async function combineWordSnapshotParts(parts){
 if(!Array.isArray(parts)||!parts.length||parts.length>256)throw Error('Invalid Word snapshot parts');
 let total=0;const zip=new JSZip(),types=xml(`<Types xmlns="${typesNS}"/>`),relationships=xml(`<Relationships xmlns="${NS.rels}"/>`);let main=null,body=null,lastSection=null;
 const addType=(name,type)=>{const node=types.createElementNS(typesNS,'Override');node.setAttribute('PartName','/'+name);node.setAttribute('ContentType',type);types.documentElement.appendChild(node);};
 for(let index=0;index<parts.length;index++){
  const text=parts[index];if(typeof text!=='string'||(total+=Buffer.byteLength(text))>MAX_FLAT_OPC_BYTES)throw Error('Oversized Word snapshot parts');
  const packageDoc=xml(text),nodes=Array.from(packageDoc.getElementsByTagNameNS(NS.pkg,'part')),entries=new Map();
  for(const node of nodes){const name=node.getAttributeNS(NS.pkg,'name').replace(/^\//,''),type=node.getAttributeNS(NS.pkg,'contentType');if(!safeName(name)||entries.has(name)||!type)throw Error('Invalid Word snapshot part');const data=node.getElementsByTagNameNS(NS.pkg,'xmlData')[0],binary=node.getElementsByTagNameNS(NS.pkg,'binaryData')[0];if(!!data===!!binary)throw Error('Invalid Word snapshot payload');entries.set(name,{name,type,data,binary});}
  const root=entries.get('_rels/.rels');if(!root?.data)throw Error('Missing Word snapshot relationships');
  const rootXML=xml(Array.from(root.data.childNodes).map(serialize).join(''));
  const office=Array.from(rootXML.getElementsByTagNameNS(NS.rels,'Relationship')).filter(n=>n.getAttribute('Type')===NS.r+'/officeDocument'&&n.getAttribute('TargetMode')!=='External');
  if(office.length!==1)throw Error('Invalid Word main-document relationship');
  const mainName=targetPart('',office[0].getAttribute('Target')),entry=entries.get(mainName);
  if(!entry?.data)throw Error('Missing Word snapshot main document');
  const document=xml(Array.from(entry.data.childNodes).map(serialize).join('')),sourceBody=document.getElementsByTagNameNS(NS.w,'body')[0];if(!sourceBody||document.documentElement.localName!=='document')throw Error('Invalid Word main document');
  if(!main){main=document;body=sourceBody;while(body.firstChild)body.removeChild(body.firstChild);addType('word/document.xml','application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml');}
  // Import from a separate tree even for the first range, whose body we clear.
  const source=xml(Array.from(entry.data.childNodes).map(serialize).join('')).getElementsByTagNameNS(NS.w,'body')[0];
  const prefix=`ranges/${index}/`,renamed=name=>name===mainName?'word/document.xml':prefix+name;
  for(const element of Array.from(source.getElementsByTagName('*'))){
   for(const attribute of Array.from(element.attributes))if(attribute.namespaceURI===NS.r)attribute.value=`p${index}_${attribute.value}`;
   // Word restarts VML shape ids when serializing each Range.
   if(element.namespaceURI===NS.v&&['shape','shapetype'].includes(element.localName)&&element.hasAttribute('id'))element.setAttribute('id',`p${index}_${element.getAttribute('id')}`);
   if(element.namespaceURI===NS.v&&element.hasAttribute('type')&&element.getAttribute('type').startsWith('#'))element.setAttribute('type',`#p${index}_${element.getAttribute('type').slice(1)}`);
   if(element.namespaceURI===NS.o&&element.hasAttribute('ShapeID'))element.setAttribute('ShapeID',`p${index}_${element.getAttribute('ShapeID')}`);
  }
  for(const node of Array.from(source.childNodes))if(node.nodeType===1&&node.namespaceURI===NS.w&&node.localName==='sectPr')lastSection=node;else body.appendChild(main.importNode(node,true));
  const mainRels=path.posix.join(path.posix.dirname(mainName),'_rels',path.posix.basename(mainName)+'.rels');
  for(const item of entries.values()){
   if(item.name==='_rels/.rels'||item.name===mainName)continue;
   const name=renamed(item.name);let content;
   if(item.data){
    content=xml(Array.from(item.data.childNodes).map(serialize).join(''));
    if(item.name.endsWith('.rels')){
     const owner=ownerOfRels(item.name),newOwner=renamed(owner);
     for(const relation of Array.from(content.getElementsByTagNameNS(NS.rels,'Relationship'))){
      if(item.name===mainRels)relation.setAttribute('Id',`p${index}_${relation.getAttribute('Id')}`);
      if(relation.getAttribute('TargetMode')!=='External'){
       const target=renamed(targetPart(owner,relation.getAttribute('Target')));
       relation.setAttribute('Target',path.posix.relative(path.posix.dirname(newOwner),target));
      }
      if(item.name===mainRels)relationships.documentElement.appendChild(relationships.importNode(relation,true));
     }
     if(item.name===mainRels)continue;
    }
    content=serialize(content);
   }else{const base64=item.binary.textContent.replace(/\s/g,'');if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))throw Error('Invalid Word binary part');content=Buffer.from(base64,'base64');}
   zip.file(name,content);addType(name,item.type);
  }
 }
 if(lastSection)body.appendChild(main.importNode(lastSection,true));
 zip.file('word/document.xml',serialize(main));zip.file('word/_rels/document.xml.rels',serialize(relationships));addType('word/_rels/document.xml.rels','application/vnd.openxmlformats-package.relationships+xml');
 zip.file('_rels/.rels',`<Relationships xmlns="${NS.rels}"><Relationship Id="rDocument" Type="${NS.r}/officeDocument" Target="word/document.xml"/></Relationships>`);addType('_rels/.rels','application/vnd.openxmlformats-package.relationships+xml');
 zip.file('[Content_Types].xml',serialize(types));return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
