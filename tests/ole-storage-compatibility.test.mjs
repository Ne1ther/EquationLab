import assert from 'node:assert/strict';
import test from 'node:test';
import CFB from 'cfb';
import JSZip from 'jszip';
import {createDocx,editDocxBatch,inspectDocx,NS} from '../src/document.mjs';
import {nativePdf,renderNative} from '../src/font-renderer.mjs';
import {makeNewOle} from '../src/new-formula.mjs';
import {inspectOle,makeOle,template,wrapNative} from '../src/native.mjs';

const cases = String.raw`\frac{\mathrm{d}N^*}{\mathrm{d}D} = \begin{cases} \dfrac{N^* \phi \eta'(D)}{\eta(D)^2 [\phi/\eta(D) - \rho/\alpha]} > 0, & N^* < \bar{N}_Z, \\ \dfrac{N^* \eta'(D)}{\eta(D)} > 0, & N^* > \bar{N}_Z \end{cases}`;
const free = -1;
const end = -2;

// Read v3 sector chains directly, independent of the CFB parser used by the app.
function readStorage(file) {
  assert.equal(file.subarray(0,8).toString('hex'),'d0cf11e0a1b11ae1');
  assert.equal(file.readUInt16LE(26),3);
  const sectorSize=2**file.readUInt16LE(30),miniSize=2**file.readUInt16LE(32);
  assert.equal(sectorSize,512);
  assert.equal(miniSize,64);
  const sector=(id)=>{
    assert.ok(id>=0&&id<file.length/sectorSize-1,`sector ${id} must exist`);
    return file.subarray((id+1)*sectorSize,(id+2)*sectorSize);
  };
  const ints=(buffer)=>Array.from({length:buffer.length/4},(_,i)=>buffer.readInt32LE(i*4));
  const difatCount=file.readUInt32LE(72),difatIds=[],fatIds=ints(file.subarray(76,512));
  let difat=file.readInt32LE(68);
  for(let i=0;i<difatCount;i++){
    difatIds.push(difat);
    const entries=ints(sector(difat));
    difat=entries.pop();
    fatIds.push(...entries);
  }
  assert.equal(difat,end);
  const fatCount=file.readUInt32LE(44);
  assert.ok(fatIds.splice(fatCount).every(id=>id===free));
  const fat=fatIds.flatMap(id=>ints(sector(id)));
  for(const id of fatIds)assert.equal(fat[id],-3);
  for(const id of difatIds)assert.equal(fat[id],-4);
  const seen=new Set([...fatIds,...difatIds]);
  const seenMini=new Set();
  function chain(start,table,seen,size,readSector,count){
    const entries=[];
    for(let id=start;id!==end;id=table[id]){
      assert.ok(id>=0&&id<table.length&&!seen.has(id),`invalid or reused sector ${id}`);
      seen.add(id);
      entries.push(readSector(id));
    }
    if(count!==undefined)assert.equal(entries.length,count);
    if(size!==undefined)assert.equal(entries.length,Math.ceil(size/entries[0]?.length)||0);
    return Buffer.concat(entries).subarray(0,size);
  }
  const directory=chain(file.readInt32LE(48),fat,seen,undefined,sector);
  const miniFat=ints(chain(file.readInt32LE(60),fat,seen,undefined,sector,file.readUInt32LE(64)));
  const miniStream=chain(directory.readInt32LE(116),fat,seen,directory.readUInt32LE(120),sector);
  const cutoff=file.readUInt32LE(56);
  assert.equal(cutoff,4096);
  const streams=new Map();
  for(let i=128;i<directory.length;i+=128){
    const entry=directory.subarray(i,i+128);
    if(entry[66]!==2)continue;
    const name=entry.subarray(0,entry.readUInt16LE(64)-2).toString('utf16le');
    const start=entry.readInt32LE(116),size=entry.readUInt32LE(120),regular=size>=cutoff;
    assert.equal(entry.readUInt32LE(124),0);
    const contents=regular?chain(start,fat,seen,size,sector):
      chain(start,miniFat,seenMini,size,(id)=>{
        assert.ok((id+1)*miniSize<=miniStream.length);
        return miniStream.subarray(id*miniSize,(id+1)*miniSize);
      });
    assert.equal(contents.length,size);
    streams.set(name,{contents,regular});
  }
  assert.ok(fat.every((entry,i)=>seen.has(i)||entry===free),'unused FAT entries must be FREESECT');
  assert.ok(miniFat.every((entry,i)=>seenMini.has(i)||entry===free),'unused MiniFAT entries must be FREESECT');
  return {streams,difatCount,classId:directory.subarray(80,96).toString('hex')};
}

