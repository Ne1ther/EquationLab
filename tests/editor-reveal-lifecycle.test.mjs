import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {buildMathLiveEditor} from '../packaging/mathlive-editor.mjs';

const source=await readFile(new URL('../macos/Views/EquationCanvas.swift',import.meta.url),'utf8');

test('The retained WKWebView observes window reveal and application activation',()=>{
 assert.match(source,/override func viewDidMoveToWindow\(\)/);
  assert.match(source,/NSWindow\.didChangeOcclusionStateNotification/);
 assert.match(source,/NSWindow\.didBecomeKeyNotification/);
 assert.match(source,/NSApplication\.didBecomeActiveNotification/);
 assert.match(source,/NotificationCenter\.default\.removeObserver\(self\)/);
 assert.match(source,/windowWasRevealed\(_ notification: Notification\).*refreshAfterReveal\(\)/s);
 assert.match(source,/applicationBecameActive\(_ notification: Notification\).*refreshAfterReveal\(\)/s);
});

test('Reveal recovery invalidates layout and drawing without replacing editor state',()=>{
 const start=source.indexOf('func refreshAfterReveal() {');
 const end=source.indexOf('@objc private func windowWasRevealed',start);
 assert.ok(start>=0&&end>start,'the public reveal hook is present');
 const hook=source.slice(start,end);
 assert.match(hook,/needsLayout\s*=\s*true/);
 assert.match(hook,/layoutSubtreeIfNeeded\(\)/);
 assert.match(hook,/setNeedsDisplay\(self\.bounds\)/);
 assert.match(hook,/layer\?\.setNeedsDisplay\(\)/);
 assert.match(hook,/window\.dispatchEvent\(new Event\('resize'\)\)/);
 assert.match(hook,/window\.nativeRefreshEditorSurface/);
 assert.doesNotMatch(hook,/\.focus\(|\.value\s*=|loadHTMLString|loadFileURL|select\(/);
});

test('Real MathLive paints a missed background frame on reveal without taking focus', {
 skip:process.platform!=='darwin', timeout:25000
}, async t=>{
 const root=fileURLToPath(new URL('..',import.meta.url)),directory=await mkdtemp(join(tmpdir(),'equationlab-reveal-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const mathliveDirectory=join(root,'node_modules','mathlive');
 await cp(join(mathliveDirectory,'fonts'),join(directory,'fonts'),{recursive:true});
 await buildMathLiveEditor({root,mathliveDirectory,output:join(directory,'mathlive.js')});
 await cp(join(root,'desktop','editor-viewport.js'),join(directory,'editor-viewport.js'));
 const input=join(directory,'fixture.html'),output=join(directory,'painted'),binary=join(directory,'webkit');
 await writeFile(input,String.raw`<!doctype html><meta charset="utf-8">
<style>.math-wrap{height:75px}math-field{font-size:var(--formula-size,29px);padding:8px 0}</style>
<script>
let suppressFrames=false, suppressed=0;
window.requestAnimationFrame=callback=>{
 if(suppressFrames){suppressed++;return -suppressed;}
 return setTimeout(()=>callback(performance.now()),16);
};
window.cancelAnimationFrame=clearTimeout;
</script>
<script src="mathlive.js"></script><script>MathfieldElement.fontsDirectory='fonts';MathfieldElement.soundsDirectory=null;</script>
<div class="math-viewport"><div class="math-wrap"><math-field id="formula"></math-field></div>
<span class="editor-empty-hint" hidden></span><div class="equation-scrollbar" hidden><div></div></div></div>
<script src="editor-viewport.js"></script>
<script>
const field=document.getElementById('formula'),hint=document.querySelector('.editor-empty-hint');
const viewport=createEquationViewport(field,{getZoom:()=>0,onScaleChange:()=>{}});
const hasRoot=()=>!!field.shadowRoot.querySelector('[data-equation-radical]');
const result={},settle=()=>new Promise(resolve=>setTimeout(resolve,100));
globalThis.ready=(async()=>{
 await document.fonts.ready;
 await settle();
 viewport.refresh();
 await settle();
 result.emptyInitially=!hint.hidden && field.value==='';
 suppressFrames=true;
 field.value='\\sqrt{\\sum_{i=1}^{n}{x_i^3}}';
 field.selection={ranges:[[1,2]]};
 viewport.refresh();
 const selection=JSON.stringify(field.selection),value=field.value;
 result.missedPaint=field._mathfield.dirty && !hasRoot() && suppressed>=2;
 suppressFrames=false;
 window.editorIsComposing=()=>true;
 viewport.reveal();
 result.compositionKept=!hasRoot() && field._mathfield.dirty;
 window.editorIsComposing=()=>false;
 viewport.reveal();
 result.fitBeforeFrame=viewport.effectiveZoom<100;
 await settle();
 result.painted=hasRoot() && !field._mathfield.dirty && hint.hidden;
 result.preserved=value===field.value && selection===JSON.stringify(field.selection) && document.activeElement!==field;
})();
globalThis.readout=()=>result;
</script>`);
 const execute=promisify(execFile);
 await execute('/usr/bin/swiftc',[join(root,'tests','fixtures','radical-webkit.swift'),'-o',binary],{timeout:12000});
 await execute(binary,[input,output],{timeout:10000});
 assert.deepEqual(JSON.parse(await readFile(output+'.json','utf8')),{
  emptyInitially:true,missedPaint:true,compositionKept:true,fitBeforeFrame:true,painted:true,preserved:true
 });
});
