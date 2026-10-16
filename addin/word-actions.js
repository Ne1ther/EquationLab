/* Word operations shared by command routes. No host or clipboard access on load. */
(() => {
 const inside=new Set(['Inside','InsideStart','InsideEnd','Equal']);
 const directions={previous:new Set(['Before','AdjacentBefore']),next:new Set(['After','AdjacentAfter'])};
 const symbols=Object.freeze(['α','β','γ','δ','ε','θ','λ','μ','π','σ','φ','ω','∞','≤','≥','≠','≈','±','×','÷','∈','∉','⊂','⊆','∪','∩','∅','∀','∃','∂','∇','∫','∑','∏','→','⇒']);
 function candidateIndex(relations,direction){
  if(!directions[direction])throw Error('未知浏览方向');
  const indexes=relations.map((relation,index)=>directions[direction].has(relation)?index:-1).filter(index=>index>=0);
  return direction==='previous'?indexes.at(-1):indexes[0];
 }
 function create({Word,api,supports}){
  function requireApi(version){if(!supports('WordApi',version))throw Error('此操作需要 WordApi '+version+'。');}
  async function mainSelection(c){
   const range=c.document.getSelection(),relation=range.compareLocationWith(c.document.body.getRange('Whole'));
   await c.sync();if(!inside.has(relation.value))throw Error('此命令只支持正文；请先把光标移到正文。');return range;
  }
  async function atEmptySelection(build,kind='ooxml'){
   requireApi('1.3');
   return Word.run(async c=>{
    const range=(await mainSelection(c)).track();
    try{
     // Mac Word throws GeneralException when getOoxml targets a collapsed
     // insertion point. Snapshot its containing paragraph while keeping the
     // tracked, empty insertion range for all position checks and the write.
     const surrounding=range.paragraphs.getFirst().getRange('Whole');
     range.load('isEmpty');const original=surrounding.getOoxml();await c.sync();
     if(!range.isEmpty)throw Error('请先放置空白光标；插入不会替换已选中的文字或公式。');
     const payload=await build(c),location=c.document.getSelection().compareLocationWith(range),latest=surrounding.getOoxml();range.load('isEmpty');await c.sync();
     if(location.value!=='Equal'||!range.isEmpty)throw Error('光标已改变，请重新操作。');
     if(!(await api('compare-selection',{original:original.value,current:latest.value})).equal)throw Error('光标附近内容已改变，请重新操作。');
     // Recheck position after the async comparison, immediately before mutation.
     const finalLocation=c.document.getSelection().compareLocationWith(range);range.load('isEmpty');await c.sync();
     if(finalLocation.value!=='Equal'||!range.isEmpty)throw Error('光标已改变，请重新操作。');
     if(kind==='text')range.insertText(payload,'Replace');else range.insertOoxml(payload,'Replace');await c.sync();
    }finally{range.untrack();await c.sync();}
   });
  }
  async function insertSymbol(symbol){
   if(!symbols.includes(symbol))throw Error('未授权的数学符号');
   return atEmptySelection(async()=>symbol,'text');
  }
  async function discover(c){
   const paragraphs=c.document.body.paragraphs;paragraphs.load('items');await c.sync();
   if(paragraphs.items.length>1000)throw Error('正文超过 1000 个段落；请手动选择公式，本次未改变选区。');
   const entries=paragraphs.items.map((p,ordinal)=>{const range=p.getRange('Whole');range.load('text');return {range,ordinal,xml:range.getOoxml(),pictures:range.inlinePictures};});
   await c.sync();const candidates=[];
   for(const entry of entries){
    if(!entry.xml.value.includes('OLEObject'))continue;
    const objects=(await api('inspect-selection',{ooxml:entry.xml.value})).objects.filter(o=>!o.part||o.part==='word/document.xml');
    if(!objects.length)continue;
    entry.pictures.load('items');await c.sync();
    const pictureRanges=entry.pictures.items.map(p=>{const range=p.getRange('Whole');return {range,xml:range.getOoxml()};});await c.sync();
    const mapped=[];
    for(const picture of pictureRanges){const found=(await api('inspect-selection',{ooxml:picture.xml.value})).objects.filter(o=>!o.part||o.part==='word/document.xml');if(found.length===1)mapped.push({range:picture.range,object:found[0],xml:picture.xml.value});}
    const order=mapped.slice(1).map((item,index)=>item.range.compareLocationWith(mapped[index].range));await c.sync();
    if(mapped.length===objects.length&&order.every(value=>directions.next.has(value.value))){
     // Collection order and physical ranges distinguish even byte-identical objects.
     candidates.push(...mapped.map((item,within)=>({...item,ordinal:entry.ordinal,within})));continue;
    }
    // Some Word builds omit OLE objects from inlinePictures. A single independent
    // equation paragraph is an unambiguous safe fallback; mixed paragraphs aren't.
    const plain=entry.range.text.replace(/[\s\uFFFC\u0001]/g,''),number=objects[0]?.layout?.numberText?.replace(/\s/g,'')??'';
    const independent=objects.length===1&&(!plain||(objects[0].layout?.owned&&plain===number));
    candidates.push({range:entry.range,object:objects[0],xml:entry.xml.value,ordinal:entry.ordinal,within:0,paragraphFallback:independent,blocked:!independent});
   }
   return candidates;
  }
  async function navigate(direction){
   requireApi('1.3');
   return Word.run(async c=>{
    const original=(await mainSelection(c)).track();
    try{
     const candidates=await discover(c),relations=candidates.map(item=>item.range.compareLocationWith(original));await c.sync();
     if(candidates.some((item,index)=>item.blocked&&['Contains','ContainsStart','ContainsEnd','OverlapsBefore','OverlapsAfter'].includes(relations[index].value)))throw Error('当前段落的公式范围无法区分。请手动选择公式；本次未改变选区。');
     const index=candidateIndex(relations.map(value=>value.value),direction);
     if(index===undefined)return {found:false};
     const target=candidates[index];
     if(target.blocked)throw Error('邻近公式位于混合段落，Word 未提供独立对象范围。请手动选择该公式；本次未改变选区。');
     const location=c.document.getSelection().compareLocationWith(original),latest=target.range.getOoxml();await c.sync();
     if(location.value!=='Equal')throw Error('光标已改变，请重新浏览。');
     if(!(await api('compare-selection',{original:target.xml,current:latest.value})).equal)throw Error('目标公式已改变，请重新浏览。');
     const finalLocation=c.document.getSelection().compareLocationWith(original);await c.sync();if(finalLocation.value!=='Equal')throw Error('光标已改变，请重新浏览。');
     target.range.select('Select');await c.sync();return {found:true,paragraphFallback:!!target.paragraphFallback,ordinal:target.ordinal,within:target.within};
    }finally{original.untrack();await c.sync();}
   });
  }
  return {atEmptySelection,insertSymbol,navigate};
 }
 globalThis.EquationLabWordActions=Object.freeze({symbols,candidateIndex,create});
})();
