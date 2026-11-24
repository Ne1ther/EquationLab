(function(root){
 // Input/selection updates do not walk or serialize document rows. Only list
 // replacement, row changes or number freshness updates produce a bridge payload.
 root.createSidebarPublisher=function(){
  const origin=root.crypto?.randomUUID?.()??(Date.now().toString(36)+Math.random().toString(36).slice(2));
  let current,numberFreshness,rows=[],epoch=0,revision=0,reset=true;const dirty=new Set(),previewDirty=new Set();
  const numberStatus=(freshness,numberText)=>freshness==='stale'?'stale':freshness==='loading'&&!numberText?'pending':'snapshot';
  const row=(object,document,freshness,id=object.index)=>{
   const numberText=typeof object.layout?.numberText==='string'?object.layout.numberText.trim():'';
   return {id,position:document.documentPosition===undefined||document.savedCatalogue?object.index+1:document.documentPosition+1,label:'公式 '+(id+1),detail:object.error||(document.savedCatalogue?'在 Word 中打开此公式':'原生 MathType · '+object.application),latex:object.latex||'',image:object.image||null,readOnly:!!object.error,numberText:numberText||null,numberStatus:document.savedCatalogue&&freshness!=='stale'?'catalogue':numberStatus(freshness,numberText)};
  };
  function catalogueRow(document,freshness,id){
   const position=document.documentPosition,owner=document.objects?.[document.activeIndex];
   const preview=document.catalogueRows?.[id]??document.retainedCatalogueRows?.[id];
   if(id===position&&owner){
    const active=row(owner,document,freshness,id);
    return !active.numberText&&preview?.numberText?{...active,numberText:preview.numberText,numberStatus:'catalogue'}:active;
   }
   return {id,position:id+1,label:'公式 '+(id+1),detail:'在 Word 中打开此公式',latex:preview?.latex||'',image:null,readOnly:false,numberText:preview?.numberText??null,numberStatus:preview?'catalogue':'pending'};
  }
  function rowsFor(document,freshness){
   if(!document?.catalogProof)return (document?.objects||[]).map(object=>row(object,document,freshness));
   return Array.from({length:document.documentTotal},(_,id)=>catalogueRow(document,freshness,id));
  }
  return {
   reset(){reset=true;},
   invalidate(document,indices){if(document!==current)return;if(indices)for(const index of indices)dirty.add(index);else reset=true;},
   invalidateCatalogue(document,start,end){
    if(document!==current)return;
    for(let index=start;index<end;index++)previewDirty.add(index);
   },
   snapshot(document){
    const nextFreshness=document?.numberingRefreshNeeded?'stale':document?.documentLoading||document?.catalogProof?'loading':'snapshot';
    const freshnessChanged=nextFreshness!==numberFreshness;
    if(document!==current){
     // A save can replace the editor source with its cached copy. Preserve the
     // row generation and existing images when the Word snapshot is the same.
     const sameSnapshot=document?.documentIdentity&&document.documentIdentity===current?.documentIdentity
      &&document.documentSnapshot!=null&&document.documentSnapshot===current.documentSnapshot
      &&document.documentPosition===undefined&&current.documentPosition===undefined
      &&!document.catalogProof&&!current.catalogProof&&Array.isArray(document.objects)&&document.objects.length===rows.length
      &&document.objects.every((object,index)=>object.index===rows[index].id);
     if(!reset&&sameSnapshot){
      for(const [index,object] of document.objects.entries()){
       const next=row(object,document,numberFreshness);
       if(Object.keys(next).some(key=>next[key]!==rows[index][key]))dirty.add(index);
      }
     }else reset=true;
     current=document;
    }
    let delta=null;
    if(reset){rows=rowsFor(document,nextFreshness);epoch++;revision=1;delta={generation:origin+':'+epoch,baseRevision:0,revision,reset:rows};reset=false;dirty.clear();previewDirty.clear();}
    else if(freshnessChanged||dirty.size||previewDirty.size){
     if(freshnessChanged)rows=rows.map(item=>{
      const status=numberStatus(nextFreshness,item.numberText);
      return item.numberStatus===status?item:{...item,numberStatus:status};
     });
     const upserts=[];for(const index of dirty){const object=document?.objects[index];if(!object)continue;const id=document.catalogProof?document.documentPosition:object.index,next=row(object,document,nextFreshness,id),position=rows[index]?.id===id?index:rows.findIndex(item=>item.id===id);if(position>=0)rows[position]=next;else rows.push(next);upserts.push(next);}
     dirty.clear();
     for(const index of previewDirty){
      const next=catalogueRow(document,nextFreshness,index),previous=rows[index];
      if(previous&&Object.keys(next).every(key=>next[key]===previous[key]))continue;
      rows[index]=next;upserts.push(next);
     }
     previewDirty.clear();
     if(freshnessChanged||upserts.length)delta={generation:origin+':'+epoch,baseRevision:revision,revision:++revision,
      ...(freshnessChanged?{numberFreshness:nextFreshness}:{}),...(upserts.length?{upserts}:{})};
    }
    numberFreshness=nextFreshness;
    return {objects:rows,delta};
   }
  };
 };
})(typeof window==='undefined'?globalThis:window);
