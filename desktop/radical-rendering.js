/* MathLive 0.111.1 Box adapter. Installed inside the audited vendor build,
 * where SurdAtom is in scope; no parser, value, caret or undo hooks change.
 * The shared contour is injected from src/radical-contour.mjs by the builder.
 */
(function(host){
 'use strict';
 host.installEquationRadicalRenderer=function(prototype){
  const original=prototype.render;
  if(original.equationLabContinuousRadical)return;
  const hasClass=(box,name)=>(box.classes||'').split(/\s+/).includes(name);
  function findLine(box){const queue=[box];while(queue.length){const child=queue.shift();if(hasClass(child,'ML__sqrt-line'))return child;queue.push(...(child.children||[]));}return null;}
  function glyphWidth(box,ancestorScale=1){
   // VBox.softWidth is a no-op in MathLive 0.111.1: the tall delimiter's
   // Box.width sums all vertically stacked fragments (plus a zero-width
   // DOM strut). CSS paints only one font-cell width. Read that glyph cell,
   // retaining its actual ancestor font scales rather than the wrapper sum.
   if(box.value&&/[\u221A\u23B7\uE000\uE001]/.test(box.value))return box.width*ancestorScale;
   return Math.max(0,...(box.children||[]).map(child=>glyphWidth(child,ancestorScale*(box.scale??1))));
  }
  function render(context){
   const result=original.call(this,context);if(!result)return result;
   const children=result.children||[],delimiter=children.find(box=>hasClass(box,'ML__sqrt-sign')),body=children[children.length-1],line=body&&findLine(body);
   if(!delimiter||!line)return result;
   const width=glyphWidth(delimiter),height=delimiter.height+delimiter.depth,rule=line.height;
   if(!(width>0&&height>0&&rule>=0&&rule<height))return result;
   // VBox rounds its CSS anchors upward to hundredths of an em. Its painted
   // rule top therefore differs from the ideal Box.height baseline. Recover
   // that same anchor from the actual pstrut/wrapper CSS, without DOM reads.
   const wrapper=line.parent,pstrut=wrapper?.children?.find(box=>hasClass(box,'ML__pstrut'));
   const anchor=Number.parseFloat(wrapper?.cssProperties?.top),strut=Number.parseFloat(pstrut?.cssProperties?.height);
   const top=Number.isFinite(anchor)&&Number.isFinite(strut)?delimiter.height+strut+anchor-2*rule:0,paintHeight=height-top;
   if(!(paintHeight>rule))return result;
   const contour=host.equationRadicalContour({width,height:paintHeight,stemWidth:width,rule});
   // Keep MathLive's measured delimiter/line boxes and atom bindings. Only
   // their paint changes. MathLive adds inter-atom spacing after render and
   // leaves Box.width stale, so the rule keeps its original 100% width box.
   // Its SVG joins the stem SVG at exactly the same height and thickness.
   delimiter.children=undefined;delimiter.value='';
   delimiter.setStyle('width',width+'em');delimiter.setStyle('height',height+'em');
   delimiter.setStyle('display','inline-block');delimiter.setStyle('position','relative');
   delimiter.setStyle('vertical-align',-delimiter.depth+'em');
   if(delimiter.cssProperties)delete delimiter.cssProperties.top;
   const markup=delimiter.toMarkup;
   delimiter.toMarkup=function(){
    const span=markup.call(this),at=span.indexOf('>'),end=span.lastIndexOf('</span>');
    const svg=`<svg aria-hidden="true" data-equation-radical="continuous" data-radical-size="${contour.size}" viewBox="0 0 ${width} ${paintHeight}" width="${width}em" height="${paintHeight}em" style="position:absolute;left:0;top:${top}em;width:${width}em;height:${paintHeight}em;overflow:visible;pointer-events:none" preserveAspectRatio="none"><path fill="currentColor" d="${contour.d}" transform="scale(${contour.scaleX} ${contour.scaleY})"></path></svg>`;
    return at>=0&&end>at?span.slice(0,at+1)+svg+span.slice(end):span;
   };
   line.classes=line.classes.replace(/\bML__sqrt-line\b/g,'EL__radical-rule-layout');
   line.setStyle('display','inline-block');line.setStyle('width','100%');line.setStyle('height',line.height+'em');line.setStyle('position','relative');
   const lineMarkup=line.toMarkup;
   line.toMarkup=function(){const span=lineMarkup.call(this),at=span.indexOf('>'),end=span.lastIndexOf('</span>');
    // The original :before is one rule above this line box. Use the same
    // anchor, with an SVG rect rather than the pixel-clamped CSS pseudo-line.
    const svg=`<svg aria-hidden="true" data-equation-radical-rule="continuous" width="100%" height="${rule}em" style="position:absolute;left:0;top:${-rule}em;width:100%;height:${rule}em;overflow:visible;pointer-events:none"><rect width="100%" height="100%" fill="currentColor"></rect></svg>`;
    return at>=0&&end>at?span.slice(0,at+1)+svg+span.slice(end):span;
   };
   return result;
  }
  render.equationLabContinuousRadical=true;prototype.render=render;
 };
})(globalThis);
