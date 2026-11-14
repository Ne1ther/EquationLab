import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import JSZip from 'jszip';
import {inspectDocx} from '../src/document.mjs';

const source=await readFile(new URL('../docs/examples/equation-lab-30-formulas.docx',import.meta.url));
const index=objects=>objects.map(o=>({part:o.part,mainDocument:o.mainDocument===true,error:o.parseError,nativeSha256:o.nativeSha256}));

test('Native-only index retains the full inspector object order, errors and Native hashes',async()=>{
 const full=await inspectDocx(source),light=await inspectDocx(source,{nativeIndexOnly:true});
 assert.deepEqual(index(light.objects),index(full.objects));assert.equal(light.objects.length,30);
 const zip=await JSZip.loadAsync(source);zip.file(full.objects[2].path,Buffer.from('broken OLE'));
 zip.file('word/header7.xml','<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:p><w:r><w:object><o:OLEObject ProgID="Equation.DSMT4" r:id="rEquation"/></w:object></w:r></w:p></w:hdr>');
 zip.file('word/_rels/header7.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rEquation" Target="embeddings/header-equation.bin" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject"/></Relationships>');
 zip.file('word/embeddings/header-equation.bin',full.objects[0].ole);
 const broken=await zip.generateAsync({type:'nodebuffer'});
 const fullBroken=await inspectDocx(broken),lightBroken=await inspectDocx(broken,{nativeIndexOnly:true});
 assert.ok(fullBroken.objects[2].parseError);assert.equal(fullBroken.objects.at(-1).mainDocument,false);assert.deepEqual(index(lightBroken.objects),index(fullBroken.objects));
});

test('Native-only index rejects malformed package relationships, main XML and settings like full inspection',async()=>{
 for(const [name,value]of [['_rels/.rels','<bad'],['word/document.xml','<bad'],['word/settings.xml','<bad']]){
  const zip=await JSZip.loadAsync(source);zip.file(name,value);const broken=await zip.generateAsync({type:'nodebuffer'});
  await assert.rejects(inspectDocx(broken));await assert.rejects(inspectDocx(broken,{nativeIndexOnly:true}));
 }
});

test('Native-only index preserves acceptance when unused custom properties are malformed',async()=>{
 const zip=await JSZip.loadAsync(source);zip.file('docProps/custom.xml','<bad');
 const bytes=await zip.generateAsync({type:'nodebuffer'}),full=await inspectDocx(bytes),light=await inspectDocx(bytes,{nativeIndexOnly:true});
 assert.deepEqual(index(light.objects),index(full.objects));
});
