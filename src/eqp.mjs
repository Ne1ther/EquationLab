/** MathType INI v1 preferences, anchored to all 12 shipped .eqp samples in
 * evidence/rea/command-parity-eqp.json. This module handles text only and never
 * executes software. Import returns 11 styles and 5 sizes as a native patch;
 * spacing and the last three sizes are returned separately for an editor to
 * explicitly stage/validate. Parsing alone never applies any preference.
 * WIRIS workflow: https://docs.wiris.com/en_US/dialogs
 * Unknown style flags (including unverified bold-italic spelling) stay opaque.
 */
export const EQP_STYLE_KEYS=Object.freeze(['Text','Function','Variable','LCGreek','UCGreek','Symbol','Vector','Number','User1','User2','MTExtra']);
export const EQP_SIZE_KEYS=Object.freeze(['Full','Script','ScriptScript','Symbol','SubSymbol','User1','User2','SmallLargeIncr']);
export const EQP_SPACING_KEYS=Object.freeze(['LineSpacing','MatrixRowSpacing','MatrixColSpacing','SuperscriptHeight','SubscriptDepth','SubSupGap','LimHeight','LimDepth','LimLineSpacing','NumerHeight','DenomDepth','FractBarOver','FractBarThick','SubFractBarThick','FractGap','FenceOver','OperSpacing','NonOperSpacing','CharWidth','MinGap','VertRadGap','HorizRadGap','RadWidth','EmbellGap','PrimeHeight','BoxStrokeThick','StikeThruThick','MatrixLineThick','RadStrokeThick','HorizFenceGap']);
const sectionKeys={styles:EQP_STYLE_KEYS,sizes:EQP_SIZE_KEYS,spacing:EQP_SPACING_KEYS};
const MAX_TEXT=1024*1024,MAX_LINES=20000;
const decimal=/^-?(?:\d+(?:\.\d*)?|\.\d+)$/;
function object(v,label){if(!v||typeof v!=='object'||Array.isArray(v))throw Error(`Invalid ${label}`);return v;}
function dimension(raw){
 const match=raw.match(/^(-?(?:\d+(?:\.\d*)?|\.\d+))\s+(pt|%)$/);
 if(!match||match[1].length>24||!Number.isFinite(Number(match[1])))throw Error('Unrecognized EQP dimension; only verified pt/% syntax can be applied');
 return {unit:match[2],value:match[1]};
}
function style(raw){
 const parts=raw.split(',').map(x=>x.trim());
 if(parts.length>2||!parts[0]||parts[0].length>128||/[\x00-\x1f;\[\]=]/.test(parts[0]))throw Error('Unrecognized EQP font/style syntax');
 const flag=parts[1]??'';if(!['','B','I'].includes(flag))throw Error('Unverified EQP character-style flag; preserved without applying it');
 return {font:parts[0],style:flag==='B'?1:flag==='I'?2:0};
}
function textModel(text){
 if(typeof text!=='string'||text.length>MAX_TEXT||text.includes('\0'))throw Error('EQP requires text of at most 1 MiB without NUL bytes');
 const lines=[],entries=[],sections=new Map(),knownKeys=new Set();let position=0,section='',header=false;
 while(position<text.length){
  if(lines.length>=MAX_LINES)throw Error('EQP line limit exceeded');
  const match=/([^\r\n]*)(\r\n|\r|\n|$)/y;match.lastIndex=position;const found=match.exec(text);
  const body=found[1],eol=found[2],parseBody=position===0?body.replace(/^\uFEFF/,''):body;
  const line={start:position,end:position+found[0].length,body,eol,number:lines.length+1};lines.push(line);position=line.end;
  if(/^\s*;\s*MathType INI v1\s*:\s*Equation Preferences\s*$/i.test(parseBody))header=true;
  if(!parseBody.trim()||/^\s*;/.test(parseBody))continue;
  const heading=parseBody.match(/^\s*\[([^\]\r\n]+)\]\s*$/);
  if(heading){
   if(section&&sections.has(section))sections.get(section).end=line.start;
   section=heading[1].trim().toLowerCase();
   if(Object.hasOwn(sectionKeys,section)&&sections.has(section))throw Error(`Duplicate EQP section ${heading[1]}`);
   sections.set(section,{start:line.start,end:text.length,label:heading[1]});continue;
  }
  const pair=body.match(/^([^=]+)=(.*)$/);
  if(!pair){entries.push({section,key:null,rawValue:body,line:line.number});continue;}
  const key=pair[1].trim(),value=pair[2],canonical=Object.hasOwn(sectionKeys,section)?sectionKeys[section].find(k=>k.toLowerCase()===key.toLowerCase()):undefined;
  if(canonical){const identity=section+'/'+canonical;if(knownKeys.has(identity))throw Error(`Duplicate EQP key ${key}`);knownKeys.add(identity);}
  const leading=value.match(/^\s*/)[0].length,trailing=value.match(/\s*$/)[0].length;
  const valueStart=line.start+pair[1].length+1+leading,valueEnd=value.trim()?line.start+body.length-trailing:valueStart;
  entries.push({section,key,canonical,rawValue:value,raw:value.trim(),line:line.number,valueStart,valueEnd});
 }
 if(!header)throw Error('Not a MathType INI v1 Equation Preferences file');
 return {text,lines,entries,sections,eol:lines.find(l=>l.eol)?.eol||'\r\n'};
}

