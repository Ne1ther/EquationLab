import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import sharp from 'sharp';
import {DOMParser} from '@xmldom/xmldom';
import {buildIconAssets} from '../packaging/icon-assets.mjs';
import {normalizeIconCanvas} from '../packaging/normalize-icon-assets.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const directory = path.join(root, 'design/equation-lab-icons/v6');
const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('macOS icon profiles preserve the approved outlines with one idempotent canvas transform', async () => {
  for (const asset of manifest.assets.filter(asset => asset.path.startsWith('svg/'))) {
    const source = await fs.readFile(path.join(directory, asset.path), 'utf8');
    assert.equal(normalizeIconCanvas(source), source, asset.path);
    const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
    assert.ok(doc.getElementById('macos-icon-canvas'));
    for (const [id, expected] of Object.entries(manifest.preservedPaths)) {
      const node = doc.getElementById(id), outline = node.tagName === 'path' ? node : node.getElementsByTagName('path')[0];
      assert.equal(hash(outline.getAttribute('d')), expected, asset.path + ':' + id);
    }
  }
});

test('all ten macOS icon slots retain centered transparent padding at their native resolution', async () => {
  assert.equal(manifest.slots.length, 10);
  for (const slot of manifest.slots) {
    const {data, info} = await sharp(path.join(directory, manifest.iconsetDirectory, slot.filename)).ensureAlpha().raw().toBuffer({resolveWithObject: true});
    assert.equal(info.width, slot.pixels); assert.equal(info.height, slot.pixels);
    let left = info.width, top = info.height, right = -1, bottom = -1;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      const alpha = data[(y * info.width + x) * 4 + 3];
      if (x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1) assert.ok(alpha <= 1, slot.filename + ' shadow has no visible canvas-edge clipping');
      if (alpha >= 128) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
    }
    const width = (right - left + 1) / info.width, height = (bottom - top + 1) / info.height;
    assert.ok(width >= .78 && width <= .84 && height >= .78 && height <= .84, slot.filename + ' visible tile fits the macOS peer size');
    assert.ok(Math.abs(left - (info.width - right - 1)) <= 1 && Math.abs(top - (info.height - bottom - 1)) <= 1, slot.filename + ' tile stays centered');
  }
});

test('shipping icon manifest and native ICNS reconstruction agree', {skip: process.platform !== 'darwin'}, async t => {
  const temporaryDirectory = await fs.mkdtemp(path.join(tmpdir(), 'equationlab-icon-padding-test-'));
  t.after(() => fs.rm(temporaryDirectory, {recursive: true, force: true}));
  for (const asset of manifest.assets) assert.equal(hash(await fs.readFile(path.join(directory, asset.path))), asset.sha256, asset.path);
  const resources = path.join(temporaryDirectory, 'Resources');
  const packaged = await buildIconAssets({root, resources, temporaryDirectory});
  assert.equal(packaged.slots.length, 10);
  assert.equal(packaged.icnsSha256, hash(await fs.readFile(path.join(directory, manifest.icns))));
  const roundtrip = path.join(temporaryDirectory, 'roundtrip.iconset');
  execFileSync('/usr/bin/iconutil', ['--convert', 'iconset', '--output', roundtrip, path.join(resources, 'EquationLab.icns')], {stdio: 'pipe'});
  for (const slot of manifest.slots) {
    const original = await sharp(path.join(directory, manifest.iconsetDirectory, slot.filename)).ensureAlpha().raw().toBuffer();
    const decoded = await sharp(path.join(roundtrip, slot.filename)).ensureAlpha().raw().toBuffer();
    assert.equal(original.length, decoded.length, slot.filename);
    for (let pixel = 3; pixel < original.length; pixel += 4) assert.equal(decoded[pixel], original[pixel], slot.filename + ' native ICNS preserves alpha geometry');
  }
});
