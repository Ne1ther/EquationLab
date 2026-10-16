import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {makeOle,inspectOle} from '../src/native.mjs';
import {makeNewOle,factoryTypography} from '../src/new-formula.mjs';
import {readTypography} from '../src/typography-native.mjs';
import {readEqp,writeEqp} from '../src/eqp.mjs';
import {operation} from '../src/server.mjs';

// Execute the actual task-pane handlers with a small inert DOM. No Word,
// browser, live localhost service, font helper or user document is accessed.
class Element {
 constructor(tag='div'){this.tagName=tag.toLowerCase();this.children=[];this.dataset={};this.className='';this.value='';this.hidden=false;this.attributes={};this.classList={add:()=>{},remove:()=>{},toggle:()=>{}};}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=[...children];}
 setAttribute(name,value){this.attributes[name]=String(value);}
 addEventListener(){}
 click(){this.clicks=(this.clicks||0)+1;}
 focus(){}
 querySelectorAll(selector){const found=[];for(const child of this.children){if(selector.startsWith('.')?child.className.split(' ').includes(selector.slice(1)):child.tagName===selector)found.push(child);found.push(...child.querySelectorAll(selector));}return found;}
 querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
}
async function pane({descriptorsAvailable=true,initialTypography=null}={}){
 const elements=new Map(),storage=new Map(),calls=[],downloads=[];
 if(initialTypography)storage.set('equationlab.typography',JSON.stringify(initialTypography));
 const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};get('formula').value='x^3';
 const document={getElementById:get,createElement:tag=>new Element(tag),querySelectorAll:()=>[]};
 class DownloadURL extends URL {static createObjectURL(blob){downloads.push(blob);return 'blob:inert-'+downloads.length;}static revokeObjectURL(){}}
 const context=vm.createContext({document,MathfieldElement:class {},URL:DownloadURL,URLSearchParams,Blob,location:{search:''},window:{},localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},setTimeout:()=>1,clearTimeout:()=>{},btoa:text=>Buffer.from(text,'binary').toString('base64'),unescape,encodeURIComponent});
 context.fetch=async(url,options)=>{
  const path=url.replace('/api/',''),body=JSON.parse(options.body);calls.push({path,body});
  try{
   if(path==='typography-descriptors'&&!descriptorsAvailable)throw Error('未知操作');
   let data;if(path==='validate'){const ole=makeNewOle(body.latex,body.typography);context.checkedOle=ole;data={nativeBytes:inspectOle(ole).native.length,svg:null};}
   else if(path==='event')data={ok:true};else data=await operation(path,body);
   return {ok:true,json:async()=>data};
  }catch(error){return {ok:false,json:async()=>({error:error.message})};}
 };
 vm.runInContext(readFileSync(new URL('../addin/taskpane.js',import.meta.url),'utf8'),context);
 const run=source=>vm.runInContext(source,context),flush=async()=>{await new Promise(resolve=>setImmediate(resolve));};
 await flush();
 return {get,calls,downloads,storage,context,run,flush,row:(kind,id)=>run(`dimensionRows(${JSON.stringify(kind)}).find(row=>Number(row.dataset.id)===${id})`),plain:source=>JSON.parse(JSON.stringify(run(source)))};
}

test('Task-pane descriptors expose all 33 slots and untouched controls produce no native patch',async()=>{
 const p=await pane(),descriptors=await operation('typography-descriptors',{});
 assert.equal(descriptors.spaces.length,30);assert.equal(descriptors.extraSizes.length,3);assert.deepEqual(descriptors.eqpUnits,['pt','%']);assert.match(descriptors.spacingPreview,/尚未全部/);
 assert.equal(p.run("dimensionRows('spaces').length"),30);assert.equal(p.run("dimensionRows('extraSizes').length"),3);assert.equal(p.run('typographyPatch()'),null);
 for(const id of [16,17,22])assert.deepEqual(p.row('spaces',id).querySelector('select').children.filter(o=>!o.disabled).map(o=>o.value),['%']);
 assert.match(p.get('spacing-preview-note').textContent,/尚未全部/);
});

test('An older running service keeps the original font controls usable without guessing spacing descriptors',async()=>{
 const p=await pane({descriptorsAvailable:false});assert.equal(p.get('type-styles').children.length,12);assert.equal(p.run("dimensionRows('sizes').length"),5);assert.equal(p.run("dimensionRows('spaces').length"),0);
 assert.equal(p.run('typographyPatch()'),null);assert.equal(p.get('typography-default').disabled,true);assert.match(p.get('spacing-preview-note').textContent,/原值保留/);
 assert.deepEqual(p.plain('currentTypography()'),factoryTypography());
});

