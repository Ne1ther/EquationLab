import CFB from 'cfb';
import { readFileSync } from 'node:fs';
import {integralMacroName,integralMacroVariation,integralGlyphs} from './integral-templates.mjs';

export const template = JSON.parse(readFileSync(new URL('./resources/ole-template.json', import.meta.url)));
const b64 = s => Buffer.from(s, 'base64');
const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const cat = (...parts) => Buffer.concat(parts.map(p => Buffer.isBuffer(p) ? p : Buffer.from(p)));

export class MtefReader {
  constructor(data) { this.b = Buffer.from(data); this.p = 0; this.nodes = 0; }
  byte() { if (this.p >= this.b.length) throw Error('Truncated MTEF'); return this.b[this.p++]; }
  word() { return this.byte() | this.byte() << 8; }
  uint() { const n = this.byte(); return n === 255 ? this.word() : n; }
  sint() { const n = this.byte(); return n === 255 ? this.word() - 32768 : n - 128; }
  zstr() { const p = this.p; while (this.byte()) {} return this.b.subarray(p, this.p - 1).toString('utf8'); }
  skip(n) { if (n < 0 || this.p + n > this.b.length) throw Error('Invalid MTEF length'); this.p += n; }
  nudge(o) { if (o & 8) { const x = this.byte(), y = this.byte(); if (x === 128 && y === 128) this.skip(4); } }
  dimensions() {
    const count = this.byte(), values = []; let current = [];
    while (values.length < count) {
      const v = this.byte();
      for (const nibble of [v >> 4, v & 15]) {
        if (values.length === count) break;
        if (nibble === 15) { values.push(current); current = []; } else current.push(nibble);
      }
    }
    return values;
  }
  list(depth = 0) {
    if (depth > 100) throw Error('MTEF nesting limit');
    const nodes = [];
    while (true) { const n = this.record(depth); if (n.type === 0) break; nodes.push(n); }
    return nodes;
  }
  record(depth = 0) {
    if (++this.nodes > 100000) throw Error('MTEF node limit');
    const start = this.p, type = this.byte(), n = { type, start };
    if (type === 0 || (type >= 10 && type <= 14)) {}
    else if (type === 19) n.name = this.zstr();
    else if (type === 17) { n.encoding = this.uint(); n.name = this.zstr(); }
    else if (type === 18) {
      n.options = this.byte(); n.sizes = this.dimensions(); n.spaces = this.dimensions();
      const count = this.byte(); n.styles = [];
      for (let i = 0; i < count; i++) { const font = this.uint(); n.styles.push({font,style:font ? this.byte() : 0}); }
    } else if (type === 8) { n.font = this.uint(); n.style = this.byte(); }
    else if (type === 9) {
      const size = this.byte();
      if (size === 101) { n.pointSize = this.word(); }
      else if (size === 100) { n.logicalSize = this.byte(); n.delta = this.word(); if (n.delta >= 32768) n.delta -= 65536; }
      else { n.logicalSize = size; n.delta = this.byte()-128; }
    }
    else if (type === 15) n.color = this.uint();
    else if (type === 16) { n.options = this.byte(); this.skip(n.options & 1 ? 8 : 6); if (n.options & 4) this.zstr(); }
    else if (type === 7) { const count=this.byte(); n.tabs=Array.from({length:count},()=>({type:this.byte(),position:this.word()})); }
    else if (type >= 100) this.skip(this.uint());
    else if ([1,2,3,4,5,6].includes(type)) {
      n.options = this.byte();
      // Original CHAR writer 0x66d520 also emits 0x40 unparsed input and
      // 0x80 bad input. Preserve these status bits even when preview rejects.
      const mask = type === 1 ? 15 : type === 2 ? 255 : type === 4 ? 10 : 8;
      if (n.options & ~mask) throw Error(`Unknown MTEF options ${n.options} for record ${type}`);
      this.nudge(n.options);
      if (type === 1) {
        if (n.options & 4) n.lineSpacing = this.word();
        if (n.options & 2) n.ruler = this.record(depth + 1);
        n.children = n.options & 1 ? [] : this.list(depth + 1);
      } else if (type === 2) {
        n.typeface = this.sint();
        if (!(n.options & 32)) { n.codeOffset = this.p; n.code = this.word(); }
        if (n.options & 4) { n.fontPositionOffset = this.p; n.fontPosition = this.byte(); n.fontPositionSize = 1; }
        if (n.options & 16) { n.fontPositionOffset = this.p; n.fontPosition = this.word(); n.fontPositionSize = 2; }
        if (n.options & 1) n.children = this.list(depth + 1);
      } else if (type === 3) {
        n.selector = this.byte(); const v = this.byte(); n.variation = v & 128 ? (v & 127) | this.byte() << 8 : v;
        n.templateOptions = this.byte(); n.children = this.list(depth + 1);
      } else if (type === 4) {
        n.halign = this.byte(); n.valign = this.byte(); if (n.options & 2) n.ruler = this.record(depth + 1);
        n.children = this.list(depth + 1);
      } else if (type === 5) {
        n.valign = this.byte(); n.hjust = this.byte(); n.vjust = this.byte(); n.rows = this.byte(); n.cols = this.byte();
        n.rowPartitions = Array.from({length:Math.ceil((n.rows + 1) / 4)},()=>this.byte());
        n.colPartitions = Array.from({length:Math.ceil((n.cols + 1) / 4)},()=>this.byte());
        n.children = this.list(depth + 1);
      } else n.embellishment = this.byte();
    } else throw Error(`Unsupported MTEF record ${type} at ${start}; original data remains unchanged`);
    n.end = this.p; return n;
  }
  read({allowTrailing = false} = {}) {
    if (this.byte() !== 5) throw Error('This prototype supports MTEF v5 only');
    const platform = this.byte(), product = this.byte(), major = this.byte(), minor = this.byte();
    const application = this.zstr(), options = this.byte(), headerEnd = this.p;
    const records = this.list();
    if (!allowTrailing && this.p !== this.b.length) throw Error(`Trailing MTEF bytes: ${this.b.length - this.p}`);
    return { platform, product, major, minor, application, options, headerEnd, records, consumed:this.p };
  }
}

export function parseNative(native) {
  native = Buffer.from(native);
  if (native.length < 28) throw Error('Invalid Equation Native header or length');
  const h = native.readUInt16LE(0), len = native.readUInt32LE(8);
  if (h !== 28 || len !== native.length - h) throw Error('Invalid Equation Native header or length');
  const data = native.subarray(h); return { data, header: native.subarray(0,h), parsed: new MtefReader(data).read() };
}

export function inspectOle(buffer) {
  const cfb = CFB.read(buffer, {type:'buffer'});
  const entry = CFB.find(cfb, 'Equation Native');
  if (!entry) throw Error('Selected object has no Equation Native stream');
  const native = Buffer.from(entry.content), result = parseNative(native);
  return { cfb, native, ...result };
}

export function wrapNative(native, sourceOle) {
  const cfb = sourceOle ? CFB.read(sourceOle, {type:'buffer'}) : CFB.utils.cfb_new({root:'Root Entry'});
  if (!sourceOle) {
    cfb.FileIndex[0].clsid = '03ce020000000000c000000000000046';
    for (const [name, value] of Object.entries(template.streams)) CFB.utils.cfb_add(cfb, name, b64(value));
  }
  CFB.utils.cfb_add(cfb, 'Equation Native', native);
  return Buffer.from(CFB.write(cfb, {type:'buffer'}));
}

