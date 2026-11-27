export const documentPageTwips = Object.freeze({width:11906,height:16838,margin:1440});
const wordNamespace='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const vmlNamespace='urn:schemas-microsoft-com:vml';
// Leave room for the normal line box and the display paragraph's 6 pt before/after spacing.
const paragraphAllowance=24;
const defaultWidthTwips=documentPageTwips.width-2*documentPageTwips.margin;
const defaultHeightTwips=documentPageTwips.height-2*documentPageTwips.margin;
const smallPreviewLimit=72;

/** One scale controls the picture size and, in a copy, its run position.
 * In-place Word OLE updates retain the host's existing run position. Its
 * lowering or raising must therefore be budgeted as a fixed offset. */
export function wordPreviewBox({width,height,depth},{widthTwips,heightTwips,retainedPosition,pendingOwnerCapture=false,oldFrame}={}){
 const availableWidth=(widthTwips??defaultWidthTwips)/20;
 const availableHeight=(heightTwips??defaultHeightTwips)/20-paragraphAllowance;
 const fixedOffset=retainedPosition===undefined?0:Math.abs(retainedPosition);
 const scaledOffset=retainedPosition===undefined?Math.abs(depth):0;
 // Range.WordOpenXML can omit the section or carry range-export defaults.
 // A selection capture uses the old picture as a no-growth envelope. A
 // legacy capture without a usable VML frame keeps its small-edit path.
 if(pendingOwnerCapture){
  const safeWidth=Math.min(smallPreviewLimit,oldFrame?.width??Infinity);
  const safeHeight=Math.min(smallPreviewLimit,oldFrame?oldFrame.height+fixedOffset:Infinity);
  if(width>safeWidth+.001||height+fixedOffset+scaledOffset>safeHeight+.001)
   throw Error('此公式需要完整的 Word 页面信息。请等待文档加载完成后重试，当前编辑仍保留。');
 }
 const heightBudget=availableHeight-fixedOffset-.5;
 if(heightBudget<=0)throw Error('Word 公式原有基线位置超出页面，请在 Word 中重置公式的字符位置后重试。');
 const scale=Math.min(1,availableWidth/width,heightBudget/(height+scaledOffset));
 return {width:width*scale,height:height*scale,depth:depth*scale};
}