test('Editing two controls sends only those slots and round-trips signed spacing/sub-point increments',async()=>{
 const p=await pane(),before=p.plain('typographyBase');
 p.row('spaces',18).querySelector('input').value='-3.750';p.row('spaces',18).querySelector('select').value='%';
 p.row('extraSizes',2).querySelector('input').value='0.375';p.row('extraSizes',2).querySelector('select').value='pt';
 const expected={spaces:{18:{value:'-3.750',unit:'%'}},extraSizes:{2:{value:'0.375',unit:'pt'}}};assert.deepEqual(p.plain('typographyPatch()'),expected);
 await p.run('validate()');assert.deepEqual(p.calls.filter(c=>c.path==='validate').at(-1).body.typography,expected);
 const written=readTypography(p.context.checkedOle);assert.deepEqual(written.spaces[18],{unit:'%',value:'-3.750'});assert.deepEqual(written.extraSizes[2],{unit:'pt',value:'0.375'});
 before.spaces[18]=written.spaces[18];before.extraSizes[2]=written.extraSizes[2];assert.deepEqual(p.plain('currentTypography()'),before);
});

test('Opaque and missing dimensions stay read-only, survive snapshots and never migrate into defaults',async()=>{
 const p=await pane(),base=p.plain('typographyBase');base.spaces[7]={unit:null,value:null,unsupported:true,rawNibbles:[13,1]};base.extraSizes.length=2;
 p.context.fixture=base;p.run('typography(fixture)');
 for(const [kind,id]of [['spaces',7],['extraSizes',2]]){const row=p.row(kind,id);assert.equal(row.dataset.readonly,'true');assert.equal(row.querySelector('input'),null);assert.equal(row.querySelector('select'),null);}
 assert.match(p.row('spaces',7).querySelector('output').textContent,/未知编码/);assert.match(p.row('extraSizes',2).querySelector('output').textContent,/未包含/);
 assert.equal(p.run('typographyPatch()'),null);assert.deepEqual(p.plain('currentTypography()'),base);
 await p.get('typography-default').onclick();const preset=JSON.parse(p.storage.get('equationlab.typography'));
 assert.equal(Object.hasOwn(preset.spaces,7),false);assert.equal(Object.hasOwn(preset.extraSizes,2),false);assert.equal(Object.keys(preset.spaces).length,29);assert.equal(Object.keys(preset.extraSizes).length,2);
 await p.get('eqp-export').onclick();assert.equal(p.downloads.length,0,'complete current export must reject opaque/missing native preferences');assert.match(p.get('status').textContent,/unknown|opaque|extraSizes/i);
});

test('EQP import stages all known slots; preserving export changes only later edits and retains unknown text',async()=>{
 const p=await pane(),source=readTypography(makeOle('x'));
 source.spaces[0]={unit:'%',value:'175.25'};source.extraSizes[0]={unit:'%',value:'92.5'};
 const text=writeEqp(source)+'\r\n; 用户备注\r\n[Future]\r\nAlienGap=never normalize me\r\n';
 p.get('eqp-file').files=[{name:'custom.eqp',size:Buffer.byteLength(text),text:async()=>text}];await p.get('eqp-file').onchange();
 assert.equal(p.run("typographySnapshot().spaces[0].value"),'175.25');assert.equal(p.run("typographySnapshot().extraSizes[0].value"),'92.5');assert.equal(p.get('eqp-preserve').hidden,false);assert.match(p.get('status').textContent,/33 项/);
 await p.get('eqp-preserve').onclick();assert.equal(await p.downloads.at(-1).text(),text,'no-op imported profile stays byte exact');
 p.row('spaces',0).querySelector('input').value='201.75';p.row('extraSizes',0).querySelector('input').value='86.25';
 await p.get('eqp-preserve').onclick();assert.equal(await p.downloads.at(-1).text(),text.replace('LineSpacing=175.25 %','LineSpacing=201.75 %').replace('User1=92.5 %','User1=86.25 %'));
 const body=p.calls.filter(c=>c.path==='eqp-export').at(-1).body;assert.deepEqual(body.typography,{spaces:{0:{unit:'%',value:'201.75'}},extraSizes:{0:{unit:'%',value:'86.25'}}});
 await p.get('eqp-export').onclick();const exported=readEqp(await p.downloads.at(-1).text());assert.equal(exported.spaces.LineSpacing.value,'201.75');assert.equal(exported.extraSizes.User1.value,'86.25');
});

