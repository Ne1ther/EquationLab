import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {characters, inspectOle, makeEmbellishmentOle, makeOle, makeTemplateOle, oleLatex, replaceOleLatex, wrapNative} from '../src/native.mjs';
import {makeNewOle} from '../src/new-formula.mjs';
import {editFormulaOle, patchTypography, readTypography} from '../src/typography-native.mjs';
import {createDocx, editDocxBatch, inspectDocx} from '../src/document.mjs';
import {applyTypography, preflightTypography} from '../src/document-typography.mjs';
import {desktopRequest} from '../src/desktop-rpc.mjs';
import {renderNative} from '../src/font-renderer.mjs';
import {localLegacyOptions} from './helpers/local-legacy-evidence.mjs';

const tex = String.raw;
const reported = tex`\left.\frac{\partial \dot{N}}{\partial N}\right|_{N=N^*} = -\beta\left[\frac{\phi}{\eta(D)} - \frac{\rho}{\alpha}\right] N^* < 0`;

function flatten(nodes) {
  return nodes.flatMap(node => [node, ...flatten(node.children ?? [])]);
}

function mainTemplate(ole, selector) {
  return flatten(inspectOle(ole).parsed.records).find(node => node.type === 3 && node.selector === selector);
}

function decorations(template) {
  return template.children.filter(node => node.type === 2).map(({typeface, code}) => [typeface, code]);
}

const cases = tex`\frac{\mathrm{d}N^*}{\mathrm{d}D}=\begin{cases}[\phi \eta'(D)] & N^*<\bar{N}\\0 & N^*>\bar{N}\end{cases}`;

test('Fixed-size brackets in cases use the Symbol slot and no optional font', async () => {
  for (const latex of [cases, cases.replace('[', tex`\lbrack `).replace(']', tex`\rbrack `)]) {
    const ole = makeNewOle(latex), {data, parsed} = inspectOle(ole);
    assert.deepEqual(parsed.records.filter(n => n.type === 17).map(n => n.name), ['Times New Roman', 'Symbol', 'Courier New', 'MT Extra']);
    for (const code of [0x5b, 0x5d]) {
      const bracket = characters(parsed).find(n => n.code === code);
      assert.equal(bracket.typeface, 6);
      assert.equal(bracket.encoding, 'Symbol');
      assert.deepEqual([...data.subarray(bracket.offset - 3, bracket.offset + 3)], [2, 4, 134, code, 0, code]);
    }
    assert.deepEqual((await renderNative(ole, {raster: false})).warnings, []);
  }
});

test('An unknown-origin STIX bracket binding survives structural edits even with the old record layout', () => {
  const current = makeNewOle(cases + tex`+\epsilon`);
  const {data, header, parsed} = inspectOle(current), original = Buffer.from(data);
  const fonts = parsed.records.filter(n => n.type === 17), cambria = fonts.at(-1);
  const style = parsed.records.find(n => n.type === 8 && n.font === fonts.length);
  original[style.start + 1]++;
  const epsilon = flatten(parsed.records).find(n => n.type === 2 && n.code === 0x3f5);
  original[epsilon.start + 2]--;
  const stix = Buffer.concat([Buffer.from([17, 5]), Buffer.from('STIX Two Math\0'), Buffer.from([8, fonts.length, 0])]);
  const parts = [original.subarray(0, cambria.start), stix];
  let offset = cambria.start;
  for (const bracket of flatten(parsed.records).filter(n => n.type === 2 && [0x5b, 0x5d].includes(n.code))) {
    parts.push(original.subarray(offset, bracket.start), Buffer.from([2, 0, 126, bracket.code, 0]));
    offset = bracket.end;
  }
  const oldData = Buffer.concat([...parts, original.subarray(offset)]), oldHeader = Buffer.from(header);
  oldHeader.writeUInt32LE(oldData.length, 8);
  const old = wrapNative(Buffer.concat([oldHeader, oldData]), current), canonical = oleLatex(old), before = Buffer.from(old);
  assert.deepEqual(replaceOleLatex(old, canonical), before);
  const updated = replaceOleLatex(old, canonical + '+1'), revised = inspectOle(updated).parsed;
  assert.deepEqual(revised.records.filter(n => n.type === 17).map(n => n.name), [...fonts.slice(0, -1).map(n => n.name), 'STIX Two Math', 'Cambria Math']);
  assert.deepEqual(revised.records.filter(n => n.type === 8).map(n => n.font), [1, fonts.length, fonts.length + 1]);
  assert.equal(oleLatex(updated), canonical + '+1');
  assert.deepEqual(old, before);
});