const isWord=(node,name)=>node?.namespaceURI===wordNamespace&&node.localName===name;
const child=(node,name)=>Array.from(node?.childNodes??[]).find(n=>isWord(n,name));
const children=(node,name)=>Array.from(node?.childNodes??[]).filter(n=>isWord(n,name));
const attr=(node,name)=>node?.getAttributeNS(wordNamespace,name);
const positionNode=container=>child(child(container?.parentNode,'rPr'),'position');
const objectShape=container=>Array.from(container?.childNodes??[]).find(node=>node.namespaceURI===vmlNamespace&&node.localName==='shape');
function shapeDimension(shape,name){
 return Number(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*(\\d+(?:\\.\\d+)?)pt\\s*(?:;|$)`,'i').exec(shape?.getAttribute('style')??'')?.[1]);
}
function storedFrame(shape){
 const width=shapeDimension(shape,'width'),height=shapeDimension(shape,'height');
 return width>0&&height>0?{width,height}:null;
}
const runPosition=container=>{
 const value=attr(positionNode(container),'val');
 return /^[-+]?\d+$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value)/2:0;
};

const defaultCellMargin=115; // OOXML's default leading and trailing margin, in twips.
function nonnegativeInteger(value){
 return /^\d+$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):undefined;
}
function tableMeasurement(node){
 const type=attr(node,'type');
 if(type==='nil')return 0;
 if(type&&type!=='dxa')return undefined;
 return nonnegativeInteger(attr(node,'w'));
}
function gridCellWidth(cell,row,table){
 const grid=children(child(table,'tblGrid'),'gridCol');
 if(!grid.length||cell.parentNode!==row)return undefined;
 const before=child(child(row,'trPr'),'gridBefore');
 let start=before?nonnegativeInteger(attr(before,'val')):0;
 for(const sibling of Array.from(row.childNodes)){
  if(start===undefined||start>=grid.length)return undefined;
  if(!isWord(sibling,'tc')){
   if(sibling.getElementsByTagNameNS?.(wordNamespace,'tc').length)return undefined;
   continue;
  }
  const spanNode=child(child(sibling,'tcPr'),'gridSpan');
  const span=spanNode?nonnegativeInteger(attr(spanNode,'val')):1;
  if(!span||span>grid.length-start)return undefined;
  if(sibling===cell){
   const widths=grid.slice(start,start+span).map(column=>nonnegativeInteger(attr(column,'w')));
   return widths.every(width=>width>0)?widths.reduce((sum,width)=>sum+width,0):undefined;
  }
  start+=span;
 }
}
function tableStyleLayers(styles,tableProps){
 const available=children(styles?.documentElement,'style').filter(style=>attr(style,'type')==='table');
 const byId=new Map(available.map(style=>[attr(style,'styleId'),style]));
 const styleId=attr(child(tableProps,'tblStyle'),'val');
 let style=byId.get(styleId)??available.find(s=>['1','on','true'].includes(attr(s,'default')));
 const seen=new Set(),layers=[];
 while(style&&!seen.has(style)){
  seen.add(style);
  const whole=children(style,'tblStylePr').find(node=>attr(node,'type')==='wholeTable');
  if(whole)layers.push(whole);
  layers.push(style);
  style=byId.get(attr(child(style,'basedOn'),'val'));
 }
 return layers;
}
function tableCellNetWidth(cell,styles){
 const row=cell.parentNode,table=row?.parentNode;
 if(!isWord(row,'tr')||!isWord(table,'tbl'))return undefined;
 const props=child(cell,'tcPr'),tableProps=child(table,'tblPr');
 const preferred=child(props,'tcW');
 const explicit=preferred?tableMeasurement(preferred):undefined;
 // Auto and percentage cell widths may differ from the cached grid.
 if(preferred&&!(explicit>0))return undefined;
 const layers=tableStyleLayers(styles,tableProps);
 const layout=child(tableProps,'tblLayout')??layers.map(layer=>child(child(layer,'tblPr'),'tblLayout')).find(Boolean);
 const grid=attr(layout,'type')==='fixed'?gridCellWidth(cell,row,table):undefined;
 const width=explicit&&grid?Math.min(explicit,grid):explicit??grid;
 if(!(width>0))return undefined;
 const styleMargins=layers.flatMap(layer=>[child(child(layer,'tcPr'),'tcMar'),child(child(layer,'tblPr'),'tblCellMar')]);
 const margins=[child(props,'tcMar'),child(child(row,'tblPrEx'),'tblCellMar'),child(tableProps,'tblCellMar'),...styleMargins];
 const edge=(logical,physical)=>{
  for(const margin of margins){
   const value=child(margin,logical)??child(margin,physical);
   if(isWord(margin,'tcMar')&&attr(value,'type')==='nil')continue;
   if(value)return tableMeasurement(value);
  }
  return defaultCellMargin;
 };
 const net=width-edge('start','left')-edge('end','right');
 return Number.isFinite(net)?Math.max(1,net):undefined;
}

/** Use the paragraph's section/column geometry when it is resolved. Closest
 * body block geometry remains a page-level bound for tables and other nested
 * paragraphs that the standalone arrangement engine cannot edit. */
export function wordObjectPreviewLimits(container,resolveGeometry,styles){
 let paragraph=container;
 while(paragraph&&!isWord(paragraph,'p'))paragraph=paragraph.parentNode;
 let block=paragraph;
 while(block&&!isWord(block.parentNode,'body'))block=block.parentNode;
 const cells=[];
 for(let node=paragraph?.parentNode;node;node=node.parentNode)if(isWord(node,'tc'))cells.push(node);
 let geometry;
 try{geometry=resolveGeometry?.(paragraph,cells.length?{previewBodyBlock:block}:undefined);}catch{/* Unresolved local layout still has a page bound. */}
 const limits={retainedPosition:runPosition(container)};
 const shape=objectShape(container),oldFrame=storedFrame(shape);
 if(oldFrame)limits.oldFrame=oldFrame;
 if(geometry?.widthTwips>0)limits.widthTwips=geometry.widthTwips;
 if(geometry?.heightTwips>0)limits.heightTwips=geometry.heightTwips;
 for(let node=block;node&&!(limits.widthTwips&&limits.heightTwips);node=node.nextSibling){
  const section=isWord(node,'sectPr')?node:child(child(node,'pPr'),'sectPr');
  if(!section)continue;
  const page=child(section,'pgSz'),margin=child(section,'pgMar');
  for(const [key,size,start,end] of [['widthTwips','w','left','right'],['heightTwips','h','top','bottom']]){
   if(limits[key])continue;
   const values=[attr(page,size),attr(margin,start),attr(margin,end)];
   if(!values.every(value=>/^\d+$/.test(value)&&Number(value)<=31680))continue;
   const [dimension,before,after]=values.map(Number),available=dimension-before-after;
   if(available>0)limits[key]=available;
  }
  if(attr(child(section,'type'),'val')!=='continuous')break;
 }
 const oldWidth=cells.length?oldFrame?.width??shapeDimension(shape,'width'):undefined;
 for(const [index,cell] of cells.entries()){
  const netWidth=tableCellNetWidth(cell,styles);
  const indent=index===0?Math.max(0,(geometry?.leftIndentTwips??0)+(geometry?.rightIndentTwips??0)):0;
  const available=netWidth===undefined?oldWidth*20:Math.max(1,netWidth-indent);
  if(available>0)limits.widthTwips=Math.min(limits.widthTwips??defaultWidthTwips,available);
 }
 return limits;
}

/** Arrangement resizes the stored picture without replacing the image or OLE. */
export function fitStoredWordObjectPreview(container,limits){
 const shape=objectShape(container),frame=storedFrame(shape);
 if(!frame)return;
 const {width,height}=frame;
 const fitted=wordPreviewBox({width,height,depth:-runPosition(container)},limits);
 if(fitted.width<width||fitted.height<height)updateWordObjectPreview(shape,container,fitted);
}

export function updateWordObjectPreview(shape,container,{width,height,depth}){
 const properties=(shape.getAttribute('style')??'').split(';').map(s=>s.trim())
  .filter(s=>s&&!/^(?:width|height)\s*:/i.test(s));
 shape.setAttribute('style',[...properties,`width:${width.toFixed(3)}pt`,`height:${height.toFixed(3)}pt`].join(';'));
 container.setAttributeNS(wordNamespace,'w:dxaOrig',String(Math.round(width*20)));
 container.setAttributeNS(wordNamespace,'w:dyaOrig',String(Math.round(height*20)));
 const position=positionNode(container),halfPoints=-Math.round(depth*2);
 if(position)position.setAttributeNS(wordNamespace,'w:val',String(halfPoints));
 else if(halfPoints&&isWord(container.parentNode,'r')&&Array.from(container.parentNode.childNodes).every(node=>node.nodeType!==1||node===container||isWord(node,'rPr'))){
  const run=container.parentNode,doc=run.ownerDocument;
  let properties=child(run,'rPr');
  if(!properties){properties=doc.createElementNS(wordNamespace,'w:rPr');run.insertBefore(properties,run.firstChild);}
  const node=doc.createElementNS(wordNamespace,'w:position');
  node.setAttributeNS(wordNamespace,'w:val',String(halfPoints));
  const later=new Set(['sz','szCs','highlight','u','effect','bdr','shd','fitText','vertAlign','rtl','cs','em','lang','eastAsianLayout','specVanish','oMath','rPrChange']);
  properties.insertBefore(node,Array.from(properties.childNodes).find(child=>child.namespaceURI===wordNamespace&&later.has(child.localName))??null);
 }
}
