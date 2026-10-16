import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createDocx,inspectDocx,editDocx,flatOpc} from './document.mjs';
const [command,...args]=process.argv.slice(2);
const root=new URL('../',import.meta.url);
function serial(objects) {return objects.map(({ole,element,shape,image,partDoc,rels,...o})=>o);}
if(command==='demo') {
  const out=new URL('output/',root);await mkdir(out,{recursive:true});
  const before=await createDocx([{label:'Original native object: x squared',latex:'x^{2}'}]);
  const inspected=await inspectDocx(before), exponent=inspected.objects[0].characters.find(c=>c.char==='2');
  const after=await editDocx(before,0,{[exponent.offset]:'3'});
  await writeFile(new URL('01-original-x2.docx',out),before);await writeFile(new URL('02-edited-x3.docx',out),after);
  const formulas=['x_{i}^{2}+y','\\frac{a+b}{c}','\\sqrt{x_1+2}','\\alpha+\\beta=\\gamma'];
  await writeFile(new URL('03-structured-formulas.docx',out),await createDocx(formulas.map(latex=>({latex,label:latex}))));
  await writeFile(new URL('02-edited-x3.xml',out),await flatOpc(after));
  const result={runtime:process.platform,original:serial(inspected.objects),edited:serial((await inspectDocx(after)).objects),windows_gui_validation:'NOT RUN'};
  await writeFile(new URL('evidence/core-roundtrip.json',root),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
} else if(command==='inspect') {
  console.log(JSON.stringify(serial((await inspectDocx(await readFile(args[0]))).objects),null,2));
} else if(command==='edit-char') {
  const [input,output,index,offset,value]=args;if(input===output)throw Error('Write to a new output file');
  await writeFile(output,await editDocx(await readFile(input),Number(index),{[offset]:value}));
} else throw Error('Usage: demo | inspect FILE | edit-char INPUT OUTPUT INDEX OFFSET CHARACTER');