// MTEF v5 structure comes from WIRIS' published specification. Two published
// errata (big-operator limit bits and slot order) are anchored to actual MathType
// toolbar records; see evidence/mtef-extended-validation.json.
const glyphs = {
 alpha:'α',beta:'β',gamma:'γ',delta:'δ',epsilon:'ϵ',varepsilon:'ε',zeta:'ζ',eta:'η',theta:'θ',vartheta:'ϑ',iota:'ι',kappa:'κ',varkappa:'ϰ',lambda:'λ',mu:'μ',nu:'ν',xi:'ξ',omicron:'ο',pi:'π',varpi:'ϖ',rho:'ρ',varrho:'ϱ',sigma:'σ',varsigma:'ς',tau:'τ',upsilon:'υ',phi:'ϕ',varphi:'φ',chi:'χ',psi:'ψ',omega:'ω',
 Gamma:'Γ',Delta:'Δ',Theta:'Θ',Lambda:'Λ',Xi:'Ξ',Pi:'Π',Sigma:'Σ',Upsilon:'Υ',Phi:'Φ',Psi:'Ψ',Omega:'Ω',
 times:'×',cdot:'⋅',div:'÷',pm:'±',mp:'∓',le:'≤',leq:'≤',ge:'≥',geq:'≥',ne:'≠',neq:'≠',approx:'≈',equiv:'≡',sim:'∼',simeq:'≃',propto:'∝',ll:'≪',gg:'≫',infty:'∞',partial:'∂',nabla:'∇',ell:'ℓ',hbar:'ℏ',Re:'ℜ',Im:'ℑ',emptyset:'∅',varnothing:'∅',forall:'∀',exists:'∃',nexists:'∄',in:'∈',notin:'∉',ni:'∋',subset:'⊂',supset:'⊃',subseteq:'⊆',supseteq:'⊇',cup:'∪',cap:'∩',setminus:'∖',land:'∧',lor:'∨',neg:'¬',lnot:'¬',oplus:'⊕',otimes:'⊗',odot:'⊙',circ:'∘',bullet:'•',star:'⋆',ast:'∗',perp:'⊥',parallel:'∥',angle:'∠',triangle:'△',square:'□',therefore:'∴',because:'∵',to:'→',rightarrow:'→',leftarrow:'←',leftrightarrow:'↔',Rightarrow:'⇒',Leftarrow:'⇐',Leftrightarrow:'⇔',mapsto:'↦',uparrow:'↑',downarrow:'↓',updownarrow:'↕',ldots:'…',cdots:'⋯',vdots:'⋮',ddots:'⋱',prime:'′',degree:'°',colon:':',langle:'⟨',rangle:'⟩',lfloor:'⌊',rfloor:'⌋',lceil:'⌈',rceil:'⌉',lbrace:'{',rbrace:'}',vert:'|',lvert:'|',rvert:'|',Vert:'‖',lVert:'‖',rVert:'‖',backslash:'\\'
};
const originalNativeGlyphs=new Set(Object.values(glyphs));
Object.assign(glyphs,{
 leqq:'≦',geqq:'≧',leqslant:'⩽',geqslant:'⩾',nleq:'≰',ngeq:'≱',nless:'≮',ngtr:'≯',lesssim:'≲',gtrsim:'≳',lessapprox:'⪅',gtrapprox:'⪆',lessgtr:'≶',gtrless:'≷',lesseqgtr:'⋚',gtreqless:'⋛',prec:'≺',succ:'≻',preceq:'≼',succeq:'≽',precsim:'≾',succsim:'≿',doteq:'≐',doteqdot:'≑',fallingdotseq:'≒',risingdotseq:'≓',triangleq:'≜',coloneqq:'≔',eqqcolon:'≕',bumpeq:'≏',Bumpeq:'≎',asymp:'≍',cong:'≅',ncong:'≇',nsim:'≁',simeq:'≃',nparallel:'∦',mid:'∣',nmid:'∤',models:'⊨',vdash:'⊢',dashv:'⊣',Vdash:'⊩',Vvdash:'⊪',nvdash:'⊬',nvDash:'⊭',Subset:'⋐',Supset:'⋑',sqsubset:'⊏',sqsupset:'⊐',sqsubseteq:'⊑',sqsupseteq:'⊒',nsubseteq:'⊈',nsupseteq:'⊉',subsetneq:'⊊',supsetneq:'⊋',uplus:'⊎',sqcap:'⊓',sqcup:'⊔',amalg:'⨿',wr:'≀',diamond:'⋄',bigtriangleup:'△',bigtriangledown:'▽',triangleleft:'◁',triangleright:'▷',lhd:'⊲',rhd:'⊳',unlhd:'⊴',unrhd:'⊵',boxplus:'⊞',boxminus:'⊟',boxtimes:'⊠',boxdot:'⊡',ominus:'⊖',oslash:'⊘',dagger:'†',ddagger:'‡',aleph:'ℵ',beth:'ℶ',gimel:'ℷ',daleth:'ℸ',wp:'℘',hslash:'ℏ',imath:'ı',jmath:'ȷ',mho:'℧',top:'⊤',bot:'⊥',surd:'√',checkmark:'✓',vartriangle:'△',blacktriangle:'▲',blacktriangledown:'▼',blacksquare:'■',lozenge:'◊',blacklozenge:'◆',clubsuit:'♣',diamondsuit:'♢',heartsuit:'♡',spadesuit:'♠',longrightarrow:'⟶',longleftarrow:'⟵',longleftrightarrow:'⟷',Longrightarrow:'⟹',Longleftarrow:'⟸',Longleftrightarrow:'⟺',longmapsto:'⟼',hookrightarrow:'↪',hookleftarrow:'↩',leftharpoonup:'↼',leftharpoondown:'↽',rightharpoonup:'⇀',rightharpoondown:'⇁',rightleftharpoons:'⇌',leftrightharpoons:'⇋',nearrow:'↗',searrow:'↘',swarrow:'↙',nwarrow:'↖',Uparrow:'⇑',Downarrow:'⇓',Updownarrow:'⇕',leadsto:'⇝',rightsquigarrow:'⇝',rightleftarrows:'⇄',leftrightarrows:'⇆',twoheadrightarrow:'↠',twoheadleftarrow:'↞',lbrack:'[',rbrack:']'
});
Object.assign(glyphs,{lBrack:'⟦',rBrack:'⟧',llbracket:'⟦',rrbracket:'⟧',backprime:'‵',frown:'⌢',smile:'⌣'});
export const supportedGlyphs=Object.freeze({...glyphs});
const nativeMathGlyphs=new Set(['∬','∭','∐','∮','∯','∰','∲','∳',...Object.values(glyphs).filter(c=>!originalNativeGlyphs.has(c))]);
const nativeGreekGlyphs=new Set(['ϰ','ϱ','ϵ']);
// BMP script letters fit MTEF's 16-bit character field. Persist their actual
// outline font in the equation rather than substituting only in the preview.
const scriptLetters={B:'ℬ',E:'ℰ',F:'ℱ',H:'ℋ',I:'ℐ',L:'ℒ',M:'ℳ',R:'ℛ',e:'ℯ',g:'ℊ',o:'ℴ'};
for(const value of Object.values(scriptLetters))nativeMathGlyphs.add(value);
// Actual CoreText checks against the shipping macOS Symbol face show these
// existing commands have no glyph. Author their real native font explicitly;
// a renderer-only fallback would leave Word's saved object inconsistent.
for(const code of [0x2213,0x2243,0x226a,0x226b,0x2113,0x210f,0x2204,0x220b,0x2216,0x2299,0x2218,0x22c6,0x2225,0x25b3,0x25a1,0x2235,0x21a6,0x2195,0x22ef,0x22ee,0x22f1])nativeMathGlyphs.add(String.fromCharCode(code));
const reverseGlyphs = Object.fromEntries(Object.entries(glyphs).map(([k,v])=>[v,`\\${k} `]));
const functions = new Set(['sin','cos','tan','cot','sec','csc','arcsin','arccos','arctan','sinh','cosh','tanh','coth','log','ln','lg','exp','det','dim','ker','arg','gcd','hom','Pr']);
const bigOperators = {
 sum:{selector:16,value:'∑',sum:true},prod:{selector:17,value:'∏',sum:true},coprod:{selector:18,value:'∐',sum:true},bigcup:{selector:19,value:'∪',sum:true},bigcap:{selector:20,value:'∩',sum:true},
 int:{selector:15,value:'∫',variant:1},iint:{selector:15,value:'∬',variant:2},iiint:{selector:15,value:'∭',variant:3},oint:{selector:15,value:'∮',variant:5},oiint:{selector:15,value:'∯',variant:6},oiiint:{selector:15,value:'∰',variant:7},varointclockwise:{selector:15,value:'∲',variant:9},ointctrclockwise:{selector:15,value:'∳',variant:13}
};
const spaces = {',':'\u2009',':':'\u2005',';':'\u2004',' ':' ',quad:'\u2003',qquad:'\u2003\u2003',enspace:'\u2002',space:' '};
const reverseSpaces = {'\u2009':'\\,','\u2005':'\\:','\u2004':'\\;','\u2003':'\\quad ','\u2002':'\\enspace ',' ':'\\ '};
const fencePairs = [['⟨','⟩'],['(',')'],['{','}'],['[',']'],['|','|'],['‖','‖'],['⌊','⌋'],['⌈','⌉'],['⟦','⟧']];
const accentCodes = {dot:2,ddot:3,dddot:4,ddddot:24,hat:9,tilde:8,vec:11,overrightarrow:11,overleftarrow:12,overleftrightarrow:13,bar:17,underdot:25,underddot:26,underdddot:27,underddddot:28,undertilde:30,underleftarrow:34,underrightarrow:33,underleftrightarrow:35};
const accentCommands = Object.fromEntries(Object.entries(accentCodes).map(([k,v])=>[v,k]));
// Embellishment 11 is a single-character vector accent. The expanding arrow
// template is decoded separately below; using it here clips a full-size arrow
// to a narrow character's advance in the SVG/PDF preview.
Object.assign(accentCommands,{5:'prime',6:'doubleprime',18:'tripleprime',10:'not',11:'vec'});
const seqNode = items => ({kind:'seq',items});
const emptyNode = n => !n || n.kind==='seq' && n.items.every(emptyNode);
const onlyChar = n => n?.kind==='char' ? n : n?.kind==='seq' && n.items.length===1 ? onlyChar(n.items[0]) : null;
const preservedMacro=(command,...args)=>'\\'+command+args.map(value=>`{${value===''?'{}':value}}`).join('');
const embellishmentMacro=id=>'mtemb'+(id-2<26?String.fromCharCode(65+id-2):'A'+String.fromCharCode(65+id-28));
const embellishmentMacroIds=new Map(Array.from({length:36},(_,i)=>[embellishmentMacro(i+2),i+2]));

/** A deliberately bounded LaTeX grammar. Unsupported commands are errors, never
 * ignored. It accepts the common MathLive output families used by the editor. */