/** Returns only successfully understood, applicable styles/sizes in typography.
 * spaces/extraSizes remain visible but are NOT included in that native patch.
 * Unknown keys, malformed values and unsupported units/flags remain in
 * originalText and have explicit entries in unsupported. Missing keys are not
 * replaced by invented defaults. */
export function readEqp(text){
 const model=textModel(text),styles={},sizes={},spaces={},extraSizes={},unsupported=[];
 const issue=(entry,reason,code)=>unsupported.push({section:entry.section,key:entry.key,line:entry.line,rawValue:entry.rawValue,code,reason,preserved:true,applied:false});
 for(const entry of model.entries){
  if(!entry.canonical){issue(entry,entry.key?'Unknown preference key or section; retained without applying it':'Unrecognized INI line; retained without applying it','unknown');continue;}
  try{
   if(entry.section==='styles')styles[EQP_STYLE_KEYS.indexOf(entry.canonical)+1]=style(entry.raw);
   else{
    const value=dimension(entry.raw),id=EQP_SIZE_KEYS.indexOf(entry.canonical);
    if(entry.section==='spacing'){spaces[entry.canonical]=value;issue(entry,'Spacing is preserved in the EQP file and is not applied by this typography import','spacing-not-applied');}
    else if(id>=5){extraSizes[entry.canonical]=value;issue(entry,'User sizes and the size increment are preserved and are not applied by this typography import','extra-size-not-applied');}
    else{
     const number=Number(value.value);
     if(id===0&&value.unit!=='pt'||number<(value.unit==='pt'?2:1)||number>(value.unit==='pt'?127:1000))throw Error('Size exceeds the supported native editing range (2–127 pt, 1–1000%, Full in pt)');
     sizes[id]=value;
    }
   }
  }catch(error){issue(entry,error.message,'unsupported-value');}
 }
 return {format:'MathType INI v1',typography:{styles,sizes},spaces,extraSizes,unsupported,originalText:text};
}

