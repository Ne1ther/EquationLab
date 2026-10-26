import {DOMParser} from '@xmldom/xmldom';

const identity=[1,0,0,1,0,0];
function multiply(a,b){return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];}
const numbers=s=>(s.match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi)||[]).map(Number);
function transform(text){
 let result=identity;
 for(const match of text.matchAll(/(translate|scale|matrix)\(([^)]*)\)/g)){
  const v=numbers(match[2]);let m;
  if(match[1]==='translate'&&v.length>=1&&v.length<=2)m=[1,0,0,1,v[0],v[1]||0];
  else if(match[1]==='scale'&&v.length>=1&&v.length<=2)m=[v[0],0,0,v[1]??v[0],0,0];
  else if(match[1]==='matrix'&&v.length===6)m=v;
  else throw Error('Unsupported vector transform');
  result=multiply(result,m);
 }
 if(text.replace(/(translate|scale|matrix)\([^)]*\)/g,'').trim())throw Error('Unsupported vector transform');
 return result;
}

// Endpoint ellipse parameters to cubic segments, at most a quarter turn each.
// Radii correction and sweep/large-arc choices follow SVG's endpoint geometry.
function arcCommands(x,y,rx,ry,rotation,large,sweep,x2,y2){
 if(![0,1].includes(large)||![0,1].includes(sweep)||rx<0||ry<0)throw Error('Invalid vector arc');
 if(!rx||!ry||x===x2&&y===y2)return [{op:'L',values:[x2,y2]}];
 const angle=rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),dx=(x-x2)/2,dy=(y-y2)/2,xp=c*dx+s*dy,yp=-s*dx+c*dy;
 const lambda=xp*xp/(rx*rx)+yp*yp/(ry*ry);if(lambda>1){rx*=Math.sqrt(lambda);ry*=Math.sqrt(lambda);}
 const denominator=rx*rx*yp*yp+ry*ry*xp*xp,factor=(large===sweep?-1:1)*Math.sqrt(Math.max(0,(rx*rx*ry*ry-denominator)/denominator)),cxp=factor*rx*yp/ry,cyp=-factor*ry*xp/rx,cx=c*cxp-s*cyp+(x+x2)/2,cy=s*cxp+c*cyp+(y+y2)/2;
 const ux=(xp-cxp)/rx,uy=(yp-cyp)/ry,vx=(-xp-cxp)/rx,vy=(-yp-cyp)/ry;let start=Math.atan2(uy,ux),delta=Math.atan2(ux*vy-uy*vx,ux*vx+uy*vy);if(!sweep&&delta>0)delta-=2*Math.PI;if(sweep&&delta<0)delta+=2*Math.PI;
 const count=Math.ceil(Math.abs(delta)/(Math.PI/2)),step=delta/count,out=[],point=t=>[cx+c*rx*Math.cos(t)-s*ry*Math.sin(t),cy+s*rx*Math.cos(t)+c*ry*Math.sin(t)],derivative=t=>[-c*rx*Math.sin(t)-s*ry*Math.cos(t),-s*rx*Math.sin(t)+c*ry*Math.cos(t)];
 for(let i=0;i<count;i++){const end=start+step,a=point(start),b=point(end),da=derivative(start),db=derivative(end),k=4/3*Math.tan(step/4);out.push({op:'C',values:[a[0]+k*da[0],a[1]+k*da[1],b[0]-k*db[0],b[1]-k*db[1],...b]});start=end;}out.at(-1).values.splice(4,2,x2,y2);return out;
}

// Normalize the closed outline vocabulary emitted by CoreText and MathJax.
// Unsupported commands fail instead of silently dropping visible strokes.
export function outlineCommands(data){
 const tokens=data.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi)||[];
 if(data.replace(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?|[\s,]/gi,''))throw Error('Invalid vector path');
 let i=0,command,x=0,y=0,sx=0,sy=0,control=null,previous='';const out=[];
 const count={M:2,L:2,H:1,V:1,Q:4,T:2,C:6,S:4,A:7};
 while(i<tokens.length){
  if(/^[a-z]$/i.test(tokens[i]))command=tokens[i++];
  if(!command)throw Error('Missing vector path command');
  const op=command.toUpperCase(),relative=command!==op;
  if(op==='Z'){out.push({op:'Z',values:[]});x=sx;y=sy;control=null;previous=op;command=null;continue;}
  const n=count[op];if(!n||i+n>tokens.length)throw Error('Unsupported vector path command '+op);
  const v=tokens.slice(i,i+n).map(Number);if(!v.every(Number.isFinite))throw Error('Invalid vector coordinates');i+=n;
  if(op==='A'){const x2=v[5]+(relative?x:0),y2=v[6]+(relative?y:0);out.push(...arcCommands(x,y,...v.slice(0,5),x2,y2));x=x2;y=y2;control=null;previous=op;continue;}
  const p=(j)=>[v[j]+(relative?x:0),v[j+1]+(relative?y:0)];let values,kind=op,nextControl=null;
  if(op==='H'){values=[v[0]+(relative?x:0),y];kind='L';}
  else if(op==='V'){values=[x,v[0]+(relative?y:0)];kind='L';}
  else if(op==='T'){const a=previous==='Q'||previous==='T'?[2*x-control[0],2*y-control[1]]:[x,y];values=[...a,...p(0)];kind='Q';nextControl=a;}
  else if(op==='S'){const a=previous==='C'||previous==='S'?[2*x-control[0],2*y-control[1]]:[x,y];values=[...a,...p(0),...p(2)];kind='C';nextControl=values.slice(2,4);}
  else {values=[];for(let j=0;j<n;j+=2)values.push(...p(j));if(op==='Q')nextControl=values.slice(0,2);if(op==='C')nextControl=values.slice(2,4);}
  [x,y]=values.slice(-2);if(op==='M'){sx=x;sy=y;command=relative?'l':'L';}
  out.push({op:kind,values});control=nextControl;previous=op;
 }
 return out;
}

