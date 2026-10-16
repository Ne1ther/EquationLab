import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {DOMParser} from '@xmldom/xmldom';
import JSZip from 'jszip';
import sharp from 'sharp';
import {standaloneNumber} from '../src/layout.mjs';
import {numberDocx,referenceDocx,flatOpc,NS} from '../src/document.mjs';
import {equationNumberTargets,equationNumberingContext} from '../src/word-numbering.mjs';
import {operation,localServer} from '../src/server.mjs';
import {factoryTypography} from '../src/new-formula.mjs';

const sources=Object.fromEntries(await Promise.all(['command-registry','word-actions','commands'].map(async name=>[name,await readFile(new URL(`../addin/${name}.js`,import.meta.url),'utf8')])));
function runtime(){const context=vm.createContext({});for(const name of ['command-registry','word-actions'])vm.runInContext(sources[name],context);return context;}
const plain=value=>JSON.parse(JSON.stringify(value));

test('Ribbon declares five groups and all 19 executable shared command routes with complete icon resources',async()=>{
 const context=runtime(),xml=await readFile(new URL('../addin/manifest.xml',import.meta.url),'utf8'),doc=new DOMParser().parseFromString(xml,'application/xml');
 const all=name=>Array.from(doc.getElementsByTagName(name)),registry=context.EquationLabCommands;
 const {APP_VERSION}=await import('../src/version.mjs');
 assert.equal(all('Version')[0].textContent,APP_VERSION+'.3');assert.equal(all('Group').length,5);assert.equal(all('Control').length,20);
 assert.equal(all('Runtime')[0].getAttribute('resid'),'Taskpane.Url');assert.equal(all('Runtime')[0].getAttribute('lifetime'),'long');assert.equal(all('FunctionFile')[0].getAttribute('resid'),'Taskpane.Url');assert.equal(all('TaskpaneId')[0].textContent,'Office.AutoShowTaskpaneWithDocument');
 const opener=all('Control').find(node=>node.getAttribute('id')==='EquationLab.OpenPane');assert.equal(opener.getElementsByTagName('Action')[0].getAttribute('xsi:type'),'ShowTaskpane');assert.equal(opener.getElementsByTagName('SourceLocation')[0].getAttribute('resid'),'Taskpane.Url');
 assert.match(xml,/<bt:Set Name="SharedRuntime" MinVersion="1.1"/);
 const resources=new Map([...all('bt:Image'),...all('bt:String'),...all('bt:Url')].map(node=>[node.getAttribute('id'),node.getAttribute('DefaultValue')]));
 for(const node of all('*'))if(node.hasAttribute('resid'))assert.ok(resources.has(node.getAttribute('resid')),node.getAttribute('resid'));
 for(const command of registry.commands){
  const control=all('Control').find(node=>node.getAttribute('id')===command.ribbonId);assert.ok(control,command.id);assert.equal(control.getElementsByTagName('FunctionName')[0].textContent,command.functionName);
  assert.equal(control.getElementsByTagName('Action')[0].getAttribute('xsi:type'),'ExecuteFunction');
 }
 for(const node of all('bt:Image').filter(n=>n.hasAttribute('DefaultValue'))){const path=new URL(node.getAttribute('DefaultValue')).pathname,size=Number(node.getAttribute('id').split('.').at(-1)),metadata=await sharp(new URL('../addin'+path,import.meta.url).pathname).metadata();assert.equal(metadata.width,size);assert.equal(metadata.height,size);assert.equal(metadata.hasAlpha,true);}
 const html=await readFile(new URL('../addin/taskpane.html',import.meta.url),'utf8');for(const command of registry.commands)assert.match(html,new RegExp('id="'+command.target+'"'),command.id);
 assert.ok(resources.get('Taskpane.Url').endsWith('/taskpane.html'));assert.match(html,/全部命令/);assert.match(await readFile(new URL('../addin/icons/lucide/LICENSE',import.meta.url),'utf8'),/ISC License/);
});

