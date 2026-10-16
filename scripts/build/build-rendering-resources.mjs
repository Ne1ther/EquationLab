// Rebuild distributable rendering resources using only the shipped OFL font,
// locked Apache-2.0 MathJax source, and Equation Lab's parametric geometry.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import vm from 'node:vm';

const root=path.resolve(import.meta.dirname,'../..');
const hash=b=>createHash('sha256').update(b).digest('hex');
const fontPath=path.join(root,'assets/fonts/STIXTwoMath-Regular.otf');
const font=await fs.readFile(fontPath);
const fontSource=JSON.parse(await fs.readFile(path.join(root,'assets/fonts/source.json'),'utf8'));
if(hash(font)!==fontSource.sha256)throw Error('Bundled STIX font does not match its source record.');
const helperCandidates=['.build/release/EquationFontMetrics','.build/out/Products/Release/EquationFontMetrics','.build/debug/EquationFontMetrics'];
let helper;
for(const rel of helperCandidates)if(await fs.access(path.join(root,rel)).then(()=>true,()=>false)){helper=path.join(root,rel);break;}
if(!helper){execFileSync('/usr/bin/swift',['build','--product','EquationFontMetrics'],{cwd:root,stdio:'inherit'});helper=path.join(root,'.build/debug/EquationFontMetrics');}
const codes=[0x2210,0x2229,0x222a];
const response=JSON.parse(execFileSync(helper,[],{cwd:root,encoding:'utf8',input:JSON.stringify({faces:[{font:'STIX Two Math',style:0,characters:codes}]}),timeout:30000}));
if(response.error)throw Error(response.error);
const face=response.faces[0],operators={};
for(const code of codes){const g=face.glyphs[code];if(!g?.path)throw Error('Missing STIX operator '+code);operators[code]={unicode:code,sourceFont:'STIX Two Math',postscript:face.postscript,license:'OFL-1.1',path:g.path,advance:g.advance,bounds:[g.left,-g.depth,g.right,g.height]};}

// A stroked ellipse represented as oppositely wound closed paths. It can be
// exported through the existing SVG/PDF pipeline without a proprietary glyph.
const ellipse=(cx,cy,rx,ry,reverse=false)=>{
 const sweep=reverse?0:1;
 return `M${cx-rx} ${cy}A${rx} ${ry} 0 1 ${sweep} ${cx+rx} ${cy}A${rx} ${ry} 0 1 ${sweep} ${cx-rx} ${cy}Z`;
};
function loop(width,direction=0){
 const cx=width/2,cy=400,rx=width/2-20,ry=180,t=24;
 let d=ellipse(cx,cy,rx,ry)+ellipse(cx,cy,rx-t,ry-t,true);
 if(direction){const x=cx+rx,y=cy,sign=direction;d+=`M${x} ${y+sign*76}L${x-62} ${y-sign*38}L${x+20} ${y-sign*38}Z`;}
 return {path:d,advance:width,bounds:[0,cy-ry,width,cy+ry],axis:cy,source:'Equation Lab ellipse and tangent-arrow construction',license:'MIT'};
}
const pieces={
 schema:'equationlab.open-rendering-pieces.v1',
 source:'STIX Two Math operators plus Equation Lab parametric marks; no vendor font outlines',
 unitsPerEm:1000,
 licenses:{operators:'OFL-1.1',geometry:'MIT'},
 font:{file:'assets/fonts/STIXTwoMath-Regular.otf',sha256:hash(font),source:fontSource.source,licenseFile:'assets/fonts/OFL-STIX.txt'},
 jointGeometry:{width:800,halfWidth:400,bottom:600,top:800,joinY:760,stroke:40},
 jstat:{
  60941:{path:'M0 600L150 800H650L800 600H752L630 760H170L48 600Z',advance:800,bounds:[0,600,800,800],source:'Equation Lab angular bracket construction',license:'MIT'},
  60942:{path:'M0 600L150 800H400V760H170L48 600Z',advance:400,bounds:[0,600,400,800],source:'Equation Lab angular bracket construction',license:'MIT'},
  60943:{path:'M0 800H250L400 600H352L230 760H0Z',advance:400,bounds:[0,600,400,800],source:'Equation Lab angular bracket construction',license:'MIT'}
 },
 integralOverlays:{60928:loop(400,1),60929:loop(400,-1),60945:loop(400),60946:loop(700),60947:loop(1000)},
 mtExtraOperators:operators
};

const mathjaxPath=path.join(root,'node_modules/mathjax-full/js/core/MmlTree/MmlNode.js');
const mathjax=await fs.readFile(mathjaxPath,'utf8');
const literal=/var TEXSPACE = (\[[\s\S]*?\n\]);/.exec(mathjax)?.[1];
if(!literal)throw Error('Locked MathJax TEXSPACE definition not found.');
const tex=vm.runInNewContext(literal,Object.create(null),{timeout:1000});
if(tex.length!==8||tex.some(row=>row.length!==8||row.some(n=>!Number.isInteger(n)||Math.abs(n)>3)))throw Error('Unexpected TeX spacing classes.');
// Local classes: number, letter, operator, unary, binary, relation, open,
// close, punctuation, compound. Map them to MathJax's public TeX classes.
const classes=[0,0,1,0,2,3,4,5,6,7];
const tables=[false,true].map(script=>classes.map(a=>classes.map(b=>{
 const n=tex[a][b];return script&&n>=0?1:[1,2,3,4][Math.abs(n)];
})));
const spacing={schema:'equationlab.open-spacing.v1',source:'MathJax 3.2.2 TeX class spacing, mapped to Equation Lab token classes',license:'Apache-2.0',sourceFile:'node_modules/mathjax-full/js/core/MmlTree/MmlNode.js',sourceSha256:hash(Buffer.from(mathjax)),classMap:classes,tables};
await fs.writeFile(path.join(root,'src/native-template-pieces.json'),JSON.stringify(pieces,null,2)+'\n');
await fs.writeFile(path.join(root,'src/native-spacing-tables.json'),JSON.stringify(spacing,null,2)+'\n');
console.log(JSON.stringify({operatorFont:face.postscript,operators:codes.length,geometry:'Equation Lab parametric paths',spacing:'MathJax TeX classes',vendorInputsRead:false}));
