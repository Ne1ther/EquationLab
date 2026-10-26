import JSZip from 'jszip';
import {inflateRaw} from 'node:zlib';
import {promisify} from 'node:util';
const inflate=promisify(inflateRaw),MAX_PACKED=34_000_000,MAX_EXPANDED=128*1024*1024;
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(data){let value=0xffffffff;for(const byte of data)value=crcTable[(value^byte)&255]^(value>>>8);return (value^0xffffffff)>>>0;}
// The native reader has already removed images. Recheck all ZIP declarations
// and inflate each retained part with an explicit bound before parsing XML.
export async function checkedWordSnapshotZip(base64){
 const bytes=Buffer.from(base64,'base64');
 if(!bytes.length||bytes.length>MAX_PACKED||bytes.toString('base64')!==base64)throw Error('Invalid saved Word snapshot');
 let end=bytes.length-22;
 for(;end>=Math.max(0,bytes.length-65557);end--)if(bytes.readUInt32LE(end)===0x06054b50&&end+22+bytes.readUInt16LE(end+20)===bytes.length)break;
 if(end<Math.max(0,bytes.length-65557))throw Error('Invalid saved Word ZIP directory');
 const count=bytes.readUInt16LE(end+10),length=bytes.readUInt32LE(end+12),offset=bytes.readUInt32LE(end+16);
 if(bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6)||bytes.readUInt16LE(end+8)!==count||count===65535||offset+length!==end)throw Error('Invalid saved Word ZIP bounds');
 const zip=new JSZip(),names=new Set();let position=offset,total=0;
 for(let i=0;i<count;i++){
  if(position+46>end||bytes.readUInt32LE(position)!==0x02014b50)throw Error('Invalid saved Word ZIP entry');
  const flags=bytes.readUInt16LE(position+8),method=bytes.readUInt16LE(position+10),crc=bytes.readUInt32LE(position+16),packed=bytes.readUInt32LE(position+20),size=bytes.readUInt32LE(position+24),nameLength=bytes.readUInt16LE(position+28),extra=bytes.readUInt16LE(position+30),comment=bytes.readUInt16LE(position+32),local=bytes.readUInt32LE(position+42);
  if(flags&~0x080e||![0,8].includes(method)||!nameLength||position+46+nameLength+extra+comment>end||bytes.readUInt16LE(position+34))throw Error('Unsupported saved Word ZIP entry');
  const nameBytes=bytes.subarray(position+46,position+46+nameLength),name=new TextDecoder('utf8',{fatal:true}).decode(nameBytes);
  if(name.startsWith('/')||/[\\\x00:]/.test(name)||name.split('/').some(part=>part==='.'||part==='..')||names.has(name)||!(/\.(xml|rels|bin)$/i.test(name)))throw Error('Invalid saved Word snapshot part');
  names.add(name);total+=size;
  if(total>MAX_EXPANDED||size>MAX_EXPANDED||size===0xffffffff||packed===0xffffffff||local+30>offset||bytes.readUInt32LE(local)!==0x04034b50)throw Error('Oversized saved Word snapshot');
  const localNameLength=bytes.readUInt16LE(local+26),localExtra=bytes.readUInt16LE(local+28),start=local+30+localNameLength+localExtra;
  if(bytes.readUInt16LE(local+8)!==method||(bytes.readUInt16LE(local+6)&~8)!==(flags&~8)||localNameLength!==nameLength||!bytes.subarray(local+30,local+30+localNameLength).equals(nameBytes)||start+packed>offset)throw Error('Saved Word snapshot local entry mismatch');
  const compressed=bytes.subarray(start,start+packed);let data;
  try{data=method===8?await inflate(compressed,{maxOutputLength:Math.max(1,size)}):Buffer.from(compressed);}
  catch{throw Error('Invalid or oversized saved Word snapshot part');}
  if(data.length!==size||crc32(data)!==crc){data.fill(0);throw Error('Saved Word snapshot checksum mismatch');}
  zip.file(name,data,{createFolders:false});position+=46+nameLength+extra+comment;
 }
 if(position!==end||!names.has('_rels/.rels')||!names.has('[Content_Types].xml'))throw Error('Incomplete saved Word snapshot');
 return zip.generateAsync({type:'nodebuffer',compression:'STORE'});
}