/** Drawn bounds in SVG viewBox coordinates, including transformed curves.
 * Keep advances/empty template slots separately in the caller's layout box. */
export function vectorInkBounds({vector}){
 let bounds=null;
 const merge=(a,b)=>a?[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[2],b[2]),Math.max(a[3],b[3])]:b;
 const point=([a,b,c,d,e,f],x,y)=>[a*x+c*y+e,b*x+d*y+f];
 const curve=(points,t)=>{const p=points.map(x=>[...x]);for(let n=p.length-1;n>0;n--)for(let i=0;i<n;i++)for(let axis=0;axis<2;axis++)p[i][axis]=(1-t)*p[i][axis]+t*p[i+1][axis];return p[0];};
 for(const item of vector){
  const stroked=item.stroke!=='none'&&item.strokeWidth>0;if(item.fill==='none'&&!stroked)continue;
  let box=null,current=[0,0],start=current;
  for(const {op,values}of item.commands){
   const points=[];for(let i=0;i<values.length;i+=2)points.push(point(item.matrix,values[i],values[i+1]));
   if(op==='M'){current=start=points[0];continue;}
   if(op==='Z')points.push(start);
   const p=[current,...points],times=[0,1];
   for(let axis=0;axis<2;axis++){
    const v=p.map(x=>x[axis]);
    if(op==='Q'){const denominator=v[0]-2*v[1]+v[2];if(denominator)times.push((v[0]-v[1])/denominator);}
    if(op==='C'){
     const a=-v[0]+3*v[1]-3*v[2]+v[3],b=2*(v[0]-2*v[1]+v[2]),c=v[1]-v[0];
     if(Math.abs(a)<1e-12){if(b)times.push(-c/b);}else {const discriminant=b*b-4*a*c;if(discriminant>=0)times.push((-b+Math.sqrt(discriminant))/(2*a),(-b-Math.sqrt(discriminant))/(2*a));}
    }
   }
   for(const t of times)if(t>=0&&t<=1){const [x,y]=curve(p,t);box=merge(box,[x,y,x,y]);}
   current=points.at(-1);
  }
  if(!box)continue;
  if(stroked){const [a,b,c,d]=item.matrix,margin=item.strokeWidth/2*Math.max(Math.hypot(a,b),Math.hypot(c,d))*(item.lineJoin==='miter'?10:1);box=[box[0]-margin,box[1]-margin,box[2]+margin,box[3]+margin];}
  for(const clip of item.clips??[]){const [x,y,w,h]=clip.rect,corners=[[x,y],[x+w,y],[x,y+h],[x+w,y+h]].map(([cx,cy])=>point(clip.matrix,cx,cy)),cb=corners.reduce((b,[cx,cy])=>merge(b,[cx,cy,cx,cy]),null);box=[Math.max(box[0],cb[0]),Math.max(box[1],cb[1]),Math.min(box[2],cb[2]),Math.min(box[3],cb[3])];}
  if(box[0]<=box[2]&&box[1]<=box[3])bounds=merge(bounds,box);
 }
 return bounds;
}

