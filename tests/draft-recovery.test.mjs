import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {mkdtemp,readFile,writeFile,stat,symlink,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createDraftStore} from '../src/draft-store.mjs';
import {makeNewOle} from '../src/new-formula.mjs';

const id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',other='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const sample={latex:'\\frac{x}{y}',mode:'rebuild',layout:{mode:'numbered-right',numberFormat:'(#C1.#E1)',chapter:3,section:1},ruler:[],outcomeUnknown:true};
test('draft records survive a new store instance, keep independent editors and preserve native structure',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'el-draft-'));try{
  const store=createDraftStore({directory}),ole=makeNewOle('x+1');
  await store.save(id,{...sample,mode:'characters',replacements:{4:'y'}},ole);
  await store.save(other,{...sample,latex:'new editor'});
  const restarted=createDraftStore({directory}),record=await restarted.load(id);
  assert.deepEqual(record.draft,{...sample,mode:'characters',replacements:{4:'y'}});assert.ok(record.baseOle.equals(ole));
  assert.equal((await restarted.status(other)).id,id);assert.equal((await stat(join(directory,id+'.json'))).mode&0o777,0o600);
  const text=await readFile(join(directory,id+'.json'),'utf8');assert.doesNotMatch(text,/ticket|documentPath|sourcePath/);
  await restarted.clear(id);assert.equal(await restarted.load(id),null);assert.equal((await restarted.load(other)).draft.latex,'new editor');
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('expired drafts disappear, invalid schemas and symlinks are never offered or followed',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'el-draft-'));let now=1_000_000;try{
  const store=createDraftStore({directory,now:()=>now});await store.save(id,sample);now+=15*86400_000;assert.equal((await store.status()).available,false);
  await writeFile(join(directory,id+'.json'),JSON.stringify({schema:'old-format',id,updatedAt:now,draft:sample}));
  assert.equal((await store.status()).available,false);await assert.rejects(store.load(id),/Invalid draft record/);
  await rm(join(directory,id+'.json'));const outside=join(directory,'original');await writeFile(outside,'untouched');await symlink(outside,join(directory,id+'.json'));
  await assert.rejects(store.save(id,sample),/Unsafe draft file/);await assert.rejects(store.clear(id),/Unsafe draft file/);assert.equal(await readFile(outside,'utf8'),'untouched');
  await assert.rejects(store.save('../escape',sample),/identifier/);await assert.rejects(store.save(other,{...sample,ticket:'never persist this'}),/Unknown draft field/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('atomic draft writes leave the previous valid record after invalid edits and no temporary files',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'el-draft-'));try{
  const store=createDraftStore({directory});await store.save(id,sample);
  await assert.rejects(store.save(id,{...sample,layout:{...sample.layout,chapter:0}}),/counter/);
  assert.equal((await store.load(id)).draft.latex,sample.latex);
  await assert.rejects(store.save(other,{...sample,mode:'characters'}),/structure/);
  assert.deepEqual(await readdir(directory),[id+'.json']);
 }finally{await rm(directory,{recursive:true,force:true});}
});

