import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {buildMathLiveEditor} from '../packaging/mathlive-editor.mjs';

const execute=promisify(execFile),root=resolve(new URL('..',import.meta.url).pathname);
test('Actual WebKit Mathfield CSS keeps stacked radicals one glyph wide and joins every rule on its painted baseline',{skip:process.platform!=='darwin',timeout:45000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'equationlab-radical-webkit-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 await cp(join(root,'node_modules/mathlive/fonts'),join(directory,'fonts'),{recursive:true});
 await buildMathLiveEditor({root,mathliveDirectory:join(root,'node_modules/mathlive'),output:join(directory,'editor.js')});
 const samples=[['ordinary','\\sqrt{x+y+z}'],['tall','\\left\\|\\mathbf{x}\\right\\|_2=\\sqrt{\\sum_{i=1}^{n}x_i^2}'],['nth','\\sqrt[3]{\\frac{x+1}{y^2}}'],['nested','\\sqrt{\\sqrt{x+y}}'],['subscript','x_{\\sqrt{y+z}}'],['superscript','x^{\\sqrt{y+z}}'],['empty','\\sqrt[\\placeholder{}]{\\placeholder{}}']];
 // With no NSWindow, WebKit pauses animation frames. The test-only timer
 // fallback schedules the actual MathLive renderer; it changes no layout.
 const html=`<!doctype html><meta charset="utf-8"><style>body{margin:14px;background:white}section{height:148px}math-field{width:95%;font-size:40px;border:0}</style><script>window.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),16);window.cancelAnimationFrame=clearTimeout;</script><script src="editor.js"></script><script>MathfieldElement.fontsDirectory='fonts';MathfieldElement.soundsDirectory=null;</script>${samples.map(([id])=>`<section><math-field id="${id}"></math-field></section>`).join('')}<script>const samples=${JSON.stringify(samples)};for(const[id,latex]of samples){const field=document.getElementById(id);field.mathVirtualKeyboardPolicy='manual';field.value=latex;}globalThis.ready=Promise.all([document.fonts.ready,new Promise(r=>setTimeout(r,1200))]);const rect=node=>{const r=node.getBoundingClientRect();return{top:r.top,left:r.left,width:r.width,height:r.height,fontSize:parseFloat(getComputedStyle(node).fontSize),size:node.getAttribute('data-radical-size')}};globalThis.readout=()=>samples.map(([id,latex])=>{const field=document.getElementById(id);return{id,latex,editor:field.value,stems:[...field.shadowRoot.querySelectorAll('[data-equation-radical]')].map(rect),rules:[...field.shadowRoot.querySelectorAll('[data-equation-radical-rule]')].map(rect)}});</script>`;
 await writeFile(join(directory,'fixture.html'),html);
 const binary=join(directory,'webkit');await execute('/usr/bin/swiftc',[join(root,'tests/fixtures/radical-webkit.swift'),'-o',binary],{timeout:25000});
 await execute(binary,[join(directory,'fixture.html'),join(directory,'rendered')],{timeout:30000});
 const results=JSON.parse(await readFile(join(directory,'rendered.json'),'utf8'));
 for(const {id,latex,editor,stems,rules}of results){
  assert.equal(editor,latex,id);assert.equal(stems.length,(latex.match(/\\sqrt/g)||[]).length,id);assert.equal(rules.length,stems.length,id);
  for(const stem of stems){
   assert.ok(stem.width/stem.fontSize<=1.1,`${id}: a stacked radical must not sum the widths of vertical font pieces`);
   const rule=rules.find(rule=>Math.abs(rule.left-stem.left-stem.width)<.1);assert.ok(rule,`${id}: radical must meet its adaptive rule at the same x coordinate`);
   assert.ok(Math.abs(rule.top-stem.top)<=.1,`${id}: painted rule has a visible step (${rule.top-stem.top}px)`);
   assert.ok(rule.height>1&&rule.height<2,`${id}: unexpected painted rule thickness ${rule.height}px`);
  }
 }
 const tall=results.find(row=>row.id==='tall').stems[0];assert.equal(tall.size,'tall');assert.ok(Math.abs(tall.width/tall.fontSize-1.05556)<.002);assert.ok(tall.height/tall.width>3);
 assert.ok(results.find(row=>row.id==='ordinary').rules[0].width>120,'the adaptive rule must cover all terms and inserted operator spacing');
});
