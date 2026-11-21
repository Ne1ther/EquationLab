import JSZip from 'jszip';
import path from 'node:path';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {NS,MAX_FLAT_OPC_BYTES} from './document.mjs';
const typesNS='http://schemas.openxmlformats.org/package/2006/content-types';
const drawingNS='http://schemas.openxmlformats.org/drawingml/2006/main';
const corePropsNS='http://schemas.openxmlformats.org/package/2006/metadata/core-properties';
const appPropsNS='http://schemas.openxmlformats.org/officeDocument/2006/extended-properties';
const customPropsNS='http://schemas.openxmlformats.org/officeDocument/2006/custom-properties';
const corePropsRel='http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties';
const appPropsRel='http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties';
const reuseNS='urn:equationlab:internal-snapshot-part-reuse';
const settingsRelation=NS.r+'/settings';
const sharedPartSpecs=[
 {
  scope:'main',id:'rSettings',name:'word/settings.xml',target:'settings.xml',
  relationships:'word/_rels/settings.xml.rels',
  type:'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml',
  relation:settingsRelation,root:'settings',namespace:NS.w
 },
 {
  scope:'main',id:'rStyles',name:'word/styles.xml',target:'styles.xml',
  relationships:'word/_rels/styles.xml.rels',
  type:'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml',
  relation:NS.r+'/styles',root:'styles',namespace:NS.w
 },
 {
  scope:'main',id:'rFontTable',name:'word/fontTable.xml',target:'fontTable.xml',
  relationships:'word/_rels/fontTable.xml.rels',
  type:'application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml',
  relation:NS.r+'/fontTable',root:'fonts',namespace:NS.w
 },
 {
  scope:'main',id:'rWebSettings',name:'word/webSettings.xml',target:'webSettings.xml',
  relationships:'word/_rels/webSettings.xml.rels',
  type:'application/vnd.openxmlformats-officedocument.wordprocessingml.webSettings+xml',
  relation:NS.r+'/webSettings',root:'webSettings',namespace:NS.w
 },
 {
  scope:'main',id:'rNumbering',name:'word/numbering.xml',target:'numbering.xml',
  relationships:'word/_rels/numbering.xml.rels',
  type:'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml',
  relation:NS.r+'/numbering',root:'numbering',namespace:NS.w
 },
 {
  scope:'main',id:'rTheme',name:'word/theme/theme1.xml',target:'theme/theme1.xml',
  relationships:'word/theme/_rels/theme1.xml.rels',
  type:'application/vnd.openxmlformats-officedocument.theme+xml',
  relation:NS.r+'/theme',root:'theme',namespace:drawingNS
 },
 {
  scope:'root',id:'rCustom',name:'docProps/custom.xml',target:'docProps/custom.xml',
  relationships:'docProps/_rels/custom.xml.rels',
  type:'application/vnd.openxmlformats-officedocument.custom-properties+xml',
  relation:NS.r+'/custom-properties',root:'Properties',namespace:customPropsNS
 },
 {
  scope:'root',id:'rCore',name:'docProps/core.xml',target:'docProps/core.xml',
  relationships:'docProps/_rels/core.xml.rels',
  type:'application/vnd.openxmlformats-package.core-properties+xml',
  relation:corePropsRel,root:'coreProperties',namespace:corePropsNS
 },
 {
  scope:'root',id:'rApp',name:'docProps/app.xml',target:'docProps/app.xml',
  relationships:'docProps/_rels/app.xml.rels',
  type:'application/vnd.openxmlformats-officedocument.extended-properties+xml',
  relation:appPropsRel,root:'Properties',namespace:appPropsNS
 }
];
const sharedSpecByName=new Map(sharedPartSpecs.map(spec=>[spec.name,spec]));
const serialize=node=>new XMLSerializer().serializeToString(node);
function xml(text){if(typeof text!=='string'||/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('Invalid Word snapshot XML');return new DOMParser({onError(level,message){throw Error('Invalid Word snapshot XML: '+message);}}).parseFromString(text,'application/xml');}
function safeName(name){return typeof name==='string'&&name.length>0&&name.length<1024&&!name.startsWith('/')&&!/[\\\x00:]/.test(name)&&!name.split('/').some(s=>s==='.'||s==='..'||!s);}
function ownerOfRels(name){if(name==='_rels/.rels')return '';const dir=path.posix.dirname(name);if(path.posix.basename(dir)!=='_rels'||!name.endsWith('.rels'))throw Error('Invalid Word relationship part');return path.posix.join(path.posix.dirname(dir),path.posix.basename(name).slice(0,-5));}
function targetPart(owner,target){const name=target.startsWith('/')?target.slice(1):path.posix.normalize(path.posix.join(path.posix.dirname(owner),target));if(!safeName(name))throw Error('Invalid Word relationship target');return name;}
function serializedPayload(data){
 const nodes=Array.from(data.childNodes);
 const roots=nodes.filter(node=>node.nodeType===1);
 if(roots.length!==1||nodes.some(node=>node.nodeType===4||node.nodeType===3&&/[^ \t\r\n]/.test(node.nodeValue)))throw Error('Invalid Word snapshot XML payload');
 return {root:roots[0],xml:nodes.map(serialize).join('')};
}
function hasRelationshipAttr(data){
 for(const element of Array.from(data.getElementsByTagName('*'))){
  for(const attribute of Array.from(element.attributes)){
   if(attribute.namespaceURI===NS.r)return true;
  }
 }
 return false;
}
function skipSpace(text,pos){while(pos<text.length&&(text[pos]===' '||text[pos]==='\t'||text[pos]==='\r'||text[pos]==='\n'))pos++;return pos;}
/** Scan top-level <pkg:part> boundaries in clean Flat OPC XML so subsequent
 * segments can skip re-parsing and re-serializing byte-identical, already
 * DOM-validated context-free shared parts (styles, settings, theme, etc.).
 * Returns null on any comment, CDATA, PI inside <pkg:package>, or nonstandard
 * framing so the caller falls back to full DOM parsing without losing checks.
 */
function scanTopLevelParts(text){
 if(text.includes('<!--')||text.includes('<![CDATA[')||text.includes(reuseNS))return null;
 let pos=skipSpace(text,0);
 if(text.startsWith('<?xml',pos)){
  const declEnd=text.indexOf('?>',pos+5);
  if(declEnd<0)return null;
  pos=skipSpace(text,declEnd+2);
 }
 if(!text.startsWith('<pkg:package',pos))return null;
 const pkgEnd=text.indexOf('>',pos+12);
 if(pkgEnd<0||text[pkgEnd-1]==='/')return null;
 if(text.indexOf('<?',pkgEnd+1)>=0)return null;
 const packageOpenTag=text.slice(pos,pkgEnd+1);
 pos=skipSpace(text,pkgEnd+1);
 const parts=[];
 while(pos<text.length){
  if(text.startsWith('</pkg:package>',pos)){
   pos=skipSpace(text,pos+'</pkg:package>'.length);
   return pos===text.length?{packageOpenTag,parts}:null;
  }
  if(!text.startsWith('<pkg:part ',pos))return null;
  const openEnd=text.indexOf('>',pos+10);
  if(openEnd<0||text[openEnd-1]==='/')return null;
  const closeStart=text.indexOf('</pkg:part>',openEnd+1);
  if(closeStart<0)return null;
  const nested=text.indexOf('<pkg:part',pos+9);
  if(nested>=0&&nested<closeStart)return null;
  const openTag=text.slice(pos,openEnd+1);
  const match=/\bpkg:name="\/([^"]+)"/.exec(openTag);
  const partEnd=closeStart+'</pkg:part>'.length;
  parts.push({name:match?match[1]:null,start:pos,end:partEnd});
  pos=skipSpace(text,partEnd);
 }
 return null;
}
function parseSegmentWithSharedReuse(text,verifiedRawParts){
 if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('Invalid Word snapshot XML');
 const scanned=scanTopLevelParts(text);
 const reusedPayloads=new Map();
 let rawByName=null;
 if(scanned){
  const counts=new Map();
  for(const part of scanned.parts)if(part.name)counts.set(part.name,(counts.get(part.name)??0)+1);
  rawByName=new Map();
  let substituted=null,cursor=0;
  for(const part of scanned.parts){
   if(!part.name||!sharedSpecByName.has(part.name))continue;
   if(counts.get(part.name)===1)rawByName.set(part.name,text.slice(part.start,part.end));
   const cached=verifiedRawParts.get(part.name);
   if(cached&&cached.packageOpenTag===scanned.packageOpenTag&&part.end-part.start===cached.raw.length&&text.startsWith(cached.raw,part.start)){
    if(substituted===null)substituted=[];
    substituted.push(text.slice(cursor,part.start));
    substituted.push(`<pkg:part pkg:name="/${part.name}" pkg:contentType="${cached.type}"><pkg:xmlData><el:reuse xmlns:el="${reuseNS}"/></pkg:xmlData></pkg:part>`);
    cursor=part.end;
    reusedPayloads.set(part.name,cached);
   }
  }
  if(substituted!==null){
   substituted.push(text.slice(cursor));
   return {packageDoc:xml(substituted.join('')),scanned,rawByName,reusedPayloads};
  }
 }
 return {packageDoc:xml(text),scanned,rawByName,reusedPayloads};
}
/** Private read/edit snapshot, assembled from consecutive main-story ranges.
 * Each range owns its relationship namespace. Identical, context-free shared
 * package parts (styles, settings, theme, fonts, numbering, document properties)
 * are deduplicated once unanimously verified; conflicting or context-bound
 * parts remain isolated per segment without becoming document-wide defaults.
 * No merged package is written back to Word: save-back still replaces one
 * checked OLE owner at its live Range.
 */
