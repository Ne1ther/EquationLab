import {makeOle} from './native.mjs';
import {patchTypography,readTypography} from './typography-native.mjs';

function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}

/** Exact known values from the shipped Times+Symbol 12.eqp profile. The hash is
 * of the original 1047-byte vendor text, not of a normalized reconstruction.
 * Source values/line anchors: evidence/rea/command-parity-eqp.json.
 * This is one verified factory profile, not a claim that every installation's
 * saved user preferences or every MathType release uses these same values. */
export const MATHTYPE_FACTORY_SOURCE=freeze({name:'Times+Symbol 12.eqp',format:'MathType INI v1',bytes:1047,sha256:'08c741cb11fb5f812acb9908deb09e383c212ed3065d478ca4e02707d32d2e6b',evidence:'evidence/rea/command-parity-eqp.json'});
const styles=[['Times New Roman',0],['Times New Roman',0],['Times New Roman',2],['Symbol',2],['Symbol',0],['Symbol',0],['Times New Roman',1],['Times New Roman',0],['Courier New',0],['Times New Roman',0],['MT Extra',0]];
const sizes=[['pt','12'],['%','58'],['%','42'],['%','150'],['%','100']];
const spacing=['150','150','100','45','25','8','25','100','100','35','100','8','5','2.5','8','8','100','100','0','8','17','8','100','12.5','45','5','5','5','5','10'];
const dimensionMap=values=>Object.fromEntries(values.map(([unit,value],id)=>[id,{unit,value}]));
export const MATHTYPE_FACTORY_TYPOGRAPHY=freeze({
 styles:Object.fromEntries(styles.map(([font,style],id)=>[id+1,{font,style}])),
 sizes:dimensionMap(sizes),spaces:dimensionMap(spacing.map(value=>['%',value])),
 extraSizes:dimensionMap([['%','75'],['%','150'],['pt','1']])
});

/** New authoring only: factory first, then the caller's explicit preferences.
 * Existing OLE objects MUST use editCharacters/replaceOleLatex/patchTypography
 * on their own source; this helper intentionally accepts only LaTeX. The raw
 * makeOle template remains unchanged for legacy reconstruction/regressions. */
export function makeNewOle(latex,typography){
 const factory=patchTypography(makeOle(latex),MATHTYPE_FACTORY_TYPOGRAPHY);
 return typography?patchTypography(factory,typography):factory;
}
export function factoryTypography(){return readTypography(makeNewOle('x^3'));}