function checkNativeHeader(native){
  assert.equal(native.readUInt16LE(0),28);
  assert.equal(native.readUInt32LE(2),0x20000);
  assert.equal(native.readUInt32LE(8),native.length-28);
}

function checkMathTypeStorage(ole){
  const {streams,classId,difatCount}=readStorage(ole);
  assert.equal(classId,'03ce020000000000c000000000000046');
  for(const name of ['\x01CompObj','\x01Ole','\x03ObjInfo']){
    assert.deepEqual(streams.get(name).contents,Buffer.from(template.streams[name],'base64'));
  }
  assert.ok(streams.get('\x01CompObj').contents.includes(Buffer.from('Equation.DSMT4\0')));
  const native=streams.get('Equation Native');
  checkNativeHeader(native.contents);
  assert.deepEqual(inspectOle(ole).native,native.contents);
  return {native,streams,difatCount};
}

function allNodes(nodes){return nodes.flatMap(n=>[n,...allNodes(n.children??[])]);}

test('reported cases formula and a larger real matrix retain native DOCX relationships and cell structure',async()=>{
  const [first,rows]=cases.split('\\begin{cases}'),body=rows.replace('\\end{cases}','').trim();
  const large=`${first}\\begin{cases}${Array(10).fill(body).join('\\\\')}\\end{cases}`;
  const bytes=await createDocx([{latex:cases},{latex:large}]),docx=await JSZip.loadAsync(bytes);
  const xml=await docx.file('word/document.xml').async('string');
  const rels=await docx.file('word/_rels/document.xml.rels').async('string');
  for(const [number,rowCount] of [[1,2],[2,20]]){
    assert.match(xml,new RegExp(`ProgID="Equation.DSMT4"[^>]+r:id="rOle${number}"`));
    assert.ok(rels.includes(`Target="embeddings/oleObject${number}.bin"`));
    assert.ok(docx.file(`word/media/image${number}.png`));
    const ole=await docx.file(`word/embeddings/oleObject${number}.bin`).async('nodebuffer');
    const {native}=checkMathTypeStorage(ole);
    assert.equal(native.regular,number===2);
    const nodes=allNodes(inspectOle(ole).parsed.records);
    const brace=nodes.find(node=>node.type===3&&node.selector===2);
    assert.equal(brace.variation,1);
    const matrix=allNodes(brace.children).find(node=>node.type===5);
    assert.equal(matrix.rows,rowCount);
    assert.equal(matrix.cols,2);
    assert.equal(matrix.children.filter(node=>node.type===1).length,rowCount*2);
    assert.equal(nodes.filter(node=>node.type===3&&node.selector===11).length,1+rowCount);
  }
  const {objects}=await inspectDocx(bytes),[small,tall]=objects;
  const box=object=>{
    const dimensions=Object.fromEntries([...object.shape.getAttribute('style').matchAll(/(width|height):([\d.]+)pt/g)].map(([,key,value])=>[key,Number(value)]));
    const run=object.element.parentNode.parentNode;
    return {...dimensions,depth:-Number(run.getElementsByTagNameNS(NS.w,'position')[0].getAttributeNS(NS.w,'val'))/2};
  };
  const smallPreview=await renderNative(small.ole,{raster:false}),natural=await renderNative(tall.ole);
  const bodyHeight=(16838-2*1440)/20;
  const smallBox=box(small),fitted=box(tall);
  assert.equal(smallBox.height,Number(smallPreview.height.toFixed(3)));
  assert.ok(natural.height+natural.depth>bodyHeight,'unscaled case exceeds the Word line budget');
  assert.ok(fitted.height+fitted.depth<bodyHeight-20,'the picture and baseline offset fit together');
  assert.ok(Math.abs(fitted.width/fitted.height-natural.width/natural.height)<1e-5);
  assert.deepEqual(await docx.file(tall.imagePath).async('nodebuffer'),natural.png,'fitting leaves the complete raster intact');
  assert.deepEqual(inspectOle(tall.ole).native,inspectOle(makeNewOle(large)).native,'fitting leaves Native intact');

  const live=await nativePdf(tall.ole,{forWord:true}),exported=await nativePdf(tall.ole);
  assert.equal(live.height,Math.round(fitted.height*2540/72));
  assert.equal(exported.height,Math.round(natural.height*2540/72));
  const mediaBox=/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(Buffer.from(live.pdf,'base64').toString('latin1'));
  assert.ok(mediaBox,'the live Word carrier has a physical MediaBox');
  assert.ok(Math.abs(Number(mediaBox[1])-fitted.width)<.001);
  assert.ok(Math.abs(Number(mediaBox[2])-fitted.height)<.001);

  docx.file('word/document.xml',xml.replace('w:h="16838"','w:h="12800"').replace('height:'+fitted.height.toFixed(3)+'pt','height:'+fitted.height.toFixed(3)+'pt;visibility:visible'));
  const narrower=await docx.generateAsync({type:'nodebuffer'});
  const {bytes:edited}=await editDocxBatch(narrower,[{index:1,expectedNativeSha256:tall.nativeSha256,latex:large+'+1'}]);
  const refreshed=(await inspectDocx(edited)).objects[1],refreshedBox=box(refreshed);
  assert.ok(refreshedBox.height+refreshedBox.depth<((12800-2*1440)/20)-20);
  assert.match(refreshed.shape.getAttribute('style'),/visibility:visible/);
  assert.match(refreshed.latex,/\+1$/);
});

