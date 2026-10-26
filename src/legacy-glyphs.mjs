// MathType 7.8's shipped MathJax-LaTeX / Texvc translator rules identify
// these MTCode private characters. Unicode outlines come from licensed STIX,
// while the original MTCode/font/position remain intact on a read or no-op save.
const doubleStruckExceptions={2:0x2102,7:0x210d,13:0x2115,15:0x2119,16:0x211a,17:0x211d,25:0x2124};
const scriptExceptions={1:0x212c,4:0x2130,5:0x2131,7:0x210b,8:0x2110,11:0x2112,12:0x2133,17:0x211b};
export function legacyGlyph(code){
 if(code===0xe98f)return {unicode:0x22c5,latex:'\\centerdot ',font:'MT Extra',encoding:'MTExtra',position:103};
 if(code>=0xf080&&code<=0xf099){const i=code-0xf080;return {unicode:doubleStruckExceptions[i]??0x1d538+i,latex:`\\mathbb{${String.fromCharCode(65+i)}}`,font:'Euclid Math Two',encoding:'EuclidMath2',position:65+i};}
 if(code>=0xf100&&code<=0xf119){const i=code-0xf100;return {unicode:scriptExceptions[i]??0x1d49c+i,latex:`\\mathcal{${String.fromCharCode(65+i)}}`,font:'Euclid Math One',encoding:'EuclidMath1',position:65+i};}
 return null;
}
export function legacyOutline(code,font){
 const privateGlyph=legacyGlyph(code);if(privateGlyph)return privateGlyph.unicode;
 if(/^(Euclid Math (One|Two)|MT Extra)$/i.test(font)&&[0x210b,0x2119,0x223c,0x22ef,0x2299].includes(code))return code;
 return null;
}
