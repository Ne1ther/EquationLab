import {inspectOle,wrapNative} from './native.mjs';
import {EQP_SPACING_KEYS,EQP_SIZE_KEYS} from './eqp.mjs';

const UNIT_NAMES=Object.freeze(['in','cm','pt','pc','%']);
const STYLE_LABELS=['Text','Function','Variable','L.C. Greek','U.C. Greek','Symbol','Vector-Matrix','Number','User 1','User 2','MT Extra','East Asian Text'];
const SPACE_LABELS=['行距','矩阵行距','矩阵列距','上标高度','下标深度','上下标间隔','上限高度','下限深度','上下限行距','分子高度','分母深度','分数线伸出量','分数线粗细','嵌套分数线粗细','斜式分数间隔','围栏伸出量','运算符间距（正常值百分比）','非运算符间距（正常值百分比）','字符宽度调整','最小间隔','根号垂直间隔','根号水平间隔','根号宽度（正常值百分比）','修饰符间隔','撇号高度','方框线粗细','删除线粗细','矩阵分隔线粗细','根号线粗细','水平围栏间隔'];
// The three percent-only fields are explicit in the published MTEF ordering
// and the vendor's Define Spacing help. Other per-field numeric limits were
// not published; no guessed factory min/max is attached to these descriptors.
export const TYPOGRAPHY_SPACES=Object.freeze(EQP_SPACING_KEYS.map((key,id)=>Object.freeze({id,key,label:SPACE_LABELS[id],units:Object.freeze([16,17,22].includes(id)?['%']:[...UNIT_NAMES]),range:null,rendering:'preserved-native-preference; exact layout not implemented'})));
export const TYPOGRAPHY_EXTRA_SIZES=Object.freeze(EQP_SIZE_KEYS.slice(5).map((key,id)=>Object.freeze({id,key,label:['用户字号 1','用户字号 2','缩小/放大增量'][id],units:UNIT_NAMES,range:id<2?'absolute: 2–127 pt; relative: positive':'positive increment; vendor maximum unknown'})));
// These ordinary Latin families use the Windows basic-codepage encoding that
// must ALREADY be declared in the source MTEF. Symbol/MT Extra use the officially
// predefined encodings 3/4. An unknown family never gets a guessed encoding.
export const TYPOGRAPHY_FONTS=Object.freeze(['Times New Roman','Arial','Calibri','Courier New','Cambria','Cambria Math','Symbol','MT Extra']);
const LATIN=new Set(TYPOGRAPHY_FONTS.filter(f=>!['Symbol','MT Extra'].includes(f)).map(f=>f.toLowerCase()));
const MAX_OLE_BYTES=16*1024*1024;
const cat=(...parts)=>Buffer.concat(parts.map(p=>Buffer.isBuffer(p)?p:Buffer.from(p)));
const uint=n=>{if(!Number.isInteger(n)||n<0||n>65535)throw Error('Invalid native font index');if(n<255)return Buffer.from([n]);const b=Buffer.alloc(3);b[0]=255;b.writeUInt16LE(n,1);return b;};
function object(value,label){if(!value||typeof value!=='object'||Array.isArray(value))throw Error(`Invalid ${label}`);return value;}
function dimensions(bytes,position){
 const start=position,count=bytes[position++],values=[];let digits=[],padding;
 while(values.length<count){
  if(position>=bytes.length)throw Error('Truncated typography dimension array');
  const b=bytes[position++];
  for(const [index,nibble]of [b>>4,b&15].entries()){
   if(values.length===count)break;
   if(nibble===15){if(!digits.length)throw Error('Empty typography dimension');values.push(digits);digits=[];if(values.length===count&&index===0)padding=b&15;}else digits.push(nibble);
  }
 }
 return {start,end:position,values,padding};
}
function valueOf(d){
 const unit=UNIT_NAMES[d[0]];if(!unit)throw Error(`Unknown native dimension unit ${d[0]}`);
 const value=d.slice(1).map(n=>n<10?String(n):n===10?'.':n===11?'-':null);
 if(value.some(v=>v===null)||!value.length||!/^\-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.join('')))throw Error('Unknown native dimension value');
 return {unit,value:value.join('')};
}
function preservedDimension(d){
 try{return valueOf(d);}catch{return {unit:UNIT_NAMES[d[0]]??null,value:null,unsupported:true,rawNibbles:[...d]};}
}
function encodeDimensions(values,source){
 if(source?.padding)throw Error('Cannot re-encode unknown native dimension padding; source unchanged');
 if(values.length>255)throw Error('Too many typography dimensions');
 const nibble=[];for(const d of values)nibble.push(...d,15);if(nibble.length%2)nibble.push(0);
 return cat([values.length],nibble.reduce((out,n,i)=>{if(!(i%2))out.push(n<<4|nibble[i+1]);return out;},[]));
}
function encodingName(index,encodings){return index===1?'MTCode':index===2?'Unknown':index===3?'Symbol':index===4?'MTExtra':encodings[index-5]?.name;}
function knownEncoding(index,encodings){return ['MTCode','Symbol','MTExtra','WinAllBasicCodePages','WinANSI'].includes(encodingName(index,encodings));}
function collect(nodes,predicate){const out=[];function walk(ns){for(const n of ns){if(predicate(n))out.push(n);if(n.children)walk(n.children);}}walk(nodes);return out;}
function state(ole){
 if(!Buffer.isBuffer(ole)&&!(ole instanceof Uint8Array))throw Error('Typography requires an OLE byte buffer');
 if(ole.length>MAX_OLE_BYTES)throw Error('OLE typography input exceeds 16 MiB');
 const source=inspectOle(ole),prefs=source.parsed.records.filter(n=>n.type===18);
 if(prefs.length!==1)throw Error('Typography requires exactly one top-level EQN_PREFS record');
 const pref=prefs[0];if(pref.options!==0)throw Error('Unknown EQN_PREFS options; source unchanged');
 if(collect(source.parsed.records,n=>n.type===18).length!==1)throw Error('Nested equation preference overrides are not supported');
 const fonts=collect(source.parsed.records,n=>n.type===17),encodings=collect(source.parsed.records,n=>n.type===19);
 if(pref.styles.length>255)throw Error('Invalid style definition count');
 for(const s of pref.styles){if(s.style&~3)throw Error('Unknown native character style bits');if(s.font>fonts.length)throw Error('Missing native font definition');if(s.font&&fonts[s.font-1].start>pref.start)throw Error('Style references a later native font definition');}
 const raw=source.data.subarray(pref.start,pref.end),sizes=dimensions(raw,2),spaces=dimensions(raw,sizes.end);
 if(sizes.values.length<5)throw Error('Equation preferences do not define all five standard sizes');
 // Standard sizes must be understood. Extra/future sizes and spacing retain
 // unknown dimensions as opaque values; only understood source slots may be
 // edited, and untouched raw nibbles are never normalized or repaired.
 sizes.values.slice(0,5).forEach(valueOf);
 return {...source,pref,raw,sizes,spaces,fonts,encodings,characters:collect(source.parsed.records,n=>n.type===2)};
}