test('Verified legacy Equation Lab outputs remove their automatic STIX bracket font on edit', localLegacyOptions, async () => {
  const doc = new URL('../.local/xhs-bugfix/QA-XHS-OLE.docx', import.meta.url);
  const {objects} = await inspectDocx(await readFile(doc));
  for (const index of [1, 2]) {
    const {ole} = objects[index], original = Buffer.from(ole), source = inspectOle(ole);
    assert.equal(source.parsed.legacyAutomaticStix, true);
    const latex = oleLatex(ole);
    assert.doesNotMatch(latex, /\\mtstix/);
    assert.deepEqual(replaceOleLatex(ole, latex), original);
    const edited = editFormulaOle(ole, {latex: latex + '+1', typography: {styles: {3: {style: 3}}}});
    const parsed = inspectOle(edited).parsed;
    assert.equal(parsed.records.some(node => node.type === 17 && node.name === 'STIX Two Math'), false);
    assert.ok(characters(parsed).filter(node => node.code === 0x5b || node.code === 0x5d).every(node => node.typeface === 6));
    assert.deepEqual(ole, original);
  }
});

function fontFor(parsed, character) {
  const records = flatten(parsed.records), styles = records.filter(node => node.type === 8), fonts = records.filter(node => node.type === 17);
  return fonts[styles[-character.typeface - 1]?.font - 1]?.name;
}

test('Explicit external STIX ell survives app edits and remains distinct from another ell in Cambria', () => {
  for (const mixed of [false, true]) {
    const ole = makeNewOle(mixed ? tex`x+\ell+\ell` : tex`x+\ell`), {data, header, parsed} = inspectOle(ole);
    const source = Buffer.from(data), cambria = parsed.records.find(node => node.type === 17 && node.name === 'Cambria Math');
    const enc = Buffer.from([17, cambria.encoding]), font = Buffer.concat([enc, Buffer.from('STIX Two Math\0')]);
    let edited;
    if (mixed) {
      const style = parsed.records.find(node => node.type === 8), owner = characters(parsed).find(node => node.code === 0x2113);
      source[owner.offset - 1]--;
      edited = Buffer.concat([source.subarray(0, style.end), font, Buffer.from([8, 6, 0]), source.subarray(style.end)]);
    } else edited = Buffer.concat([source.subarray(0, cambria.start), font, source.subarray(cambria.end)]);
    const h = Buffer.from(header); h.writeUInt32LE(edited.length, 8);
    const original = wrapNative(Buffer.concat([h, edited]), ole), latex = oleLatex(original);
    assert.equal((latex.match(/\\mtstix/g) ?? []).length, 1);
    const spellings = mixed ? [latex] : [latex, tex`x+\ell`];
    for (const spelling of spellings) {
      const rebuilt = editFormulaOle(original, {latex: spelling + '+1', typography: symbolFont('Cambria Math')});
      const {parsed: revised} = inspectOle(rebuilt);
      assert.deepEqual(characters(revised).filter(node => node.code === 0x2113).map(node => fontFor(revised, node)), mixed ? ['STIX Two Math', 'Cambria Math'] : ['STIX Two Math']);
      assert.ok(oleLatex(rebuilt).endsWith('+1'));
    }
  }
});

test('Extended glyphs persist Windows font definitions and use bundled outlines for Mac preview', async () => {
  const ole = makeNewOle(tex`\epsilon+\ell+\checkmark+\backprime+\oint x`);
  const names = inspectOle(ole).parsed.records.filter(n => n.type === 17).map(n => n.name);
  assert.deepEqual(names.slice(4), ['Cambria Math', 'Segoe UI Symbol']);
  const preview = await renderNative(ole, {raster: false});
  assert.ok(preview.faces.some(face => face.font === 'STIX Two Math'));
  assert.deepEqual(preview.warnings, []);
});