function patches(typography){
 object(typography,'EQP typography');
 const allowed=['styles','sizes','spaces','extraSizes','explicitStyleCount','localSizeCount','units','sourceApplication','scope','warnings'];
 for(const key of Object.keys(typography))if(!allowed.includes(key))throw Error(`Unknown EQP typography field ${key}`);
 const styles={},sizes={};
 if(typography.styles!==undefined){
  if(Array.isArray(typography.styles)){
   for(const entry of typography.styles){object(entry,'native style');const id=entry.id;
    if(id===12&&!entry.font)continue;
    if(!Number.isInteger(id)||id<1||id>11||Object.hasOwn(styles,id))throw Error('EQP supports unique style ids 1 through 11; assigned style 12 has no verified key');
    styles[id]=entry;
   }
  }else{
   object(typography.styles,'EQP styles');for(const [id,entry]of Object.entries(typography.styles)){
    if(!/^(?:[1-9]|1[01])$/.test(id))throw Error('EQP style ids must be from 1 through 11');styles[id]=object(entry,'style patch');
   }
  }
 }
 if(typography.sizes!==undefined){
  const values=Array.isArray(typography.sizes)?Object.entries(typography.sizes):Object.entries(object(typography.sizes,'EQP sizes'));
  for(const [id,entry]of values){if(!/^[0-4]$/.test(id))throw Error('EQP standard size ids must be from 0 through 4');sizes[id]=object(entry,'size patch');}
 }
 function dimensions(input,keys,label){
  const out={};if(input===undefined)return out;
  const entries=Object.entries(Array.isArray(input)?input:object(input,label));
  for(const [key,value]of entries){
   const id=/^(?:0|[1-9]\d*)$/.test(key)?Number(key):keys.indexOf(key);
   if(id<0||id>=keys.length||Object.hasOwn(out,id))throw Error(`Invalid or duplicate EQP ${label} key ${key}`);
   out[id]=object(value,label+' patch');
  }
  return out;
 }
 return {styles,sizes,spaces:dimensions(typography.spaces,EQP_SPACING_KEYS,'spacing'),extraSizes:dimensions(typography.extraSizes,EQP_SIZE_KEYS.slice(5),'extraSizes')};
}
function fontValue(edit,old){
 const allowed=['font','style','id','label','fontIndex','encoding'];for(const key of Object.keys(edit))if(!allowed.includes(key))throw Error(`Unknown EQP style field ${key}`);
 if(edit.font===undefined&&edit.style===undefined)throw Error('EQP style patch is empty');
 const font=edit.font!==undefined?edit.font:old?.font,bits=edit.style!==undefined?edit.style:old?.style;
 if(typeof font!=='string'||!font.trim()||font.length>128||/[\x00-\x1f,;\[\]=]/.test(font))throw Error('EQP style requires a valid font name');
 if(!Number.isInteger(bits)||bits<0||bits>3)throw Error('EQP style requires a character-style value');
 if(bits===3)throw Error('Bold-italic EQP flag syntax is not verified; cannot export it by guessing');
 return {value:font.trim()+(bits===1?',B':bits===2?',I':''),parsed:{font:font.trim(),style:bits}};
}
function dimensionValue(edit,kind,id){
 object(edit,'EQP dimension');for(const key of Object.keys(edit))if(!['unit','value'].includes(key))throw Error(`Unknown EQP dimension field ${key}`);
 const value=typeof edit.value==='number'?String(edit.value):edit.value;
 if(!['pt','%'].includes(edit.unit)||typeof value!=='string'||value.length>24||!decimal.test(value)||!Number.isFinite(Number(value)))throw Error('Cannot export unknown or opaque EQP dimension; only verified pt/% values are supported');
 const number=Number(value);
 if(kind==='standard'&&(id===0&&edit.unit!=='pt'||number<(edit.unit==='pt'?2:1)||number>(edit.unit==='pt'?127:1000)))throw Error('EQP size is outside the supported native range');
 if(kind==='extra'&&number<=0)throw Error('EQP extra sizes must be positive');
 return {value:value+' '+edit.unit,parsed:{unit:edit.unit,value}};
}
function fullDimensions(input,keys,label){
 if(Array.isArray(input)){
  if(input.length!==keys.length)throw Error(`Complete ${label} array with ${keys.length} entries is required for a new EQP`);
  return input;
 }
 object(input,label);const values=keys.map(key=>input[key]);
 if(Object.keys(input).length!==keys.length||values.some(v=>v===undefined))throw Error(`Complete ${label} keys are required for a new EQP`);
 return values;
}

/** With originalText, only explicitly supplied known preferences are patched,
 * including partial spacing/extra-size maps (native numeric ids or EQP keys).
 * Every unrelated value/unknown/comment/line-ending byte remains unchanged.
 * Native readTypography arrays are accepted; unused style 12 is skipped.
 * Without originalText, ALL 11 styles, 5 sizes, 30 spaces and 3 extraSizes must
 * be supplied. Opaque dimensions and unverified style flags reject export;
 * there is no fallback that substitutes factory settings for user settings. */
