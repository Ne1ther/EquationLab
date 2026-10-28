// Font-independent artwork on a 24-unit grid, drawn for Equation Lab.
export const ribbonPalette={blue:'#397DB1',muted:'#74899B',accent:'#BE7938'};
const p=d=>`<path d="${d}"/>`;
const g=(color,body)=>`<g stroke="${ribbonPalette[color]}">${body}</g>`;
const cross=(x,y,s=5)=>p(`M${x} ${y}l${s} ${s}m0-${s}l-${s} ${s}`);
const fraction=(x=8,y=7)=>p(`M${x+2} ${y}l4 4m0-4-4 4M${x} ${y+6}h8m-6 2 4 4m0-4-4 4`);
const numberAt=x=>p(`M${x+1.5} 7.5c-1.7 2.5-1.7 6.5 0 9m2-6 1.4-1.2v5.5m-1.3 0h2.6m.8-7.3c1.7 2.5 1.7 6.5 0 9`);
export const ribbonArtwork={
 inline:g('muted',p('M3 8h3m13 0h2M3 19h18'))+cross(8,9,6)+g('accent',p('M15.5 5.5c0-2.4 4-2.4 4 0 0 1.4-2.4 2-4 3.8h4')),
 display:g('muted',p('M3 3h18M3 22h18'))+fraction(8,6),
 'number-right':fraction(3,6)+g('accent',numberAt(13.5)),
 'number-left':g('accent',numberAt(1.5))+fraction(13,6),
 edit:p('M4 9V4h5M15 4h5v4M4 15v5h5')+g('accent',p('m10 14 8-8 3 3-8 8-4 1ZM16 8l3 3')),
 symbols:p('M19 4H5l8 8-8 8h14M17 4v2m2 12v2'),
 number:g('accent',p('M6 4C2 8 2 16 6 20M18 4c4 4 4 12 0 16'))+p('m10 8 3-2v12m-3 0h6'),
 'number-format':p('M5 4C2 8 2 13 5 17M19 4c3 4 3 9 0 13M9 15V7m0 3c0-4 6-4 6 0v5')+g('accent',p('M5 21h14M8 19v3m8-3v3')),
 reference:p('M5 4C2 7 2 12 5 15M13 4c3 3 3 8 0 11m-6-7 2-1v6')+g('accent',p('M9 21h5c3 0 5-3 5-7v-3m-3 3 3-3 3 3')),
 refresh:p('M20 9a8.2 8.2 0 0 0-14-4L3 8m0-5v5h5M4 15a8.2 8.2 0 0 0 14 4l3-3m0 5v-5h-5')+g('accent',p('m10 10 2-1v6m-2 0h4')),
 chapter:p('M12 6c-2-2-6-3-10-2v15c4-1 8 0 10 2m0-15c2-2 6-3 10-2v15c-4-1-8 0-10 2ZM12 6v15')+g('accent',p('M6 8v6m11-6v6')),
 previous:p('m11 5-7 7 7 7M4 12h16'),
 next:p('m13 5 7 7-7 7M4 12h16'),
 typography:p('M3 19 8 5l5 14M5 14h6')+g('accent',p('M21 12v7m0-3.5a3.5 3.5 0 1 0-7 0 3.5 3.5 0 0 0 7 0')),
 spacing:cross(9,5,6)+g('muted',p('M4 3v10M20 3v10'))+g('accent',p('M4 19h16m-13-3-3 3 3 3m10-6 3 3-3 3')),
 document:p('M5 3h9l5 5v13H5ZM14 3v5h5')+cross(8,12,5)+g('accent',p('M14.5 10.5c0-1.8 3-1.8 3 0 0 1-1.8 1.5-3 2.8h3')),
 export:p('M5 14V3h9l5 5v6M14 3v5h5M3 18v3h18v-3')+g('accent',p('M12 11v8m-3-3 3 3 3-3')),
 help:'<circle cx="12" cy="12" r="9"/>'+p('M9.5 9a2.5 2.5 0 1 1 4.4 1.6c-1.1.8-1.9 1.2-1.9 2.9')+'<circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none"/>',
 capabilities:p('M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3Z')+g('accent',p('m14 18 3 3 5-7')),
 app:p('M5 13h12c1-5-1.5-8-5-8-5 0-8 5-8 9 0 4 2 6 5 6 2.8 0 5-1.4 6.5-3')+g('accent',p('M17 4.5c0-3 5-3 5 0 0 1.8-3 2.5-5 4.5h5'))
};
export function ribbonSvg(name,{small=false}={}){
 if(!Object.hasOwn(ribbonArtwork,name))throw Error('Unknown Ribbon artwork: '+name);
 return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${ribbonPalette.blue}" color="${ribbonPalette.blue}" stroke-width="${small?1.9:1.65}" stroke-linecap="round" stroke-linejoin="round"><title>${name}</title>${ribbonArtwork[name]}</svg>\n`;
}