test('The reported equation exports both superscript asterisks with the original Symbol encoding', () => {
  const ole = makeNewOle(reported);
  const {data, parsed} = inspectOle(ole);
  const chars = characters(parsed);
  const stars = chars.filter(char => [0x002a, 0x2217].includes(char.code));
  assert.equal(stars.length, 2);
  for (const {offset, encoding} of stars) {
    assert.equal(encoding, 'Symbol');
    // The original 7.8 keyboard resource binds MTCode U+2217 to Symbol
    // position 0x2A. The MTEF CHAR then includes the ANSI position (flag 4).
    assert.equal(data.subarray(offset - 3, offset + 3).toString('hex'), '02048617222a');
  }
  const superscripts = flatten(parsed.records).filter(node => node.type === 3 && node.selector === 28);
  assert.equal(superscripts.length, 2);
  assert.ok(superscripts.every(script => script.children.filter(node => node.type === 1)[1].children[0].code === 0x2217));
});

test('The reported evaluation bar uses the right-only tmBAR variation and original expanding glyph', () => {
  const ole = makeNewOle(reported);
  const {parsed} = inspectOle(ole);
  const line = parsed.records.find(node => node.type === 1).children;
  const barIndex = line.findIndex(node => node.type === 3 && node.selector === 4);
  assert.equal(barIndex, 0);
  const bar = line[barIndex];
  assert.equal(bar.variation, 2);
  assert.deepEqual(decorations(bar), [[22, 0xec08]]);
  assert.equal(bar.children.filter(node => node.type === 1).length, 1);
  assert.equal(bar.children.find(node => node.type === 1).children[0].selector, 11);
  assert.equal(line[barIndex + 1].selector, 27);
  assert.match(oleLatex(ole), /^\\left\.\\frac.*\\right\|_\{N=N\^\{\\ast \}\}/);
});

test('Asterisk aliases share the same math CHAR while text and custom fonts retain their own encoding', () => {
  const ole = makeNewOle(tex`*\ast ∗\star \text{*}`);
  const chars = characters(inspectOle(ole).parsed);
  assert.deepEqual(chars.map(({code, typeface, fontPosition}) => [code, typeface > 0 ? typeface : 'local', fontPosition]), [
    [0x2217, 6, 0x2a], [0x2217, 6, 0x2a], [0x2217, 6, 0x2a], [0x22c6, 'local', undefined], [0x002a, 1, undefined],
  ]);
  const customized = makeNewOle('*', {styles: {6: {font: 'Cambria Math'}}});
  const [custom] = characters(inspectOle(customized).parsed);
  assert.equal(custom.code, 0x2217);
  assert.equal(custom.fontPosition, undefined);
  assert.equal(custom.encoding, 'WinAllBasicCodePages');

  const accented = makeEmbellishmentOle(2, '*');
  const [embellished] = flatten(inspectOle(accented).parsed.records).filter(node => node.type === 2);
  assert.equal(embellished.code, 0x2217);
  assert.equal(embellished.fontPosition, 0x2a);
  assert.equal(embellished.children[0].embellishment, 2);
});

test('Paired, single-sided, and matrix bar fences use the original template decorations', () => {
  for (const [latex, token, selector, variation, codes] of [
    [tex`\left|x\right.`, 'TMPL-bar/l', 4, 1, [0xec07]],
    [tex`\left.x\right|`, 'TMPL-bar/r', 4, 2, [0xec08]],
    [tex`\left|x\right|`, 'TMPL-bar', 4, 3, [0xec07, 0xec08]],
    [tex`\begin{vmatrix}x\end{vmatrix}`, 'TMPL-bar', 4, 3, [0xec07, 0xec08]],
    [tex`\left\|x\right.`, 'TMPL-dbar/l', 5, 1, [0xec09]],
    [tex`\left.x\right\|`, 'TMPL-dbar/r', 5, 2, [0xec0a]],
    [tex`\begin{Vmatrix}x\end{Vmatrix}`, 'TMPL-dbar', 5, 3, [0xec09, 0xec0a]],
    [tex`\left.x\right\rangle`, 'TMPL-abrack/r', 0, 2, [0x232a]],
    [tex`\left\lfloor x\right\rfloor`, 'TMPL-floor', 6, 3, [0xf8f0, 0xf8fb]],
    [tex`\left\lceil x\right\rceil`, 'TMPL-ceil', 7, 3, [0xf8ee, 0xf8f9]],
    [tex`\left\lBrack x\right\rBrack`, 'TMPL-obrack', 8, 3, [0x301a, 0x301b]],
    [tex`\left(x\right.`, 'TMPL-paren/l', 1, 1, [0x0028]],
    [tex`\left\{x\right.`, 'TMPL-brace/l', 2, 1, [0x007b]],
    [tex`\left.x\right]`, 'TMPL-brack/r', 3, 2, [0x005d]],
    [tex`\left(x\right]`, 'TMPL-intval/lprb', 9, 0x30, [0x0028, 0x005d]],
  ]) {
    const generated = mainTemplate(makeNewOle(latex), selector);
    const originalDefinition = mainTemplate(makeTemplateOle(token, ['x']), selector);
    const expected = codes.map(code => [22, code]);
    assert.equal(generated.variation, variation, latex);
    assert.deepEqual(decorations(generated), expected, latex);
    assert.deepEqual(decorations(originalDefinition), expected, token);
  }
});