/** Native preferences only. Positive typefaces use these style definitions;
 * negative typefaces, local SIZE/NUDGE and formula records remain independent. */
export function readTypography(ole){
 const s=state(ole);
 return {
  styles:STYLE_LABELS.map((label,i)=>{const style=s.pref.styles[i]||{font:0,style:0},font=s.fonts[style.font-1];return {id:i+1,label,font:font?.name||'',style:style.style,fontIndex:style.font,encoding:font?.encoding??null};}),
  sizes:s.sizes.values.slice(0,5).map(valueOf),
  spaces:s.spaces.values.map(preservedDimension),
  warnings:[...(s.spaces.values.some(d=>preservedDimension(d).unsupported)?['Unknown spacing dimensions are preserved as opaque raw nibbles; they are not interpreted or repaired.']:[]),...(s.sizes.values.slice(5).some(d=>preservedDimension(d).unsupported)?['Unknown extra size dimensions are preserved as opaque raw nibbles; they are not interpreted or repaired.']:[]),...(s.sizes.padding?['Unknown size-array padding is preserved; that array cannot be edited safely.']:[]),...(s.spaces.padding?['Unknown spacing-array padding is preserved; that array cannot be edited safely.']:[])],
  extraSizes:s.sizes.values.slice(5).map(preservedDimension),
  explicitStyleCount:collect(s.parsed.records,n=>n.type===8).length,
  localSizeCount:collect(s.parsed.records,n=>n.type===9).length,
  units:[...UNIT_NAMES],
  sourceApplication:s.parsed.application,
  scope:'equation-preferences; explicit per-character styles and local sizes are preserved'
 };
}
function sizePatch(value,id){
 object(value,'size patch');for(const k of Object.keys(value))if(!['unit','value'].includes(k))throw Error(`Unknown size option ${k}`);
 if(!['pt','%'].includes(value.unit)||id===0&&value.unit!=='pt')throw Error('Sizes support pt/%; Full size must be pt');
 const raw=typeof value.value==='number'?String(value.value):value.value;
 if(typeof raw!=='string'||raw.length>24||!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)||!Number.isFinite(Number(raw)))throw Error('Size value must be a finite positive decimal');
 const number=Number(raw),max=value.unit==='%'?1000:127,min=value.unit==='%'?1:2;
 if(number<min||number>max)throw Error(value.unit==='pt'?'Absolute size must be between 2 and 127 pt':'Relative size must be between 1 and 1000 percent');
 return [UNIT_NAMES.indexOf(value.unit),...[...raw].map(c=>c==='.'?10:Number(c))];
}
function extendedDimensionPatch(value,kind,id){
 object(value,'native dimension patch');for(const key of Object.keys(value))if(!['unit','value'].includes(key))throw Error(`Unknown native dimension option ${key}`);
 if(!UNIT_NAMES.includes(value.unit))throw Error('Unknown native dimension unit');
 const raw=typeof value.value==='number'?String(value.value):value.value;
 if(typeof raw!=='string'||raw.length>24||!/^\-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)||!Number.isFinite(Number(raw)))throw Error('Native dimension must be a finite decimal without units or exponent notation');
 const number=Number(raw);
 if(kind==='space'&&[16,17,22].includes(id)&&value.unit!=='%')throw Error('Normal-spacing factors must use percent');
 if(kind==='extra'){
  if(number<=0)throw Error('User sizes and the Small/Large increment must be positive');
  if(id<2&&value.unit!=='%'){
   const points=number*({in:72,cm:72/2.54,pt:1,pc:12}[value.unit]);
   if(points<2||points>127)throw Error('Absolute user size must be between 2 and 127 pt');
  }
 }
 return [UNIT_NAMES.indexOf(value.unit),...[...raw].map(c=>c==='.'?10:c==='-'?11:Number(c))];
}
function applyDimensions(edits,values,{offset=0,count,kind}){
 object(edits,kind+' dimension patches');let changed=false;
 for(const [key,edit]of Object.entries(edits)){
  if(!/^(?:0|[1-9]\d*)$/.test(key)||Number(key)>=count)throw Error('Invalid native dimension index');
  const id=Number(key),index=id+offset;
  if(!values[index])throw Error('Source does not define this native dimension; no defaults were inserted');
  const current=preservedDimension(values[index]);if(current.unsupported)throw Error('Cannot edit an opaque native dimension; source unchanged');
  const next=extendedDimensionPatch(edit,kind,id);
  if(typeof edit.value==='number'&&current.unit===edit.unit&&Number(current.value)===edit.value)continue;
  if(!Buffer.from(next).equals(Buffer.from(values[index]))){values[index]=next;changed=true;}
 }
 return changed;
}
function chooseFont(s,name,newFonts){
 if(typeof name!=='string'||name.length<1||name.length>128||/[\x00-\x1f]/.test(name))throw Error('Invalid font name');
 let index=s.fonts.findIndex(f=>f.name.toLowerCase()===name.toLowerCase())+1;
 if(index){if(!knownEncoding(s.fonts[index-1].encoding,s.encodings))throw Error('This font uses an unknown native encoding');return {index,encoding:s.fonts[index-1].encoding,name:s.fonts[index-1].name};}
 let encoding,canonical;
 if(name.toLowerCase()==='symbol'){encoding=3;canonical='Symbol';}
 else if(name.toLowerCase()==='mt extra'){encoding=4;canonical='MT Extra';}
 else if(LATIN.has(name.toLowerCase())){
  const at=s.encodings.findIndex(e=>e.name==='WinAllBasicCodePages');
  const ansi=s.encodings.findIndex(e=>e.name==='WinANSI');
  if(at<0&&ansi<0)throw Error('A declared Windows basic-codepage encoding is required for this new font');
  encoding=(at>=0?at:ansi)+5;canonical=TYPOGRAPHY_FONTS.find(f=>f.toLowerCase()===name.toLowerCase());
 }else throw Error(`Font ${name} has no verified native encoding mapping; source unchanged`);
 // Adding before EQN_PREFS would renumber FONT_DEF entries later in the formula.
 if(s.fonts.some(f=>f.start>s.pref.start))throw Error('Cannot append a font without renumbering later font definitions; source unchanged');
 const existing=newFonts.findIndex(f=>f.name===canonical&&f.encoding===encoding);
 if(existing>=0)return {index:s.fonts.length+existing+1,encoding,name:canonical};
 newFonts.push({name:canonical,encoding});return {index:s.fonts.length+newFonts.length,encoding,name:canonical};
}
function checkFontChange(s,id,before,after){
 if(!before.font||before.font===after.index)return;
 const old=s.fonts[before.font-1];
 for(const c of s.characters.filter(n=>n.typeface===id)){
  if(c.code===undefined)throw Error('Changing this font requires an unknown font-position mapping');
  if(c.code>=0xe000&&c.code<=0xf8ff)throw Error('Changing fonts for private MTCode glyphs requires an explicit mapping');
  if(c.fontPosition!==undefined&&c.fontPosition!==c.code&&old.encoding!==after.encoding)throw Error('Changing native encodings would invalidate an existing encoded character position');
 }
}

