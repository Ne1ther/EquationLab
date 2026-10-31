import {access} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {mathjax} from 'mathjax-full/js/mathjax.js';
import {TeX} from 'mathjax-full/js/input/tex.js';
import {SVG} from 'mathjax-full/js/output/svg.js';
import {TeXFont} from 'mathjax-full/js/output/svg/fonts/tex.js';
import {liteAdaptor} from 'mathjax-full/js/adaptors/liteAdaptor.js';
import {RegisterHTMLHandler} from 'mathjax-full/js/handlers/html.js';
import {AllPackages} from 'mathjax-full/js/input/tex/AllPackages.js';
import {CommandMap} from 'mathjax-full/js/input/tex/SymbolMap.js';
import {Configuration} from 'mathjax-full/js/input/tex/Configuration.js';
import {inspectOle,oleRenderLatex,makeOle} from './native.mjs';
import {readTypography} from './typography-native.mjs';
import {vectorPdfRequest,vectorInkBounds} from './vector-pdf.mjs';
import {nativeDimension32} from './native-dimensions.mjs';
import {createNativeLayout} from './native-layout.mjs';
import {legacyOutline} from './legacy-glyphs.mjs';

const adaptor=liteAdaptor();RegisterHTMLHandler(adaptor);
const {mtExtraOperators={}}=JSON.parse(readFileSync(new URL('./native-template-pieces.json',import.meta.url)));
const symbolAngleOutlines=Object.freeze({0x2329:0x3008,0x232a:0x3009,0x27e8:0x3008,0x27e9:0x3009});
new CommandMap('equation-native-glyphs',{elglyph:'Glyph',elroot:'Root',elmeta:'Metadata',elruler:'Ruler',elrows:'PileRows',elwhite:'WhiteFence',elbar:'Bar',elDoubleArrow:'DoubleArrow',elStretchIntegral:'StretchIntegral',elJstat:'Jstat',overrightharpoon:'Harpoon',underrightharpoon:'Harpoon'},{Glyph(parser,name){
 const variant=parser.GetArgument(name),size=Number(parser.GetArgument(name)),code=Number.parseInt(parser.GetArgument(name),16),color=parser.GetArgument(name);
 if(!/^el\d+$/.test(variant)||!Number.isFinite(size)||size<=0||size>100||!Number.isInteger(code)||code<1||code>0x10ffff||code>=0xd800&&code<=0xdfff||!/^#[0-9a-f]{6}$/i.test(color))throw Error('Invalid native glyph');
 const ch=String.fromCodePoint(code),kind=/[A-Za-z\u0370-\u03ff]/.test(ch)||code>65535?'mi':/[0-9]/.test(ch)?'mn':'mo';
 // Native SIZE and outlines are authoritative. Letting MathJax infer largeop
 // replaces a custom CoreText variant with its -smallop/-largeop font, which
 // can silently emit an unembedded browser <text> for contour integrals.
 const token=parser.create('token',kind,{mathvariant:variant,stretchy:false,largeop:false,mathcolor:color},ch);token.setProperty('equationNativeSize',size);parser.Push(token);
},Root(parser,name){
 const ratio=Number(parser.GetArgument(name)),node=parser.ParseArg(name);if(!Number.isFinite(ratio)||ratio<=0||ratio>100)throw Error('Invalid native root size');
 let root;node.walkTree(n=>{if(!root&&['msqrt','mroot'].includes(n.kind))root=n;});if(!root)throw Error('Missing native root');root.setProperty('elNativeBoxRatio',ratio);parser.Push(node);
},Metadata(parser,name){
 const kind=Number(parser.GetArgument(name)),flags=Number(parser.GetArgument(name)),node=parser.ParseArg(name);
 if(!Number.isInteger(kind)||!Number.isInteger(flags)||flags<0||flags>65535)throw Error('Invalid native layout metadata');
 if(kind===102){
  // ParBoxClass 67aca0 fits the body when 67b240 finds a noncentral
  // matrix/pile baseline. Apply this only to this fence pair; nested
  // fences retain their own native decision.
  let row;node.walkTree(n=>{if(!row&&['mrow','inferredMrow'].includes(n.kind)&&n.childNodes.some(c=>c.kind==='mo'&&c.attributes.get('fence')))row=n;});
  if(row)for(const child of row.childNodes)if(child.kind==='mo'&&child.attributes.get('fence'))child.setProperty('elFenceFitBody',true);
 }
 const targetKind=kind===100||kind===101?'mtable':kind===11?'mfrac':null;let target;
 node.walkTree(n=>{if(!target&&(n.kind===targetKind||(kind>=24&&kind<=34||kind===200)&&['mover','munder'].includes(n.kind)))target=n;});
 if(target){if(kind===100){target.attributes.set('equalcolumns',!!(flags&1));target.attributes.set('equalrows',!!(flags&2));const v=flags>>4,rows=target.childNodes.length;target.attributes.set('align',v===0?'baseline 1':v===2?'baseline -1':v===1?(rows%2&&rows<=3?'baseline '+Math.ceil(rows/2):'axis'):'top');}if(kind===101){target.setProperty('elPile',true);const h=flags&15,v=flags>>4;if([1,2,3].includes(h))target.attributes.set('columnalign',{1:'left',2:'center',3:'right'}[h]);target.attributes.set('align',v===0?'baseline 1':v===2?'baseline -1':v===1?(target.childNodes.length%2?'baseline '+Math.ceil(target.childNodes.length/2):'axis'):'top');}if(kind===11)target.setProperty('elSmallFraction',!!(flags&1));if(kind>=31&&kind<=34)target.setProperty('elNativeWideMark',true);if(kind===200)target.attributes.set(target.kind==='munder'?'accentunder':'accent',true);}
 parser.Push(node);
},Bar(parser,name){const under=Number(parser.GetArgument(name)),count=Number(parser.GetArgument(name));if(![0,1].includes(under)||![1,2].includes(count))throw Error('Invalid native bar');const node=parser.create('node','mrow',[parser.create('node','TeXAtom',[parser.ParseArg(name)])]);node.setProperty('elNativeBar',{under,count});parser.Push(node);
},StretchIntegral(parser,name){const flags=Number(parser.GetArgument(name)),ratio=Number(parser.GetArgument(name)),operatorRatio=Number(parser.GetArgument(name));if(!Number.isInteger(flags)||flags<1||flags>0x17f||!(flags&3)||!Number.isFinite(ratio)||ratio<=0||!Number.isFinite(operatorRatio)||operatorRatio<=0)throw Error('Invalid integral layout');const children=Array.from({length:3},()=>parser.create('node','TeXAtom',[parser.ParseArg(name)]));for(let i=0;i<(flags&3);i++)children.push(parser.create('node','TeXAtom',[flags&256?parser.create('token','mo',{stretchy:true,largeop:false,mathsize:operatorRatio+'em'},'\u222b'):parser.ParseArg(name)]));const node=parser.create('node','mrow',children);node.setProperty('elStretchIntegral',flags);node.setProperty('elNativeBoxRatio',ratio);node.setProperty('elOperatorRatio',operatorRatio);parser.Push(node);
},Jstat(parser,name){const base=parser.create('node','TeXAtom',[parser.ParseArg(name)]),node=parser.create('node','mrow',[base]);node.setProperty('elJstat',true);parser.Push(node);
},DoubleArrow(parser,name){const flags=Number(parser.GetArgument(name)),ratio=Number(parser.GetArgument(name));if(!Number.isInteger(flags)||flags<0||flags>63||![1,2].includes(flags&3)||!Number.isFinite(ratio)||ratio<=0||ratio>100)throw Error('Invalid double arrow variation');const above=parser.create('node','TeXAtom',[parser.ParseArg(name)]),below=parser.create('node','TeXAtom',[parser.ParseArg(name)]),harpoon=(flags&3)===2,top=parser.create('token','mo',{stretchy:true},harpoon?'\u21c0':'\u2192'),bottom=parser.create('token','mo',{stretchy:true},harpoon?'\u21bd':'\u2190'),node=parser.create('node','mrow',[above,below,parser.create('node','TeXAtom',[top]),parser.create('node','TeXAtom',[bottom])]);node.setProperty('elDoubleArrow',flags);node.setProperty('elNativeBoxRatio',ratio);parser.Push(node);
},WhiteFence(parser,name){const flags=Number(parser.GetArgument(name)),base=parser.create('node','TeXAtom',[parser.ParseArg(name)]),node=parser.create('node','mrow',[base]);if(![1,2,3].includes(flags))throw Error('Invalid white fence variation');node.setProperty('elWhiteFence',flags);parser.Push(node);
},Harpoon(parser,name){const base=parser.ParseArg(name),mark=parser.create('token','mo',{stretchy:true,accent:true},'\u21c0'),under=name.includes('under');parser.Push(parser.create('node',under?'munder':'mover',[base,mark],under?{accentunder:true}:{accent:true}));
},Ruler(parser,name){
 const positions=parser.GetArgument(name).split(',').filter(Boolean).map(Number),types=parser.GetArgument(name).split(',').filter(Boolean).map(Number),count=Number(parser.GetArgument(name));
 if(!Number.isInteger(count)||count<1||count>256||positions.length!==types.length||positions.length>255||positions.some((p,i)=>!Number.isFinite(p)||p<0||p>32767||i&&p<=positions[i-1])||types.some(t=>!Number.isInteger(t)||t<0||t>4))throw Error('Invalid native ruler');
 const children=Array.from({length:count},()=>parser.create('node','TeXAtom',[parser.ParseArg(name)])),node=parser.create('node','mrow',children);node.setProperty('elRuler',{positions,types});parser.Push(node);
},PileRows(parser,name){
 const raw=parser.GetArgument(name),spacing=raw===''?[]:raw.split(',').map(Number);if(spacing.length>30||spacing.some(value=>!Number.isInteger(value)||value < -32768||value>32767))throw Error('Invalid native pile spacing');
 const node=parser.ParseArg(name);let target;node.walkTree(n=>{if(!target&&n.kind==='mtable')target=n;});if(!target)throw Error('Missing native pile table');target.setProperty('elPile',true);target.setProperty('elExplicitRowSpacing',spacing);parser.Push(node);
}});
Configuration.create('equation-native-fonts',{handler:{macro:['equation-native-glyphs']}});

// Bounded glyph cache survives formula ordering and only asks CoreText for new
// font/style/codepoint combinations. Color and point size do not change outlines.
const glyphCache=new Map();let glyphCount=0,binaryPromise,worker,workerTail=Promise.resolve();
const stats={helperStarts:0,helperRequests:0,glyphMisses:0,glyphHits:0};
export function nativeRendererStats(){return {...stats,cachedFaces:glyphCache.size,cachedGlyphs:glyphCount};}
async function fontBinary(){
 if(!binaryPromise)binaryPromise=(async()=>{for(const candidate of ['../bin/EquationFontMetrics','../.build/release/EquationFontMetrics','../.build/out/Products/Release/EquationFontMetrics','../.build/debug/EquationFontMetrics']){const path=fileURLToPath(new URL(candidate,import.meta.url));if(await access(path).then(()=>true,()=>false))return path;}throw Error('原生字体工具尚未构建，请运行项目构建脚本');})();
 return binaryPromise;
}
function helperRequest(request){
 const result=workerTail.then(async()=>{
  const binary=await fontBinary();
  if(!worker){const child=spawn(binary,['--stdio'],{stdio:['pipe','pipe','pipe']});child.unref();child.stdin.unref?.();child.stdout.unref?.();child.stderr.unref?.();worker={child,pending:null,buffer:''};stats.helperStarts++;
   const current=worker;
   child.stdout.setEncoding('utf8');child.stdout.on('data',data=>{current.buffer+=data;if(current.buffer.length>32_000_000){child.kill();return;}let at;while((at=current.buffer.indexOf('\n'))>=0){const line=current.buffer.slice(0,at);current.buffer=current.buffer.slice(at+1);const pending=current.pending;current.pending=null;if(!pending)continue;clearTimeout(pending.timer);child.stdout.unref?.();child.stdin.unref?.();try{const value=JSON.parse(line);value.error?pending.reject(Error(value.error)):pending.resolve(value);}catch(error){pending.reject(Error('字体工具输出无效: '+error.message));}}});
   const fail=error=>{if(worker===current)worker=null;const pending=current.pending;current.pending=null;if(pending){clearTimeout(pending.timer);pending.reject(error);}};
   child.on('error',fail);child.stdin.on('error',fail);child.stdout.on('error',fail);child.on('exit',()=>fail(Error('原生字体工具已退出')));child.stderr.on('data',()=>{});
  }
  const current=worker;stats.helperRequests++;
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{if(worker===current)worker=null;current.pending=null;current.child.kill();reject(Error('原生字体工具超时'));},15000);current.pending={resolve,reject,timer};current.child.stdout.ref?.();current.child.stdin.ref?.();current.child.stdin.write(JSON.stringify(request)+'\n',error=>{if(error){clearTimeout(timer);current.pending=null;if(worker===current)worker=null;reject(error);}});});
 });workerTail=result.catch(()=>{});return result;
}
async function metrics(faces){
 // Preserve the MTEF font declaration while using the shipped, licensed STIX
 // outlines for these three operators. Report the actual outline source.
 for(const face of faces)if(face.font.toLowerCase()==='mt extra'&&face.style===0){const key=face.font.toLowerCase()+'\0'+face.style,old=glyphCache.get(key),glyphs={...old?.glyphs};let postscript=old?.postscript;for(const code of face.characters){const source=mtExtraOperators[code];if(source&&!glyphs[code]){const [left,bottom,right,top]=source.bounds;glyphs[code]={advance:source.advance,height:Math.max(0,top),depth:Math.max(0,-bottom),left,right,path:source.path};postscript=source.postscript;glyphCount++;}}glyphCache.set(key,{font:face.font,style:0,postscript:postscript??'STIXTwoMath-Regular',syntheticItalic:false,syntheticBold:false,outlineSource:'stix-two-math-ofl',glyphs});}
 const needed=[];
 for(const face of faces){const key=face.font.toLowerCase()+'\0'+face.style,cached=glyphCache.get(key),characters=[...new Set(face.characters)].filter(code=>!cached?.glyphs[code]);stats.glyphMisses+=characters.length;stats.glyphHits+=new Set(face.characters).size-characters.length;if(characters.length)needed.push({...face,characters});}
 if(needed.length){const response=await helperRequest({faces:needed});for(const face of response.faces){const key=face.font.toLowerCase()+'\0'+face.style,old=glyphCache.get(key);glyphCount+=Object.keys(face.glyphs).filter(code=>!old?.glyphs[code]).length;glyphCache.delete(key);glyphCache.set(key,{...face,glyphs:{...old?.glyphs,...face.glyphs}});}}
 const result=faces.map(face=>{const cached=glyphCache.get(face.font.toLowerCase()+'\0'+face.style);if(!cached&&face.characters.length)throw Error('Missing CoreText glyph response');return {...cached,...face,glyphs:Object.fromEntries(face.characters.map(code=>[code,cached.glyphs[code]]))};});
 // Eviction occurs after building this response, so a large valid request can
 // use its own glyphs even when it crosses the cache capacity.
 while(glyphCache.size>64||glyphCount>20000){const key=glyphCache.keys().next().value;glyphCount-=Object.keys(glyphCache.get(key).glyphs).length;glyphCache.delete(key);}return result;
}
/** Explicit worker-start warmup; importing this module starts no processes. */
export async function warmNativeRenderer(){
 await metrics([
  {font:'Times New Roman',style:0,characters:[32,61,120,73,49,50]},
  {font:'Times New Roman',style:2,characters:[120,121]},
  {font:'Symbol',style:0,characters:[43,61,8721,8747]},
  {font:'STIX Two Math',style:0,characters:[0x2a7e]}
 ]);
 // One tiny SVG initializes parser/wrapper code while the editor is loading;
 // no PNG, PDF, catalog traversal, or user document is touched.
 await renderNative(makeOle('x^2'),{raster:false});
}
function pointValue(d,full){
 const value=Number(d?.value);
 if(!Number.isFinite(value)||value<=0)throw Error('Unsupported native typesize');
 // Unit labels are checked against the public MTEF dimension encoding.
 return nativeDimension32(d,Math.trunc(full*32))/32;
}