export function latexAst(input) {
  if (typeof input!=='string') throw Error('Formula must be LaTeX text');
  let text=input.trim();
  if ((text.startsWith('\\(')&&text.endsWith('\\)'))||(text.startsWith('\\[')&&text.endsWith('\\]'))) text=text.slice(2,-2);
  else if (text.startsWith('$$')&&text.endsWith('$$')) text=text.slice(2,-2);
  else if (text.startsWith('$')&&text.endsWith('$')) text=text.slice(1,-1);
  if (text.length>100000) throw Error('LaTeX input limit');
  let p=0,depth=0;
  function white(){while(p<text.length&&/\s/.test(text[p]))p++;}
  function control(){
    if(text[p++]!=='\\')throw Error('Expected LaTeX command');
    const m=/^[A-Za-z]+/.exec(text.slice(p));if(m){p+=m[0].length;return m[0];}
    if(p===text.length)throw Error('Incomplete LaTeX command');return text[p++];
  }
  // A TeX argument without braces is ONE atom. Consuming its postfix here
  // incorrectly changes x_i^2 into x_{i^2}, or an integral's two limits into one.
  function group(){white();if(text[p]==='{'){p++;return seq('}');}return atom();}
  function textGroup(){
    white();if(text[p++]!=='{')throw Error('Text/style command requires a braced argument');
    let s='',level=1;
    while(p<text.length){const c=text[p++];if(c==='{'){level++;continue;}if(c==='}'){if(--level===0)return s;continue;}
      if(c==='\\'){const next=text[p++];if(next===undefined||!/[{}%$#&_\\ ]/.test(next))throw Error('Unsupported command inside text argument');s+=next;}else s+=c;}
    throw Error('Unclosed text group');
  }
  function delimiter(){
    white();const command=text[p]==='\\';let d=command?control():text[p++];if(command&&d==='|')d='‖';
    if(glyphs[d])d=glyphs[d];if(d==='|')d='|';if(d==='.')return '.';
    if(!fencePairs.flat().includes(d)&&![')',']','(' ,'['].includes(d))throw Error(`Unsupported fence ${d}`);
    return d;
  }
  function environment(){
    const inputEnv=textGroup(),env=({align:'aligned','align*':'aligned',gather:'gathered','gather*':'gathered',split:'aligned'})[inputEnv]??inputEnv,supported=new Set(['matrix','pmatrix','bmatrix','Bmatrix','vmatrix','Vmatrix','cases','aligned','gathered','array']);
    if(!supported.has(env))throw Error(`Unsupported LaTeX environment ${env}`);
    const columnSpec=env==='array'?textGroup():null,columns=columnSpec?.replace(/\|/g,'');
    if(columnSpec&&(!/^[lcr|]+$/.test(columnSpec)||!(/^(l+|c+|r+)$/.test(columns))||columnSpec.includes('||')))throw Error('Only uniformly aligned arrays with single solid partition lines are supported');
    const rows=[],rowRules=[];let row=[];
    while(true){white();if(!row.length&&text.startsWith('\\hline',p)&&!/[A-Za-z]/.test(text[p+6]||'')){control();if(rowRules[rows.length])throw Error('Repeated horizontal rules are unsupported');rowRules[rows.length]=1;white();if(text.startsWith('\\end',p)){control();if(textGroup()!==inputEnv)throw Error(`Mismatched environment ${inputEnv}`);break;}}
      row.push(seq(null,{env,cell:true}));white();
      if(text[p]==='&'){p++;continue;}
      if(text.startsWith('\\\\',p)){p+=2;rows.push(row);row=[];white();if(text[p]==='[')throw Error('Custom matrix row spacing is unsupported');continue;}
      if(text.startsWith('\\end',p)&&!/[A-Za-z]/.test(text[p+4]||'')){control();if(textGroup()!==inputEnv)throw Error(`Mismatched environment ${inputEnv}`);if(row.length>1||!emptyNode(row[0])||!rows.length)rows.push(row);break;}
      throw Error(`Unclosed environment ${env}`);
    }
    const cols=Math.max(...rows.map(r=>r.length));
    if(rows.length>31||cols>31)throw Error('MathType matrices support at most 31 rows and 31 columns');
    if(env==='cases'&&cols!==2)throw Error('Cases require exactly two columns');
    if(env==='aligned'&&cols!==2)throw Error('Aligned equations support one relation alignment point per row');
    if(columns&&columns.length!==cols)throw Error('Array column declaration does not match its cells');
    if(!['aligned','gathered','cases'].includes(env)&&rows.some(r=>r.length!==cols))throw Error('Matrix rows must contain equal numbers of cells');
    if(env==='gathered'&&cols!==1)throw Error('Gathered equations require one column');
    // aligned/cases permit omitted trailing cells; preserve these as empty slots.
    for(const r of rows)while(r.length<cols)r.push(seqNode([]));
    const colRules=[];if(columnSpec){let c=0;for(const ch of columnSpec){if(ch==='|')colRules[c]=1;else c++;}}
    return {kind:'matrix',env,rows,cols,columns,rowRules,colRules};
  }
  function atom(){
    white();const c=text[p++];if(c===undefined)throw Error('Missing formula operand');
    if(c==='{')return seq('}');
    if(c==='\\'){
      p--;const command=control();
      if(command==='eltab')return {kind:'char',value:'\t'};
      if(embellishmentMacroIds.has(command))return {kind:'accent',body:group(),embellishment:embellishmentMacroIds.get(command)};
      if(command==='mtjstat')return {kind:'wideaccent',command:'mtjstat',body:group()};
      if(command==='mtdoublearrow'){
        const raw=textGroup();if(!/^[0-9]+$/.test(raw))throw Error('Invalid native double-arrow variation');const variation=Number(raw);
        if(![5,9,13,21,25,29,37,41,45,6,10,14,22,26,30,38,42,46].includes(variation))throw Error('Unknown original double-arrow variation');
        const above=group(),below=group();if(!(variation&4)&&!emptyNode(above)||!(variation&8)&&!emptyNode(below))throw Error('Hidden double-arrow annotation contains data');
        return {kind:'arrow',command,variation,above,below};
      }
      if(command==='mtmatrix'){
        const hjust=Number(textGroup()),vjust=Number(textGroup()),valign=Number(textGroup()),value=group();let matrix=value;
        while(matrix.kind==='fence'||matrix.kind==='seq'&&matrix.items.length===1)matrix=matrix.kind==='fence'?matrix.body:matrix.items[0];
        if(matrix.kind!=='matrix'||['aligned','gathered'].includes(matrix.env)||!Number.isInteger(hjust)||!Number.isInteger(vjust)||!Number.isInteger(valign)||![0,1,2].includes(hjust&127)||![1].includes(vjust&127)||hjust<0||hjust>130||vjust<0||vjust>129||![1,3,4].includes(valign))throw Error('Native matrix settings require one matrix, optionally wrapped in fences');
        Object.assign(matrix,{hjust,vjust,valign});return value;
      }
      if(command==='mtfrac'){const variation=Number(textGroup());if(![0,1,2,3,6].includes(variation))throw Error('Unknown native fraction variation');return {kind:'fraction',variation,small:!!(variation&1),num:group(),den:group()};}
      if(integralMacroVariation(command)!==undefined){
        const variation=integralMacroVariation(command),raw=textGroup();if(!/^[01]$/.test(raw))throw Error('Unknown native integral option');
        const body=group(),sub=group(),sup=group();if(!(variation&16)&&!emptyNode(sub)||!(variation&32)&&!emptyNode(sup))throw Error('Hidden integral limit contains data');
        return {kind:'expandedintegral',variation,templateOptions:Number(raw),body,sub,sup};
      }
      if(command==='mtbigop'){
        const selector=Number(textGroup()),variation=Number(textGroup());if(![21,22].includes(selector)||![selector===21?0x10:0x50,selector===21?0x20:0x60,selector===21?0x30:0x70].includes(variation))throw Error('Unknown native custom large operator');
        const operator=group(),body=group(),sub=group(),sup=group();if(!(variation&16)&&!emptyNode(sub)||!(variation&32)&&!emptyNode(sup))throw Error('Hidden custom operator limit contains data');
        return {kind:'custombigop',selector,variation,operator,body,sub,sup};
      }
      if(command==='mtdoubleoverline'||command==='mtdoubleunderline')return {kind:'bar',under:command==='mtdoubleunderline',double:true,body:group()};
      if(command==='placeholder'){white();if(text[p]==='['){const end=text.indexOf(']',++p);if(end<0)throw Error('Unclosed placeholder identifier');p=end+1;}group();return seqNode([]);}
      if(['frac','dfrac','tfrac','cfrac','sfrac','nicefrac'].includes(command))return {kind:'fraction',num:group(),den:group(),small:command==='tfrac',variation:['sfrac','nicefrac'].includes(command)?2:command==='tfrac'?1:0};
      if(['binom','dbinom','tbinom'].includes(command)){const num=group(),den=group();return {kind:'fence',left:'(',right:')',body:{kind:'matrix',env:'gathered',rows:[[num],[den]],cols:1}};}
      if(command==='prescript'){const sup=group(),sub=group(),base=group();return {kind:'script',base,sub,sup,pre:true};}
      if(['overbrace','underbrace','overbracket','underbracket'].includes(command))return {kind:'hbrace',body:group(),over:command.startsWith('over'),bracket:command.endsWith('bracket')};
      if(['cancel','bcancel','xcancel','sout'].includes(command))return {kind:'strike',body:group(),variation:{cancel:2,bcancel:4,xcancel:6,sout:1}[command]};
      if(['overparen','overarc'].includes(command))return {kind:'wideaccent',command:'overparen',body:group()};
      if(['underrightarrow','underleftarrow','underleftrightarrow','overrightharpoon','underrightharpoon'].includes(command))return {kind:'widevector',command,body:group()};
      if(['xrightarrow','xleftarrow','xleftrightarrow','xrightleftharpoons','xleftrightharpoons'].includes(command)){white();let below;if(text[p]==='['){p++;below=seq(']');}return {kind:'arrow',command,above:group(),below};}
      if(command==='overset'||command==='underset'){const annotation=group(),body=group(),single=body.kind==='seq'&&body.items.length===1?body.items[0]:body;if(command==='overset'&&single.kind==='longdiv')return {...single,quotient:annotation};return {kind:'limitbox',body,sub:command==='underset'?annotation:undefined,sup:command==='overset'?annotation:undefined};}
      if(['bra','ket','braket','Bra','Ket','Braket'].includes(command)){
        const body=group(),lower=command.toLowerCase();if(lower==='bra')return {kind:'braket',left:body};if(lower==='ket')return {kind:'braket',right:body};
        const at=body.items?.findIndex(n=>n.kind==='char'&&n.value==='|')??-1;if(at<0)throw Error('Braket requires a separating vertical bar');
        return {kind:'braket',left:seqNode(body.items.slice(0,at)),right:seqNode(body.items.slice(at+1))};
      }
      if(command==='mathop')return {kind:'limitbox',body:group()};
      if(command==='enclose'){
        const notation=textGroup().split(/[ ,]+/).filter(Boolean),body=group();
        if(notation.length===1&&notation[0]==='longdiv')return {kind:'longdiv',body};
        if(notation.length===1&&['horizontalstrike','updiagonalstrike','downdiagonalstrike'].includes(notation[0]))return {kind:'strike',body,variation:{horizontalstrike:1,updiagonalstrike:2,downdiagonalstrike:4}[notation[0]]};
        const bits=notation.reduce((v,x)=>v|({box:30,roundedbox:31,left:2,right:4,top:8,bottom:16}[x]??0),0);
        if(!bits||notation.some(x=>!['box','roundedbox','left','right','top','bottom'].includes(x)))throw Error('Unsupported enclosure notation');
        return {kind:'box',body,variation:bits};
      }
      if(command==='sqrt'){white();let index;if(text[p]==='['){p++;index=seq(']');}return {kind:'sqrt',body:group(),index};}
      if(command==='left'||command==='mleft'){
        const left=delimiter(),body=seq(null,{fence:true});white();const close=control();if(close!=='right'&&close!=='mright')throw Error('Missing right fence');
        return {kind:'fence',left,right:delimiter(),body};
      }
      if(command==='begin')return environment();
      if(command==='mathcal'||command==='mathscr'){
        const letters=textGroup();
        return seqNode([...letters].map(value=>{if(!scriptLetters[value])throw Error(`Script letter ${value} has no supported native character`);return {kind:'char',value:scriptLetters[value]};}));
      }
      if(command==='text'||command==='textrm')return {kind:'text',value:textGroup()};
      if(['mathrm','mathbf','mathit','boldsymbol','mathsf','mathtt'].includes(command))return {kind:'style',style:command,body:group()};
      if(command==='operatorname'){let limits=false;if(text[p]==='*'){p++;limits=true;}const value=textGroup();if(!/^[A-Za-z ]+$/.test(value))throw Error('Operator name must contain Latin letters/spaces');return limits?{kind:'limit',value}:{kind:'function',value};}
      if(['lim','limsup','liminf','sup','inf','max','min'].includes(command))return {kind:'limit',value:command};
      if(bigOperators[command])return {kind:'bigop',command};
      if(functions.has(command))return {kind:'function',value:command};
      if(command==='overline'||command==='underline')return {kind:'bar',under:command==='underline',body:group()};
      if(command==='widehat'||command==='widetilde')return {kind:'wideaccent',command,body:group()};
      if(accentCodes[command])return {kind:'accent',command,body:group()};
      if(command==='boxed')return {kind:'box',body:group()};
      if(command==='not'){const body=group();if(!onlyChar(body))throw Error('Negation is supported for one character only');return {kind:'accent',command:'not',body};}
      if(spaces[command]!==undefined)return seqNode([...spaces[command]].map(value=>({kind:'char',value})));
      if(glyphs[command])return {kind:'char',value:glyphs[command]};
      if(['{','}','%','$','#','&','_','|','\\'].includes(command))return {kind:'char',value:command==='|'?'‖':command};
      throw Error(`Unsupported LaTeX command \\${command}; no conversion was applied`);
    }
    if('}^_&#$%'.includes(c))throw Error(`Unexpected ${c}`);
    if(c==="'")return {kind:'char',value:'′'};
    const cp=c.codePointAt(0);
    if(cp>=0xd800&&cp<=0xdfff)throw Error('Non-BMP characters are unsupported');
    return {kind:'char',value:c};
  }
  function postfix(n){
    let sub,sup,limits;
    while(true){white();
      if(text[p]==="'"){let count=0;while(text[p]==="'"){p++;count++;}if(count>3)throw Error('At most three native prime embellishments are supported');n={kind:'accent',command:count===1?'prime':count===2?'doubleprime':'tripleprime',body:n};continue;}
      if(text[p]==='^'||text[p]==='_'){
        const op=text[p++],value=group();if(op==='^'){if(sup)throw Error('Duplicate superscript');sup=value;}else{if(sub)throw Error('Duplicate subscript');sub=value;}continue;
      }
      if(text.startsWith('\\limits',p)&&!/[A-Za-z]/.test(text[p+7]||'')){p+=7;limits=true;continue;}
      if(text.startsWith('\\nolimits',p)&&!/[A-Za-z]/.test(text[p+9]||'')){p+=9;limits=false;continue;}
      break;
    }
    if(n.kind==='bigop'||n.kind==='limit'||n.kind==='limitbox'||n.kind==='hbrace')return {...n,sub:sub??n.sub,sup:sup??n.sup,limits};
    if(n.kind==='seq'&&n.items.length===0&&(sub||sup)){const base=atom();return {kind:'script',base,sub,sup,pre:true};}
    if(limits!==undefined)throw Error('Limits placement is supported on large operators only');
    return sub||sup?{kind:'script',base:n,sub,sup}:n;
  }
  function bindOperators(items){
    const out=[];
    for(let i=0;i<items.length;i++){
      let n=items[i];
      if(n.kind==='bigop'){
        const body=[];let j=i+1;
        for(;j<items.length;j++){const x=items[j];if(x.kind==='char'&&/[+\-=,;<>]/.test(x.value)||x.kind==='char'&&['≤','≥','≠','≈','∈'].includes(x.value))break;body.push(x);}
        n={...n,body:seqNode(bindOperators(body))};i=j-1;
      }
      out.push(n);
    }
    return out;
  }
  function seq(stop,opts={}){
    if(++depth>100)throw Error('LaTeX nesting limit');let items=[];const rows=[];let closed=!stop;
    while(p<text.length){white();if(p===text.length)break;
      if(stop&&text[p]===stop){p++;closed=true;break;}
      if(opts.fence&&/^\\(?:mright|right)(?![A-Za-z])/.test(text.slice(p)))break;
      if(opts.cell&&(text[p]==='&'||text.startsWith('\\\\',p)||/^\\end(?![A-Za-z])/.test(text.slice(p))))break;
      if(!opts.cell&&text.startsWith('\\\\',p)){p+=2;rows.push([seqNode(bindOperators(items))]);items=[];continue;}
      if(text[p]==='}')throw Error('Unexpected closing group');items.push(postfix(atom()));
    }
    depth--;if(!closed)throw Error('Unclosed group');if(opts.fence&&!/^\\(?:mright|right)(?![A-Za-z])/.test(text.slice(p)))throw Error('Unclosed fence');
    if(rows.length){rows.push([seqNode(bindOperators(items))]);if(rows.length>31)throw Error('Multiline equations support at most 31 rows');return seqNode([{kind:'matrix',env:'gathered',rows,cols:1}]);}
    return seqNode(bindOperators(items));
  }
  const result=seq();white();if(p!==text.length)throw Error('Unexpected trailing LaTeX');return result;
}

const uintRecord=n=>n<255?Buffer.from([n]):cat([255],u16(n));
const signedRecord=n=>n>=-128&&n<127?Buffer.from([n+128]):cat([255],u16(n+32768));
function charRecord(value,{typeface,options=0,embellishments=[]}={}){
  let code=value.codePointAt(0);if([...value].length!==1||code>65535||code===0)throw Error('Unsupported native character');
  if(code===9)return cat([2,4],signedRecord(23),u16(9),[9]);
  if(typeface===undefined)typeface=/^[0-9]$/.test(value)?8:/^[A-Za-z]$/.test(value)?3:(code>=0x3b1&&code<=0x3d6)||[0x3f0,0x3f1,0x3f5].includes(code)?4:code>=0x391&&code<=0x3a9?5:reverseSpaces[value]?1:6;
  // A math-mode keyboard '-' denotes minus. Text-style hyphens stay U+002D.
  if(code===0x2d&&typeface===6)code=0x2212;
  return cat([2,options|(embellishments.length?1:0)],signedRecord(typeface),u16(code),...(embellishments.length?[...embellishments.map(e=>Buffer.from([6,0,e])),Buffer.from([0])]:[]));
}
const inheritedSize=ctx=>10+(ctx.logicalSize??0);
const scriptSize=ctx=>10+([1,2,2,4,4,5,6][ctx.logicalSize??0]??1);
function slot(node,ctx,size=inheritedSize(ctx),style){return emptyNode(node)?Buffer.from([1,1]):cat([size,1,0],emit(node,{...ctx,logicalSize:size-10},style),[0]);}
function tmpl(selector,slots,variation=0,options=0){
  if(variation&0x80)throw Error('Unsupported template variation bit 0x80');
  const variationBytes=variation>127?[128|(variation&127),variation>>8]:[variation];
  return cat([3,0,selector],variationBytes,[options],...slots,[0]);
}
function sourceContext(parsed){
  const fonts=[],styles=[],preferenceStyles=[];
  for(const n of parsed.records){if(n.type===17)fonts.push(n);if(n.type===8)styles.push(n);if(n.type===18)preferenceStyles.splice(0,preferenceStyles.length,...n.styles);}
  const extras=[];
  return {fonts,styles,preferenceStyles,extras,explicit(style,value){
    if(typeof style==='string')style=combineStyle(null,style);
    const symbolic=!/^[\x20-\x7e]$/.test(value)&&!reverseSpaces[value];
    let family=style.family==='math'?'STIX Two Math':style.family==='textUnicode'?'Arial Unicode MS':style.family==='sans'?'Arial':style.family==='mono'?'Courier New':symbolic?'Symbol':'Times New Roman';
    let font=fonts.findIndex(f=>f.name.toLowerCase()===family.toLowerCase())+1;
    if(!font){
      const encoding=family==='Symbol'?3:parsed.records.some(n=>n.type===19&&n.name==='WinAllBasicCodePages')?5:1;
      fonts.push({name:family,encoding});font=fonts.length;extras.push(cat([17],uintRecord(encoding),Buffer.from(family+'\0','utf8')));
    }
    const bits=style.bits;
    let index=styles.findIndex(s=>s.font===font&&s.style===bits)+1;
    if(!index){styles.push({font,style:bits});index=styles.length;extras.push(cat([8],uintRecord(font),[bits]));}
    return -index;
  }};
}
function combineStyle(parent,command){
 const value=parent&&typeof parent==='object'?{...parent}:{family:'serif',bits:0};
 if(command==='mathsf')value.family='sans';else if(command==='mathtt')value.family='mono';
 else if(command==='mathrm'){value.family='serif';value.bits=0;}
 else value.bits=command==='mathbf'?1:command==='mathit'?2:3;
 return value;
}
function authoredTypeface(ctx,value,style){
 const mathematical=nativeGreekGlyphs.has(value)||nativeMathGlyphs.has(value);
 if(style)return ctx.explicit(mathematical?{...style,family:'math'}:style,value);
 if(mathematical)return ctx.explicit({family:'math',bits:nativeGreekGlyphs.has(value)?2:0},value);
 return undefined;
}
function emit(n,ctx,style){
  if(n.kind==='seq')return cat(...n.items.map(x=>cat(emit(x,ctx,style),['bigop','custombigop','expandedintegral','limit','limitbox','hbrace','arrow'].includes(x.kind)||x.kind==='sqrt'&&x.index||x.kind==='fraction'&&x.small?[inheritedSize(ctx)]:[])));
  if(n.kind==='char')return charRecord(n.value,{typeface:authoredTypeface(ctx,n.value,style)});
  if(n.kind==='text')return cat(...[...n.value].map(c=>charRecord(c,{typeface:/[^\x00-\u024f]/.test(n.value)?ctx.explicit({family:'textUnicode',bits:0},c):1})));
  if(n.kind==='style')return emit(n.body,ctx,combineStyle(style,n.style));
  if(n.kind==='function')return cat(...[...n.value].map((c,i)=>charRecord(c,{typeface:2,options:i===0?2:0})));
  if(n.kind==='fraction')return tmpl(11,[slot(n.num,ctx,n.small?scriptSize(ctx):inheritedSize(ctx),style),slot(n.den,ctx,n.small?scriptSize(ctx):inheritedSize(ctx),style)],n.variation??(n.small?1:0));
  if(n.kind==='sqrt')return tmpl(10,[slot(n.body,ctx,undefined,style),slot(n.index,ctx,scriptSize(ctx),style)],n.index?1:0);
  if(n.kind==='script'){const sub=emptyNode(n.sub)?undefined:n.sub,sup=emptyNode(n.sup)?undefined:n.sup,script=tmpl(sub&&sup?29:sub?27:28,[slot(sub,ctx,scriptSize(ctx),style),slot(sup,ctx,scriptSize(ctx),style)],n.pre?1:0);return n.pre?cat(script,[inheritedSize(ctx)],emit(n.base,ctx,style)):cat(emit(n.base,ctx,style),script,[inheritedSize(ctx)]);}
  if(n.kind==='fence'){
    if(n.left==='.'&&n.right==='.')throw Error('Two invisible fences have no native MathType fence');
    let selector=fencePairs.findIndex(([l,r])=>(n.left==='.'||l===n.left)&&(n.right==='.'||r===n.right)),variation=(n.left==='.'?0:1)|(n.right==='.'?0:2);
    if(selector<0){
      const interval=['(',')','[',']'];if(!interval.includes(n.left)||!interval.includes(n.right))throw Error(`Unsupported native fence pair ${n.left} ${n.right}`);
      selector=9;variation=interval.indexOf(n.left)|(interval.indexOf(n.right)<<4);
    }
    return tmpl(selector,[slot(n.body,ctx,undefined,style),...(n.left==='.'?[]:[charRecord(n.left,{typeface:22})]),...(n.right==='.'?[]:[charRecord(n.right,{typeface:22})])],variation);
  }
  if(n.kind==='bigop'){
    const op=bigOperators[n.command];let sum=n.limits===undefined?!!op.sum:n.limits,sub=n.sub;
    // The recovered constructor table has no upper-only pair. Its visible
    // lower slot may be empty; retain that real pair rather than inventing one.
    if(n.sup&&!sub)sub=seqNode([]);
    if(!sub&&!n.sup&&op.selector!==16)sum=false;
    const variation=(op.variant||0)|(sub?0x10:0)|(n.sup?0x20:0)|(sum?0x40:0);
    if(op.selector===15&&(op.variant!==1)&&n.sup){
      const operator=n.command==='iint'||n.command==='iiint'?seqNode(Array.from({length:op.variant},()=>({kind:'char',value:'∫'}))):{kind:'char',value:op.value},selector=sum?22:21;
      return emit({kind:'custombigop',selector,variation:(sub?16:0)|(n.sup?32:0)|(sum?64:0),operator,body:n.body,sub,sup:n.sup},ctx,style);
    }
    // MathType-generated records use main, LOWER, UPPER, operator. The public
    // MTEF web page reverses the two limit slots in its prose.
    return tmpl(op.selector,[slot(n.body,ctx,undefined,style),slot(sub,ctx,scriptSize(ctx),style),slot(n.sup,ctx,scriptSize(ctx),style),Buffer.from([13]),charRecord(op.value,{typeface:nativeMathGlyphs.has(op.value)?ctx.explicit({family:'math',bits:0},op.value):6})],variation);
  }
  if(n.kind==='limit'){
    if(n.limits===false)throw Error('Inline placement on named limit operators is unsupported');
    return tmpl(23,[slot({kind:'function',value:n.value},ctx),slot(n.sub,ctx,scriptSize(ctx),style),slot(n.sup,ctx,scriptSize(ctx),style)],(n.sub?0x10:0)|(n.sup?0x20:0));
  }
  if(n.kind==='limitbox')return tmpl(23,[slot(n.body,ctx,undefined,style),slot(n.sub,ctx,scriptSize(ctx),style),slot(n.sup,ctx,scriptSize(ctx),style)],(n.sub?0x10:0)|(n.sup?0x20:0));
  if(n.kind==='custombigop')return tmpl(n.selector,[slot(n.body,ctx,undefined,style),slot(n.sub,ctx,scriptSize(ctx),style),slot(n.sup,ctx,scriptSize(ctx),style),slot(n.operator,ctx,13,style)],n.variation);
  if(n.kind==='expandedintegral'){
    const glyphSize=10+([3,4,2,3,4,5,6][ctx.logicalSize??0]??3);
    return tmpl(15,[slot(n.body,ctx,undefined,style),slot(n.sub,ctx,scriptSize(ctx),style),slot(n.sup,ctx,scriptSize(ctx),style),...integralGlyphs(n.variation).map(g=>cat([glyphSize],charRecord(String.fromCharCode(g.code),{typeface:g.typeface})))],n.variation,n.templateOptions);
  }
  if(n.kind==='hbrace'){
    if(n.over&&n.sub||!n.over&&n.sup)throw Error('Horizontal brace annotation must be on the brace side');
    const glyph=n.bracket?(n.over?'\uec0d':'\uec0c'):(n.over?'\ufe37':'\ufe38');
    return tmpl(n.bracket?25:24,[slot(n.body,ctx,undefined,style),slot(n.over?n.sup:n.sub,ctx,scriptSize(ctx),style),charRecord(glyph,{typeface:22})],n.over?1:0);
  }
  if(n.kind==='strike')return tmpl(36,[slot(n.body,ctx,undefined,style)],n.variation);
  if(n.kind==='braket')return tmpl(30,[slot(n.left,ctx,undefined,style),slot(n.right,ctx,undefined,style),...(n.left?[charRecord('〈',{typeface:22})]:[]),charRecord('\uec07',{typeface:22}),...(n.right?[charRecord('〉',{typeface:22})]:[])],(n.left?1:0)|(n.right?2:0));
  if(n.kind==='arrow'){
    if(n.command==='mtdoublearrow'){const harpoon=(n.variation&3)===2;return tmpl(14,[slot(n.above,ctx,scriptSize(ctx),style),slot(n.below,ctx,scriptSize(ctx),style),charRecord(harpoon?'⇀':'→',{typeface:22}),charRecord(harpoon?'↽':'←',{typeface:22})],n.variation);}
    const left=n.command==='xleftarrow',both=n.command==='xleftrightarrow',double=n.command.includes('harpoons');
    if(double)throw Error('Asymmetric double-arrow templates require exact native construction');
    const variation=(left?0x10:both?0x30:0x20)|(!emptyNode(n.above)?4:0)|(!emptyNode(n.below)?8:0);
    return tmpl(14,[slot(n.above,ctx,scriptSize(ctx),style),slot(n.below,ctx,scriptSize(ctx),style),charRecord(left?'←':both?'↔':'→',{typeface:22})],variation);
  }
  if(n.kind==='widevector'){
    const under=n.command.startsWith('under'),direction=n.command.includes('leftright')?3:n.command.includes('left')?1:2,harpoon=n.command.includes('harpoon');
    const variation=direction|(under?4:0)|(harpoon?8:0),mark=harpoon?(under?'\ueb19':'\u20d1'):direction===1?'⃖':direction===3?'⃡':'⃗';
    return tmpl(31,[slot(n.body,ctx,undefined,style),charRecord(mark,{typeface:22})],variation);
  }
  if(n.kind==='matrix'){
    if(n.env==='aligned'){
      const rows=n.rows.map(([lhs,rhs])=>{
        const first=rhs.items[0];
        if(!first||first.kind!=='char'||!['=','<','>','≤','≥','≠','≈','≡','∼'].includes(first.value))throw Error('Aligned rows must place the alignment point immediately before their first relation');
        if(lhs.items.some(x=>x.kind==='char'&&['=','<','>','≤','≥','≠','≈','≡','∼'].includes(x.value)))throw Error('Aligned rows contain an earlier relation that would change native alignment');
        return slot(seqNode([...lhs.items,...rhs.items]),ctx,undefined,style);
      });
      return cat([4,0,4,4],...rows,[0]);
    }
    if(n.env==='gathered')return cat([4,0,2,4],...n.rows.map(r=>slot(r[0],ctx,undefined,style)),[0]);
    // MatrixSpec column_align wire enums: left0, center1, right2. Original
    // 0x679330 writes these bytes directly; 1..5 belongs to the UI mapping.
    const hjust=n.hjust??(n.env==='cases'||n.columns?.[0]==='l'?0:n.columns?.[0]==='r'?2:1);
    const pack=(rules,count)=>{const b=Buffer.alloc(Math.ceil((count+1)/4));for(let i=0;i<=count;i++)b[i>>2]|=(rules?.[i]||0)<<((i&3)*2);return b;};
    const cells=n.rows.flat(),matrix=cat([5,0,n.valign??4,hjust,n.vjust??1,n.rows.length,n.cols],pack(n.rowRules,n.rows.length),pack(n.colRules,n.cols),...cells.map(c=>slot(c,ctx,undefined,style)),[0]);
    const wrappers={pmatrix:['(',')'],bmatrix:['[',']'],Bmatrix:['{','}'],vmatrix:['|','|'],Vmatrix:['‖','‖'],cases:['{','.']};
    if(wrappers[n.env]){const [left,right]=wrappers[n.env],selector=fencePairs.findIndex(([l])=>l===left);return tmpl(selector,[cat([inheritedSize(ctx),1,0],matrix,[0]),charRecord(left,{typeface:22}),...(right==='.'?[]:[charRecord(right,{typeface:22})])],right==='.'?1:3);}
    return matrix;
  }
  if(n.kind==='bar')return tmpl(n.under?12:13,[slot(n.body,ctx,undefined,style)],n.double?1:0);
  if(n.kind==='box')return tmpl(37,[slot(n.body,ctx,undefined,style)],n.variation??0x1e);
  if(n.kind==='longdiv')return tmpl(26,[slot(n.body,ctx,undefined,style),slot(n.quotient,ctx,undefined,style)],n.quotient?1:0);
  if(n.kind==='wideaccent'){
    // Hat/tilde templates have a contents line and an expanding accent char.
    const hat=n.command==='widehat',arc=n.command==='overparen',joint=n.command==='mtjstat';return tmpl(joint?35:arc?34:hat?33:32,[slot(n.body,ctx,undefined,style),charRecord(joint?'\uee0d':arc?'⌢':hat?'̂':'̃',{typeface:22})]);
  }
  if(n.kind==='accent'){
    const c=onlyChar(n.body),embellishment=n.embellishment??(n.command==='not'?10:n.command==='prime'?5:n.command==='doubleprime'?6:n.command==='tripleprime'?18:accentCodes[n.command]);
    if(!c){
      if(n.command==='bar')return tmpl(13,[slot(n.body,ctx,undefined,style)]);
      if(['vec','overrightarrow','overleftarrow','overleftrightarrow'].includes(n.command)){
        const direction=n.command==='overleftarrow'?1:n.command==='overleftrightarrow'?3:2,mark=direction===1?'⃖':direction===3?'⃡':'⃗';
        return tmpl(31,[slot(n.body,ctx,undefined,style),charRecord(mark,{typeface:22})],direction);
      }
      throw Error(`Accent \\${n.command} requires one character; use a wide accent for a group`);
    }
    return charRecord(c.value,{typeface:authoredTypeface(ctx,c.value,style),embellishments:[embellishment]});
  }
  throw Error(`Unsupported node ${n.kind}`);
}

function rebuildNative(sourceNative,latex){
  const {data,parsed,header}=parseNative(sourceNative),ast=latexAst(latex);
  const content=parsed.records.find(n=>[1,4].includes(n.type));
  let formulaStart=content?.start;
  if(formulaStart===undefined){const size=parsed.records.find(n=>[9,10,11,12,13,14].includes(n.type));if(!size)throw Error('Cannot identify the source formula container; original data remains unchanged');formulaStart=size.start;}
  else {const at=parsed.records.indexOf(content);if(at&&[9,10,11,12,13,14].includes(parsed.records[at-1].type))formulaStart=parsed.records[at-1].start;}
  const ctx=sourceContext(parsed),body=slot(ast,ctx),mtef=cat(data.subarray(0,formulaStart),...ctx.extras,body,[0]);
  const h=Buffer.from(header);h.writeUInt32LE(mtef.length,8);const native=cat(h,mtef);parseNative(native);return native;
}
/** RULER record7 uses count then (type:uint8,position:uint16) entries.
 * Positions retain original 1/32 pt wire coordinates, not view pixels. */
export function readRuler(ole){
 const {parsed}=inspectOle(ole),owner=parsed.records.find(n=>n.type===1||n.type===4);
 return (owner?.ruler?.tabs||[]).map(({position,type})=>({position,type}));
}
export function patchRuler(ole,tabs){
 if(!Array.isArray(tabs)||tabs.length>255)throw Error('Invalid ruler tab list');
 const values=tabs.map(t=>{if(!Number.isInteger(t.position)||t.position<0||t.position>32767||!Number.isInteger(t.type)||t.type<0||t.type>4)throw Error('Invalid ruler tab position or type');return {position:t.position,type:t.type};}).sort((a,b)=>a.position-b.position);
 if(values.some((t,i)=>i&&t.position===values[i-1].position))throw Error('Ruler tab positions must be unique');
 const {data,header,native,parsed}=inspectOle(ole),owner=parsed.records.find(n=>n.type===1||n.type===4);
 if(!owner)throw Error('Formula has no root line or pile for a ruler');
 if(JSON.stringify(readRuler(ole))===JSON.stringify(values))return Buffer.from(ole);
 const ruler=values.length?cat([7,values.length],...values.map(t=>cat([t.type],u16(t.position)))):Buffer.alloc(0);
 // Keep every unrelated native byte, including SIZE, local font, color,
 // nudge and all companion streams. Locate the ruler after those options.
 let at=owner.start+2;
 if(owner.options&8){const a=data[at],b=data[at+1];at+=a===128&&b===128?6:2;}
 if(owner.type===1&&owner.options&4)at+=2;
 if(owner.type===4)at+=2;
 const end=owner.ruler?.end??at,next=Buffer.from(data.subarray(0,at));
 next[owner.start+1]=values.length?owner.options|2:owner.options&~2;
 const edited=cat(next,ruler,data.subarray(end)),h=Buffer.from(header);h.writeUInt32LE(edited.length,8);
 const result=wrapNative(cat(h,edited),ole);parseNative(inspectOle(result).native);return result;
}
export function makeOle(latex){const result=wrapNative(rebuildNative(b64(template.streams['Equation Native']),latex));oleLatex(result);return result;}
/** Exact recovered template constructor, separate from a normalized LaTeX
 * expression. Only original table pairs and populated, documented slots may be
 * authored. New expanded integrals use the original-runtime-stable option 1. */
export function makeTemplateOle(token,slotLatexes=[]){
 const catalog=JSON.parse(readFileSync(new URL('./template-catalog.json',import.meta.url))),entry=catalog.items.find(x=>x.originalToken===token&&x.nativeDefinition),d=entry?.nativeDefinition;
 if(!d)throw Error('Unknown original template token');
 if(d.variation>=0x100)integralMacroName(d.variation);
 if(!Array.isArray(slotLatexes)||slotLatexes.length>d.slots.length)throw Error('Invalid original template slot list');
 const sourceNative=inspectOle(makeOle('x')).native,{data,parsed,header}=parseNative(sourceNative),ctx=sourceContext(parsed),start=parsed.records.find(n=>[1,4].includes(n.type)).start;
 const slots=d.slots.map((s,i)=>{const text=slotLatexes[i]??'';if(s.lineNull&&text.trim())throw Error('Hidden original template slot cannot contain data');return slot(s.lineNull?undefined:latexAst(text),ctx,10+s.logicalSize);});
 const glyphs=d.glyphs.map(g=>cat(g.logicalSize?[10+g.logicalSize]:[],charRecord(String.fromCharCode(g.code),{typeface:g.typeface})));
 const body=cat([10,1,0],tmpl(d.selector,slots.concat(glyphs),d.variation,d.variation>=0x100?1:0),[0]),mtef=cat(data.subarray(0,start),...ctx.extras,body,[0]),h=Buffer.from(header);h.writeUInt32LE(mtef.length,8);
 const result=wrapNative(cat(h,mtef));oleLatex(result);return result;
}
export function makeEmbellishmentOle(id,latex){
 if(!Number.isInteger(id)||id<2||id>37)throw Error('Unknown original embellishment');
 const ast=latexAst(latex),c=onlyChar(ast);if(!c)throw Error('Character embellishments require exactly one character');
 const original=makeOle(latex),{data,parsed,header}=inspectOle(original),node=parsed.records.find(n=>n.type===1),character=node.children.find(n=>n.type===2);
 const raw=charRecord(c.value,{typeface:character.typeface,embellishments:[id]}),mtef=cat(data.subarray(0,character.start),raw,data.subarray(character.end)),h=Buffer.from(header);h.writeUInt32LE(mtef.length,8);
 const result=wrapNative(cat(h,mtef),original);oleLatex(result);return result;
}
/** Structural replacement, not lossless editing: preserve source Equation Native
 * header, preference bytes, CFB CLSID and all companion streams; regenerate the
 * formula's records. Original per-character fonts, size overrides and positioning
 * can change. editCharacters is the separate exact-native-byte edit path. */
export function replaceOleLatex(sourceOle,latex){
  // Opening and closing the structure editor must not normalize original MTEF
  // records, local styles, nudges or opaque extensions when nothing changed.
  if(latex===oleLatex(sourceOle))return Buffer.from(sourceOle);
  const {native}=inspectOle(sourceOle),result=wrapNative(rebuildNative(native,latex),sourceOle),ruler=readRuler(sourceOle),updated=ruler.length?patchRuler(result,ruler):result;oleLatex(updated);return updated;
}

export function characters(parsed){
  const result=[],ctx=decoderContext(parsed);function walk(nodes){for(const n of nodes){if(n.type===2&&n.codeOffset!==undefined)result.push({offset:n.codeOffset,code:n.code,char:String.fromCharCode(n.code),typeface:n.typeface,fontPosition:n.fontPosition,fontPositionOffset:n.fontPositionOffset,fontPositionSize:n.fontPositionSize,...characterEditing(n,ctx)});if(n.children)walk(n.children);}}
  walk(parsed.records);return result;
}

// Exact letter entries of the original Symbol encoder at 0x944a60, plus its
// ASCII digits. Full table SHA a959e5fa2c8cb4ff443225237af79c7985600bb176a08b9ef708e6c8dd89c655.
// A font-position is not Unicode: Symbol 0x61 is alpha, and 0x67 is gamma.
const symbolLetterPositions=new Map();
for(const [first,letters]of [[0x41,'ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ'],[0x61,'αβχδεϕγηιφκλμνοπθρστυϖωξψζ'],[0x30,'0123456789']])
 for(const [i,char]of [...letters].entries())symbolLetterPositions.set(char.charCodeAt(0),first+i);
const greekLetters=new Set([...Object.values(glyphs),...Array.from(symbolLetterPositions.keys(),n=>String.fromCharCode(n))].filter(c=>/^[\u0370-\u03ff]$/.test(c)));
function characterCategory(char){return /^[0-9]$/.test(char)?'number':/^[A-Za-z]$/.test(char)?'letter':greekLetters.has(char)?'greek':null;}
function characterEncoding(n,ctx){
 const definition=n.typeface<0?ctx.styles[-n.typeface-1]:ctx.preferences[n.typeface-1],font=ctx.fonts[definition?.font-1];
 return font?.encoding===1?'MTCode':font?.encoding===2?'Unknown':font?.encoding===3?'Symbol':font?.encoding===4?'MTExtra':ctx.encodings[font?.encoding-5]?.name;
}
function supportedGreekCode(code,encoding){
 if(encoding==='Symbol')return symbolLetterPositions.has(code);
 if(encoding==='MTCode')return true;
 // Original WinAllBasicCodePages Greek block at0x94ea7c (first=0x380),
 // within table SHA2365bbca82bfb426da77995899a4e3166ec2cc10b780dcd1aa55ad8267d65488.
 if(encoding==='WinAllBasicCodePages'&&code>=0x380&&code<0x400){const delta=code-0x380;return !!([0xffffd770,0xfffffffb,0x00007fff,0][delta>>5]&(1<<(delta&31)));}
 return false;
}
function characterPosition(n,code,ctx){
 const encoding=characterEncoding(n,ctx);
 if((n.options&0x14)===0x14)throw Error('Character has conflicting 8-bit and 16-bit font positions');
 let position;
 if(encoding==='Symbol'){
  if(symbolLetterPositions.get(n.code)!==n.fontPosition)throw Error('Source Symbol font position does not match its MTCode');
  position=symbolLetterPositions.get(code);
 }else if(encoding==='MTCode'){
  if(n.fontPosition!==n.code)throw Error('Source MTCode font position does not match its character');
  position=code;
 }else if(['WinANSI','WinAllBasicCodePages'].includes(encoding)&&n.fontPosition===n.code&&((n.code>=32&&n.code<=126&&code>=32&&code<=126)||(supportedGreekCode(n.code,encoding)&&supportedGreekCode(code,encoding))))position=code;
 if(position===undefined)throw Error('This legacy font encoding requires a verified character mapping');
 if(n.fontPositionSize===1&&position>255)throw Error('Replacement exceeds the source 8-bit font position');
 return position;
}
function characterEditing(n,ctx){
 const editCategory=characterCategory(String.fromCharCode(n.code)),encoding=characterEncoding(n,ctx)??null;
 let editReason=editCategory?null:'This character is a structural symbol or has no supported letter/digit edit';
 if(!editReason&&editCategory==='greek'&&!supportedGreekCode(n.code,encoding))editReason='Greek editing requires a verified native font encoding';
 if(!editReason&&n.fontPosition!==undefined)try{characterPosition(n,n.code,ctx);}catch(error){editReason=error.message;}
 return {editable:!editReason,editCategory,encoding,editReason};
}

function previewError(message){throw Error(`${message}; original native data remains unchanged`);}
function glyphLatex(n){
  if(n.code===undefined)previewError('Character has no MTCode mapping');const c=String.fromCharCode(n.code);
  if(c==='\t'&&n.typeface===23&&n.fontPosition===9)return '\\eltab ';
  if(reverseSpaces[c])return reverseSpaces[c];
  if(c==='−')return '-';
  if(reverseGlyphs[c])return reverseGlyphs[c];
  const script=Object.entries(scriptLetters).find(([,value])=>value===c);
  if(script)return `\\mathcal{${script[0]}}`;
  if(Object.values(bigOperators).some(op=>op.value===c))return c;
  if(greekLetters.has(c))return c;
  if(/[{}%$#&_]/.test(c))return '\\'+c;
  if(/^[A-Za-z0-9+\-=().,\[\]\/|:;<>!?]$/.test(c))return c;
  previewError(`Preview of MTCode U+${n.code.toString(16)} is unsupported`);
}
function decoderContext(parsed){
  const fonts=[],styles=[],preferences=[],encodings=[];
  function walk(nodes){for(const n of nodes){if(n.type===17)fonts.push(n);else if(n.type===8)styles.push(n);else if(n.type===18)preferences.splice(0,preferences.length,...n.styles);else if(n.type===19)encodings.push(n);if(n.children)walk(n.children);}}
  walk(parsed.records);return {fonts,styles,preferences,encodings};
}
function characterStyle(n,ctx){
  if(n.typeface===23&&n.code===9&&n.fontPosition===9)return null;
  if(n.typeface===22)previewError('Expanding decoration appeared outside a supported template');
  let style,font,defaultBits=0;
  if(n.typeface<0){const s=ctx.styles[-n.typeface-1];if(!s)previewError(`Unknown explicit font style ${n.typeface}`);({style,font}=s);}
  else {
    if(![1,2,3,4,5,6,7,8,11,12].includes(n.typeface))previewError(`Preview of typeface ${n.typeface} is unsupported`);
    const s=ctx.preferences[n.typeface-1];if(s){style=s.style;font=s.font;}
    defaultBits=[3,4].includes(n.typeface)?2:n.typeface===7?1:0;
    if(style===undefined)style=defaultBits;
    if(n.typeface===12)previewError('East Asian text font preview is unsupported');
  }
  if(style&~3)previewError('Unknown character style bits');
  const family=font?ctx.fonts[font-1]?.name:undefined;
  if(font&&!family)previewError(`Missing font definition ${font}`);
  if(family==='STIX Two Math'&&(style===0&&n.code>=128||style===2&&nativeGreekGlyphs.has(String.fromCharCode(n.code))))return null;
  if(family==='Arial Unicode MS'&&style===0)return 'text';
  // Editable LaTeX describes content and broad styles; exact family names stay
  // in MTEF and are rendered separately through CoreText, never inferred from
  // the MathLive input field's default math font.
  if(n.typeface===2&&style===0)return 'function';
  if(n.typeface===1&&style===0)return 'text';
  if(n.typeface===7)return style===1?'mathbf':style===3?'boldsymbol':style===2?'mathit':'mathrm';
  if(n.typeface>0&&style===defaultBits)return null;
  if(/courier new|arial/i.test(family||'')){const familyStyle=/arial/i.test(family)?'mathsf':'mathtt';return style?[style===1?'mathbf':style===2?'mathit':'boldsymbol',familyStyle]:familyStyle;}
  return style===0?'mathrm':style===1?'mathbf':style===2?'mathit':'boldsymbol';
}
function escapedText(c){return /[{}%$#&_\\]/.test(c)?'\\'+c:c;}
function renderChar(n,ctx){
  if(n.typeface===23&&n.code===9&&n.fontPosition===9)return ctx.fontToken?'\\elTab{}':'\\eltab ';
  if(n.options&0xc0)previewError('Unparsed/bad input character styling is unsupported');
  if(n.options&8)previewError('Nudged characters cannot be faithfully represented');
  if(n.code===undefined)previewError('Character has no MTCode mapping');
  const style=ctx.fontToken?null:characterStyle(n,ctx);
  let text=ctx.fontToken?ctx.fontToken(n,reverseSpaces[String.fromCharCode(n.code)]||''):style==='text'&&!reverseSpaces[String.fromCharCode(n.code)]?'':glyphLatex(n);
  if(reverseSpaces[String.fromCharCode(n.code)]){}
  else if(style==='text')text=`\\text{${escapedText(String.fromCharCode(n.code))}}`;
  else if(style&&style!=='function'){for(const command of (Array.isArray(style)?[...style].reverse():[style]))text=`\\${command}{${text}}`;}
  if(n.children){for(const e of n.children){
    if(e.type!==6||e.options)previewError('Unknown character embellishment styling');
    if(!ctx.fontToken&&[7,14,15,16,19,20,21,22,23,25,26,27,28,29,30,31,32,33,34,35,36,37].includes(e.embellishment)){text=preservedMacro(embellishmentMacro(e.embellishment),text);continue;}
    const command=accentCommands[e.embellishment];
    if(command==='prime')text+="'";else if(command==='doubleprime')text+="''";else if(command==='tripleprime')text+="'''";
    else if([7,14,15,19,20,31,32,36,37].includes(e.embellishment)){
      const under=[31,32,36,37].includes(e.embellishment),mark={7:'\\backprime',14:'\\rightharpoonup',15:'\\leftharpoonup',19:'\\frown',20:'\\smile',31:'\\frown',32:'\\smile',36:'\\rightharpoondown',37:'\\leftharpoondown'}[e.embellishment];text=`\\${under?'underset':'overset'}{${mark}}{${text}}`;
    }else if(e.embellishment===16&&ctx.fontToken)text=`\\enclose{horizontalstrike}{${text}}`;
    else if([16,21,22,23,29].includes(e.embellishment))text=`\\${{16:'sout',21:'xcancel',22:'cancel',23:'bcancel',29:'underline'}[e.embellishment]}{${text}}`;
    else if(e.embellishment>=25&&e.embellishment<=28)text=`\\underset{${'\\cdot '.repeat(e.embellishment-24)}}{${text}}`;
    else if(e.embellishment===30)text=`\\underset{\\sim}{${text}}`;
    else if(command)text=`\\${command}{${text}}`;
    else previewError(`Unknown embellishment ${e.embellishment}`);
    if(ctx.embellishment)text=ctx.embellishment(e,text,ctx);
  }}
  return text;
}
function contentChildren(n){
  const defs=new Set([8,17,18,19]);
  for(const c of n.children||[])if(![1,2,5,9,10,11,12,13,14].includes(c.type)&&!defs.has(c.type))previewError(`Unsupported template child record ${c.type}`);
  return (n.children||[]).filter(c=>[1,2,5].includes(c.type));
}
function slotsFor(n,count,{chars=0,oldRoot=false}={}){
  const kids=contentChildren(n),slots=kids.filter(c=>c.type===1),decor=kids.filter(c=>c.type===2);
  if(kids.some(c=>c.type===5)||slots.length!==count&&!(oldRoot&&slots.length===1)||decor.length!==chars)previewError(`Unexpected slot/decoration count in template ${n.selector}`);
  return {slots,decor};
}
function renderTemplate(n,ctx){
  if(n.options)previewError('Nudged templates cannot be faithfully represented');
  const selector=n.selector,variation=n.variation;
  if(n.templateOptions&&!([0,1,2,3,4,5,6,7,8,9].includes(selector)&&[1,2].includes(n.templateOptions))&&!(selector===15&&n.templateOptions===1))previewError('Unknown template options');
  const value=s=>s?renderNodes(s.children,ctx):'';
  if(selector<=9){
    let left,right;
    if(selector===9){if(variation&~0x33)previewError('Unknown interval variation');const d=['(',')','[',']'];left=d[variation&3];right=d[variation>>4&3];}
    else {if(variation&~3||!variation)previewError('Unknown fence variation');const pair=fencePairs[selector];if(!pair)previewError('White/open bracket template is unsupported');left=variation&1?pair[0]:'.';right=variation&2?pair[1]:'.';}
    const count=(left==='.'?0:1)+(right==='.'?0:1),{slots,decor}=slotsFor(n,1,{chars:count});let j=0;
    const originalPairs={0:[0x2329,0x232a],4:[0xec07,0xec08],5:[0xec09,0xec0a],6:[0xf8f0,0xf8fb],7:[0xf8ee,0xf8f9],8:[0x301a,0x301b]};
    for(const [side,d]of [left,right].entries())if(d!=='.'){const c=decor[j++];if(![d.charCodeAt(0),originalPairs[selector]?.[side]].includes(c.code)||c.typeface!==22||c.children?.length)previewError('Custom fence glyph is unsupported');}
    const escape=d=>({'{':'\\{','}':'\\}','⟨':'\\langle ','⟩':'\\rangle ','‖':'\\|','⌊':'\\lfloor ','⌋':'\\rfloor ','⌈':'\\lceil ','⌉':'\\rceil '}[d]||d);
    return `\\left${escape(left)}${value(slots[0])}\\right${escape(right)}`;
  }
  if(selector===10){if(variation!==0&&variation!==1)previewError('Unknown root variation');const {slots}=slotsFor(n,2,{oldRoot:variation===0});if(variation===0&&slots[1]&&!(slots[1].options&1)&&value(slots[1]))previewError('Unexpected square-root index');return `\\sqrt${variation?`[${value(slots[1])}]`:''}{${value(slots[0])}}`;}
  if(selector===11){if(![0,1,2,3,6].includes(variation))previewError('Unknown fraction variation');const {slots}=slotsFor(n,2),a=value(slots[0]),b=value(slots[1]);return variation&2?ctx.fontToken?`{${variation&1?'\\scriptstyle ':''}{}^{${a}}\\! /\\!{}_{${b}}}`:variation===2?preservedMacro('sfrac',a,b):preservedMacro('mtfrac',variation,a,b):`\\${variation?'tfrac':'frac'}{${a}}{${b}}`;}
  if([12,13].includes(selector)){if(variation&~1)previewError('Unknown bar variation');const {slots}=slotsFor(n,1),command=selector===12?'underline':'overline',body=value(slots[0]);return variation&&!ctx.fontToken?preservedMacro('mtdouble'+command,body):`\\${command}{${variation?`\\${command}{${body}}`:body}}`;}
  if(selector===14){
    if([5,9,13,21,25,29,37,41,45,6,10,14,22,26,30,38,42,46].includes(variation)){
      const {slots,decor}=slotsFor(n,2,{chars:2}),expected=(variation&3)===2?[0x21c0,0x21bd]:[0x2192,0x2190];
      if(decor.some((c,i)=>c.code!==expected[i]||c.typeface!==22))previewError('Unknown double-arrow decoration');
      return ctx.fontToken?`\\elDoubleArrow{${variation}}{${value(slots[0])}}{${value(slots[1])}}`:preservedMacro('mtdoublearrow',variation,value(slots[0]),value(slots[1]));
    }
    if(![0x14,0x18,0x1c,0x24,0x28,0x2c,0x34,0x38,0x3c].includes(variation))previewError('Double/asymmetric arrows require exact native rendering');
    const {slots,decor}=slotsFor(n,2,{chars:1}),direction=variation&0x30,command=direction===0x10?'xleftarrow':direction===0x30?'xleftrightarrow':'xrightarrow';
    if(decor[0].code!==({0x10:0x2190,0x20:0x2192,0x30:0x2194}[direction]))previewError('Unknown arrow decoration');
    return `\\${command}${variation&8?`[${value(slots[1])}]`:''}{${variation&4?value(slots[0]):''}}`;
  }
  if(selector>=15&&selector<=20){
    if(variation&~0x17f||selector!==15&&variation&0x100)previewError('Unknown expanded/custom integral variation');
    const kids=contentChildren(n),slots=kids.filter(c=>c.type===1),decor=kids.filter(c=>c.type===2);if(slots.length!==3||kids.some(c=>![1,2].includes(c.type)))previewError('Invalid large-operator slots');
    let command;if(selector===15){command={1:'int',2:'iint',3:'iiint',5:'oint',6:'oiint',7:'oiiint',9:'varointclockwise',13:'ointctrclockwise'}[variation&15];if(!command)previewError('Unsupported integral variation');}
    else {if(variation&15)previewError('Unknown big-operator variation');command={16:'sum',17:'prod',18:'coprod',19:'bigcup',20:'bigcap'}[selector];}
    const legacy=decor.length===1&&decor[0].code===bigOperators[command].value.charCodeAt(0)&&!decor[0].children?.length;
    const low=variation&15,loopCodes={5:0xee11,6:0xee12,7:0xee13,9:0xee01,13:0xee00},expected=selector===15?[...(loopCodes[low]?[{code:loopCodes[low],typeface:11}]:[]),...Array.from({length:low&3},()=>({code:0x222b,typeface:variation&0x100?22:6}))]:[{code:bigOperators[command].value.charCodeAt(0),typeface:6}];
    const original=decor.length===expected.length&&decor.every((c,i)=>c.code===expected[i].code&&c.typeface===expected[i].typeface&&!c.children?.length);
    if(!legacy&&!original)previewError('Custom large-operator glyph is unsupported');
    if(!(variation&0x10)&&value(slots[1])||!(variation&0x20)&&value(slots[2]))previewError('Hidden operator limits contain unrepresented content');
    const sum=!!(variation&0x40),defaultSum=!!bigOperators[command].sum,placement=sum===defaultSum?'':sum?'\\limits':'\\nolimits';
    if(ctx.fontToken&&(variation&0x100||original&&!legacy))return `\\elStretchIntegral{${variation}}{${value(slots[0])}}{${value(slots[1])}}{${value(slots[2])}}`;
    if(variation&0x100)return preservedMacro(integralMacroName(variation),n.templateOptions,value(slots[0]),value(slots[1]),value(slots[2]));
    // Symbol has the single integral outline, but no Unicode double/triple
    // integral glyph. Those are compound templates; use the layout engine's
    // template drawing rather than requesting a nonexistent Symbol character.
    const compound=selector===15&&(['iint','iiint'].includes(command)||original&&!legacy);
    const operator=ctx.fontToken&&!compound?`\\mathop{${renderChar(decor[0],ctx)}}${sum?'\\limits':'\\nolimits'}`:`\\${command}${placement}`;
    return `${operator}${variation&0x10?`_{${value(slots[1])}}`:''}${variation&0x20?`^{${value(slots[2])}}`:''}{${value(slots[0])}}`;
  }
  if(selector===23){
    if(variation&~0x30)previewError('Unknown limit variation');const {slots}=slotsFor(n,3);let base=value(slots[0]);
    if(base.startsWith('\\operatorname{'))base=base.replace('\\operatorname{','\\operatorname*{');
    if(!(variation&0x10)&&value(slots[1])||!(variation&0x20)&&value(slots[2]))previewError('Hidden named limits contain content');
    const known=base.startsWith('\\operatorname*{')||/^\\(?:lim|limsup|liminf|sup|inf|max|min)\s/.test(base)||ctx.fontToken&&base.startsWith('\\mathop{');
    if(!known){if(variation===0x10)return `\\underset{${value(slots[1])}}{${base}}`;if(variation===0x20)return `\\overset{${value(slots[2])}}{${base}}`;return `\\overset{${value(slots[2])}}{\\underset{${value(slots[1])}}{${base}}}`;}
    return `${base}${variation&0x10?`_{${value(slots[1])}}`:''}${variation&0x20?`^{${value(slots[2])}}`:''}`;
  }
  if(selector===21||selector===22){
    const allowed=selector===21?[0x10,0x20,0x30]:[0x50,0x60,0x70];if(!allowed.includes(variation))previewError('Unknown custom large-operator variation');const {slots}=slotsFor(n,4);
    const body=value(slots[0]),sub=value(slots[1]),sup=value(slots[2]),operator=value(slots[3]);
    if(!(variation&16)&&sub||!(variation&32)&&sup)previewError('Hidden custom-operator limit contains data');
    return ctx.fontToken?`\\mathop{${operator}}${selector===22?'\\limits':'\\nolimits'}${variation&16?`_{${sub}}`:''}${variation&32?`^{${sup}}`:''}{${body}}`:preservedMacro('mtbigop',selector,variation,operator,body,sub,sup);
  }
  if(selector===24||selector===25){const {slots}=slotsFor(n,2,{chars:1});if(variation&~1)previewError('Unknown horizontal fence variation');const command=(variation?'over':'under')+(selector===24?'brace':'bracket');return `\\${command}{${value(slots[0])}}${value(slots[1])?`${variation?'^':'_'}{${value(slots[1])}}`:''}`;}
  if(selector===26){if(variation&~1)previewError('Unknown long-division variation');const {slots}=slotsFor(n,2),body=`\\enclose{longdiv}{${value(slots[0])}}`;return variation?`\\overset{${value(slots[1])}}{${body}}`:body;}
  if([27,28,29].includes(selector)){
    if(variation&~1)previewError('Unknown script variation');const {slots}=slotsFor(n,2);
    if(selector===28&&value(slots[0])||selector===27&&value(slots[1]))previewError('Hidden script slot contains content');
    return (variation?'{}':'')+(selector!==28?`_{${value(slots[0])}}`:'')+(selector!==27?`^{${value(slots[1])}}`:'');
  }
  if(selector===31){
    if(![1,2,3,5,6,7,10,14].includes(variation))previewError('Unknown vector variation');const {slots,decor}=slotsFor(n,1,{chars:1});
    const marks={1:0x20d6,2:0x20d7,3:0x20e1,5:0x20d6,6:0x20d7,7:0x20e1,10:0x20d1,14:0xeb19};if(decor[0].code!==marks[variation])previewError('Unknown vector decoration');
    const command=(variation&4?'under':'over')+(variation&8?'rightharpoon':(variation&3)===1?'leftarrow':(variation&3)===3?'leftrightarrow':'rightarrow');
    return `\\${command}{${value(slots[0])}}`;
  }
  if(selector===30){if(![1,2,3].includes(variation))previewError('Unknown Dirac-bracket variation');const {slots}=slotsFor(n,2,{chars:variation===3?3:2});return variation===1?`\\bra{${value(slots[0])}}`:variation===2?`\\ket{${value(slots[1])}}`:`\\braket{${value(slots[0])}|${value(slots[1])}}`;}
  if(selector===32||selector===33){if(variation)previewError('Unknown wide-accent variation');const {slots,decor}=slotsFor(n,1,{chars:1});if(decor[0].code!==(selector===33?0x302:0x303))previewError('Unknown accent decoration');return `\\${selector===33?'widehat':'widetilde'}{${value(slots[0])}}`;}
  if(selector===34){if(variation)previewError('Unknown arc variation');const {slots}=slotsFor(n,1,{chars:1});return `\\overparen{${value(slots[0])}}`;}
  if(selector===35){if(variation)previewError('Unknown joint-status variation');const {slots,decor}=slotsFor(n,1,{chars:1});if(decor[0].code!==0xee0d||decor[0].typeface!==22)previewError('Unknown joint-status decoration');return preservedMacro(ctx.fontToken?'elJstat':'mtjstat',value(slots[0]));}
  if(selector===36){if(![1,2,4,6].includes(variation))previewError('Unknown strike variation');const {slots}=slotsFor(n,1);return variation===1&&ctx.fontToken?`\\enclose{horizontalstrike}{${value(slots[0])}}`:`\\${{1:'sout',2:'cancel',4:'bcancel',6:'xcancel'}[variation]}{${value(slots[0])}}`;}
  if(selector===37){if(![0xa,0xc,0x12,0x14,0x1e,0x1f].includes(variation))previewError('Unknown box variation');const {slots}=slotsFor(n,1),notation=variation===0x1e?'box':variation===0x1f?'roundedbox':[[2,'left'],[4,'right'],[8,'top'],[16,'bottom']].filter(([bit])=>variation&bit).map(([,name])=>name).join(' ');return variation===0x1e?`\\boxed{${value(slots[0])}}`:`\\enclose{${notation}}{${value(slots[0])}}`;}
  previewError(`Preview of template ${selector}/${variation} is not supported`);
}
function renderNodes(nodes,ctx,{top=false}={}){
  const out=[];
  for(let i=0;i<nodes.length;i++){
    const n=nodes[i];
    if(n.type===1){if(n.options&8)previewError('Nudged line position is unsupported');if(n.lineSpacing&&!ctx.line)previewError('Custom line spacing requires native renderer');const local={...ctx,currentRuler:n.ruler||ctx.currentRuler},latex=renderNodes(n.children,local);out.push(ctx.line?ctx.line(n,latex,local):latex);}
    else if(n.type===2){
      if(n.typeface===2&&!(n.children?.length)&&!(n.options&8)&&ctx.fontToken){
        const group=[n];let j=i+1;for(;j<nodes.length;j++){const c=nodes[j];if(c.type!==2||c.typeface!==2||c.children?.length||c.options&10||!/[A-Za-z]/.test(String.fromCharCode(c.code)))break;group.push(c);}out.push(`\\mathop{${group.map(c=>renderChar(c,ctx)).join('')}}\\nolimits`);i=j-1;
      }else if(n.typeface===2&&!(n.children?.length)&&!(n.options&8)&&!ctx.fontToken){
        if(characterStyle(n,ctx)!=='function'){out.push(renderChar(n,ctx));continue;}
        let name=String.fromCharCode(n.code),j=i+1;
        for(;j<nodes.length;j++){const c=nodes[j];if(c.type!==2||c.typeface!==2||c.children?.length||c.options&10||!/[A-Za-z]/.test(String.fromCharCode(c.code))||characterStyle(c,ctx)!=='function')break;name+=String.fromCharCode(c.code);}
        characterStyle(n,ctx);
        if(/^[A-Za-z]+$/.test(name)){out.push(functions.has(name)||['lim','limsup','liminf','sup','inf','max','min'].includes(name)?`\\${name} `:`\\operatorname{${name}}`);i=j-1;}else out.push(renderChar(n,ctx));
      }else out.push(renderChar(n,ctx));
    }
    else if(n.type===3){const latex=renderTemplate(n,ctx);out.push(ctx.template?ctx.template(n,latex,ctx):latex);}
    else if(n.type===5){
      if(n.options)previewError('Nudged matrices are unsupported');
      const hjust=n.hjust&0x7f,vjust=n.vjust&0x7f;
      if(!n.rows||!n.cols||n.rows>31||n.cols>31||!([0,1,2].includes(hjust))||vjust!==1||![1,3,4].includes(n.valign))previewError('Custom matrix alignment is unsupported');
      const cells=n.children.filter(c=>c.type===1);if(cells.length!==n.rows*n.cols||n.children.some(c=>![1,10,11,12,13,14].includes(c.type)))previewError('Matrix cell count/structure is invalid');
      const unpack=(bytes,count)=>Array.from({length:count+1},(_,i)=>(bytes[i>>2]>>((i&3)*2))&3),rowRules=unpack(n.rowPartitions,n.rows),colRules=unpack(n.colPartitions,n.cols);
      if([...rowRules,...colRules].some(x=>x>1))previewError('Dashed/dotted matrix partition styles require native renderer');
      const partitioned=rowRules.some(Boolean)||colRules.some(Boolean),rows=[];for(let r=0;r<n.rows;r++)rows.push((rowRules[r]?'\\hline ':'')+cells.slice(r*n.cols,(r+1)*n.cols).map(c=>renderNodes(c.children,ctx)).join('&'));
      const env=hjust===1&&!partitioned?'matrix':'array',align=hjust===0?'l':hjust===2?'r':'c',columns=env==='matrix'?'':`{${Array.from({length:n.cols},(_,c)=>(colRules[c]?'|':'')+align).join('')+(colRules[n.cols]?'|':'')}}`;
      const latex=`\\begin{${env}}${columns}${rows.join('\\\\')}${rowRules[n.rows]?'\\\\\\hline ':''}\\end{${env}}`;out.push(ctx.matrix?ctx.matrix(n,latex,ctx):(n.hjust|n.vjust)&0x80||n.valign!==4?`\\mtmatrix{${n.hjust}}{${n.vjust}}{${n.valign}}{${latex}}`:latex);
    }
    else if(n.type===4){
      if(n.options&8||![2,4].includes(n.halign)||n.valign!==4||n.children.some(c=>![1,10,11,12,13,14].includes(c.type)))previewError('Custom equation pile is unsupported');
      const local={...ctx,currentRuler:n.ruler||ctx.currentRuler};
      const rows=n.children.filter(c=>c.type===1).map(c=>{
        if(n.halign===2){const latex=renderNodes(c.children,local);return ctx.line?ctx.line(c,latex,local):latex;}
        const at=c.children.findIndex(x=>x.type===2&&['=','<','>','≤','≥','≠','≈','≡','∼'].includes(String.fromCharCode(x.code)));
        if(at<0)previewError('Relationally aligned pile has no supported relation');
        return renderNodes(c.children.slice(0,at),local)+'&'+renderNodes(c.children.slice(at),local);
      });const env=n.halign===4?'aligned':'gathered',latex=`\\begin{${env}}${rows.join('\\\\')}\\end{${env}}`;out.push(ctx.pile?ctx.pile(n,latex,local):latex);
    }
    else if(n.type===9){if(!ctx.fontToken)previewError('Explicit character-size overrides cannot be faithfully represented');}
    else if([15,16].includes(n.type)){if(!ctx.fontToken)previewError('Explicit native colors cannot be faithfully represented');}
    else if([10,11,12,13,14].includes(n.type)){}
    else if([8,17,18,19].includes(n.type)){if(n.type===18&&n.options)previewError('Unknown equation preference options');}
    else previewError(`Preview of record ${n.type} is not supported`);
  }
  return out.join('');
}
export function oleLatex(ole){const {parsed}=inspectOle(ole);return renderNodes(parsed.records,decoderContext(parsed),{top:true});}
/** Render-only glyph callback, separate from editable LaTeX. Font and size
 * metadata is consumed by the native-font renderer rather than discarded. */
export function oleRenderLatex(ole,fontToken,options={}){const {parsed}=inspectOle(ole),ctx={...decoderContext(parsed),...options,fontToken};return renderNodes(parsed.records,ctx,{top:true});}

export function editCharacters(ole,replacements){
  const {native,parsed}=inspectOle(ole),ctx=decoderContext(parsed),allowed=new Map();
  function walk(nodes){for(const n of nodes){if(n.type===2&&n.codeOffset!==undefined)allowed.set(n.codeOffset,n);if(n.children)walk(n.children);}}walk(parsed.records);
  const edited=Buffer.from(native);let changed=false;
  for(const [offsetText,value]of Object.entries(replacements)){
    const offset=Number(offsetText),old=allowed.get(offset);
    if(!old||typeof value!=='string'||[...value].length!==1||value.codePointAt(0)>65535)throw Error('Invalid character replacement');
    if(value.charCodeAt(0)===old.code)continue;
    const category=characterCategory(value);
    if(!category||category!==characterCategory(String.fromCharCode(old.code)))throw Error('Preserve font styles: replace a digit with a digit, a Latin letter with a Latin letter, or a Greek letter with a Greek letter');
    if(category==='greek'&&(!supportedGreekCode(old.code,characterEncoding(old,ctx))||!supportedGreekCode(value.charCodeAt(0),characterEncoding(old,ctx))))throw Error('Greek editing requires a verified native font encoding');
    const position=old.fontPosition===undefined?undefined:characterPosition(old,value.charCodeAt(0),ctx);
    edited.writeUInt16LE(value.charCodeAt(0),28+offset);
    if(old.fontPositionOffset!==undefined){if(old.fontPositionSize===1)edited.writeUInt8(position,28+old.fontPositionOffset);else edited.writeUInt16LE(position,28+old.fontPositionOffset);}changed=true;
  }
  if(!changed)return Buffer.from(ole);
  const result=wrapNative(edited,ole);inspectOle(result);return result;
}
