import {mkdir,lstat,readdir,open,rename,unlink,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {inspectOle,patchRuler} from './native.mjs';
import {makeNewOle} from './new-formula.mjs';
import {normalizeTypographyPatch} from './document-typography.mjs';
import {previewNumberFormat} from './layout.mjs';

const SCHEMA='equationlab.draft.v1',MAX_BYTES=4_000_000,TTL=14*86400_000;
const identifier=id=>{if(typeof id!=='string'||!/^\w{8}-\w{4}-\w{4}-\w{4}-\w{12}$/.test(id)||!/^[a-f0-9-]+$/i.test(id))throw Error('Invalid draft identifier');return id;};
const object=(value,label)=>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid '+label);return value;};
export function normalizeDraft(value){
 object(value,'draft');
 if(Object.keys(value).some(key=>!['latex','mode','typography','ruler','layout','replacements','outcomeUnknown'].includes(key)))throw Error('Unknown draft field');
 if(typeof value.latex!=='string'||value.latex.length>256_000||!['rebuild','characters'].includes(value.mode))throw Error('Invalid draft content');
 const result={latex:value.latex,mode:value.mode,outcomeUnknown:value.outcomeUnknown===true};
 if(value.typography!=null)result.typography=normalizeTypographyPatch(value.typography);
 if(value.ruler!==undefined){patchRuler(makeNewOle('x'),value.ruler);result.ruler=value.ruler;}
 if(value.layout!==undefined){
  const layout=object(value.layout,'draft layout');
  if(Object.keys(layout).some(key=>!['mode','numberFormat','chapter','section'].includes(key))||!['inline','display','numbered-left','numbered-right'].includes(layout.mode))throw Error('Invalid draft layout');
  if(typeof layout.numberFormat!=='string'||layout.numberFormat.length>128)throw Error('Invalid draft number format');
  for(const key of ['chapter','section'])if(!Number.isSafeInteger(layout[key])||layout[key]<1||layout[key]>32767)throw Error('Invalid draft counter');
  previewNumberFormat(layout.numberFormat,{chapter:layout.chapter,section:layout.section,equation:1});result.layout={...layout};
 }
 if(value.replacements!==undefined){
  object(value.replacements,'draft replacements');const entries=Object.entries(value.replacements);
  if(entries.length>20_000||entries.some(([key,text])=>!/^\d{1,8}$/.test(key)||typeof text!=='string'||text.length>32))throw Error('Invalid draft replacements');
  result.replacements=Object.fromEntries(entries);
 }
 return result;
}

// One record per editor launch prevents a new draft from overwriting an older
// recovery candidate. Only one equation is retained in each bounded record.
export function createDraftStore({directory=join(process.env.EQUATIONLAB_DATA_DIR||join(homedir(),'Library/Application Support/Equation Lab'),'drafts'),now=()=>Date.now()}={}){
 let tail=Promise.resolve();
 const serial=run=>{const next=tail.then(run);tail=next.catch(()=>{});return next;};
 const path=id=>join(directory,identifier(id)+'.json');
 const stagedPath=id=>join(directory,'restored-'+identifier(id)+'.docx');
 async function removeStage(id){const file=stagedPath(id),info=await lstat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(info?.isFile()&&!info.isSymbolicLink()&&info.uid===process.getuid())await unlink(file);}
 async function root(){
  await mkdir(directory,{recursive:true,mode:0o700});const info=await lstat(directory);
  if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==process.getuid())throw Error('Unsafe draft directory');
  await chmod(directory,0o700);
 }
 async function read(id){
  let handle;try{
   const file=path(id),info=await lstat(file);
   if(!info.isFile()||info.isSymbolicLink()||info.uid!==process.getuid()||info.size>MAX_BYTES)throw Error('Unsafe draft file');
   handle=await open(file,'r');const record=JSON.parse(await handle.readFile('utf8'));
   if(record.schema!==SCHEMA||record.id!==id||!Number.isFinite(record.updatedAt)||record.updatedAt>now()+60_000)throw Error('Invalid draft record');
   if(now()-record.updatedAt>TTL){await unlink(file);await removeStage(id);return null;}
   const draft=normalizeDraft(record.draft);
   let baseOle;
   if(record.baseOle!==undefined){
    if(typeof record.baseOle!=='string'||record.baseOle.length>3_000_000)throw Error('Invalid draft baseline');
    baseOle=Buffer.from(record.baseOle,'base64');if(baseOle.toString('base64')!==record.baseOle)throw Error('Invalid draft baseline');inspectOle(baseOle);
   }
   if(draft.mode==='characters'&&!baseOle)throw Error('The preserved structure is unavailable');
   return {...record,draft,...baseOle?{baseOle}:{}};
  }catch(error){if(error.code==='ENOENT')return null;throw error;}finally{await handle?.close();}
 }
 async function records(){
  await root();const result=[];
  for(const file of await readdir(directory))if(/^[a-f0-9-]{36}\.json$/i.test(file)){const id=file.slice(0,-5);try{const record=await read(id);if(record)result.push(record);}catch{/* An invalid record is never offered or overwritten. */}}
  return result.sort((a,b)=>b.updatedAt-a.updatedAt);
 }
 return {
  directory,
  save(id,value,baseOle){return serial(async()=>{
   await root();const draft=normalizeDraft(value);identifier(id);
   if(baseOle){inspectOle(baseOle);if(baseOle.length>2_250_000)throw Error('Draft baseline is too large');}
   if(draft.mode==='characters'&&!baseOle)throw Error('The preserved structure is unavailable');
   const record={schema:SCHEMA,id,updatedAt:now(),draft,...baseOle?{baseOle:baseOle.toString('base64')}:{}};
   const bytes=Buffer.from(JSON.stringify(record));if(bytes.length>MAX_BYTES)throw Error('Draft is too large');
   const destination=path(id),existing=await lstat(destination).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
   if(existing&&(!existing.isFile()||existing.isSymbolicLink()||existing.uid!==process.getuid()))throw Error('Unsafe draft file');
   const temporary=join(directory,'.'+randomUUID()+'.tmp');let handle;
   try{handle=await open(temporary,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;await rename(temporary,destination);}finally{await handle?.close();await unlink(temporary).catch(()=>{});}
   for(const old of (await records()).slice(10)){await unlink(path(old.id));await removeStage(old.id);}
   return {saved:true,updatedAt:record.updatedAt};
  });},
  status(exclude){return serial(async()=>{if(exclude)identifier(exclude);const candidates=(await records()).filter(record=>record.id!==exclude);const latest=candidates[0];return latest?{available:true,id:latest.id,updatedAt:latest.updatedAt,count:candidates.length,outcomeUnknown:latest.draft.outcomeUnknown,mode:latest.draft.mode}:{available:false,count:0};});},
  load(id){return serial(async()=>{await root();return read(identifier(id));});},
  stage(id,bytes){return serial(async()=>{await root();const file=stagedPath(id),info=await lstat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(info&&(!info.isFile()||info.isSymbolicLink()||info.uid!==process.getuid()))throw Error('Unsafe recovery source');const temporary=join(directory,'.'+randomUUID()+'.tmp');try{await open(temporary,'wx',0o600).then(async handle=>{try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}});await rename(temporary,file);}finally{await unlink(temporary).catch(()=>{});}return file;});},
  clear(id){return serial(async()=>{await root();const file=path(id),info=await lstat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(info&&(!info.isFile()||info.isSymbolicLink()||info.uid!==process.getuid()))throw Error('Unsafe draft file');if(info)await unlink(file);await removeStage(id);return {cleared:true};});}
 };
}