/** Actual CoreText outlines/advances drive MathJax's layout. This does not
 * claim pixel-identical MathType spacing or replace stretchy template pieces. */
export async function renderNative(ole,{raster=true,maxWidth,maxHeight}={}){
 const {parsed,data}=inspectOle(ole);
 function validatePreferenceDigits(nodes){for(const n of nodes){
  // MTEF defines numeric digits0..9, decimal A and minus B. C/D/E in
  // numeric text cannot be emitted by the original preference writer658470.
  // Keep them readable/opaque in MtefReader; do not render and write back a
  // plausible preview of the known EQL physical-block contamination.
  if(n.type===18&&[...n.sizes,...n.spaces].some(d=>d.slice(1).some(v=>v>=12&&v<=14)))throw Error('Invalid native preference dimension nibbles; original data remains unchanged');
  if(n.children)validatePreferenceDigits(n.children);
 }}validatePreferenceDigits(parsed.records);
 function containsPreferences(nodes){return nodes.some(n=>n.type===18||n.children&&containsPreferences(n.children));}
 // A MathPage Symbol payload has no EQN_PREFS: its glyph state is fully
 // explicit. Do not manufacture global styles or logical sizes for that case.
 const prefs=containsPreferences(parsed.records)?readTypography(ole):null;
 let full=prefs?pointValue(prefs.sizes[0],12):undefined;
 if(prefs&&(full<2||full>127))throw Error('预览支持 2–127 pt 的完整字号');
 const sizes=prefs?[...prefs.sizes,...prefs.extraSizes].map(d=>pointValue(d,full)):[],fonts=[],styles=[],states=new Map(),layoutSizes=new Map(),layoutColors=new Map(),colors=[prefs?'#000000':undefined];
 const compoundDecorations=new Set();function compounds(nodes){for(const n of nodes){if(n.type===3&&n.selector===15){const decor=(n.children??[]).filter(c=>c.type===2);if(n.variation&256||decor.length>1)for(const c of decor)if(c.typeface===11||c.typeface===22)compoundDecorations.add(c.start);}if(n.children)compounds(n.children);}}compounds(parsed.records);
 let size=sizes[0],color=colors[0];
 function walk(nodes){for(const n of nodes){
  if(!prefs&&[3,4,5,6,7].includes(n.type))throw Error('Preference-free template geometry is not supported');
  if(n.type===17)fonts.push(n);
  else if(n.type===8)styles.push(n);
  else if(n.type>=10&&n.type<=14)size=sizes[n.type-10];
  else if(n.type===9){
   if(n.pointSize!==undefined){
    // Original reader 0x6c9270 negates the unsigned wire magnitude into its
    // signed internal logical size. Original writer 0x6c9d00 reverses that.
    if(n.pointSize<1||n.pointSize>32768)throw Error('Invalid explicit native SIZE');
    size=n.pointSize/32;
   }else {const base=sizes[n.logicalSize];if(!base)throw Error('Unsupported logical typesize without native preferences');size=base+n.delta/32;}
   if(size<=0||size>512)throw Error('Native SIZE is outside the rendering range');
  }else if(n.type===16){
   if(n.options&~7||n.options&1)throw Error('Unsupported native COLOR_DEF flags or CMYK color');
   const components=[0,1,2].map(i=>data.readUInt16LE(n.start+2+i*2));
   if(components.some(v=>v>1000))throw Error('Invalid native RGB color component');
   colors.push('#'+components.map(v=>Math.round(v*255/1000).toString(16).padStart(2,'0')).join(''));
  }else if(n.type===15){color=colors[n.color];if(!color)throw Error('Missing explicit native color definition '+n.color);}
  if([1,2,3,4,5].includes(n.type))layoutSizes.set(n.start,size/full);
  if([1,2,3,4,5,6].includes(n.type))layoutColors.set(n.start,color);
  if(n.type===2&&!compoundDecorations.has(n.start)&&n.typeface!==22&&!(n.typeface===23&&n.code===9&&n.fontPosition===9)){
   const definition=n.typeface<0?styles[-n.typeface-1]:prefs?.styles[n.typeface-1];
   if(!definition)throw Error('Missing native font style for typeface '+n.typeface);
   const font=n.typeface<0?fonts[definition.font-1]?.name:definition.font;
   if(!font)throw Error('Missing native font');if(definition.style&~3)throw Error('Unknown native character style bits');
   if(!Number.isFinite(size))throw Error('Missing explicit native SIZE without EQN_PREFS');
   if(!color)throw Error('Missing explicit native color without EQN_PREFS');
   states.set(n.start,{font,style:definition.style,size,color});
  }
  if(n.children)walk(n.children);
 }}walk(parsed.records);
 // This is only the coordinate unit for the layout engine, not a supplied
 // Full preference. The original explicit point sizes remain authoritative.
 if(!prefs){if(states.size!==1)throw Error('Preference-free rendering requires a single explicit native glyph');full=states.values().next().value.size;}
 const faces=[],faceIds=new Map();
 const glyphToken=(n,plain)=>{
  if(/\s/.test(String.fromCharCode(n.code)))return plain;
  const state=states.get(n.start);if(!state)throw Error('Missing native glyph state');
  // MTEF's Symbol position for '*' has no Unicode U+002A outline in the
  // macOS Symbol face. Draw the equivalent mathematical asterisk from the
  // shipped STIX face for preview only; keep the source MTEF font and bytes.
  // Old Equation Lab objects also used ASCII '-' in Symbol; render it as a
  // mathematical minus without changing stored data or text hyphens.
  const symbol=state.font.toLowerCase()==='symbol',symbolStar=symbol&&n.code===0x2a;
  // The macOS Symbol cmap exposes its own angleleft/angleright outlines at
  // U+3008/3009, not the old MathType U+2329/232A or modern math U+27E8/27E9.
  // These are the same named Symbol glyphs (not a CJK-font substitution).
  // Resolve only the outline lookup; the source MTCode and font position stay
  // intact for no-op saves and character-only edits.
  const symbolAngle=symbol?symbolAngleOutlines[n.code]:undefined;
  const alias=legacyOutline(n.code,state.font),eastAsianMath=n.typeface===12&&[0x2223].includes(n.code),missing=n.code===0xf700,useSTIX=symbolStar||alias!==null||eastAsianMath||missing;
  const code=missing?0x25a1:alias??symbolAngle??(symbolStar?0x2217:symbol&&n.code===0x2d?0x2212:n.code),fontName=useSTIX?'STIX Two Math':state.font,fontStyle=state.style;
  const key=fontName+'\0'+fontStyle;let index=faceIds.get(key);
  if(index===undefined){index=faces.length;faceIds.set(key,index);faces.push({font:fontName,style:fontStyle,characters:[]});}
  if(!faces[index].characters.includes(code))faces[index].characters.push(code);
  return `\\elglyph{el${index}}{${state.size/full}}{${code.toString(16)}}{${state.color}}`;
 };
 const layoutCallbacks={
  embellishment:(n,latex)=>[14,15,19,20,25,26,27,28,30,31,32,36,37].includes(n.embellishment)?`\\elmeta{200}{${n.embellishment}}{${latex}}`:latex,
  template:(n,latex)=>{
   if(n.selector<=7||n.selector===9){
    const body=n.children.find(c=>c.type===1||c.type===4),alignment=body?.type===4?body.valign:body?.children?.find(c=>c.type===5)?.valign??1;
    if(n.templateOptions===1||alignment!==1)return `\\elmeta{102}{1}{${latex}}`;
   }
   if(n.selector===10)return `\\elroot{${layoutSizes.get(n.start)??1}}{${latex}}`;if([12,13].includes(n.selector)){for(let i=0;i<1+n.variation;i++)latex=latex.replace(/^\\(?:overline|underline)\{([\s\S]*)\}$/,'$1');return `\\elbar{${n.selector===12?1:0}}{${1+n.variation}}{${latex}}`;}if(n.selector>=31&&n.selector<=34)return `\\elmeta{${n.selector}}{${n.variation}}{${latex}}`;if(n.selector===15&&latex.startsWith('\\elStretchIntegral')){const glyphs=n.children.filter(c=>c.type===2&&c.code===0x222b),operatorRatio=layoutSizes.get(glyphs[0]?.start)??layoutSizes.get(n.start)??1;return latex.replace(/^(\\elStretchIntegral\{\d+\})/,`$1{${layoutSizes.get(n.start)??1}}{${operatorRatio}}`)+(n.variation&256?'':glyphs.map(g=>`{${glyphToken(g,'')}}`).join(''));}if(n.selector===14&&latex.startsWith('\\elDoubleArrow'))return latex.replace(/^(\\elDoubleArrow\{\d+\})/,`$1{${layoutSizes.get(n.start)??1}}`);if(n.selector===8)return `\\elwhite{${n.variation}}{${latex.replace(/^\\left(?:⟦|\.)/,'').replace(/\\right(?:⟧|\.)$/,'')}}`;if(n.selector!==11)return latex;if(n.variation&2){const gap=prefs?.spaces[14];if(gap&&!gap.unsupported)latex=latex.replaceAll('\\!',`\\kern{${nativeDimension32(gap,Math.trunc(full*32))/(32*full)}em}`);}return `\\elmeta{11}{${n.variation}}{${latex}}`;},
  matrix:(n,latex)=>`\\elmeta{100}{${(n.hjust&128?1:0)|(n.vjust&128?2:0)|(n.valign<<4)}}{${latex}}`,
  pile:(n,latex)=>`\\elmeta{101}{${n.halign|(n.valign<<4)}}{${latex}}`,
  line:(n,latex,ctx)=>{const parts=latex.split('\\elTab{}');if(parts.length===1)return latex;const tabs=ctx.currentRuler?.tabs??[];return `\\elruler{${tabs.map(t=>t.position??t.offset).join(',')}}{${tabs.map(t=>t.type).join(',')}}{${parts.length}}${parts.map(p=>`{${p}}`).join('')}`;}
 };
 // COLOR state belongs to the complete native box as well as its CHARs.
 // Keeping it only on glyph tokens made radicals, fraction rules, fences,
 // accents and drawn integrals turn black in SVG/PDF despite red native data.
 for(const key of ['template','matrix','pile','embellishment']){
  const callback=layoutCallbacks[key];
  layoutCallbacks[key]=(n,...args)=>{
   const latex=callback(n,...args),color=layoutColors.get(n.start);
   // Postfix sub/superscript records attach to the preceding atom. Wrapping
   // just _{...}/^{...} would detach them; their glyphs carry their own color.
   return color&&!(key==='template'&&[27,28,29].includes(n.selector))?'\\textcolor{'+color+'}{'+latex+'}':latex;
  };
 }
 const latex=oleRenderLatex(ole,glyphToken,layoutCallbacks);
 const usedFaceCount=faces.length;
 // Function Full space advance drives the recovered token-gap arithmetic.
 // Request that face even when the formula contains only Variable glyphs.
 if(prefs?.styles[1]?.font){const definition=prefs.styles[1],index=faces.findIndex(f=>f.font===definition.font&&f.style===definition.style);if(index<0)faces.push({font:definition.font,style:definition.style,characters:[32,61,120,73]});else for(const code of [32,61,120,73])if(!faces[index].characters.includes(code))faces[index].characters.push(code);}
 // 677140 takes the mathematical axis from Symbol Full independently of the
 // Function Full ascent/x-height. Keep those two font probes separate.
 if(prefs?.styles[5]?.font){const definition=prefs.styles[5],index=faces.findIndex(f=>f.font===definition.font&&f.style===definition.style);if(index<0)faces.push({font:definition.font,style:definition.style,characters:[61]});else if(!faces[index].characters.includes(61))faces[index].characters.push(61);}
 const nativeFaces=await metrics(faces),font=new TeXFont(),layout=createNativeLayout(prefs,full,nativeFaces);
 for(const [name,value]of Object.entries(layout.fontParameters??{}))if(value!==undefined)font.params[name]=value;
 for(let i=0;i<nativeFaces.length;i++){
  const name='el'+i; font.createVariant(name,'normal');font.variant[name].cacheID=name;
  const chars={};for(const [code,g]of Object.entries(nativeFaces[i].glyphs))chars[code]=[g.height/1000,g.depth/1000,g.advance/1000,{p:g.path.replace(/^M/,''),ic:Math.max(0,g.right-g.advance)/1000}];font.defineChars(name,chars);
 }
 const tex=new TeX({packages:[...AllPackages.filter(p=>!['noerrors','noundefined'].includes(p)),'equation-native-fonts']});
 tex.postFilters.add(({data})=>data.root.walkTree(node=>{const ratio=node.getProperty('equationNativeSize');if(ratio){node.attributes.set('scriptlevel',0);node.attributes.set('mathsize',ratio+'em');}}),10);
 tex.postFilters.add(layout.postFilter,20);
 const doc=mathjax.document('',{InputJax:tex,OutputJax:new SVG({fontCache:'local',font,wrapperFactory:layout.factory,mathmlSpacing:true})});
 let svg=adaptor.outerHTML(doc.convert(latex,{display:false}));if(svg.includes('data-mjx-error'))throw Error('原生字体排版失败: '+(svg.match(/data-mjx-error="([^"]*)"/)?.[1]??'unknown layout error'));
 svg=svg.slice(svg.indexOf('<svg'),svg.lastIndexOf('</svg>')+6);
 const [,view]=/viewBox="([^"]+)"/.exec(svg),[x,y,w,h]=view.split(/\s+/).map(Number);
 const left=Math.max(0,...nativeFaces.slice(0,usedFaceCount).flatMap(f=>Object.values(f.glyphs).map(g=>-g.left))),right=20;
 // A tight ink box cuts off antialiasing at glyph extrema (notably italic s
 // and the radical bar). Reserve a small physical margin on every edge and
 // include the bottom margin in the baseline used by Word.
 // Layout advances do not include every overhanging accent or the final
 // transformed integral contour. Union the actual vector ink before adding
 // padding, so PNG, editor SVG and Word PDF share one complete physical box.
 const ink=vectorInkBounds(vectorPdfRequest(svg,1,1)),padding=.5,pad=padding*1000/full;
 const minX=Math.min(x-left,ink?.[0]??x),minY=Math.min(y,ink?.[1]??y),maxX=Math.max(x+w+right,ink?.[2]??x+w),maxY=Math.max(y+h,ink?.[3]??y+h);
 const width=Math.max(2,(maxX-minX)*full/1000)+2*padding,height=Math.max(2,(maxY-minY)*full/1000)+2*padding,depth=Math.max(0,maxY*full/1000)+padding;
 svg=svg.replace(/viewBox="[^"]+"/,`viewBox="${minX-pad} ${minY-pad} ${maxX-minX+2*pad} ${maxY-minY+2*pad}"`);
 svg=svg.replace(/width="[^"]+"/,`width="${width}pt"`).replace(/height="[^"]+"/,`height="${height}pt"`);
 if(width*height*16>32_000_000)throw Error('公式预览超过像素限制，请减小字号或拆分公式');
 // Editor validation displays SVG directly. Rasterize only for an actual PNG
 // consumer, rather than doing unused image encoding after every keystroke.
 const png=raster?await rasterizeNativeSvg(svg,width,height,{maxWidth,maxHeight}):undefined;
 const warnings=[];function missingGlyphs(nodes){for(const n of nodes){if(n.type===2&&n.code===0xf700&&!warnings.length)warnings.push('原公式含未映射字符，方框为占位显示；原始字符数据已保留。');if(n.children)missingGlyphs(n.children);}}missingGlyphs(parsed.records);
 return {svg,png,width,height,depth,warnings,faces:nativeFaces.slice(0,usedFaceCount).map(({font,style,postscript,syntheticItalic,syntheticBold})=>({font,style,postscript,syntheticItalic,syntheticBold})),fullSize:prefs?full:null,sizeSource:prefs?'equation-preferences':'explicit-native-glyph-state'};
}