export async function combineWordSnapshotParts(parts){
 if(!Array.isArray(parts)||!parts.length||parts.length>256)throw Error('Invalid Word snapshot parts');
 let total=0;const zip=new JSZip(),types=xml(`<Types xmlns="${typesNS}"/>`),relationships=xml(`<Relationships xmlns="${NS.rels}"/>`);let main=null,body=null,lastSection=null;
 const verifiedRawParts=new Map();
 const sharedState=new Map(sharedPartSpecs.map(spec=>[spec.name,{spec,segments:[]}]));
 const addType=(name,type)=>{const node=types.createElementNS(typesNS,'Override');node.setAttribute('PartName','/'+name);node.setAttribute('ContentType',type);types.documentElement.appendChild(node);};
 for(let index=0;index<parts.length;index++){
  const text=parts[index];if(typeof text!=='string'||(total+=Buffer.byteLength(text))>MAX_FLAT_OPC_BYTES)throw Error('Oversized Word snapshot parts');
  const {packageDoc,scanned,rawByName,reusedPayloads}=parseSegmentWithSharedReuse(text,verifiedRawParts);
  const nodes=Array.from(packageDoc.getElementsByTagNameNS(NS.pkg,'part')),entries=new Map();
  for(const node of nodes){const name=node.getAttributeNS(NS.pkg,'name').replace(/^\//,''),type=node.getAttributeNS(NS.pkg,'contentType');if(!safeName(name)||entries.has(name)||!type)throw Error('Invalid Word snapshot part');const data=node.getElementsByTagNameNS(NS.pkg,'xmlData')[0],binary=node.getElementsByTagNameNS(NS.pkg,'binaryData')[0];if(!!data===!!binary)throw Error('Invalid Word snapshot payload');entries.set(name,{name,type,data,binary});}
  const root=entries.get('_rels/.rels');if(!root?.data)throw Error('Missing Word snapshot relationships');
  const rootXML=xml(serializedPayload(root.data).xml);
  const rootLinks=Array.from(rootXML.getElementsByTagNameNS(NS.rels,'Relationship'));
  const office=rootLinks.filter(n=>n.getAttribute('Type')===NS.r+'/officeDocument'&&n.getAttribute('TargetMode')!=='External');
  if(office.length!==1)throw Error('Invalid Word main-document relationship');
  const mainName=targetPart('',office[0].getAttribute('Target')),entry=entries.get(mainName);
  if(!entry?.data)throw Error('Missing Word snapshot main document');
  const document=xml(serializedPayload(entry.data).xml),sourceBody=document.getElementsByTagNameNS(NS.w,'body')[0];if(!sourceBody||document.documentElement.localName!=='document')throw Error('Invalid Word main document');
  let source=sourceBody;
  if(!main){main=document;body=sourceBody;source=sourceBody.cloneNode(true);while(body.firstChild)body.removeChild(body.firstChild);addType('word/document.xml','application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml');}
  const prefix=`ranges/${index}/`,renamed=name=>name===mainName?'word/document.xml':prefix+name;
  const bodyRelIds=new Set();
  for(const element of Array.from(source.getElementsByTagName('*'))){
   for(const attribute of Array.from(element.attributes))if(attribute.namespaceURI===NS.r){bodyRelIds.add(attribute.value);attribute.value=`p${index}_${attribute.value}`;}
   // Word restarts VML shape ids when serializing each Range.
   if(element.namespaceURI===NS.v&&['shape','shapetype'].includes(element.localName)&&element.hasAttribute('id'))element.setAttribute('id',`p${index}_${element.getAttribute('id')}`);
   if(element.namespaceURI===NS.v&&element.hasAttribute('type')&&element.getAttribute('type').startsWith('#'))element.setAttribute('type',`#p${index}_${element.getAttribute('type').slice(1)}`);
   if(element.namespaceURI===NS.o&&element.hasAttribute('ShapeID'))element.setAttribute('ShapeID',`p${index}_${element.getAttribute('ShapeID')}`);
  }
  for(const node of Array.from(source.childNodes))if(node.nodeType===1&&node.namespaceURI===NS.w&&node.localName==='sectPr')lastSection=node;else body.appendChild(main.importNode(node,true));
  const mainRels=path.posix.join(path.posix.dirname(mainName),'_rels',path.posix.basename(mainName)+'.rels');
  const parsedRels=new Map(),otherRelTargets=new Set();
  for(const item of entries.values()){
   if(item.name==='_rels/.rels'||!item.name.endsWith('.rels'))continue;
   if(!item.data)throw Error('Invalid Word relationship part');
   const relDoc=xml(serializedPayload(item.data).xml);
   const owner=ownerOfRels(item.name);
   const links=Array.from(relDoc.getElementsByTagNameNS(NS.rels,'Relationship'));
   parsedRels.set(item.name,{owner,relDoc,links});
   if(item.name!==mainRels){
    for(const relation of links){
     if(relation.getAttribute('TargetMode')!=='External')otherRelTargets.add(targetPart(owner,relation.getAttribute('Target')));
    }
   }
  }
  const mainLinks=parsedRels.get(mainRels)?.links??[];
  const countTargets=(links,owner)=>{
   const counts=new Map();
   for(const link of links){
    if(link.getAttribute('TargetMode')==='External')continue;
    const target=targetPart(owner,link.getAttribute('Target'));
    counts.set(target,(counts.get(target)??0)+1);
   }
   return counts;
  };
  const rootTargetCounts=countTargets(rootLinks,'');
  const mainTargetCounts=countTargets(mainLinks,mainName);
  const deferredPartNames=new Set();
  const deferredMainRelById=new Map();
  for(const spec of sharedPartSpecs){
   const state=sharedState.get(spec.name);
   const item=entries.get(spec.name);
   if(!item){state.segments.push({status:'absent'});continue;}
   let payload=null,validShared=false,ownerLink=null;
   const reused=reusedPayloads.get(spec.name);
   const basicOk=!!item.data&&item.type===spec.type&&!entries.has(spec.relationships)&&!otherRelTargets.has(spec.name);
   if(basicOk){
    if(spec.scope==='main'){
     const matching=mainLinks.filter(node=>node.getAttribute('Type')===spec.relation);
     if(matching.length===1&&matching[0].getAttribute('TargetMode')!=='External'&&targetPart(mainName,matching[0].getAttribute('Target'))===spec.name&&mainTargetCounts.get(spec.name)===1&&(rootTargetCounts.get(spec.name)??0)===0&&!bodyRelIds.has(matching[0].getAttribute('Id'))){
      ownerLink=matching[0];
     }
    }else{
     const matching=rootLinks.filter(node=>node.getAttribute('Type')===spec.relation);
     if(matching.length===1&&matching[0].getAttribute('TargetMode')!=='External'&&targetPart('',matching[0].getAttribute('Target'))===spec.name&&rootTargetCounts.get(spec.name)===1&&(mainTargetCounts.get(spec.name)??0)===0){
      ownerLink=matching[0];
     }
    }
   }
   if(ownerLink){
    if(reused){
     payload=reused.payload;validShared=true;
    }else{
     const parsed=serializedPayload(item.data);
     if(parsed.root.namespaceURI===spec.namespace&&parsed.root.localName===spec.root&&!hasRelationshipAttr(item.data)){
      payload=parsed.xml;validShared=true;
      if(scanned&&rawByName?.has(spec.name)&&!verifiedRawParts.has(spec.name)){
       verifiedRawParts.set(spec.name,{packageOpenTag:scanned.packageOpenTag,raw:rawByName.get(spec.name),type:spec.type,payload});
      }
     }
    }
   }
   if(validShared){
    deferredPartNames.add(spec.name);
    const segmentEntry={status:'eligible',index,name:item.name,type:item.type,payload,mainRelNode:null};
    state.segments.push(segmentEntry);
    if(spec.scope==='main')deferredMainRelById.set(ownerLink.getAttribute('Id'),segmentEntry);
   }else{
    state.segments.push({status:'ineligible'});
   }
  }
  for(const item of entries.values()){
   if(item.name==='_rels/.rels'||item.name===mainName||deferredPartNames.has(item.name))continue;
   const name=renamed(item.name);let content;
   if(item.data){
    if(item.name.endsWith('.rels')){
     const {owner,relDoc,links}=parsedRels.get(item.name),newOwner=renamed(owner);
     for(const relation of links){
      const originalId=relation.getAttribute('Id');
      if(item.name===mainRels)relation.setAttribute('Id',`p${index}_${originalId}`);
      if(relation.getAttribute('TargetMode')!=='External'){
       const target=renamed(targetPart(owner,relation.getAttribute('Target')));
       relation.setAttribute('Target',path.posix.relative(path.posix.dirname(newOwner),target));
      }
      if(item.name===mainRels){
       const deferred=deferredMainRelById.get(originalId);
       if(deferred)deferred.mainRelNode=relation;
       // Segment-local settings are metadata only. Publish a document-wide
       // settings link below only after every segment agrees on its contents.
       else if(relation.getAttribute('Type')!==settingsRelation||bodyRelIds.has(originalId))relationships.documentElement.appendChild(relationships.importNode(relation,true));
      }
     }
     if(item.name===mainRels)continue;
     content=serialize(relDoc);
    }else{
     const reused=reusedPayloads.get(item.name);
     content=reused?reused.payload:serializedPayload(item.data).xml;
    }
   }else{const base64=item.binary.textContent.replace(/\s/g,'');if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))throw Error('Invalid Word binary part');content=Buffer.from(base64,'base64');}
   zip.file(name,content);addType(name,item.type);
  }
 }
 if(lastSection)body.appendChild(main.importNode(lastSection,true));
 const rootRelationTags=[`<Relationship Id="rDocument" Type="${NS.r}/officeDocument" Target="word/document.xml"/>`];
 for(const spec of sharedPartSpecs){
  const {segments}=sharedState.get(spec.name);
  const unanimous=segments.length===parts.length&&segments.every(s=>s.status==='eligible')&&segments.every(s=>s.payload===segments[0].payload);
  if(unanimous){
   zip.file(spec.name,segments[0].payload);addType(spec.name,spec.type);
   if(spec.scope==='main'){
    const relation=relationships.createElementNS(NS.rels,'Relationship');
    relation.setAttribute('Id',spec.id);relation.setAttribute('Type',spec.relation);relation.setAttribute('Target',spec.target);
    relationships.documentElement.appendChild(relation);
   }else{
    rootRelationTags.push(`<Relationship Id="${spec.id}" Type="${spec.relation}" Target="${spec.target}"/>`);
   }
  }else{
   // Conflicting, missing, or context-bound parts stay isolated per segment
   // and never become a document-wide default.
   for(const segment of segments){
    if(segment.status!=='eligible')continue;
    const rangeName=`ranges/${segment.index}/${segment.name}`;
    zip.file(rangeName,segment.payload);addType(rangeName,segment.type);
    if(segment.mainRelNode&&spec.relation!==settingsRelation)relationships.documentElement.appendChild(relationships.importNode(segment.mainRelNode,true));
   }
  }
 }
 zip.file('word/document.xml',serialize(main));zip.file('word/_rels/document.xml.rels',serialize(relationships));addType('word/_rels/document.xml.rels','application/vnd.openxmlformats-package.relationships+xml');
 zip.file('_rels/.rels',`<Relationships xmlns="${NS.rels}">${rootRelationTags.join('')}</Relationships>`);addType('_rels/.rels','application/vnd.openxmlformats-package.relationships+xml');
 zip.file('[Content_Types].xml',serialize(types));return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:1}});
}