test('Every click dispatches again, direct actions share state and reject unavailable routes before mutation',async()=>{
 const {EquationLabCommands:registry}=runtime(),calls=[];let busy=false,ready=true;
 const dispatch=registry.createDispatcher({state:()=>({busy,ready,supports:(_name,v)=>v!=='1.5'}),showPane:async pane=>calls.push(['pane',pane]),focus:id=>calls.push(['focus',id]),execute:async name=>calls.push(['execute',name]),prepare:async mode=>calls.push(['prepare',mode])});
 await dispatch('edit-selected');await dispatch('edit-selected');assert.equal(calls.filter(([kind,name])=>kind==='execute'&&name==='read').length,2);
 await dispatch('insert-left');assert.deepEqual(calls.at(-2),['prepare','numbered-left']);assert.deepEqual(calls.at(-1),['focus','insert-layout']);
 const count=calls.length;await assert.rejects(dispatch('update-fields'),/1.5/);busy=true;await assert.rejects(dispatch('next-equation'),/正在处理/);busy=false;ready=false;await assert.rejects(dispatch('edit-selected'),/Word/);await assert.rejects(dispatch('invented'),/未知命令/);assert.equal(calls.length,count);
 await dispatch('typography');assert.deepEqual(calls.at(-1),['focus','typography-panel'],'preview users retain exact controls without Word');
});

test('All Office function handlers await actual dispatch and complete exactly once on success or error',async()=>{
 const context=runtime(),handlers=new Map(),calls=[];let release;
 context.Office={onReady:async()=>{},actions:{associate:(name,handler)=>handlers.set(name,handler)}};
 context.EquationLabRunCommand=async id=>{calls.push(id);if(id==='edit-selected')await new Promise(resolve=>release=resolve);if(id==='next-equation')throw Error('range blocked');};context.EquationLabCommandError=error=>calls.push(error.message);
 vm.runInContext(sources.commands,context);assert.equal(handlers.size,19);
 let completed=0;const pending=handlers.get('EquationLab_edit_selected')({completed:()=>completed++});await new Promise(resolve=>setImmediate(resolve));assert.equal(completed,0);release();await pending;assert.equal(completed,1);
 await handlers.get('EquationLab_next_equation')({completed:()=>completed++});assert.equal(completed,2);assert.deepEqual(calls,['edit-selected','next-equation','range blocked']);
});

