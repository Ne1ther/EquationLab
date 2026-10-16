// Display-only sizing. Native equation point sizes and export data are unchanged.
(() => {
 const minimum=50,maximum=100,pixelsPerPercent=.29;
 function fittedZoom(width,height,contentWidth,contentHeight,current){
  if(contentWidth<=0||contentHeight<=0)return maximum;
  return Math.max(minimum,Math.min(maximum,Math.floor(Math.min(width/contentWidth,height/contentHeight)*current)));
 }
 window.equationFitZoom=fittedZoom;
 window.createEquationViewport=(field,{getZoom,onScaleChange})=>{
  const wrap=field.closest('.math-wrap'),rail=wrap.parentElement.querySelector('.equation-scrollbar');let effectiveZoom=maximum,scheduled=false,content=null;
  const padding=(element,axis)=>{const style=getComputedStyle(element);return axis==='x'?parseFloat(style.paddingLeft)+parseFloat(style.paddingRight):parseFloat(style.paddingTop)+parseFloat(style.paddingBottom);};
  function apply(zoom){
   if(zoom===effectiveZoom)return;
   effectiveZoom=zoom;field.style.setProperty('--formula-size',zoom*pixelsPerPercent+'px');onScaleChange();
  }
  function syncRail(){
   if(!content)return;
   const overflow=Math.max(0,content.scrollWidth-content.clientWidth);
   rail.hidden=overflow<2;
   if(!rail.hidden){rail.firstElementChild.style.width=(rail.clientWidth+overflow)+'px';rail.scrollLeft=content.scrollLeft;}
  }
  rail.addEventListener('scroll',()=>{if(content&&Math.abs(content.scrollLeft-rail.scrollLeft)>.5)content.scrollLeft=rail.scrollLeft;},{passive:true});
  wrap.addEventListener('wheel',event=>{
   const delta=event.deltaX||(event.shiftKey?event.deltaY:0);
   if(content&&delta&&content.scrollWidth>content.clientWidth){content.scrollLeft+=delta;event.preventDefault();}
  },{passive:false});
  function refresh(){
   if(scheduled)return;scheduled=true;
   requestAnimationFrame(()=>{
    scheduled=false;
    const nextContent=field.shadowRoot?.querySelector('[part=content]');
    if(nextContent!==content){content=nextContent;content?.addEventListener('scroll',syncRail,{passive:true});}
    const selected=getZoom();if(selected){apply(selected);syncRail();return;}
    const base=content?.querySelector('.ML__base');
    if(!content||!base||!field.value.trim()){apply(maximum);syncRail();return;}
    const box=base.getBoundingClientRect(),width=Math.max(1,content.clientWidth-padding(content,'x')-12),height=Math.max(1,wrap.clientHeight-padding(wrap,'y')-padding(field,'y')-padding(content,'y')-12);
    apply(fittedZoom(width,height,box.width,box.height,effectiveZoom));
    syncRail();
   });
  }
  new ResizeObserver(refresh).observe(wrap);
  // MathLive can render after the host's input event/animation frame. Measure
  // its completed content too, without polling or observing caret animation.
  if(field.shadowRoot)new MutationObserver(refresh).observe(field.shadowRoot,{childList:true,subtree:true});
  document.fonts.ready.then(refresh);
  return {refresh,get effectiveZoom(){return effectiveZoom;}};
 };
})();
