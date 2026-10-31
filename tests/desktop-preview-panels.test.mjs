import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
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
