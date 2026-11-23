import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DOMParser} from '@xmldom/xmldom';

const html = await readFile(new URL('../desktop/index.html', import.meta.url), 'utf8');
const previews = html.match(/<div class="workbench-previews">(.*?)<\/div><\/section>/s)[1];
const doc = new DOMParser().parseFromString('<panels>' + previews + '</panels>', 'application/xml');

test('Word preview and LaTeX source are named, permanently visible panels', () => {
  for (const id of ['word-preview', 'latex-details']) {
    const panel = doc.getElementById(id);
    assert.equal(panel.tagName, 'section');
    assert.equal(panel.hasAttribute('hidden'), false);
    assert.equal(panel.getElementsByTagName('details').length, 0);
    assert.equal(panel.getElementsByTagName('summary').length, 0);
    const heading = doc.getElementById(panel.getAttribute('aria-labelledby'));
    assert.equal(heading.tagName, 'h2');
    assert.equal(heading.parentNode.getAttribute('class'), 'preview-panel-header');
  }
});

test('Preview controls remain outside any disclosure activation surface', () => {
  const zoom = doc.getElementById('word-preview-zoom');
  assert.equal(zoom.parentNode.getAttribute('class'), 'preview-panel-header');
  assert.deepEqual([...zoom.getElementsByTagName('option')].map(option => option.getAttribute('value')), ['1', '1.5', '2']);
  const latex = doc.getElementById('latex');
  assert.equal(latex.parentNode.getAttribute('id'), 'latex-details');
  assert.equal(latex.hasAttribute('disabled'), false);
  assert.equal(latex.hasAttribute('readonly'), false);
});

test('Actual WebKit keeps the entire zoomed Word preview reachable at a narrow size', {
  skip: process.platform !== 'darwin', timeout: 25000
}, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'equationlab-preview-panels-'));
  t.after(() => rm(directory, {recursive:true, force:true}));
  for (const name of ['style.css', 'native.css']) {
    await cp(new URL('../desktop/' + name, import.meta.url), join(directory, name));
  }
  const figure = html.match(/<figure id="desktop-font-preview".*?<\/figure>/s)[0];
  const fixture = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="style.css"><link rel="stylesheet" href="native.css">
<body class="native-layout"><main style="width:550px;height:415px"><section class="editor-card">
<div class="math-viewport"><math-field>x</math-field></div>
<div class="workbench-previews">${previews}</div></section></main>${figure}
<script>
const panel = document.getElementById('word-preview');
const paper = document.getElementById('desktop-font-preview');
const image = paper.querySelector('img');
const canvas = document.querySelector('.math-viewport');
const zoom = document.getElementById('word-preview-zoom');
panel.append(paper);
paper.hidden = true;
document.getElementById('word-preview-placeholder').hidden = true;
zoom.addEventListener('change', event => document.documentElement.style.setProperty('--word-preview-scale', event.target.value));
const readout = {zooms:[]};
globalThis.ready = (async () => {
  image.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="330"><path d="M0 0H800V330H0z"/></svg>');
  await image.decode();
  paper.hidden = false;
  for (const scale of ['1', '1.5', '2', '1']) {
    zoom.value = scale;
    zoom.dispatchEvent(new Event('change'));
    const bounds = paper.getBoundingClientRect();
    const start = image.getBoundingClientRect();
    paper.scrollLeft = paper.scrollTop = 1e5;
    const end = image.getBoundingClientRect();
    readout.zooms.push({
      width:start.width, height:start.height, startsVisible:start.left >= bounds.left && start.top >= bounds.top,
      endVisible:end.right <= bounds.left + paper.clientWidth + 1 && end.bottom <= bounds.top + paper.clientHeight + 1,
      scrollX:paper.scrollLeft, scrollY:paper.scrollTop
    });
    paper.scrollLeft = paper.scrollTop = 0;
  }
  readout.appearances = {};
  for (const appearance of ['light', 'dark']) {
    document.documentElement.dataset.appearance = appearance;
    readout.appearances[appearance] = {
      paper:getComputedStyle(paper).backgroundColor,
      editSurface:getComputedStyle(canvas).backgroundColor,
      editInk:getComputedStyle(canvas.querySelector('math-field')).color
    };
  }
  readout.previewFocusable = paper.tabIndex === 0 && !!paper.getAttribute('aria-label');
})();
globalThis.readout = () => readout;
</script>`;
  const execute = promisify(execFile);
  const input = join(directory, 'fixture.html'), output = join(directory, 'preview'), binary = join(directory, 'webkit');
  await writeFile(input, fixture);
  await execute('/usr/bin/swiftc', [fileURLToPath(new URL('fixtures/radical-webkit.swift', import.meta.url)), '-o', binary], {timeout:12000});
  await execute(binary, [input, output], {timeout:10000});
  const result = JSON.parse(await readFile(output + '.json', 'utf8'));
  const [normal, larger, largest, restored] = result.zooms;
  assert.equal(normal.scrollX, 0);
  assert.equal(normal.scrollY, 0);
  assert.ok(larger.width > normal.width * 1.35 && larger.height > normal.height * 1.35);
  assert.ok(largest.width > normal.width * 1.8 && largest.height > normal.height * 1.8);
  assert.ok(largest.scrollX > 0 && largest.scrollY > 0);
  assert.ok(result.zooms.every(sample => sample.startsVisible && sample.endVisible));
  assert.deepEqual(restored, normal);
  assert.deepEqual(result.appearances, {
    light:{paper:'rgb(255, 255, 255)', editSurface:'rgb(255, 255, 255)', editInk:'rgb(32, 33, 36)'},
    dark:{paper:'rgb(255, 255, 255)', editSurface:'rgb(36, 36, 37)', editInk:'rgb(243, 243, 244)'}
  });
  assert.equal(result.previewFocusable, true);
});
