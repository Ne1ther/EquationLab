import {SVGWrapperFactory} from 'mathjax-full/js/output/svg/WrapperFactory.js';
import {SVGmfrac} from 'mathjax-full/js/output/svg/Wrappers/mfrac.js';
import {SVGmsqrt} from 'mathjax-full/js/output/svg/Wrappers/msqrt.js';
import {SVGmroot} from 'mathjax-full/js/output/svg/Wrappers/mroot.js';
import {SVGmtable} from 'mathjax-full/js/output/svg/Wrappers/mtable.js';
import {SVGmsub,SVGmsup,SVGmsubsup} from 'mathjax-full/js/output/svg/Wrappers/msubsup.js';
import {SVGmover,SVGmunder,SVGmunderover} from 'mathjax-full/js/output/svg/Wrappers/munderover.js';
import {SVGmrow} from 'mathjax-full/js/output/svg/Wrappers/mrow.js';
import {SVGmo} from 'mathjax-full/js/output/svg/Wrappers/mo.js';
import {nativeDimension32} from './native-dimensions.mjs';
import {radicalContour} from './radical-contour.mjs';
import {readFileSync} from 'node:fs';
const {tables}=JSON.parse(readFileSync(new URL('./native-spacing-tables.json',import.meta.url)));
const {jstat,integralOverlays,jointGeometry}=JSON.parse(readFileSync(new URL('./native-template-pieces.json',import.meta.url)));
const text=n=>n.getText?.()??n.childNodes?.map(text).join('')??'';
function nativeRatio(n){const own=n.getProperty?.('equationNativeSize')??n.getProperty?.('elNativeBoxRatio');if(own)return own;for(const child of n.childNodes??[]){const r=nativeRatio(child);if(r)return r;}return 1;}
function tokenClass(node){
 const kind=node.kind,value=text(node);
 if(['msup','msub','msubsup','mmultiscripts'].includes(kind))return tokenClass(node.childNodes[0]);
 if(['mfrac','msqrt','mroot','mtable','menclose'].includes(kind))return 10;
 if(['munderover','mover','munder'].includes(kind)){if(node.attributes.get('accent')||node.attributes.get('accentunder'))return tokenClass(node.childNodes[0]);return 4;}
 if(kind==='TeXAtom'&&node.texClass===1)return 3;
 if(['mrow','inferredMrow','TeXAtom','mstyle','mpadded'].includes(kind)){const items=node.childNodes??[];return items.length===1?tokenClass(items[0]):10;}
 if(/^\d+$/.test(value))return 1;
 if(/^[A-Za-z\u0370-\u03ff]+$/.test(value))return 2;
 if(/^[+−\-±∓×÷⋅·∗∪∩\\]$/.test(value))return 5;
 if(/^[=<>≤≥≠≈≡≃≅∼∈∉⊂⊃⊆⊇≦≧⩽⩾∝→←↔⇒⇔]$/.test(value))return 6;
 if(/^[([{⟨⌊⌈]$/.test(value))return 7;
 if(/^[)\]}⟩⌋⌉]$/.test(value))return 8;
 if(/^[,;:]$/.test(value))return 9;
 if(kind==='mo'&&node.attributes.get('largeop'))return 4;
 return value.trim()?2:0;
}
/** Consumers follow retained REA integer 1/32pt preferences and box contracts.
 * Font extents are CoreText, and stretchy contours remain MathJax; this is not
 * Windows GDI pixel parity. Unknown preference dimensions are never guessed. */
