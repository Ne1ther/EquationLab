import {previewNumberFormat} from './layout.mjs';

// A numbering change belongs to the same immutable document/formula target as
// the native save. Zero expected counters mean that no context marker existed.
export function checkedWordNumbering(value,{supported,contextSupported,existingSupported,target}={}){
 if(value===undefined)return null;
 if(!supported||!target||!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['format','side','context','existingRevision'].includes(key))||!['left','right'].includes(value.side)||typeof value.format!=='string')throw Error('Invalid Word numbering request');
 previewNumberFormat(value.format,{chapter:1,section:1,equation:1});
 const result={format:value.format,side:value.side};
 if(value.existingRevision!==undefined){
  if(!existingSupported||value.context!==undefined||!Number.isSafeInteger(value.existingRevision)||value.existingRevision<0||value.existingRevision>2147483646)throw Error('Invalid existing Word numbering revision');
  result.existingRevision=value.existingRevision;
 }
 if(value.context!==undefined){
  const context=value.context,keys=['chapter','section','expectedChapter','expectedSection'];
  if(!contextSupported||!context||typeof context!=='object'||Array.isArray(context)||Object.keys(context).length!==4||Object.keys(context).some(key=>!keys.includes(key)))throw Error('Word chapter/section changes require the updated plugin');
  for(const key of keys)if(!Number.isSafeInteger(context[key])||context[key]<(key.startsWith('expected')?0:1)||context[key]>32767)throw Error('Invalid Word chapter/section counter');
  result.context=Object.fromEntries(keys.map(key=>[key,context[key]]));
 }
 return result;
}

// A selection snapshot stages its owner at index 0, but a write still uses
// that equation's real ordinal in Word. Never derive authority from index 0.
export function checkExistingWordNumberingTarget(numbering,document,target){
 if(numbering?.existingRevision===undefined)return;
 if(document?.snapshot==null||!document.identity||target?.documentIdentity!==document.identity||target.index!==(document.position??document.index)||numbering.existingRevision!==document.numberingRevision)throw Error('Existing Word numbering target or revision changed');
}
