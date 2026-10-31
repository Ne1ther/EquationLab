import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {DOMParser, XMLSerializer} from '@xmldom/xmldom';
import sharp from 'sharp';

const namespace = 'http://www.w3.org/2000/svg';
const canvasPixels = 1024, previousTilePixels = 892, tilePixels = 824;
const scale = tilePixels / previousTilePixels;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const parse = svg => new DOMParser().parseFromString(svg, 'image/svg+xml');

// Keep each reviewed optical profile and its exact paths; shrink the complete
// drawing, including its shadow, around the canvas centre. Re-running is safe.
export function normalizeIconCanvas(source) {
  const doc = parse(source), svg = doc.documentElement;
  assert.equal(svg.getAttribute('viewBox'), '0 0 1024 1024');
  let group = doc.getElementById('macos-icon-canvas');
  if (!group) {
    group = doc.createElementNS(namespace, 'g');
    group.setAttribute('id', 'macos-icon-canvas');
    const drawing = [...svg.childNodes].filter(node => node.nodeType === 1 && !['defs', 'title', 'desc'].includes(node.localName));
    for (const node of drawing) group.appendChild(node);
    svg.appendChild(group);
  }
  group.setAttribute('transform', `translate(512 512) scale(${scale}) translate(-512 -512)`);
  return new XMLSerializer().serializeToString(doc);
}

function verifyOutlines(svg, expected) {
  const doc = parse(svg);
  for (const [id, digest] of Object.entries(expected)) {
    const node = doc.getElementById(id);
    const outline = node.tagName === 'path' ? node : node.getElementsByTagName('path')[0];
    assert.equal(hash(outline.getAttribute('d')), digest, 'Approved outline changed: ' + id);
  }
}

async function raster(svg, pixels) {
  const doc = parse(svg);
  doc.documentElement.setAttribute('width', String(pixels));
  doc.documentElement.setAttribute('height', String(pixels));
  return sharp(Buffer.from(new XMLSerializer().serializeToString(doc))).png({compressionLevel: 9}).toBuffer();
}

export async function normalizeIconAssets(directory) {
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.schema, 'equationlab.icon-optical-assets.v1');
  const normalized = new Map();
  for (const asset of manifest.assets.filter(asset => asset.path.startsWith('svg/'))) {
    const svg = normalizeIconCanvas(await fs.readFile(path.join(directory, asset.path), 'utf8'));
    verifyOutlines(svg, manifest.preservedPaths);
    normalized.set(asset.path, {svg, profile: asset.profile, pixels: asset.pixels});
  }
  const assets = [];
  async function save(relative, bytes, metadata = {}) {
    await fs.writeFile(path.join(directory, relative), bytes);
    assets.push({path: relative, sha256: hash(bytes), ...metadata});
  }
  for (const [relative, {svg, profile, pixels}] of normalized) {
    await save(relative, svg, profile === undefined ? {} : {profile, pixels});
  }
  await save(manifest.brandPNG, await raster(normalized.get(manifest.masterSVG).svg, canvasPixels), {profile: canvasPixels, pixels: canvasPixels});
  for (const slot of manifest.slots) {
    const svg = normalized.get(`svg/optical/e2-lab-cream-optical-${slot.points}.svg`).svg;
    await save(manifest.iconsetDirectory + '/' + slot.filename, await raster(svg, slot.pixels), {profile: slot.points, pixels: slot.pixels, scale: slot.scale});
  }
  execFileSync('/usr/bin/iconutil', ['--convert', 'icns', '--output', path.join(directory, manifest.icns), path.join(directory, manifest.iconsetDirectory)], {stdio: 'pipe'});
  assets.push({path: manifest.icns, sha256: hash(await fs.readFile(path.join(directory, manifest.icns)))});
  // The public manifest describes the shipping resources. Historical comparison
  // sheets and local PNG experiments are not inputs to the packaged icon.
  manifest.assets = assets;
  manifest.canvasNormalization = {canvasPixels, previousTilePixels, tilePixels, scale, center: [512, 512], outlinePathsPreserved: true};
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return {assets: assets.length, slots: manifest.slots.length, ...manifest.canvasNormalization};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../design/equation-lab-icons/v6');
  console.log(JSON.stringify(await normalizeIconAssets(directory)));
}
