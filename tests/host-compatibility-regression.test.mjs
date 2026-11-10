import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectDocx} from '../src/document.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;

test('published demo identity, numbering and reference targets match frozen expectations', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'tests/fixtures/compatibility/public-demo.json'), 'utf8'));
  assert.equal(manifest.schema, 'equationlab.public-demo-regression.v1');
  assert.equal(manifest.provenance.kind, 'project-generated-public-demo');
  assert.equal(manifest.document, 'docs/examples/equation-lab-30-formulas.docx');
  assert.equal(manifest.count, 30);
  const bytes = await readFile(resolve(root, manifest.document));
  assert.equal(digest(bytes), manifest.sha256, 'review sample changes before updating the frozen identity');
  const {objects} = await inspectDocx(bytes);
  assert.equal(objects.length, manifest.count);
  for (const [index, object] of objects.entries()) {
    const n = index + 1;
    assert.equal(object.layout.bookmarkName, `EL_DEMO_${String(n).padStart(2, '0')}`);
    assert.equal(object.layout.numberText, `(${Math.floor(index / 10) + 1}.${index % 10 + 1})`);
    assert.equal(object.layout.referenceCount, manifest.referenceTargets.includes(n) ? 1 : 0);
  }
});

const privateManifest = process.env.EQUATIONLAB_HOST_CORPUS_MANIFEST;
test('opt-in host corpus matches declared file identities and frozen objects', {
  skip: privateManifest ? false : 'No private host corpus configured; real host compatibility is not covered by CI.'
}, async () => {
  const path = resolve(privateManifest);
  const corpus = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(corpus.schema, 'equationlab.private-host-corpus.v1');
  assert.ok(Array.isArray(corpus.cases) && corpus.cases.length > 0, 'host corpus must contain cases');
  const ids = new Set();
  for (const c of corpus.cases) {
    assert.ok(nonempty(c.id) && !ids.has(c.id), 'each case needs a unique id'); ids.add(c.id);
    assert.ok(nonempty(c.host) && nonempty(c.captureDate) && nonempty(c.operation) && nonempty(c.sourceDescription), `${c.id}: provenance required`);
    assert.match(c.captureDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(nonempty(c.document) && sha(c.documentSha256) && nonempty(c.receipt) && sha(c.receiptSha256), `${c.id}: document and receipt identities required`);
    assert.ok(Array.isArray(c.objects) && c.objects.length > 0, `${c.id}: frozen ordered object expectations required`);
    const bytes = await readFile(resolve(dirname(path), c.document));
    const receipt = await readFile(resolve(dirname(path), c.receipt));
    assert.equal(digest(bytes), c.documentSha256, `${c.id}: document changed`);
    assert.equal(digest(receipt), c.receiptSha256, `${c.id}: receipt changed`);
    const {objects} = await inspectDocx(bytes);
    assert.equal(objects.length, c.objects.length, `${c.id}: object count`);
    for (const [index, expected] of c.objects.entries()) {
      assert.ok(sha(expected.nativeSha256), `${c.id}/${index}: expected native hash required`);
      assert.ok(typeof expected.bookmarkName === 'string' || expected.bookmarkName === null);
      assert.ok(typeof expected.numberText === 'string' || expected.numberText === null);
      const actual = objects[index];
      assert.equal(actual.nativeSha256, expected.nativeSha256, `${c.id}/${index}: native`);
      assert.equal(actual.layout?.bookmarkName ?? null, expected.bookmarkName, `${c.id}/${index}: bookmark`);
      assert.equal(actual.layout?.numberText ?? null, expected.numberText, `${c.id}/${index}: number`);
    }
  }
});
