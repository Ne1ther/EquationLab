import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const iconSlots = [16, 32, 128, 256, 512].flatMap(points => [1, 2].map(scale => ({points, scale, pixels: points * scale, filename: `icon_${points}x${points}${scale === 2 ? '@2x' : ''}.png`})));
async function safeFile(directory, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw Error('Invalid icon asset path.');
  const file = path.join(directory, relative), canonical = await fs.realpath(file);
  if (!canonical.startsWith(directory + path.sep)) throw Error('Icon asset escapes its prepared directory.');
  if (!(await fs.lstat(file)).isFile()) throw Error('Icon asset must be a regular file.');
  return file;
}
function pngSize(bytes) {
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.subarray(12, 16).toString() !== 'IHDR') throw Error('Invalid optical PNG.');
  return {width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20)};
}

/** v6 is the reviewed candidate default; explicit v5 remains reproducible. */
export async function buildIconAssets({root, resources, temporaryDirectory, assetDirectory}) {
  const brand = path.join(resources, 'brand'); await fs.mkdir(brand, {recursive: true});
  const iconset = path.join(temporaryDirectory, 'EquationLab.iconset'); await fs.mkdir(iconset);
  const requested = assetDirectory && /^v[56]$/.test(assetDirectory) ? path.join(root, 'design/equation-lab-icons', assetDirectory) : assetDirectory ?? path.join(root, 'design/equation-lab-icons/v6');
  const directory = await fs.realpath(requested);
  const manifestBytes = await fs.readFile(await safeFile(directory, 'manifest.json')), manifest = JSON.parse(manifestBytes);
  if (manifest.version === 5 && manifest.app_svg === 'svg/e2-lab-orange-paper.svg') {
    const legacy = directory;
    await fs.copyFile(path.join(legacy, 'svg/e2-lab-orange-paper.svg'), path.join(brand, 'EquationLab.svg'));
    const original = path.join(legacy, 'png/e2-lab-orange-paper-2048.png');
    for (const slot of iconSlots) execFileSync('/usr/bin/sips', ['-z', String(slot.pixels), String(slot.pixels), original, '--out', path.join(iconset, slot.filename)], {stdio: 'pipe'});
    execFileSync('/usr/bin/iconutil', ['--convert', 'icns', '--output', path.join(resources, 'EquationLab.icns'), iconset], {stdio: 'pipe'});
    await fs.copyFile(path.join(iconset, 'icon_512x512@2x.png'), path.join(brand, 'EquationLab-1024.png'));
    return {version: 5, opticalProfiles: false, source: 'explicit-v5-override', selectedByExplicitAssetDirectory: true};
  }
  if (manifest.schema !== 'equationlab.icon-optical-assets.v1') throw Error('Require prepared optical icon assets, not a single large PNG.');
  const entries = new Map(manifest.assets.map(entry => [entry.path, entry]));
  async function checked(relative) {
    const file = await safeFile(directory, relative), bytes = await fs.readFile(file), entry = entries.get(relative);
    if (!entry || hash(bytes) !== entry.sha256) throw Error('Optical icon asset differs from manifest: ' + relative);
    return {file, bytes, entry};
  }
  for (const expected of iconSlots) {
    const supplied = manifest.slots.find(slot => slot.filename === expected.filename);
    if (!supplied || ['points', 'scale', 'pixels'].some(key => supplied[key] !== expected[key])) throw Error('Missing or invalid macOS optical icon slot: ' + expected.filename);
    const asset = await checked(manifest.iconsetDirectory + '/' + expected.filename), dimensions = pngSize(asset.bytes);
    if (dimensions.width !== expected.pixels || dimensions.height !== expected.pixels || asset.entry.profile !== expected.points || asset.entry.scale !== expected.scale) throw Error('The icon slot must use its own logical-size optical profile: ' + expected.filename);
    await fs.copyFile(asset.file, path.join(iconset, expected.filename));
  }
  const svg = await checked(manifest.masterSVG), png = await checked(manifest.brandPNG);
  if (pngSize(png.bytes).width !== 1024 || pngSize(png.bytes).height !== 1024) throw Error('Brand preview must be 1024 pixels.');
  if (/<image|<text|data:image/.test(svg.bytes.toString())) throw Error('The approved brand SVG must remain outlined vector paths.');
  await fs.copyFile(svg.file, path.join(brand, 'EquationLab.svg'));
  await fs.copyFile(png.file, path.join(brand, 'EquationLab-1024.png'));
  execFileSync('/usr/bin/iconutil', ['--convert', 'icns', '--output', path.join(resources, 'EquationLab.icns'), iconset], {stdio: 'pipe'});
  const expectedIcns = await checked(manifest.icns), actualIcns = await fs.readFile(path.join(resources, 'EquationLab.icns'));
  if (hash(expectedIcns.bytes) !== hash(actualIcns)) throw Error('Rebuilt ICNS differs from the prepared optical export.');
  return {version: manifest.version, status: manifest.status, opticalProfiles: true, selectedByExplicitAssetDirectory: !!assetDirectory, manifestSha256: hash(manifestBytes), icnsSha256: hash(actualIcns), preservedPaths: manifest.preservedPaths, slots: iconSlots};
}
