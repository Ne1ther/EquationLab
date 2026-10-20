import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import '../../word-ribbon/command-registry.js';
const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: build-ribbon-template.mjs compiled.dotm new-ribbon.dotm');
const zip=await JSZip.loadAsync(await fs.readFile(input));
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
const images=new Set(),button=(id,label,icon)=>{images.add(icon);return `<button id="EL.${id}" label="${escape(label)}" tag="${id}" image="${icon}" onAction="EquationLabRibbon.ELRibbonAction"${['insert-inline','insert-display','insert-right','open-pane'].includes(id)?' size="large"':''}/>`;};
const registry=globalThis.EquationLabCommands;
// Keep `open-pane` as the frozen template ABI tag; it routes to the native editor.
const xml=`<?xml version="1.0" encoding="UTF-8"?><customUI xmlns="http://schemas.microsoft.com/office/2009/07/customui"><ribbon><tabs><tab id="EquationLab.Native.Tab" label="Equation Lab">${registry.groups.map(group=>`<group id="EL.${group.id}" label="${escape(group.label)}">${group.id==='Help'?button('open-pane','Equation Lab','inline'):''}${group.commands.map(id=>{const command=registry.get(id);return button(id,command.label,command.icon);}).join('')}</group>`).join('')}</tab></tabs></ribbon></customUI>`;
zip.file('customUI/customUI.xml',xml);
zip.file('customUI/_rels/customUI.xml.rels',`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${[...images].map(name=>`<Relationship Id="${name}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="icons/${name}.png"/>`).join('')}</Relationships>`);
for(const name of images)zip.file(`customUI/icons/${name}.png`,await fs.readFile(new URL(`../../word-ribbon/icons/${name}-32.png`,import.meta.url)));
let rels=await zip.file('_rels/.rels').async('string');if(rels.includes('/ui/extensibility'))throw Error('Input template already contains a Ribbon.');
rels=rels.replace('</Relationships>','<Relationship Id="EquationLabRibbon" Type="http://schemas.microsoft.com/office/2007/relationships/ui/extensibility" Target="customUI/customUI.xml"/></Relationships>');zip.file('_rels/.rels',rels);
let types=await zip.file('[Content_Types].xml').async('string');if(!types.includes('Extension="png"'))types=types.replace('</Types>','<Default Extension="png" ContentType="image/png"/></Types>');zip.file('[Content_Types].xml',types);
await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
console.log(JSON.stringify({template:output,groups:registry.groups.length,commands:registry.commands.length,permanentNativeEntry:true}));