export function writeEqp(typography,originalText){
 const edit=patches(typography);
 if(originalText===undefined){
  const styleLines=EQP_STYLE_KEYS.map((key,i)=>{if(!edit.styles[i+1])throw Error('All 11 styles are required for a new EQP');return key+'='+fontValue(edit.styles[i+1]).value;});
  const sizeLines=EQP_SIZE_KEYS.slice(0,5).map((key,i)=>{if(!edit.sizes[i])throw Error('All five standard sizes are required for a new EQP');return key+'='+dimensionValue(edit.sizes[i],'standard',i).value;});
  fullDimensions(typography.extraSizes,EQP_SIZE_KEYS.slice(5),'extraSizes').forEach((value,i)=>sizeLines.push(EQP_SIZE_KEYS[i+5]+'='+dimensionValue(value,'extra',i).value));
  const spaceLines=fullDimensions(typography.spaces,EQP_SPACING_KEYS,'spacing').map((value,i)=>EQP_SPACING_KEYS[i]+'='+dimensionValue(value,'spacing',i).value);
  return ['; MathType INI v1: Equation Preferences','; Saved by EquationLab from the supplied equation preferences.','','[Styles]',...styleLines,'','[Sizes]',...sizeLines,'','[Spacing]',...spaceLines,''].join('\r\n');
 }
 const model=textModel(originalText),parsed=readEqp(originalText),old=parsed.typography,replacements=[],additions=new Map();
 const insert=(position,value)=>{const existing=replacements.find(r=>r.start===position&&r.end===position);if(existing)existing.value+=value;else replacements.push({start:position,end:position,value});};
 function change(section,key,next,same){
  const entry=model.entries.find(e=>e.section===section&&e.canonical===key);
  if(entry){if(!same)replacements.push({start:entry.valueStart,end:entry.valueEnd,value:next});}
  else{if(!additions.has(section))additions.set(section,[]);additions.get(section).push(key+'='+next);}
 }
 for(const [id,value]of Object.entries(edit.styles)){
  const next=fontValue(value,old.styles[id]),before=old.styles[id];
  change('styles',EQP_STYLE_KEYS[Number(id)-1],next.value,!!before&&before.font===next.parsed.font&&before.style===next.parsed.style);
 }
 for(const [id,value]of Object.entries(edit.sizes)){
  const next=dimensionValue(value,'standard',Number(id)),before=old.sizes[id];
  const same=!!before&&before.unit===next.parsed.unit&&(typeof value.value==='number'?Number(before.value)===value.value:before.value===next.parsed.value);
  change('sizes',EQP_SIZE_KEYS[Number(id)],next.value,same);
 }
 for(const [kind,section,keys,baseline]of [['extraSizes','sizes',EQP_SIZE_KEYS.slice(5),parsed.extraSizes],['spaces','spacing',EQP_SPACING_KEYS,parsed.spaces]]){
  for(const [id,value]of Object.entries(edit[kind])){
   const key=keys[Number(id)],next=dimensionValue(value,kind==='spaces'?'spacing':'extra',Number(id)),before=baseline[key];
   const same=!!before&&before.unit===next.parsed.unit&&(typeof value.value==='number'?Number(before.value)===value.value:before.value===next.parsed.value);
   change(section,key,next.value,same);
  }
 }
 let append='';
 for(const [section,values]of additions){
  const at=model.sections.get(section),body=values.join(model.eol)+model.eol;
  if(at){const prefix=at.end&&!/[\r\n]/.test(originalText[at.end-1])?model.eol:'';insert(at.end,prefix+body);}
  else append+=(append?'':originalText&&!/[\r\n]$/.test(originalText)?model.eol:'')+'['+({styles:'Styles',sizes:'Sizes',spacing:'Spacing'}[section])+']'+model.eol+body;
 }
 if(append)insert(originalText.length,append);
 let result=originalText;for(const replacement of replacements.sort((a,b)=>b.start-a.start))result=result.slice(0,replacement.start)+replacement.value+result.slice(replacement.end);
 return result;
}