export function createNativeLayout(prefs,full,nativeFaces){
 const full32=Math.trunc(full*32),space=prefs?.spaces??[],G=(id)=>space[id]&&!space[id].unsupported?nativeDimension32(space[id],full32,{relative:![16,17,22].includes(id)}):undefined;
 const P=(id,ratio=1)=>{const g=G(id);return g===undefined?undefined:Math.trunc(g*Math.trunc(full32*ratio)/full32)/(32*full);};
 const Q=value=>Math.ceil(value*full*32)/(32*full);
 const boundaryGap=(a,b,ratio)=>{
  if(!a||!b)return 0;
  const ef=tables[ratio<.9?1:0]?.[a-1]?.[b-1]??1,coefficient={2:16,3:22,4:27,5:100,6:200,7:8}[ef];if(!coefficient)return 0;
  const baseAdvance=(nativeFaces.find(f=>f.font===prefs.styles[1]?.font)?.glyphs?.[32]?.advance??250)*full32/1000;
  const advance=Math.trunc(baseAdvance*Math.trunc(full32*ratio)/full32),scaled=Math.trunc(advance*coefficient*4/100),factor=G([a,b].some(c=>c===5||c===6)?16:17)??3200;
  return Q((Math.trunc(factor*scaled/100)>>5)/(32*full));
 };
 const metric=nativeFaces.find(f=>f.font===prefs?.styles[1]?.font)?.metrics??nativeFaces[0]?.metrics;
 const M0=(metric?.ascent??750)/1000,M1=(metric?.descent??250)/1000;
 const factory=new SVGWrapperFactory();
 if(!prefs)return {factory,postFilter:()=>{},spacing:null};
 class NativeOperator extends SVGmo{
  // Native character records already identify the intended glyph. MathJax's
  // TeX remapping would turn text hyphens and asterisks into other outlines.
  remapChars(chars){return this.node.getProperty('equationNativeSize')?chars:super.remapChars(chars);}
  toSVG(parent){super.toSVG(parent);
   // MathJax 3's symmetric-operator translation replaces the scale installed
   // by standardSVGnode(). Keep the native glyph size in the drawn outline
   // as well as its measured box, or limits float around a smaller symbol.
   const transform=this.adaptor.getAttribute(this.element,'transform')??'';
   if(this.bbox.rscale!==1&&transform.startsWith('translate('))this.adaptor.setAttribute(this.element,'transform',`scale(${this.fixed(this.bbox.rscale/1000,3)}) ${transform}`);
  }
 }
 factory.setNodeClass('mo',NativeOperator);
 class Fraction extends SVGmfrac{
  dimensions(t){const [n,d]=this.childNodes.map(c=>c.getOuterBBox()),rN=nativeRatio(this.childNodes[0].node),rD=nativeRatio(this.childNodes[1].node),a=this.font.params.axis_height,small=this.node.getProperty('elSmallFraction');
   const minimum=Q(P(19,Math.min(rN,rD))??0),numGap=small?minimum:Math.max(minimum,(P(9,rN)??0)-n.d*n.rscale),denGap=small?minimum:Math.max(minimum,(P(10,rD)??0)-d.h*d.rscale);
   return {n,d,a,numY:a+t/2+numGap+n.d*n.rscale,denY:a-t/2-denGap-d.h*d.rscale,over:P(11)??.1};
  }
  getFractionBBox(bbox,_display,t){const p=this.dimensions(t);bbox.combine(p.n,0,p.numY);bbox.combine(p.d,0,p.denY);bbox.w+=2*p.over;}
  makeFraction(_display,t){const p=this.dimensions(t),[num,den]=this.childNodes,W=Math.max((p.n.L+p.n.w+p.n.R)*p.n.rscale,(p.d.L+p.d.w+p.d.R)*p.d.rscale);num.toSVG(this.element);den.toSVG(this.element);num.place(this.getAlignX(W,p.n,this.node.attributes.get('numalign'))+p.over,p.numY);den.place(this.getAlignX(W,p.d,this.node.attributes.get('denomalign'))+p.over,p.denY);this.adaptor.append(this.element,this.svg('rect',{width:this.fixed(W+2*p.over),height:this.fixed(t),x:0,y:this.fixed(p.a-t/2)}));}
  getBevelData(display){const p=super.getBevelData(display),gap=P(14,nativeRatio(this.childNodes[0].node));return gap===undefined?p:{...p,delta:-Math.max(0,gap)*2};}
 }
 function rootClass(Base){return class extends Base{
  nativeGeometry(){const box=this.childNodes[this.base].getOuterBBox(),ratio=nativeRatio(this.node);
   // A native NULL line has no glyph bounds. Keep the empty editing template
   // at a usable em-sized extent instead of vertically flattening the radical.
   // This reserves blank space only; no placeholder characters enter MTEF.
   const n=box.w===0&&box.h===0&&box.d===0?{...box,w:.5*ratio/box.rscale,h:.7*ratio/box.rscale,d:.2*ratio/box.rscale}:box;
   const t=Math.max(0,P(28,ratio)??.04),gap=P(20,ratio)??0,fence=P(15,ratio)??0,over=P(11,ratio)??0;
   // 681330: preserve integer operation order for RadWidth rather than a
   // percentage of MathJax's chosen glyph width.
   const size=Math.trunc(full32*ratio),w=(Math.trunc((G(22)??3200)*Math.trunc(size*60/100)/100)>>5)/(32*full),top=n.h*n.rscale+t+gap,bottom=-n.d*n.rscale-fence;
   let extraX=0,extraY=0,indexX=0,indexY=0;
   if(this.root){const j=this.childNodes[this.root].getOuterBBox(),q=Q(ratio/20),surd=this.childNodes[this.surd],sbox=surd.getBBox(),surdHeight=sbox.h+sbox.d;
    // The recovered native index rectangle assumes the original drawn
    // radical. Our MathJax outline has a taller entry hook. Keep the native
    // position as a minimum, then clear that actual contour using MathJax's
    // own root-height contract, mapped through the same vertical stretch.
    const hookClearance=(surd.size<0?1.9:.55*surdHeight)*(top-bottom)/surdHeight;
    const indexBottom=Math.max(bottom+.395*(top-bottom)+q,bottom+hookClearance+q),available=.625*w+.375*w*(indexBottom-bottom)/(top-bottom)-q,jw=j.w*j.rscale;
    if(available<jw)extraX=jw-available;else indexX=(available-jw)/2;indexY=indexBottom+j.d*j.rscale;extraY=Math.max(0,indexY+j.h*j.rscale-top);
   }
   return {n,t,w,top,bottom,over,gap:P(21,ratio)??0,extraX,extraY,indexX,indexY};
  }
  computeBBox(bbox,recompute){const p=this.nativeGeometry();bbox.h=p.top+p.extraY; bbox.d=-p.bottom; bbox.w=p.extraX+p.w+p.gap+p.n.w*p.n.rscale+p.over;this.setChildPWidths(recompute);}
  toSVG(parent){const p=this.nativeGeometry(),SVG=this.standardSVGnode(parent),base=this.childNodes[this.base],contour=radicalContour({width:p.w+p.gap+p.n.w*p.n.rscale+p.over,height:p.top-p.bottom,stemWidth:p.w,rule:p.t});
   // The old stretched font cap and separate rectangle disagreed at tall
   // heights. One closed outline joins the hook, stem and requested rule.
   const radical=this.adaptor.append(SVG,this.svg('g',{'data-equation-radical':'continuous','data-rule':this.fixed(p.t),transform:'translate('+this.fixed(p.extraX)+' '+this.fixed(p.top)+') scale('+contour.scaleX*1000+' '+(-contour.scaleY*1000)+')'}));
   this.adaptor.append(radical,this.svg('path',{d:contour.d}));
   // An inferred mrow reuses its parent element. Isolate the radicand so its
   // placement cannot translate the radical, overbar and index as well.
   const BASE=this.adaptor.append(SVG,this.svg('g'));base.toSVG(BASE);base.place(p.extraX+p.w+p.gap,0);
   if(this.root){const index=this.childNodes[this.root];index.toSVG(SVG);index.place(p.indexX,p.indexY);}
  }
 };}
 class Table extends SVGmtable{
  setLineThickness(t,style,properties){const attrs=super.setLineThickness(t,style,properties);delete attrs['stroke-thickness'];Object.assign(attrs,{fill:'none','stroke-width':this.fixed(t)});if(style==='dashed')attrs['stroke-dasharray']=this.fixed(2*t);if(style==='dotted'){attrs['stroke-linecap']='round';attrs['stroke-dasharray']='0,'+this.fixed(2*t);}return attrs;}
  updateHDW(cell,i,j,align,H,D,W,M){const result=super.updateHDW(cell,i,j,align,H,D,W,M),r=nativeRatio(this.node);H[j]=Math.max(H[j],M0*r);D[j]=Math.max(D[j],M1*r);return result;}
  constructor(...args){super(...args);const r=nativeRatio(this.node),pile=this.node.getProperty('elPile'),rowSpace=P(pile?(r<.9?8:0):1,r);if(rowSpace!==undefined)this.rSpace=this.rSpace.map(()=>rowSpace-(M0+M1)*r);if(!pile&&P(2,r)!==undefined)this.cSpace=this.cSpace.map(()=>P(2,r));
   // A relation-aligned pile becomes two MathML cells. Its relation still
   // needs the native boundary gap that a single-line equation receives.
   if(pile&&this.numCols===2)this.cSpace=this.cSpace.map(()=>boundaryGap(2,6,r));
   const thickness=P(27,r);if(thickness!==undefined){this.cLines=this.cLines.map(x=>x?Math.max(0,thickness):0);this.rLines=this.rLines.map(x=>x?Math.max(0,thickness):0);if(this.frame)this.fLine=Math.max(0,thickness);}}
 }
 function scriptClass(Base){return class extends Base{
  getBaseWidth(){return super.getBaseWidth()+(P(5,nativeRatio(this.baseChild.node))??0);}
  getU(){const ratio=nativeRatio(this.baseChild.node),prime=/[′″‴‵‶‷]/.test(text(this.scriptChild?.node??{}));return Math.max(P(prime?24:3,ratio)??super.getU(),this.scriptChild?.getOuterBBox().d??0);}
  getV(){return P(4,nativeRatio(this.baseChild.node))??super.getV();}
  getUVQ(){if(!this.subChild||!this.supChild)return super.getUVQ();const sub=this.subChild.getOuterBBox(),sup=this.supChild.getOuterBBox(),r=nativeRatio(this.baseChild.node);let u=P(3,r)??.45,v=P(4,r)??.25;const gap=P(19,r)??0,q=u+v-sup.d*sup.rscale-sub.h*sub.rscale;if(q<gap){u+=(gap-q)/2;v+=(gap-q)/2;}return [u,-v,u+v-sup.d*sup.rscale-sub.h*sub.rscale];}
 };}
 function markClass(Base){return class extends Base{
  getOverKU(base,over){const child=this.overChild??this.scriptChild,r=nativeRatio(this.baseChild.node),accent=this.node.attributes.get('accent'),horizontal=/[⏞⏜]/.test(text(child?.node??{}));
   if(!accent&&!horizontal&&!this.node.getProperty('elNativeWideMark')){
    // BigOpBox passes the LIMIT line's logical size to 688c30, not the
    // enlarged operator size. LimHeight is measured from the operator's
    // ink edge to the limit baseline; subtract only the limit's depth.
    const limitRatio=nativeRatio(child.node),k=Math.max(Q(P(19,limitRatio)??0),(P(6,limitRatio)??0)-over.d*over.rscale);return [k,base.h*base.rscale+k+over.d*over.rscale];
   }
   const gap=P(horizontal?29:this.node.getProperty('elNativeWideMark')?19:23,r)??0,k=accent?gap:Math.max(P(19,r)??0,gap-base.h*base.rscale-over.d*over.rscale);return [k,base.h*base.rscale+k+over.d*over.rscale];
  }
  getUnderKV(base,under){const child=this.underChild??this.scriptChild,r=nativeRatio(this.baseChild.node),accent=this.node.attributes.get('accentunder'),horizontal=/[⏟⏝]/.test(text(child?.node??{}));
   if(!accent&&!horizontal&&!this.node.getProperty('elNativeWideMark')){
    const limitRatio=nativeRatio(child.node),k=Math.max(Q(P(19,limitRatio)??0),(P(7,limitRatio)??0)-under.h*under.rscale);return [k,-(base.d*base.rscale+k+under.h*under.rscale)];
   }
   const gap=P(horizontal?29:this.node.getProperty('elNativeWideMark')?19:23,r)??0,k=accent?gap:Math.max(P(19,r)??0,gap-base.d*base.rscale-under.h*under.rscale);return [k,-(base.d*base.rscale+k+under.h*under.rscale)];
  }
  computeBBox(bbox,recompute){if(!this.isLineAbove&&!this.isLineBelow)return super.computeBBox(bbox,recompute);const base=this.baseChild.getOuterBBox(),r=nativeRatio(this.baseChild.node),gap=P(23,r)??0,t=P(12,r)??.04;bbox.empty();bbox.append(base);if(this.isLineAbove)bbox.h+=gap+t;else bbox.d+=gap+t;bbox.clean();this.setChildPWidths(recompute);}
  toSVG(parent){if(!this.isLineAbove&&!this.isLineBelow)return super.toSVG(parent);const base=this.baseChild,box=base.getOuterBBox(),r=nativeRatio(base.node),gap=P(23,r)??0,t=P(12,r)??.04,SVG=this.standardSVGnode(parent);base.toSVG(SVG);base.place(0,0);this.adaptor.append(SVG,this.svg('rect',{x:0,y:this.fixed(this.isLineAbove?box.h*box.rscale+gap:-box.d*box.rscale-gap-t),width:this.fixed(box.w*box.rscale),height:this.fixed(Math.max(0,t))}));}
 };}
 function anchor(wrapper,type){
  const value=text(wrapper.node),r=nativeRatio(wrapper.node),box=wrapper.getOuterBBox();
  if(type===1)return box.w*box.rscale/2;if(type===2)return box.w*box.rscale;
  function find(w,kind){const ch=text(w.node);if(w.node.isToken&&((kind===3&&/^[=<>≤≥≠≈≡≃≅∼∈∉⊂⊃⊆⊇≦≧⩽⩾]$/.test(ch))||(kind===4&&ch==='.')))return kind===3?w.getOuterBBox().w*w.getOuterBBox().rscale/2:r/6;let x=0;for(const child of w.childNodes??[]){const b=child.getOuterBBox(),found=find(child,kind);if(found!==null)return x+b.L*b.rscale+found;x+=(b.L+b.w+b.R)*b.rscale;}return null;}
  if(type===3||type===4)return find(wrapper,type)??0;return 0;
 }
 class RulerRow extends SVGmrow{
  barGeometry(){const bar=this.node.getProperty('elNativeBar');if(!bar)return null;const box=this.childNodes[0].getOuterBBox(),r=nativeRatio(this.node),t=Math.max(0,P(12,r)??.04),gap=P(23,r)??0;return {...bar,box,t,gap};}
  drawBar(parent,p){const svg=this.standardSVGnode(parent),base=this.childNodes[0];base.toSVG(svg);base.place(0,0);for(let i=0;i<p.count;i++)this.adaptor.append(svg,this.svg('rect',{x:0,y:this.fixed(p.under?-p.box.d*p.box.rscale-p.gap-p.t-i*3*p.t:p.box.h*p.box.rscale+p.gap+i*3*p.t),width:this.fixed(p.box.w*p.box.rscale),height:this.fixed(p.t)}));}

  integralGeometry(){const flags=this.node.getProperty('elStretchIntegral');if(flags===undefined)return null;if(this.integralData)return this.integralData;const [body,lower,upper,...operators]=this.childNodes,b=body.getOuterBBox(),l=lower.getOuterBBox(),u=upper.getOuterBBox(),r=nativeRatio(this.node),target=(b.h+b.d)*b.rscale,axis=this.font.params.axis_height,items=[];let x=0,opTop=0,opBottom=0;
   const operatorRatio=this.node.getProperty('elOperatorRatio')??r,drawn=!!(flags&256),height=Math.max(operatorRatio,target+2*Math.max(0,P(15,r)??0)),width=.4*operatorRatio;
   for(const [i,operator]of operators.entries()){
    if(drawn){const contour={width,top:axis+height/2,bottom:axis-height/2,hook:Math.min(.5*operatorRatio,height/3),tip:Math.min(.04*operatorRatio,width/8),stroke:Math.max(0,P(12,r)??.04)},box={w:width,h:contour.top,d:-contour.bottom,rscale:1,L:0,R:0,contour};items.push([operator,x,0,true,1,box]);opTop=contour.top;opBottom=contour.bottom;x+=width*(i===operators.length-1?1:.7);}
    else {const box=operator.getOuterBBox(),y=axis-(box.h-box.d)*box.rscale/2;items.push([operator,x,y,true]);opTop=Math.max(opTop,y+box.h*box.rscale);opBottom=Math.min(opBottom,y-box.d*box.rscale);x+=box.w*box.rscale;}
   }
   const opWidth=x,stacked=!!(flags&64),hasLower=!!(flags&16),hasUpper=!!(flags&32),lowerRatio=nativeRatio(lower.node),upperRatio=nativeRatio(upper.node),minGap=P(19,Math.min(lowerRatio,upperRatio))??0,lowerY=Math.min(opBottom-minGap-l.h*l.rscale,-(P(7,lowerRatio)??0)-l.h*l.rscale),upperY=Math.max(opTop+minGap+u.d*u.rscale,(P(6,upperRatio)??0)+u.d*u.rscale);let bodyX=opWidth+r/10;
   if(stacked){const span=Math.max(opWidth,hasLower?l.w*l.rscale:0,hasUpper?u.w*u.rscale:0),offset=(span-opWidth)/2;for(const item of items)item[1]+=offset;items.push([lower,(span-l.w*l.rscale)/2,lowerY,hasLower],[upper,(span-u.w*u.rscale)/2,upperY,hasUpper]);bodyX=span+r/10;}else {const lx=opWidth+(P(5,r)??0);items.push([lower,lx,Math.min(-(P(4,r)??0),opBottom+l.d*l.rscale),hasLower],[upper,lx,Math.max(P(3,r)??0,opTop-u.h*u.rscale),hasUpper]);bodyX=Math.max(opWidth,hasLower?lx+l.w*l.rscale:0,hasUpper?lx+u.w*u.rscale:0)+r/10;}
   items.push([body,bodyX,0,!!b.w]);const overlayRatio=this.node.getProperty('elOperatorRatio')??r,loop=flags&12,overlay=loop?integralOverlays[loop===4?60944+(flags&3):loop===8?60929:60928]:null,overlayX=overlay?(opWidth-overlay.advance*overlayRatio/1000)/2+(stacked?(bodyX-r/10-opWidth)/2:0):0;
   return this.integralData={items,overlay,overlayX,overlayY:axis-(overlay?.axis??410)*overlayRatio/1000,r:overlayRatio};
  }
  drawIntegralContour(parent,x,y,c){
   // Typeface 22 is a geometric template, not a font glyph. Its pen follows
   // Full size while hook width follows the independent variable-symbol size.
   // One continuous curve keeps the same stroke at every body height.
   const group=this.adaptor.append(parent,this.svg('g',{transform:'translate('+this.fixed(x)+' '+this.fixed(y)+')','data-equation-integral-contour':'true'})),F=v=>this.fixed(v),mid=c.width/2,left=c.tip,right=c.width-c.tip,top=c.top-c.tip,bottom=c.bottom+c.tip;
   const path=`M${F(right)} ${F(top)}C${F(right)} ${F(c.top)} ${F(mid)} ${F(c.top)} ${F(mid)} ${F(c.top-c.hook)}L${F(mid)} ${F(c.bottom+c.hook)}C${F(mid)} ${F(c.bottom)} ${F(left)} ${F(c.bottom)} ${F(left)} ${F(bottom)}`;
   this.adaptor.append(group,this.svg('path',{d:path,fill:'none',stroke:'currentColor','stroke-width':F(c.stroke),'stroke-linecap':'round','stroke-linejoin':'round'}));
   for(const [cx,cy]of [[right,top],[left,bottom]])this.adaptor.append(group,this.svg('path',{d:`M${F(cx-c.tip)} ${F(cy)}A${F(c.tip)} ${F(c.tip)} 0 1 1 ${F(cx+c.tip)} ${F(cy)}A${F(c.tip)} ${F(c.tip)} 0 1 1 ${F(cx-c.tip)} ${F(cy)}Z`,fill:'currentColor',stroke:'none'}));
  }
  drawIntegral(parent,p){const svg=this.standardSVGnode(parent);this.adaptor.setAttribute(svg,'data-equation-integral','true');for(const[child,x,y,visible,,box]of p.items)if(visible){if(box?.contour)this.drawIntegralContour(svg,x,y,box.contour);else {child.toSVG(svg);child.place(x,y);}}if(p.overlay)this.adaptor.append(svg,this.svg('path',{d:p.overlay.path,transform:'translate('+this.fixed(p.overlayX)+' '+this.fixed(p.overlayY)+') scale('+p.r+')'}));}

  jstatGeometry(){if(!this.node.getProperty('elJstat'))return null;const box=this.childNodes[0].getOuterBBox(),r=nativeRatio(this.node),w=box.w*box.rscale,gap=P(19,r)??0;return {box,r,w,gap,h:box.h*box.rscale+gap+(jointGeometry.top-jointGeometry.bottom)*r/1000,shift:box.h*box.rscale+gap-jointGeometry.bottom*r/1000};}
  drawJstat(parent,p){const svg=this.standardSVGnode(parent),base=this.childNodes[0];base.toSVG(svg);base.place(0,0);const g=jointGeometry,W=g.width/1000,H=g.halfWidth/1000,path=(code,x,sx=p.r)=>this.adaptor.append(svg,this.svg('path',{d:jstat[code].path,transform:'translate('+this.fixed(x)+' '+this.fixed(p.shift)+') scale('+sx+' '+p.r+')'}));if(p.w<=W*p.r)path(60941,0,p.w/W);else {path(60942,0);path(60943,p.w-H*p.r);this.adaptor.append(svg,this.svg('rect',{x:this.fixed(H*p.r),y:this.fixed(p.shift+g.joinY*p.r/1000),width:this.fixed(p.w-W*p.r),height:this.fixed(g.stroke*p.r/1000)}));}}

  doubleGeometry(){const flags=this.node.getProperty('elDoubleArrow');if(flags===undefined)return null;if(this.doubleData)return this.doubleData;const [above,below,top,bottom]=this.childNodes,a=above.getOuterBBox(),b=below.getOuterBBox(),r=nativeRatio(this.node),spaceAdvance=nativeFaces.find(f=>f.font===prefs.styles[1]?.font&&f.style===prefs.styles[1]?.style)?.glyphs?.[32]?.advance??250,base=Math.trunc(spaceAdvance*full32/1000),scaled=Math.trunc(base*Math.trunc(full32*r)/full32),ef5=Q((Math.trunc((G(17)??3200)*Math.trunc(scaled*4)/100)>>5)/(32*full)),w=Math.max(a.w*a.rscale,b.w*b.rscale)+2*ef5,tw=w-(flags&32?ef5:0),bw=w-(flags&16?ef5:0);
   const topCore=top.coreMO(),bottomCore=bottom.coreMO();topCore.canStretch(2);topCore.getStretchedVariant([tw]);bottomCore.canStretch(2);bottomCore.getStretchedVariant([bw]);top.invalidateBBox();bottom.invalidateBBox();const t=top.getOuterBBox(),d=bottom.getOuterBBox(),axis=this.font.params.axis_height,ty=axis+3*(t.h+t.d)*t.rscale/8-((flags&3)===2?-t.d:(t.h-t.d)/2)*t.rscale,by=axis-3*(d.h+d.d)*d.rscale/8-((flags&3)===2?d.h:(d.h-d.d)/2)*d.rscale,ay=Math.max(axis+3*(t.h+t.d)*t.rscale/8+(P(9,nativeRatio(above.node))??0),ty+t.h*t.rscale+(P(19,r)??0))+a.d*a.rscale,dy=Math.min(axis-3*(d.h+d.d)*d.rscale/8-(P(10,nativeRatio(below.node))??0),by-d.d*d.rscale-(P(19,r)??0))-b.h*b.rscale;
   return this.doubleData={w,items:[[above,(w-a.w*a.rscale)/2,ay,!!(flags&4)],[below,(w-b.w*b.rscale)/2,dy,!!(flags&8)],[top,(w-t.w*t.rscale)/2,ty,true],[bottom,(w-d.w*d.rscale)/2,by,true]]};
  }

  whiteGeometry(){const flags=this.node.getProperty('elWhiteFence');if(!flags)return null;const box=this.childNodes[0].getOuterBBox(),r=nativeRatio(this.node),w=(this.font.getChar('normal',0x5b)?.[2]??.278)*r,over=P(15,r)??0;return {flags,box,w,top:box.h*box.rscale+over,bottom:-box.d*box.rscale-over,t:Math.max(0,P(12,r)??.04)};}
  positions(){const tabs=this.node.getProperty('elRuler');if(!tabs)return null;let current=0;const result=[];for(let i=0;i<this.childNodes.length;i++){const child=this.childNodes[i],box=child.getOuterBBox();let x=current;if(i){const tab=tabs.positions.findIndex(p=>p>current*full*32+1e-7),position=tab<0?(Math.trunc(current*full*32/1152)+1)*1152:tabs.positions[tab],type=tab<0?0:tabs.types[tab];x=position/(32*full)-anchor(child,type);}result.push(x);current=Math.max(current,x+(box.L+box.w+box.R)*box.rscale);}return result;}
  computeBBox(bbox,recompute){const bar=this.barGeometry();if(bar){bbox.empty();bbox.append(bar.box);if(bar.under)bbox.d+=bar.gap+bar.t+(bar.count-1)*3*bar.t;else bbox.h+=bar.gap+bar.t+(bar.count-1)*3*bar.t;bbox.clean();this.setChildPWidths(recompute);return;}const integral=this.integralGeometry();if(integral){bbox.empty();for(const[child,x,y,visible,,custom]of integral.items)if(visible)bbox.combine(custom??child.getOuterBBox(),x,y);if(integral.overlay){bbox.h=Math.max(bbox.h,integral.overlayY+integral.overlay.bounds[3]*integral.r/1000);bbox.d=Math.max(bbox.d,-integral.overlayY-integral.overlay.bounds[1]*integral.r/1000);}bbox.clean();this.setChildPWidths(recompute);return;}const joint=this.jstatGeometry();if(joint){bbox.h=joint.h;bbox.d=joint.box.d*joint.box.rscale;bbox.w=joint.w;this.setChildPWidths(recompute);return;}const double=this.doubleGeometry();if(double){bbox.empty();for(const [child,x,y,visible]of double.items)if(visible)bbox.combine(child.getOuterBBox(),x,y);bbox.w=double.w;bbox.clean();this.setChildPWidths(recompute);return;}const white=this.whiteGeometry();if(white){bbox.h=white.top;bbox.d=-white.bottom;bbox.w=white.box.w*white.box.rscale+((white.flags&1?1:0)+(white.flags&2?1:0))*white.w;this.setChildPWidths(recompute);return;}const positions=this.positions();if(!positions)return super.computeBBox(bbox,recompute);bbox.empty();this.childNodes.forEach((child,i)=>bbox.combine(child.getOuterBBox(),positions[i],0));bbox.clean();this.setChildPWidths(recompute);}
  toSVG(parent){const bar=this.barGeometry();if(bar)return this.drawBar(parent,bar);const integral=this.integralGeometry();if(integral)return this.drawIntegral(parent,integral);const joint=this.jstatGeometry();if(joint)return this.drawJstat(parent,joint);const double=this.doubleGeometry();if(double){const svg=this.standardSVGnode(parent);for(const [child,x,y,visible]of double.items)if(visible){child.toSVG(svg);child.place(x,y);}return;}const white=this.whiteGeometry();if(white){const svg=this.standardSVGnode(parent),base=this.childNodes[0],left=white.flags&1?white.w:0;base.toSVG(svg);base.place(left,0);const draw=(x,sign)=>{const t=white.t,top=white.top,bottom=white.bottom,w=white.w;for(const dx of [0,w/3])this.adaptor.append(svg,this.svg('rect',{x:this.fixed(x+sign*dx-(sign<0?t:0)),y:this.fixed(bottom),width:this.fixed(t),height:this.fixed(top-bottom)}));for(const y of [top-t,bottom])this.adaptor.append(svg,this.svg('rect',{x:this.fixed(sign>0?x:x-w+t),y:this.fixed(y),width:this.fixed(w),height:this.fixed(t)}));};if(white.flags&1)draw(0,1);if(white.flags&2)draw(left+white.box.w*white.box.rscale+white.w-white.t,-1);return;}const positions=this.positions();if(!positions)return super.toSVG(parent);const svg=this.standardSVGnode(parent);this.childNodes.forEach((child,i)=>{child.toSVG(svg);child.place(positions[i],0);});}
 }
 factory.setNodeClass('mfrac',Fraction);factory.setNodeClass('msqrt',rootClass(SVGmsqrt));factory.setNodeClass('mroot',rootClass(SVGmroot));factory.setNodeClass('mtable',Table);factory.setNodeClass('msub',scriptClass(SVGmsub));factory.setNodeClass('msup',scriptClass(SVGmsup));factory.setNodeClass('msubsup',scriptClass(SVGmsubsup));
 factory.setNodeClass('mover',markClass(SVGmover));factory.setNodeClass('munder',markClass(SVGmunder));factory.setNodeClass('munderover',markClass(SVGmunderover));
 factory.setNodeClass('mrow',RulerRow);
 // Native boundary spacing is supplied for every atom, not only MathML mo.
 for(const kind of factory.getKinds()){const Base=factory.getNodeClass(kind);factory.setNodeClass(kind,class extends Base{getSpace(){const gap=this.node.getProperty('elGap');if(gap===undefined)super.getSpace();else {this.bbox.L=gap;this.bbox.R=0;}} computeBBox(bbox,recompute){super.computeBBox(bbox,recompute);bbox.w+=this.node.getProperty('elCharWidth')??0;}});}
 const postFilter=({data})=>{
  data.root.walkTree(node=>{
   if(node.kind==='mo'){node.attributes.set('lspace','0em');node.attributes.set('rspace','0em');if(node.attributes.get('fence')){node.attributes.set('minsize',(100+2*(P(15)??0)*100)+'%');}}
   if(node.kind==='mfrac'){let parent=node.parent,nesting=0;while(parent){if(parent.kind==='mfrac')nesting++;parent=parent.parent;}const thick=P(nesting?13:12);if(thick!==undefined&&!node.attributes.get('bevelled'))node.attributes.set('linethickness',Math.max(0,Q(thick))+'em');}
   if(node.kind==='menclose'){const notation=node.attributes.get('notation')??'',strike=/strike/.test(notation);node.attributes.set('data-thickness',Math.max(0,P(strike?26:25)??.04)+'em');node.attributes.set('data-padding',Math.max(0,P(20)??.1)+'em');}
   if(node.kind==='mtable')node.setProperty('useHeight',false);
   if(node.kind==='mrow'||node.kind==='inferredMrow'){
    const children=node.childNodes.filter(c=>c.kind!=='mspace'),classes=children.map(tokenClass);
    for(let i=0;i<classes.length;i++)if(classes[i]===5&&(!i||[4,5,6,7,9].includes(classes[i-1])||[6,8,9].includes(classes[i+1])))classes[i]=4;
    children.forEach((child,i)=>{const gap=i?boundaryGap(classes[i-1],classes[i],nativeRatio(child)):0;
     child.setProperty('elGap',gap);const width=P(18,nativeRatio(child));if(width&&child.getProperty('equationNativeSize'))child.setProperty('elCharWidth',width);
    });
   }
  });
 };
 const symbolGlyphs=nativeFaces.find(f=>f.font===prefs.styles[5]?.font&&f.style===prefs.styles[5]?.style)?.glyphs,axis=symbolGlyphs?.[61]?(symbolGlyphs[61].height-symbolGlyphs[61].depth)/2000:undefined;
 return {factory,postFilter,spacing:{get:G,em:P},fontParameters:{axis_height:axis,x_height:metric?.xHeight?metric.xHeight/1000:undefined,sup1:P(3),sup2:P(3),sup3:P(3),sub1:P(4),sub2:P(4),num1:P(9),num2:P(9),num3:P(9),denom1:P(10),denom2:P(10),big_op_spacing1:P(23),big_op_spacing2:P(23),big_op_spacing3:P(6),big_op_spacing4:P(7)}};
}