test('Prime, Greek variants and bar accents keep separate MTCode or embellishment records', () => {
  const ole = makeNewOle(tex`\prime x'\phi\varphi\epsilon\varepsilon\bar{N}\bar{NM}`);
  const records = flatten(inspectOle(ole).parsed.records);
  const chars = records.filter(node => node.type === 2);
  assert.equal(chars[0].code, 0x2032);
  assert.equal(chars[0].fontPosition, 0xa2);
  assert.equal(chars[1].children[0].embellishment, 5);
  assert.deepEqual(chars.slice(2, 6).map(node => node.code), [0x03d5, 0x03c6, 0x03f5, 0x03b5]);
  assert.equal(chars[6].children[0].embellishment, 17);
  assert.equal(records.find(node => node.type === 3).selector, 13);
});

test('Earlier previewable ASCII bar records survive an unchanged save and rebuild with native glyphs after editing', () => {
  const source = makeNewOle(tex`\left.x\right|`);
  const {native, parsed, header} = inspectOle(source);
  const oldNative = Buffer.from(native);
  const expand = characters(parsed).find(char => char.typeface === 22);
  oldNative.writeUInt16LE(0x007c, header.length + expand.offset);
  const oldOle = wrapNative(oldNative, source);
  assert.equal(oleLatex(oldOle), tex`\left.x\right|`);
  assert.deepEqual(replaceOleLatex(oldOle, oleLatex(oldOle)), oldOle);
  const updated = replaceOleLatex(oldOle, tex`\left.y\right|`);
  assert.deepEqual(decorations(mainTemplate(updated, 4)), [[22, 0xec08]]);
});

function symbolFont(font) { return {styles: {6: {font}}}; }

function operatorPositions(ole) {
  return characters(inspectOle(ole).parsed).filter(char => char.typeface === 6 && [0x2217, 0x2032].includes(char.code))
    .map(({code, fontPosition}) => [code, fontPosition]);
}

test('Font-only changes remap exact Symbol positions both ways while preserving explicit styles and embellishments', () => {
  const original = makeNewOle(tex`\dot{*}+\prime+\mathbf{\ast}+\mathbf{*}+\text{*}+x'`);
  const changed = patchTypography(original, symbolFont('Cambria Math'));
  const restored = patchTypography(changed, symbolFont('Symbol'));
  assert.deepEqual(operatorPositions(changed), [[0x2217, undefined], [0x2032, undefined]]);
  assert.deepEqual(operatorPositions(restored), [[0x2217, 0x2a], [0x2032, 0xa2]]);
  assert.equal(oleLatex(changed), oleLatex(original));
  const after = inspectOle(changed), stored = flatten(after.parsed.records);
  const explicit = stored.filter(node => node.type === 2 && node.typeface < 0);
  assert.deepEqual(explicit.map(({code, fontPosition}) => [code, fontPosition]), [[0x2217, 0x2a], [0x002a, undefined]]);
  const originalDot = flatten(inspectOle(original).parsed.records).find(node => node.type === 2 && node.code === 0x2217);
  const dot = stored.find(node => node.type === 2 && node.code === 0x2217);
  assert.deepEqual(after.data.subarray(dot.children[0].start, dot.end), inspectOle(original).data.subarray(originalDot.children[0].start, originalDot.end));
  const suffix = ({data, parsed}) => data.subarray(parsed.records.find(node => node.type === 18).end);
  assert.deepEqual(suffix(inspectOle(restored)), suffix(inspectOle(original)));
  assert.deepEqual(patchTypography(changed, symbolFont('Cambria Math')), changed);
});