test('New defaults include known 33 preferences, reload them, and reject invalid values before persistence',async()=>{
 const p=await pane();p.row('spaces',2).querySelector('input').value='47.5';p.row('extraSizes',1).querySelector('input').value='82.25';
 await p.get('typography-default').onclick();const saved=p.storage.get('equationlab.typography'),preset=JSON.parse(saved);
 assert.equal(Object.keys(preset.spaces).length,30);assert.equal(Object.keys(preset.extraSizes).length,3);assert.equal(preset.spaces[2].value,'47.5');assert.equal(preset.extraSizes[1].value,'82.25');
 p.run('reset()');await p.flush();assert.equal(p.row('spaces',2).querySelector('input').value,'47.5');assert.equal(p.row('extraSizes',1).querySelector('input').value,'82.25');
 p.row('spaces',0).querySelector('input').value='1e3';await p.get('typography-default').onclick();assert.equal(p.storage.get('equationlab.typography'),saved);assert.match(p.get('status').textContent,/decimal/i);
});

test('Unverified EQP units remain in the imported template and cannot be claimed as current export support',async()=>{
 const p=await pane(),native=readTypography(makeOle('x')),text=writeEqp(native).replace(/^LineSpacing=.*$/m,'LineSpacing=0.5 in').replace(/^SmallLargeIncr=.*$/m,'SmallLargeIncr=0.1 cm');
 const before=p.row('spaces',0).querySelector('input').value;p.get('eqp-file').files=[{name:'opaque-units.eqp',size:Buffer.byteLength(text),text:async()=>text}];await p.get('eqp-file').onchange();
 assert.equal(p.row('spaces',0).querySelector('input').value,before);assert.match(p.get('eqp-source-note').textContent,/2 项未识别/);await p.get('eqp-preserve').onclick();assert.equal(await p.downloads.at(-1).text(),text);
 const count=p.downloads.length;p.row('spaces',0).querySelector('input').value='0.5';p.row('spaces',0).querySelector('select').value='in';
 await p.get('eqp-export').onclick();assert.equal(p.downloads.length,count);assert.match(p.get('status').textContent,/pt\/%/);
 await p.get('eqp-preserve').onclick();assert.equal(p.downloads.length,count,'edited in/cm/pc is rejected even with originalText');
});

test('Factory restore, original settings and saved new defaults remain separate task-pane operations',async()=>{
 const custom={styles:{3:{font:'Arial',style:1}},sizes:{0:{unit:'pt',value:'24'},1:{unit:'pt',value:'6.5'}}},p=await pane({initialTypography:custom}),saved=p.storage.get('equationlab.typography');
 assert.equal(p.row('sizes',0).querySelector('input').value,'24');assert.equal(p.row('sizes',1).querySelector('select').value,'pt');assert.equal(p.storage.get('equationlab.typography'),saved);
 await p.get('typography-factory').onclick();assert.equal(p.run('typographyPatch()'),null);assert.equal(p.row('sizes',1).querySelector('select').value,'%');assert.equal(p.row('sizes',1).querySelector('input').value,'58');assert.equal(p.storage.get('equationlab.typography'),saved,'restoring the current panel must not replace saved custom defaults');
 p.get('typography-reset').onclick();assert.equal(p.row('sizes',1).querySelector('input').value,'6.5');assert.equal(p.row('sizes',0).querySelector('input').value,'24','original settings return to this new equation session\'s custom defaults');
 p.run('reset()');await p.flush();assert.equal(p.row('sizes',1).querySelector('input').value,'6.5');assert.equal(p.storage.get('equationlab.typography'),saved);
});

test('Loading a legacy equation keeps absolute source sizes and disables automatic factory reset',async()=>{
 const p=await pane(),ole=makeOle('x^3'),before=Buffer.from(ole),legacy=readTypography(ole);p.context.legacy=legacy;p.run('selectedObject={typography:legacy};loadTypography(legacy)');
 assert.equal(p.row('sizes',1).querySelector('select').value,'pt');assert.equal(p.row('sizes',1).querySelector('input').value,'7');assert.equal(p.get('typography-factory').disabled,true);assert.equal(p.run('typographyPatch()'),null);
 await p.get('typography-factory').onclick();assert.equal(p.run('typographyPatch()'),null);assert.match(p.get('status').textContent,/已有公式/);
 p.row('sizes',1).querySelector('input').value='9';p.get('typography-reset').onclick();assert.equal(p.row('sizes',1).querySelector('input').value,'7');assert.equal(p.run('typographyPatch()'),null);assert.deepEqual(ole,before);
});