/** CoreGraphics PNG from the same vector vocabulary used by Word PDF.
 * maxWidth/maxHeight are pixel bounds; point geometry is kept unchanged. */
export async function rasterizeNativeSvg(svg,width,height,{maxWidth,maxHeight,scale=8}={}){
 if(!Number.isFinite(scale)||scale<=0||scale>8)throw Error('Invalid raster scale');
 for(const value of [maxWidth,maxHeight])if(value!==undefined&&(!Number.isFinite(value)||value<1||value>32000000))throw Error('Invalid raster pixel bound');
 scale=Math.min(scale,maxWidth===undefined?scale:maxWidth/width,maxHeight===undefined?scale:maxHeight/height);
 // Keep the decoded bitmap bounded even for a large valid equation.
 if(Math.ceil(width*scale)*Math.ceil(height*scale)>32000000)scale=Math.min(scale,Math.sqrt(31000000/(width*height)));
 return Buffer.from((await helperRequest({...vectorPdfRequest(svg,width,height),format:'png',scale})).png,'base64');
}

export async function nativePdf(ole){
 const p=await renderNative(ole,{raster:false}),response=await helperRequest(vectorPdfRequest(p.svg,p.width,p.height));
 return {pdf:response.pdf,width:Math.max(1,Math.round(p.width*2540/72)),height:Math.max(1,Math.round(p.height*2540/72))};
}