const controllerSource=await readFile(new URL('../desktop/draft-recovery.js',import.meta.url),'utf8');
function factory(options){const context=vm.createContext({setTimeout,clearTimeout});vm.runInContext(controllerSource,context);return context.createDraftRecovery(options);}
test('composition defers persistence; debounce and explicit flush save only the latest complete input',async()=>{
 let composing=false,current={draft:sample},callback;const calls=[];
 const recovery=factory({id,capture:()=>current,canCapture:()=>!composing,setTimer:fn=>{callback=fn;return 1;},clearTimer:()=>{callback=null;},native:async(action,payload)=>{calls.push({action,payload});return {available:false};}});
 await recovery.initialize();composing=true;recovery.schedule();assert.equal(await recovery.flush(),false);assert.equal(calls.length,1);
 composing=false;recovery.schedule();current={draft:{...sample,latex:'中文'}};recovery.schedule();assert.ok(callback);await recovery.flush();
 assert.equal(calls[1].action,'draftSave');assert.equal(calls[1].payload.draft.latex,'中文');await recovery.flush();assert.equal(calls.length,2);
 await recovery.clear();await recovery.flush();assert.equal(calls.at(-1).action,'draftSave','identical content after explicit discard can be backed up again');
});
test('recovery is explicit and never replays a Word mutation; failed restoration leaves the original record',async()=>{
 const calls=[],current={draft:sample};let applied=0;
 const recovery=factory({id,capture:()=>current,native:async(action,payload)=>{calls.push({action,payload});return action==='draftStatus'?{available:true,id:other}:action==='draftRestore'?{draft:sample}:{};}});
 await recovery.initialize();assert.equal(applied,0);
 await assert.rejects(recovery.restore(()=>{throw Error('cannot restore structure');}),/structure/);
 assert.equal(calls.some(call=>call.action==='draftClear'),false);
 assert.equal(await recovery.restore(()=>{applied++;return true;}),true);assert.equal(applied,1);
 assert.equal(calls.some(call=>/^wordSession/.test(call.action)),false);assert.equal(recovery.available.restored,true);
 await recovery.discardRecovery();assert.equal(calls.find(call=>call.action==='draftClear').payload.clientId,other);
});

test('a delayed or failed recovery lookup never blocks this launch from backing up a new draft',async()=>{
 let release;const lookup=new Promise(resolve=>{release=resolve;}),calls=[];
 const recovery=factory({id,capture:()=>({draft:sample}),native:async(action)=>{calls.push(action);return action==='draftStatus'?lookup:{};}});
 assert.equal(await recovery.flush(),false,'not initialized is not a successful flush');
 const initializing=recovery.initialize();assert.equal(await recovery.flush(),true);assert.deepEqual(calls,['draftStatus','draftSave']);
 release({available:false});await initializing;
 const failed=factory({id,capture:()=>({draft:sample}),native:async action=>{if(action==='draftStatus')throw Error('lookup failed');return {};}});
 await assert.rejects(failed.initialize(),/lookup failed/);assert.equal(await failed.flush(),true);
});

test('flush waits for a pending newer write before saving an undo back to the last saved value',async()=>{
 let current={draft:{...sample,latex:'A'}},release,started;const gate=new Promise(resolve=>{release=resolve;}),began=new Promise(resolve=>{started=resolve;}),disk=[];
 const recovery=factory({id,capture:()=>current,native:async(action,payload)=>{if(action==='draftStatus')return {available:false};if(action==='draftSave'){if(payload.draft.latex==='B'){started();await gate;}disk.push(payload.draft.latex);}return {};}});
 await recovery.initialize();await recovery.flush();current={draft:{...sample,latex:'B'}};const newer=recovery.flush();await began;
 current={draft:{...sample,latex:'A'}};let quitAccepted=false;const quitting=recovery.flush().then(result=>{quitAccepted=result;});
 await Promise.resolve();assert.equal(quitAccepted,false);release();await Promise.all([newer,quitting]);assert.deepEqual(disk,['A','B','A']);assert.equal(quitAccepted,true);
});

test('a clearing failure cannot be hidden by an empty-draft quit flush',async()=>{
 const recovery=factory({id,capture:()=>null,native:async action=>{if(action==='draftStatus')return {available:false};if(action==='draftClear')throw Error('disk unavailable');return {};}});
 await recovery.initialize();await assert.rejects(recovery.clear(),/disk unavailable/);await assert.rejects(recovery.flush(),/disk unavailable/);
});

test('a failed discard is retried before a later draft can be saved',async()=>{
 let fail=true,current={draft:{...sample,latex:'B'}};const actions=[];
 const recovery=factory({id,capture:()=>current,native:async(action,payload)=>{actions.push(action);if(action==='draftStatus')return {available:true,id:other};if(action==='draftClear'&&fail)throw Error('temporary failure');return {};}});
 await recovery.initialize();await assert.rejects(recovery.discardRecovery(),/temporary failure/);
 await assert.rejects(recovery.flush(),/temporary failure/);assert.equal(actions.includes('draftSave'),false);
 fail=false;await recovery.flush();assert.deepEqual(actions.slice(-2),['draftClear','draftSave']);
});
