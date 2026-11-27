import {outlineCommands} from './vector-pdf.mjs';

// CoreText returns glyph paths in units of 1/1000 em. Each occupied strip
// bounds the horizontal ink in that strip, including curved extrema.
const band = 2;
const tolerance = 0.25;
// Small clearance beyond the computed outlines for SVG placement rounding
// and antialiasing where two high strokes nearly touch.
const inkMargin = 3;
const glyphProfiles = new WeakMap();

function splitCurve(points) {
 const left=[points[0]],right=[points.at(-1)];
 while(points.length>1){
  points=points.slice(1).map(([x,y],i)=>[(x+points[i][0])/2,(y+points[i][1])/2]);
  left.push(points[0]);right.unshift(points.at(-1));
 }
 return [left,right];
}

function inkProfile(glyph) {
 if(glyphProfiles.has(glyph))return glyphProfiles.get(glyph);
 if(!glyph.path)return null;
 const profile=new Map();
 function record(minY,maxY,extent){
  for(let strip=Math.floor(minY/band);strip<=Math.floor(maxY/band);strip++){
   const [left,right]=extent(strip*band),previous=profile.get(strip);
   profile.set(strip,previous?[Math.min(left,previous[0]),Math.max(right,previous[1])]:[left,right]);
  }
 }
 function line(a,b,error=0){
  const [x1,y1]=a,[x2,y2]=b,dy=y2-y1;
  const clamp=value=>Math.max(0,Math.min(1,value));
  record(Math.min(y1,y2)-error,Math.max(y1,y2)+error,y=>{
   const x=dy?x1+(x2-x1)*clamp((y-error-y1)/dy):x1;
   const xEnd=dy?x1+(x2-x1)*clamp((y+band+error-y1)/dy):x2;
   return [Math.min(x,xEnd)-error,Math.max(x,xEnd)+error];
  });
 }
 function curve(points,depth=0){
  const a=points[0],b=points.at(-1),degree=points.length-1;
  // De Casteljau's convex-hull property bounds the deviation from the
  // parameter-matched chord by the deviations of the control points.
  if(points.every((p,i)=>p.every((v,axis)=>Math.abs(v-a[axis]-(b[axis]-a[axis])*i/degree)<=tolerance))){line(a,b,tolerance);return;}
  if(depth>=12){
   const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
   record(Math.min(...ys),Math.max(...ys),()=>[Math.min(...xs),Math.max(...xs)]);return;
  }
  for(const half of splitCurve(points))curve(half,depth+1);
 }
 let current,start;
 for(const {op,values} of outlineCommands(glyph.path)){
  const points=[];for(let i=0;i<values.length;i+=2)points.push(values.slice(i,i+2));
  if(op==='M'){current=start=points[0];continue;}
  if(op==='Z')points.push(start);
  if(op==='Q'||op==='C')curve([current,...points]);else line(current,points[0]);
  current=points.at(-1);
 }
 glyphProfiles.set(glyph,profile);
 return profile;
}

export function outlineLetterClearance(glyph,nextGlyph,advance){
 // Bearings already separate most pairs. Y-strip bounds allow the slanted
 // portions of two outlines to share x extents while preserving clear ink.
 if(glyph.right+inkMargin<=advance+nextGlyph.left)return 0;
 const first=inkProfile(glyph),second=inkProfile(nextGlyph);
 if(!first?.size||!second?.size)return Math.max(0,glyph.right-nextGlyph.left+inkMargin-advance);
 let clearance=0;
 for(const [strip,[,right]] of first){
  const next=second.get(strip);
  if(next)clearance=Math.max(clearance,right-next[0]+inkMargin-advance);
 }
 return clearance;
}