/** Patch top-level EQN_PREFS and append only necessary FONT_DEF records before
 * it. The complete formula suffix, local formatting, companions, CLSID and the
 * original 28-byte native header (except its data length) are preserved.
 * patch: {styles:{1..12:{font?:string,style?:0|1|2|3}},fullSize?:number,
 *         sizes:{0..4:{unit:'pt'|'%',value:number|decimalString}},
 *         spaces:{0..29:{unit:'in'|'cm'|'pt'|'pc'|'%',value:number|decimalString}},
 *         extraSizes:{0..2:{unit:'in'|'cm'|'pt'|'pc'|'%',value:number|decimalString}}}.
 * Spacing fields 16/17/22 accept percent only. Spacing's original numeric
 * bounds are not established; finite signed decimals (at most 24 characters)
 * are structurally writable, not a claim of original-dialog validation or
 * exact rendering. Unknown/missing source slots cannot be edited or filled.
 */
export function patchTypography(ole,patch){
 object(patch,'typography patch');for(const k of Object.keys(patch))if(!['styles','fullSize','sizes','spaces','extraSizes'].includes(k))throw Error(`Unknown typography option ${k}`);
 const s=state(ole),styles=s.pref.styles.map(x=>({...x})),sizes=s.sizes.values.map(x=>[...x]),spaces=s.spaces.values.map(x=>[...x]),newFonts=[];
 let styleChanged=false,sizeChanged=false,spaceChanged=false;
 if(patch.styles!==undefined){object(patch.styles,'styles patch');
  for(const [key,edit]of Object.entries(patch.styles)){
   if(!/^(?:[1-9]|1[0-2])$/.test(key))throw Error('Style ids must be integers from 1 through 12');
   const id=Number(key);object(edit,'style patch');for(const k of Object.keys(edit))if(!['font','style'].includes(k))throw Error(`Unknown style option ${k}`);
   if(!Object.keys(edit).length)throw Error('Style patch is empty');
   const old=styles[id-1]||{font:0,style:0};let next={...old};
   if(edit.font!==undefined){const font=chooseFont(s,edit.font,newFonts);checkFontChange(s,id,old,font);next.font=font.index;}
   if(edit.style!==undefined){if(!Number.isInteger(edit.style)||edit.style<0||edit.style>3)throw Error('Character style must be 0, 1, 2 or 3');if(!next.font)throw Error('Assign a font before formatting an unused style');next.style=edit.style;}
   if(next.font!==old.font||next.style!==old.style){while(styles.length<id)styles.push({font:0,style:0});styles[id-1]=next;styleChanged=true;}
  }
 }
 const edits={};
 if(patch.sizes!==undefined){object(patch.sizes,'sizes patch');for(const [key,edit]of Object.entries(patch.sizes)){if(!/^[0-4]$/.test(key))throw Error('Size ids must be integers from 0 through 4');edits[key]=edit;}}
 if(patch.fullSize!==undefined){if(typeof patch.fullSize!=='number')throw Error('fullSize must be a number in points');if(edits[0]!==undefined)throw Error('Specify Full size using either fullSize or sizes[0], not both');edits[0]={unit:'pt',value:patch.fullSize};}
 for(const [key,edit]of Object.entries(edits)){
  const id=Number(key),next=sizePatch(edit,id),current=valueOf(sizes[id]);
  if(typeof edit.value==='number'&&current.unit===edit.unit&&Number(current.value)===edit.value)continue;
  if(!Buffer.from(next).equals(Buffer.from(sizes[id]))){sizes[id]=next;sizeChanged=true;}
 }
 if(patch.extraSizes!==undefined)sizeChanged=applyDimensions(patch.extraSizes,sizes,{offset:5,count:3,kind:'extra'})||sizeChanged;
 if(patch.spaces!==undefined)spaceChanged=applyDimensions(patch.spaces,spaces,{count:30,kind:'space'});
 if(!styleChanged&&!sizeChanged&&!spaceChanged)return Buffer.from(ole);
 const sizeBytes=sizeChanged?encodeDimensions(sizes,s.sizes):s.raw.subarray(s.sizes.start,s.sizes.end);
 const spaceBytes=spaceChanged?encodeDimensions(spaces,s.spaces):s.raw.subarray(s.spaces.start,s.spaces.end);
 const styleBytes=styleChanged?cat([styles.length],...styles.map(x=>cat(uint(x.font),...(x.font?[[x.style]]:[])))):s.raw.subarray(s.spaces.end);
 const pref=cat([18,s.pref.options],sizeBytes,spaceBytes,styleBytes);
 const fontBytes=newFonts.map(f=>cat([17],uint(f.encoding),Buffer.from(f.name+'\0','utf8')));
 const data=cat(s.data.subarray(0,s.pref.start),...fontBytes,pref,s.data.subarray(s.pref.end));
 const header=Buffer.from(s.header);header.writeUInt32LE(data.length,8);
 const result=wrapNative(cat(header,data),ole),check=state(result);
 if(!check.data.subarray(check.pref.end).equals(s.data.subarray(s.pref.end)))throw Error('Typography validation failed: formula bytes changed');
 if(!check.header.subarray(0,8).equals(s.header.subarray(0,8))||!check.header.subarray(12).equals(s.header.subarray(12)))throw Error('Typography validation failed: native header changed');
 if(check.cfb.FileIndex[0].clsid!==s.cfb.FileIndex[0].clsid)throw Error('Typography validation failed: OLE class changed');
 for(const old of s.cfb.FileIndex.filter(e=>e.type===2&&e.name!=='Equation Native')){
  const index=s.cfb.FileIndex.indexOf(old),path=s.cfb.FullPaths[index],current=check.cfb.FileIndex[check.cfb.FullPaths.indexOf(path)];
  if(!current||!Buffer.from(current.content).equals(Buffer.from(old.content)))throw Error('Typography validation failed: companion stream changed');
 }
 return result;
}