function nativeAtSize(size){
  const base=inspectOle(makeOle('x')).native, extra=size-base.length;
  const count=Math.floor((extra-2)/5),payload=Buffer.alloc(extra-count*5-2);
  const native=inspectOle(makeOle('x'.repeat(count+1))).native;
  // One small future-extension record adjusts the last few bytes at the cutoff.
  const result=Buffer.concat([native.subarray(0,-1),Buffer.from([100,payload.length]),payload,native.subarray(-1)]);
  result.writeUInt32LE(result.length-28,8);
  assert.equal(result.length,size);
  return result;
}

test('mini FAT and regular FAT use the exact cutoff and survive edits across it',()=>{
  let previous;
  for(const size of [4095,4096,4097,4095]){
    const expected=nativeAtSize(size),next=wrapNative(expected,previous);
    const {native}=checkMathTypeStorage(next);
    assert.equal(native.regular,size>=4096);
    assert.deepEqual(native.contents,expected);
    previous=next;
  }
});

test('32-bit MTEF length and one or two DIFAT sectors preserve large streams and companion bytes',()=>{
  const ole=makeOle('x'.repeat(14000)),source=CFB.read(ole,{type:'buffer'});
  const native=inspectOle(ole).native;
  assert.ok(native.readUInt32LE(8)>65535);
 for(const [megabytes,difatCount] of [[7,1],[16,2]]){
  const largeCompanion=Buffer.alloc(megabytes*1024*1024,0xa5);
  CFB.utils.cfb_add(source,'Opaque data',largeCompanion);
  const updated=wrapNative(native,CFB.write(source,{type:'buffer'}));
  const checked=checkMathTypeStorage(updated);
  assert.equal(checked.difatCount,difatCount);
  assert.deepEqual(checked.native.contents,native);
  assert.deepEqual(checked.streams.get('Opaque data').contents,largeCompanion);
 }
});

test('zero-length companion streams keep their directory entries without claiming a mini sector',()=>{
 const ole=makeOle('x'),source=CFB.read(ole,{type:'buffer'});
 CFB.utils.cfb_add(source,'Empty companion',Buffer.alloc(0));
 const native=nativeAtSize(4096);
 const updated=wrapNative(native,CFB.write(source,{type:'buffer'}));
  const checked=checkMathTypeStorage(updated);
  assert.deepEqual(checked.native.contents,native);
 assert.deepEqual(checked.streams.get('Empty companion'),{contents:Buffer.alloc(0),regular:false});
});