test('Standalone numbers contain no fake OLE and remain actual, independently referenceable EL fields',async()=>{
 const number=standaloneNumber({numberFormat:'(#C1.#EI)',chapter:3,equation:9});assert.equal(number.numberText,'(3.IX)');assert.doesNotMatch(number.xml,/OLEObject|w:object|MTEqn/);assert.match(number.xml,/SEQ EquationLab \\n/);assert.match(number.xml,/bookmarkStart/);
 const docx=await numberDocx({numberFormat:'(#E1)',equation:4},true),zip=await JSZip.loadAsync(docx),doc=new DOMParser().parseFromString(await zip.file('word/document.xml').async('string'),'application/xml'),targets=equationNumberTargets(doc);
 assert.equal(targets.length,1);assert.equal(targets[0].numberText,'(4)');assert.match(targets[0].bookmarkName,/^EL_/);
 const inspected=await operation('inspect-selection',{ooxml:await flatOpc(docx)});assert.equal(inspected.objects.length,0);assert.deepEqual(inspected.numberTargets,targets);
 assert.deepEqual(inspected.numberingContext,{chapter:true,section:true,equation:true});assert.doesNotMatch(await zip.file('word/document.xml').async('string'),/SEQ EquationLab \\r 0/,'initializing chapter context must not implicitly restart equation numbering');
 const reference=await referenceDocx(targets[0].bookmarkName,{cachedText:targets[0].numberText}),refZip=await JSZip.loadAsync(reference);assert.match(await refZip.file('word/document.xml').async('string'),new RegExp('REF '+targets[0].bookmarkName));
 await assert.rejects(operation('number',{layout:{numberFormat:'(#C1)',equation:1}}),/equation|#E/i);
 assert.throws(()=>standaloneNumber({numberFormat:'(#E1)',equation:0}),/integer/);
});

test('Reference discovery recognizes Word complex fields and excludes original MT fields and coincidental bookmarks',()=>{
 const parse=xml=>new DOMParser().parseFromString(`<w:document xmlns:w="${NS.w}"><w:body>${xml}</w:body></w:document>`,'application/xml');
 const bookmark=(name,code)=>`<w:p><w:bookmarkStart w:id="1" w:name="${name}"/><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>${code}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>(7)</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:bookmarkEnd w:id="1"/></w:p>`;
 const doc=parse(bookmark('EL_Actual',' SEQ EquationLab \\n \\* ARABIC ')+bookmark('EL_NotOurs',' SEQ MTEqn \\n ')+bookmark('ZEqnNum123456',' SEQ EquationLab \\n ')+bookmark('EL_Reference',' REF EL_Actual \\h '));
 assert.deepEqual(equationNumberTargets(doc),[{bookmarkName:'EL_Actual',numberText:'(7)'}]);
 assert.deepEqual(equationNumberingContext(doc),{chapter:false,section:false,equation:true});
 const split=parse('<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> SEQ EL</w:instrText></w:r><w:r><w:instrText>Chapter \\r 3</w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>');assert.deepEqual(equationNumberingContext(split),{chapter:true,section:false,equation:false});
});

test('The real task pane initializes shared routes, expands exact controls and preserves an in-progress editor',async()=>{
 class Element{
  constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.className='';this.value='';this.hidden=false;this.attributes={};this.classList={add(){},remove(){},toggle(){}};}
  append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
  replaceChildren(...children){this.children=[];this.append(...children);}
  setAttribute(key,value){this.attributes[key]=String(value);}
  addEventListener(){}scrollIntoView(){}focus(){this.focused=true;}click(){}
  cloneNode(){const copy=new Element(this.tagName);Object.assign(copy,{disabled:this.disabled,textContent:this.textContent,title:this.title});copy.append(...this.children.map(child=>child.cloneNode()));return copy;}
  querySelectorAll(selector){const matches=node=>selector==='[data-command]'?!!node.dataset.command:selector==='[data-word]'?Object.hasOwn(node.dataset,'word'):selector==='[data-pane]'?!!node.dataset.pane:selector.startsWith('.')?node.className.split(' ').includes(selector.slice(1)):node.tagName===selector;return this.children.flatMap(child=>[...(matches(child)?[child]:[]),...child.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
 }
 const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};get('formula').value='x^3';for(const id of ['typography-panel','spacing-panel','conversion-panel','word-symbols','latex-panel'])get(id).tagName='details';get('latex-panel').append(get('latex'));
 const document={getElementById:get,createElement:tag=>new Element(tag),querySelectorAll:selector=>[...new Set([...nodes.values()].flatMap(node=>node.querySelectorAll(selector)))]},readyCallbacks=[],updates=[],downloads=[];
 class DownloadURL extends URL{static createObjectURL(blob){downloads.push(blob);return 'blob:inert';}static revokeObjectURL(){}}
 const context=vm.createContext({document,MathfieldElement:class {},URL:DownloadURL,URLSearchParams,Blob,location:{search:''},window:{},localStorage:{getItem:()=>null,setItem(){}},setTimeout:()=>1,clearTimeout(){},btoa:text=>Buffer.from(text,'binary').toString('base64'),unescape,encodeURIComponent,Office:{HostType:{Word:'Word'},onReady:callback=>{if(callback)readyCallbacks.push(callback);return Promise.resolve({host:'Word'});},context:{requirements:{isSetSupported:()=>true}},addin:{showAsTaskpane:async()=>{}},ribbon:{requestUpdate:async update=>updates.push(update)},actions:{associate(){}}}});
 context.fetch=async(url,options)=>{const path=url.replace('/api/','');const data=path==='typography-default'?factoryTypography():path==='typography-descriptors'?await operation(path,{}):path==='validate'?{nativeBytes:100,svg:null}:{ok:true};return {ok:true,json:async()=>data};};
 for(const name of ['command-registry','word-actions'])vm.runInContext(sources[name],context);vm.runInContext(await readFile(new URL('../addin/taskpane.js',import.meta.url),'utf8'),context);vm.runInContext(sources.commands,context);
 await Promise.all(readyCallbacks.map(callback=>callback({host:'Word',platform:'Mac'})));await new Promise(resolve=>setImmediate(resolve));
 assert.equal(get('shared-commands').children.length,5);assert.equal(get('word-symbol-grid').children.length,36);assert.equal(get('capability-items').children.length,12);assert.equal(get('unsupported-tools').children.length,5);
 await context.EquationLabRunCommand('insert-left');assert.equal(get('insert-layout').value,'numbered-left');assert.equal(get('formula').value,'x^3');
 await context.EquationLabRunCommand('typography');assert.equal(get('typography-panel').open,true);assert.equal(get('typography-panel').focused,true);
 await context.EquationLabRunCommand('spacing');assert.equal(get('spacing-panel').open,true);
 await context.EquationLabRunCommand('conversion-export');assert.equal(get('conversion-panel').open,true);get('open-latex').onclick();assert.equal(get('latex-panel').open,true);assert.equal(get('latex').focused,true);
 await get('export-svg').onclick();assert.equal(downloads.length,0,'a stale/missing native preview must not export');context.testSvg='<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>';vm.runInContext('valid=true;fontPreview(testSvg);controls()',context);await get('export-svg').onclick();assert.equal(downloads.length,1);assert.equal(downloads[0].type,'image/svg+xml;charset=utf-8');assert.match(await downloads[0].text(),/<path/);vm.runInContext('changed()',context);assert.equal(get('export-svg').disabled,true);await get('export-svg').onclick();assert.equal(downloads.length,1);
 await get('export-latex').onclick();assert.equal(await downloads[1].text(),'x^3');assert.equal(get('eqp-download').download,'EquationLab.tex');
 vm.runInContext('selectedObject={latex:"x"}',context);await assert.rejects(context.EquationLabRunCommand('insert-right'),/旧公式/);assert.equal(get('formula').value,'x^3');assert.ok(updates.length>0);
 context.Office.context.requirements.isSetSupported=(name,version)=>name==='WordApi'&&version==='1.1';await readyCallbacks[0]({host:'Word',platform:'Mac'});assert.match(get('runtime-note').textContent,/16.61/);assert.equal(get('scan').disabled,false);assert.equal(get('update').disabled,true);assert.equal(get('insert').disabled,true);await assert.rejects(context.EquationLabRunCommand('edit-selected'),/1.3/);await context.EquationLabRunCommand('capabilities');assert.equal(get('capability-list').focused,true);
});

function mockWord({empty=true,moveDuringBuild=false,outside=false,changeContent=false}={}){
 const writes=[];let currentId='original',content='snapshot',untracked=0;
 const paragraph={getRange(kind){assert.equal(kind,'Whole');return this;},getOoxml(){return {value:content};}};
 const range={paragraphs:{getFirst:()=>paragraph},track(){return this;},untrack(){untracked++;},load(){},get isEmpty(){return empty;},getOoxml(){throw Error('GeneralException at collapsed Range.getOoxml');},compareLocationWith(other){return {value:other===body?(outside?'Unrelated':'Inside'):currentId==='original'?'Equal':'After'};},insertText:(text,where)=>writes.push({kind:'text',text,where}),insertOoxml:(xml,where)=>writes.push({kind:'ooxml',xml,where})};
 const body={};const c={document:{getSelection:()=>range,body:{getRange:()=>body}},sync:async()=>{}};
 const context=runtime(),api=async path=>{if(path==='compare-selection')return {equal:!changeContent};throw Error('unexpected API');};
 const actions=context.EquationLabWordActions.create({Word:{run:async callback=>callback(c)},api,supports:()=>true});
 return {actions,writes,get untracked(){return untracked;},build:async()=>{if(moveDuringBuild)currentId='moved';return 'fragment';}};
}

test('Empty-selection insertion never replaces selected text, rejects moved ranges, changed content and other stories',async()=>{
 for(const options of [{empty:false},{moveDuringBuild:true},{outside:true},{changeContent:true}]){const fixture=mockWord(options);await assert.rejects(fixture.actions.atEmptySelection(fixture.build));assert.equal(fixture.writes.length,0,JSON.stringify(options));}
 const fixture=mockWord();await fixture.actions.atEmptySelection(fixture.build);assert.deepEqual(fixture.writes,[{kind:'ooxml',xml:'fragment',where:'Replace'}]);assert.equal(fixture.untracked,1);
 await fixture.actions.insertSymbol('α');assert.equal(fixture.writes.at(-1).text,'α');await assert.rejects(fixture.actions.insertSymbol('<script>'),/未授权/);assert.equal(fixture.writes.length,2);
});

test('Navigation uses ordered physical ranges and has no wrap at document boundaries',()=>{
 const {EquationLabWordActions:{candidateIndex}}=runtime();
 assert.equal(candidateIndex(['Before','Equal','After'],'next'),2);assert.equal(candidateIndex(['Before','Equal','After'],'previous'),0);
 assert.equal(candidateIndex(['AdjacentBefore','Inside','AdjacentAfter'],'next'),2);assert.equal(candidateIndex(['AdjacentBefore','Inside','AdjacentAfter'],'previous'),0);
 assert.equal(candidateIndex(['Before','Equal'],'next'),undefined);assert.equal(candidateIndex(['Equal','After'],'previous'),undefined);
 assert.equal(candidateIndex(['Unrelated','Contains'],'next'),undefined);
});

function navigationFixture({multiple=false,pictures=true,mixed=false,move=false}={}){
 const context=runtime(),selected=[],ranges=new Map();let current;
 class Range{
  constructor(id,start,end,objects=[],text=''){Object.assign(this,{id,start,end,objects,text});ranges.set(id,this);}
  track(){return this;}untrack(){}load(){}
  compareLocationWith(other){let value;if(this.start===other.start&&this.end===other.end)value='Equal';else if(this.start>=other.start&&this.end<=other.end)value='Inside';else if(this.end<other.start)value='Before';else if(this.end===other.start)value='AdjacentBefore';else if(this.start>other.end)value='After';else if(this.start===other.end)value='AdjacentAfter';else value='Contains';return {value};}
  getOoxml(){return {value:this.objects.length?`<OLEObject id="${this.id}"/>`:`<empty id="${this.id}"/>`};}
  select(){selected.push(this.id);current=this;}
 }
 const body=new Range('body',0,100),cursor=new Range('cursor',0,0);current=cursor;
 const object=()=>({part:'word/document.xml',nativeSha256:'identical-sha',layout:{owned:false},latex:'x'}),paragraphs=[];
 for(let index=0;index<(multiple?1:2);index++){
  const objects=multiple?[object(),object()]:[object()],paragraph=new Range('p'+index,10+index*30,25+index*30,objects,mixed?'正文':'');
  const items=pictures?objects.map((o,within)=>({getRange:()=>new Range('eq'+index+'-'+within,11+index*30+within*5,12+index*30+within*5,[o])})):[];
  paragraph.inlinePictures={items,load(){}};paragraphs.push({getRange:()=>paragraph});
 }
 const c={document:{getSelection:()=>current,body:{getRange:()=>body,paragraphs:{items:paragraphs,load(){}}}},sync:async()=>{}};
 const actions=context.EquationLabWordActions.create({Word:{run:async callback=>callback(c)},supports:()=>true,api:async(path,args)=>{if(path==='compare-selection')return {equal:true};if(path==='inspect-selection'){const id=/id="([^"]+)"/.exec(args.ooxml)[1];if(move)current=new Range('moved',99,99);return {objects:ranges.get(id).objects};}throw Error('unexpected API');}});
 return {actions,selected,setCursor:(start,end=start)=>current=new Range('new-cursor',start,end)};
}

test('Actual navigation selects the next physical object even when native bytes are identical',async()=>{
 const fixture=navigationFixture();await fixture.actions.navigate('next');await fixture.actions.navigate('next');assert.deepEqual(fixture.selected,['eq0-0','eq1-0']);
 const result=await fixture.actions.navigate('next');assert.equal(result.found,false);assert.deepEqual(fixture.selected,['eq0-0','eq1-0']);
 await fixture.actions.navigate('previous');assert.equal(fixture.selected.at(-1),'eq0-0');
 const sameParagraph=navigationFixture({multiple:true});await sameParagraph.actions.navigate('next');await sameParagraph.actions.navigate('next');assert.deepEqual(sameParagraph.selected,['eq0-0','eq0-1']);
});

test('Navigation preserves selection when ranges are ambiguous or the cursor moved; independent fallback is explicit',async()=>{
 for(const options of [{multiple:true,pictures:false},{mixed:true,pictures:false},{move:true}]){const fixture=navigationFixture(options);await assert.rejects(fixture.actions.navigate('next'));assert.deepEqual(fixture.selected,[]);}
 const insideMixed=navigationFixture({mixed:true,pictures:false});insideMixed.setCursor(15);await assert.rejects(insideMixed.actions.navigate('next'),/当前段落/);assert.deepEqual(insideMixed.selected,[]);
 const independent=navigationFixture({pictures:false});const result=await independent.actions.navigate('next');assert.equal(result.paragraphFallback,true);assert.deepEqual(independent.selected,['p0']);
});

test('Server serves only whitelisted command files and uniform ribbon variants',async()=>{
 const server=localServer({port:0});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 try{for(const file of ['/command-registry.js','/word-actions.js','/icons/number-left-80.png','/icons/spacing-16.png'])assert.equal((await fetch(base+file)).status,200,file);for(const file of ['/build-ribbon.mjs','/icons/lucide/sources.json','/icons/unknown-32.png','/icons/help-64.png'])assert.equal((await fetch(base+file)).status,404,file);}
 finally{await new Promise(resolve=>server.close(resolve));}
});
