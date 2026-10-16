// Original selector-15 pairs, in retained constructor-table order. The Windows
// 7.8 API read/save/reopen evidence is in output/integral-runtime-20261016/.
export const expandedIntegralVariations=Object.freeze([257,369,305,337,273,258,338,274,259,339,275,261,341,277,262,342,278,263,343,279,269,349,285,265,345,281]);
export const integralMacroName=variation=>{const index=expandedIntegralVariations.indexOf(variation);if(index<0)throw Error('Unknown original expanded integral');return 'mtint'+String.fromCharCode(65+index);};
export const integralMacroVariation=command=>/^mtint[A-Z]$/.test(command)?expandedIntegralVariations[command.charCodeAt(5)-65]:undefined;
export function integralGlyphs(variation){
 integralMacroName(variation);
 const low=variation&15,loop={5:0xee11,6:0xee12,7:0xee13,9:0xee01,13:0xee00}[low];
 return [...(loop?[{code:loop,typeface:11}]:[]),...Array.from({length:low&3},()=>({code:0x222b,typeface:22}))];
}
export function integralEditorMacro(variation){
 const command={1:'int',2:'iint',3:'iiint',5:'oint',6:'oiint',7:'oiiint',9:'varointclockwise',13:'ointctrclockwise'}[variation&15];
 // Arg 1 is the preserved native option, deliberately hidden from the canvas.
 return {args:4,def:`\\${command}${variation&64?'\\limits':'\\nolimits'}${variation&16?'_{#3}':''}${variation&32?'^{#4}':''}{#2}`,expand:false};
}
