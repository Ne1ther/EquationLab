(function(root){
 // Input/selection updates do not walk or serialize document rows. Only list
 // replacement or explicit row changes produce a bridge payload.
 root.createSidebarPublisher=function(){
  const origin=root.crypto?.randomUUID?.()??(Date.now().toString(36)+Math.random().toString(36).slice(2));
  let current,rows=[],epoch=0,revision=0,reset=true;const dirty=new Set();
  const row=(object,document)=>({id:object.index,position:document.documentPosition===undefined?object.index+1:document.documentPosition+1,label:'公式 '+(object.index+1),detail:object.error||'原生 MathType · '+object.application,latex:object.latex||'',image:object.image||null,readOnly:!!object.error});
  return {
   reset(){reset=true;},
   invalidate(document,indices){if(document!==current)return;if(indices)for(const index of indices)dirty.add(index);else reset=true;},
   snapshot(document){
    if(document!==current){current=document;reset=true;}
    let delta=null;
    if(reset){rows=(document?.objects||[]).map(object=>row(object,document));epoch++;revision=1;delta={generation:origin+':'+epoch,baseRevision:0,revision,reset:rows};reset=false;dirty.clear();}
    else if(dirty.size){
     const upserts=[];for(const index of dirty){const object=document?.objects[index];if(!object)continue;const next=row(object,document),position=rows.findIndex(item=>item.id===index);if(position>=0)rows[position]=next;else rows.push(next);upserts.push(next);}
     dirty.clear();if(upserts.length)delta={generation:origin+':'+epoch,baseRevision:revision,revision:++revision,upserts};
    }
    return {objects:rows,delta};
   }
  };
 };
})(typeof window==='undefined'?globalThis:window);