test('In-place font changes preserve original character edit offsets and reject an inconsistent source font position', () => {
  const original = makeNewOle(tex`\ast+x+\prime`);
  const source = inspectOle(original), chars = characters(source.parsed), x = chars.find(char => char.char === 'x');
  const edited = editFormulaOle(original, {replacements: {[x.offset]: 'y'}, typography: symbolFont('Cambria Math')});
  assert.match(oleLatex(edited), /\+y\+/);
  assert.deepEqual(operatorPositions(edited), [[0x2217, undefined], [0x2032, undefined]]);
  const malformed = Buffer.from(source.native);
  malformed[source.header.length + chars[0].fontPositionOffset] = 0xa8;
  const corrupted = wrapNative(malformed, original);
  assert.throws(() => patchTypography(corrupted, symbolFont('Cambria Math')), /invalidate an existing encoded character position/);
  const rebuilt = editFormulaOle(corrupted, {latex: 'x^*', typography: symbolFont('Cambria Math')});
  assert.deepEqual(operatorPositions(rebuilt), [[0x2217, undefined]]);
});

// STIX Two Math is bundled on all test hosts. Retain its verified font encoding
// as an existing FONT_DEF to exercise the same WinAllBasicCodePages transition
// as Cambria Math without depending on an optional Office desktop font.
function withSTIXFont(latex) {
  const {header, data, parsed} = inspectOle(makeNewOle('x'));
  const pref = parsed.records.find(node => node.type === 18);
  const font = Buffer.concat([Buffer.from([17, 5]), Buffer.from('STIX Two Math\0')]);
  const reordered = Buffer.concat([data.subarray(0, pref.start), font, data.subarray(pref.start)]);
  const nativeHeader = Buffer.from(header);
  nativeHeader.writeUInt32LE(reordered.length, 8);
  return makeOle(latex, Buffer.concat([nativeHeader, reordered]));
}

test('Desktop structural preview, save and exports use the final typography before authoring new stars', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'el-symbol-font-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const input = join(dir, 'input.docx'), bytes = await createDocx([{ole: withSTIXFont('x')}]);
  await writeFile(input, bytes);
  const latex = tex`x^*+\prime`, typography = symbolFont('STIX Two Math');
  const source = {path: input, index: 0, mode: 'rebuild'};
  const edit = {input, index: 0, mode: 'rebuild', latex, typography};
  const preview = await desktopRequest({action: 'editPreview', payload: edit});
  const copyPreview = await desktopRequest({action: 'preview', payload: {source, latex, typography}});
  assert.equal(copyPreview.nativeSha256, preview.nativeSha256);
  const graphic = await desktopRequest({action: 'exportGraphic', payload: {source, output: join(dir, 'preview.svg'), format: 'svg', latex, typography}});
  assert.equal(await readFile(graphic.path, 'utf8'), preview.svg);
  const saved = await desktopRequest({action: 'edit', payload: {...edit, output: join(dir, 'save.docx')}});
  const exported = await desktopRequest({action: 'export', payload: {source, output: join(dir, 'export.docx'), equations: [{latex, typography}]}});
  for (const path of [saved.path, exported.path]) {
    const {objects: [reopened]} = await inspectDocx(await readFile(path));
    assert.equal(reopened.nativeSha256, preview.nativeSha256);
    assert.deepEqual(operatorPositions(reopened.ole), [[0x2217, undefined], [0x2032, undefined]]);
  }
  assert.deepEqual(await readFile(input), bytes);
});

test('Batch typography and native DOCX edits keep star and prime positions valid', async () => {
  const bytes = await createDocx([{ole: withSTIXFont(tex`x^*+\prime`)}, {ole: withSTIXFont('y')}]);
  const typography = symbolFont('STIX Two Math');
  const plan = await preflightTypography(bytes, {indices: [0], typography});
  assert.equal(plan.summary.ready, 1);
  const {buffer} = await applyTypography(bytes, plan);
  const {objects} = await inspectDocx(buffer);
  assert.deepEqual(operatorPositions(objects[0].ole), [[0x2217, undefined], [0x2032, undefined]]);
  const {bytes: edited} = await editDocxBatch(buffer, [
    {index: 0, expectedNativeSha256: objects[0].nativeSha256, typography: symbolFont('Symbol')},
    {index: 1, expectedNativeSha256: objects[1].nativeSha256, latex: tex`y^*+\prime`, typography},
  ]);
  const after = (await inspectDocx(edited)).objects;
  assert.deepEqual(operatorPositions(after[0].ole), [[0x2217, 0x2a], [0x2032, 0xa2]]);
  assert.deepEqual(operatorPositions(after[1].ole), [[0x2217, undefined], [0x2032, undefined]]);
});