export function vectorPdfRequest(svg,width,height){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw Error('Invalid vector output dimensions');
 if(width>10000||height>10000)throw Error('Formula exceeds the 10,000 pt image/PDF size limit; add line breaks or reduce the font size.');
 if(typeof svg!=='string'||svg.length>24_000_000||/<!DOCTYPE|<!ENTITY/i.test(svg))throw Error('Invalid vector document');
 const doc=new DOMParser().parseFromString(svg,'image/svg+xml'),root=doc.documentElement,view=numbers(root.getAttribute('viewBox'));
 if(root.tagName!=='svg'||view.length!==4||view[2]<=0||view[3]<=0||!view.every(Number.isFinite))throw Error('Invalid vector viewBox');
 const vector=[],ids=new Map();let visits=0;
 function index(el){if(el.nodeType!==1)return;const id=el.getAttribute('id');if(id){if(ids.has(id))throw Error('Duplicate vector reference');ids.set(id,el);}for(const c of el.childNodes)index(c);}index(root);
 function visit(el,parent,fill,stroke,strokeWidth,clips=[],references=[]){
  if(el.nodeType!==1)return;
  if(++visits>200000||references.length>64)throw Error('Vector reference expansion exceeds limit');
  if(el.tagName==='defs')return;
  let matrix=multiply(parent,transform(el.getAttribute('transform')||''));
  if(el.tagName==='svg'&&el!==root){
   const v=numbers(el.getAttribute('viewBox')),x=Number(el.getAttribute('x')||0),y=Number(el.getAttribute('y')||0),w=Number(el.getAttribute('width')),h=Number(el.getAttribute('height'));
   if(v.length!==4||![x,y,w,h,...v].every(Number.isFinite)||w<=0||h<=0||v[2]<=0||v[3]<=0)throw Error('Invalid nested vector viewport');
   clips=[...clips,{matrix,rect:[x,y,w,h]}];
   const aspect=el.getAttribute('preserveAspectRatio')||'xMidYMid meet';let sx=w/v[2],sy=h/v[3],dx=0,dy=0;
   if(aspect!=='none'){
    if(aspect!=='xMidYMid meet')throw Error('Unsupported nested vector alignment');
    sx=sy=Math.min(sx,sy);dx=(w-v[2]*sx)/2;dy=(h-v[3]*sy)/2;
   }
   matrix=multiply(matrix,[sx,0,0,sy,x+dx-v[0]*sx,y+dy-v[1]*sy]);
  }
  const styles=Object.fromEntries((el.getAttribute('style')||'').split(';').filter(s=>s.includes(':')).map(s=>s.split(':').map(v=>v.trim())));
  fill=styles.fill||el.getAttribute('fill')||fill;stroke=styles.stroke||el.getAttribute('stroke')||stroke;strokeWidth=styles['stroke-width']!==undefined?Number(styles['stroke-width']):el.hasAttribute('stroke-width')?Number(el.getAttribute('stroke-width')):strokeWidth;
  if(el.tagName==='use'){
   const href=el.getAttribute('href')||el.getAttribute('xlink:href');
   if(!/^#[^\s#]+$/.test(href))throw Error('External or invalid vector reference');
   const id=href.slice(1),target=ids.get(id);if(!target)throw Error('Missing vector reference');if(references.includes(id))throw Error('Cyclic vector reference');
   const x=Number(el.getAttribute('x')||0),y=Number(el.getAttribute('y')||0);if(![x,y].every(Number.isFinite))throw Error('Invalid vector reference position');
   visit(target,multiply(matrix,[1,0,0,1,x,y]),fill,stroke,strokeWidth,clips,[...references,id]);return;
  }
  const color=c=>c==='currentColor'?'#000000':c;
  if(['path','rect','line','polyline','polygon'].includes(el.tagName)){
   let commands;
   if(el.tagName==='path')commands=outlineCommands(el.getAttribute('d'));
   else if(el.tagName==='line'){const p=['x1','y1','x2','y2'].map(k=>Number(el.getAttribute(k)||0));commands=outlineCommands(`M${p[0]} ${p[1]}L${p[2]} ${p[3]}`);}
   else if(el.tagName==='polyline'||el.tagName==='polygon'){const p=numbers(el.getAttribute('points'));if(p.length<4||p.length%2)throw Error('Invalid vector polygon');commands=outlineCommands('M'+p.slice(0,2).join(' ')+'L'+p.slice(2).join(' ')+(el.tagName==='polygon'?'Z':''));}
   else {const x=Number(el.getAttribute('x')||0),y=Number(el.getAttribute('y')||0),w=Number(el.getAttribute('width')),h=Number(el.getAttribute('height'));commands=outlineCommands(`M${x} ${y}h${w}v${h}h${-w}Z`);}
   if(![...matrix,strokeWidth,...commands.flatMap(c=>c.values)].every(Number.isFinite))throw Error('Invalid vector geometry');
   vector.push({matrix,commands,fill:color(fill),stroke:color(stroke),strokeWidth,clips,lineCap:el.getAttribute('stroke-linecap')||'butt',lineJoin:el.getAttribute('stroke-linejoin')||'miter'});
  }else if(!['svg','g','title','desc'].includes(el.tagName))throw Error('Unsupported vector element '+el.tagName);
  for(const child of el.childNodes)visit(child,matrix,fill,stroke,strokeWidth,clips,references);
 }
 visit(root,identity,'#000000','none',0);
 if(!vector.length||vector.length>50000)throw Error('Invalid vector outline count');
 return {vector,viewBox:view,width,height};
}