function withLateFont(name, local) {
  const ole = makeOle('x'), {data, header, parsed} = inspectOle(ole);
  const pref = parsed.records.find(node => node.type === 18);
  const font = Buffer.concat([Buffer.from([17, 5]), Buffer.from(name + '\0')]);
  const originalChar = parsed.records.find(node => node.type === 1).children[0];
  const fontIndex = parsed.records.filter(node => node.type === 17).length + 1;
  const start = local ? originalChar.start : pref.end, end = local ? originalChar.end : pref.end;
  const styleAndChar = local ? Buffer.from([8, fontIndex, 0, 2, 0, 127, 120, 0]) : Buffer.alloc(0);
  const mtef = Buffer.concat([data.subarray(0, start), font, styleAndChar, data.subarray(end)]);
  const nativeHeader = Buffer.from(header);
  nativeHeader.writeUInt32LE(mtef.length, 8);
  return wrapNative(Buffer.concat([nativeHeader, mtef]), ole);
}

test('Structural edits can append a font when local FONT_DEF records belong to discarded content', () => {
  const typography = symbolFont('Cambria Math');
  for (const oldFont of ['Later Font', 'Cambria Math']) {
    const source = withLateFont(oldFont, true), original = Buffer.from(source);
    const fonts = inspectOle(source).parsed.records.filter(node => node.type === 17);
    const inplace = editFormulaOle(source, {latex: oleLatex(source), typography}), {parsed: inplaceParsed} = inspectOle(inplace);
    assert.equal(readTypography(inplace).styles[5].font, 'Cambria Math');
    const [retained] = characters(inplaceParsed);
    assert.equal(fontFor(inplaceParsed, retained), oldFont);
    for (const [latex, expected] of [['x+1', 'x+1'], ['x^*', tex`x^{\ast }`]]) {
      const rebuilt = editFormulaOle(source, {latex, typography}), {parsed} = inspectOle(rebuilt);
      const defs = parsed.records.filter(node => node.type === 17), pref = parsed.records.find(node => node.type === 18);
      assert.equal(oleLatex(rebuilt), expected);
      assert.deepEqual(defs.map(node => node.name), [...fonts.map(node => node.name), 'Cambria Math']);
      assert.ok(defs.at(-1).start < pref.start);
      assert.equal(readTypography(rebuilt).styles[5].fontIndex, defs.length);
      assert.equal(readTypography(rebuilt).explicitStyleCount, 0);
      assert.deepEqual(operatorPositions(rebuilt), latex === 'x^*' ? [[0x2217, undefined]] : []);
      if (latex === 'x^*') assert.equal(characters(parsed).find(node => node.code === 0x2217).encoding, 'WinAllBasicCodePages');
    }
    assert.deepEqual(source, original);
  }
});

test('Structural edits retain later FONT_DEF records already in the preserved prefix', () => {
  const source = withLateFont('Preserved Font', false);
  const rebuilt = editFormulaOle(source, {latex: 'x+1', typography: symbolFont('Cambria Math')}), {parsed} = inspectOle(rebuilt);
  assert.equal(readTypography(rebuilt).styles[5].font, 'Cambria Math');
  assert.deepEqual(parsed.records.filter(node => node.type === 17).slice(-2).map(n => n.name), ['Cambria Math', 'Preserved Font']);
});

test('Cambria Math can move from a generated ell before EQN_PREFS for both save modes', () => {
  const original = makeNewOle(tex`x+\ell`), initial = inspectOle(original).parsed.records;
  assert.ok(initial.find(n => n.type === 17 && n.name === 'Cambria Math').start > initial.find(n => n.type === 18).start);
  for (const edit of [{}, {latex: tex`x+\ell+1`}]) {
    const result = editFormulaOle(original, {...edit, typography: symbolFont('Cambria Math')});
    const {parsed} = inspectOle(result), font = parsed.records.find(n => n.type === 17 && n.name === 'Cambria Math');
    assert.ok(font.start < parsed.records.find(n => n.type === 18).start);
    assert.equal(readTypography(result).styles[5].font, 'Cambria Math');
    assert.equal(fontFor(parsed, characters(parsed).find(n => n.code === 0x2113)), 'Cambria Math');
  }
});
