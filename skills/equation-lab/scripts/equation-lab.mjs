import { open, readFile, realpath, unlink } from 'node:fs/promises';
import { dirname, extname, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const usage = `Usage: node equation-lab.mjs [--repo ROOT] inspect INPUT.docx [INDEX]
       node equation-lab.mjs [--repo ROOT] catalog
       node equation-lab.mjs [--repo ROOT] create SPEC.json NEW.docx
       node equation-lab.mjs [--repo ROOT] arrange-copy INPUT.docx SPEC.json NEW.docx`;

function keys(record, allowed, label) {
  if (!record || typeof record !== 'object' || Array.isArray(record)
    || Object.keys(record).some(key => !allowed.includes(key))) {
    throw Error('Invalid ' + label);
  }
}

async function loadEngine(explicitRoot) {
  const script = await realpath(fileURLToPath(import.meta.url));
  const candidates = explicitRoot ? [resolve(explicitRoot)]
    : [resolve(dirname(script), '../../..'), process.cwd()];
  for (const root of candidates) {
    const manifest = await readFile(resolve(root, 'package.json'), 'utf8').catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!manifest || JSON.parse(manifest).name !== 'equationlab') continue;
    const load = name => import(pathToFileURL(resolve(root, 'src', name)).href);
    return load;
  }
  throw Error('Equation Lab checkout unavailable. Use --repo ROOT or run from its checkout.');
}

async function readSpec(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function saveCopy(path, bytes) {
  if (extname(path).toLowerCase() !== '.docx') throw Error('Use a .docx output path');
  const file = await open(path, 'wx');
  try {
    await file.writeFile(bytes);
  } catch (error) {
    await file.close();
    await unlink(path).catch(() => {});
    throw error;
  }
  await file.close();
}

function row(object) {
  return {
    index: object.index,
    part: object.part,
    mainDocument: object.mainDocument,
    latex: object.latex ?? null,
    nativeSha256: object.nativeSha256,
    layout: object.layout,
    error: object.parseError ?? object.previewError ?? null,
  };
}

async function assertWritableCopy(engine, source) {
  const { zip, mainPart } = source;
  const { NS, parseDocxXml, resolveDocxPart } = engine;
  if (Object.keys(zip.files).some(name => /^_xmlsignatures\//i.test(name))) {
    throw Error('Signed documents require their authorized Word workflow');
  }
  const relationshipFile = zip.file(mainPart.replace(/([^/]+)$/, '_rels/$1.rels'));
  const relationships = relationshipFile ? parseDocxXml(await relationshipFile.async('string')) : null;
  const links = Array.from(relationships?.getElementsByTagNameNS(NS.rels, 'Relationship') ?? [])
    .filter(link => link.getAttribute('Type') === NS.r + '/settings');
  if (links.length > 1 || links[0]?.getAttribute('TargetMode') === 'External') {
    throw Error('Ambiguous document settings relationship');
  }
  const settingsPath = links.length ? resolveDocxPart(links[0].getAttribute('Target'), mainPart) : null;
  if (settingsPath && !zip.file(settingsPath)) throw Error('DOCX settings part is missing');
  for (const name of new Set([settingsPath, posix.join(posix.dirname(mainPart), 'settings.xml')])) {
    if (!name || !zip.file(name)) continue;
    const settings = parseDocxXml(await zip.file(name).async('string'));
    const protectedDocument = Array.from(settings.getElementsByTagNameNS(NS.w, 'documentProtection'))
      .some(node => /^(?:1|true|on)$/i.test(node.getAttributeNS(NS.w, 'enforcement')));
    if (protectedDocument) throw Error('Protected documents require an authorized Word host operation');
  }
}

function assertPlainTarget(engine, object) {
  if (!object?.mainDocument || object.parseError || !object.nativeSha256) {
    throw Error('Select a readable equation in the main document body');
  }
  const container = object.element.parentNode;
  const run = container.parentNode;
  if (!object.shape || !object.image || container.namespaceURI !== engine.NS.w
    || container.localName !== 'object' || run.namespaceURI !== engine.NS.w || run.localName !== 'r'
    || container.getElementsByTagNameNS(engine.NS.o, 'OLEObject').length !== 1
    || container.getElementsByTagNameNS(engine.NS.v, 'shape').length !== 1
    || Array.from(run.childNodes).some(node => node.nodeType === 1 && node !== container
      && !(node.namespaceURI === engine.NS.w && node.localName === 'rPr'))) {
    throw Error('This equation wrapper or shared text run requires a Word host operation');
  }
  for (let node = container; node; node = node.parentNode) {
    if (node.namespaceURI === engine.NS.w && ['ins', 'del', 'moveFrom', 'moveTo', 'sdt'].includes(node.localName)) {
      throw Error('Tracked or content-controlled equations require a Word host operation');
    }
  }
}

function compareReadback(before, after) {
  if (before.length !== after.length || before.some((object, index) => {
    const updated = after[index];
    return object.part !== updated.part
      || (object.layout.bookmarkName && object.layout.bookmarkName !== updated.layout.bookmarkName)
      || object.nativeSha256 !== updated.nativeSha256;
  })) throw Error('Readback changed the equation order, an existing bookmark, or a Native stream');
}

function referenceIdentity(report) {
  return report.references.map(ref => [ref.location.part, ref.type, ref.bookmark, ref.state, ref.locked]);
}

const layoutModes = ['inline', 'display', 'numbered-left', 'numbered-right'];

async function run() {
  let args = process.argv.slice(2), root;
  if (args[0] === '--repo') {
    root = args[1];
    if (!root) throw Error(usage);
    args = args.slice(2);
  }
  const [command, input, specOrIndex, output] = args;
  if (!command || command === '--help') {
    console.log(usage);
    return;
  }
  const allowedArities = { inspect: [2, 3], catalog: [1], create: [3], 'arrange-copy': [4] };
  if (!Object.hasOwn(allowedArities, command) || !allowedArities[command].includes(args.length)) throw Error(usage);
  const load = await loadEngine(root);
  if (command === 'catalog') {
    const { TYPOGRAPHY_SPACES, TYPOGRAPHY_EXTRA_SIZES, TYPOGRAPHY_FONTS } = await load('typography-native.mjs');
    return { spaces: TYPOGRAPHY_SPACES, extraSizes: TYPOGRAPHY_EXTRA_SIZES, candidateFonts: TYPOGRAPHY_FONTS };
  }
  const monitor = await load('ai-coordination.mjs').catch(() => null);
  const operation = command === 'arrange-copy' ? 'arrange' : command;
  const execute = () => runDocumentCommand(load, command, input, specOrIndex, output);
  return monitor ? monitor.withAIActivity(operation, execute) : execute();
}

async function runDocumentCommand(load, command, input, specOrIndex, output) {
  const engine = { ...await load('document.mjs'), ...await load('document-audit.mjs') };
  if (command === 'create') {
    const spec = await readSpec(input);
    keys(spec, ['equations', 'references', 'numberingFamily'], 'document spec');
    if (!Array.isArray(spec.equations) || spec.equations.length < 1 || spec.equations.length > 500) {
      throw Error('Supply 1–500 equations');
    }
    for (const item of spec.equations) {
      keys(item, ['latex', 'label', 'layout', 'typography', 'ruler'], 'new equation');
      if (typeof item.latex !== 'string' || !item.latex.trim()) throw Error('Supply equation LaTeX');
      if (item.label !== undefined && typeof item.label !== 'string') throw Error('Invalid equation label');
      if (item.layout !== undefined) {
        keys(item.layout, ['mode', 'numberFormat', 'chapter', 'section', 'equation', 'resetEquation'], 'new equation layout');
        if (!layoutModes.includes(item.layout.mode)) throw Error('Supply a supported equation layout mode');
      }
    }
    if (spec.references !== undefined) {
      if (!Array.isArray(spec.references)) throw Error('Invalid reference list');
      for (const ref of spec.references) {
        keys(ref, ['target', 'prefix'], 'cross-reference');
        if (!Number.isSafeInteger(ref.target) || ref.target < 0 || ref.target >= spec.equations.length
          || (ref.prefix !== undefined && typeof ref.prefix !== 'string')) throw Error('Invalid cross-reference');
      }
    }
    const bytes = await engine.createDocx(spec.equations, {
      fragment: true, numberingFamily: spec.numberingFamily ?? 'mathtype', references: spec.references ?? [],
    });
    const { objects } = await engine.inspectDocx(bytes);
    if (objects.length !== spec.equations.length || objects.some(object => !object.nativeSha256 || object.previewError)) {
      throw Error('Generated equations did not round-trip in the native parser');
    }
    if (spec.references?.length) {
      const { references } = await engine.auditDocx(bytes);
      if (references.length !== spec.references.length || references.some((reference, index) =>
        reference.state !== 'resolved' || reference.bookmark !== objects[spec.references[index].target].layout.bookmarkName)) {
        throw Error('Generated cross-references did not resolve to their requested equations');
      }
    }
    await saveCopy(specOrIndex, bytes);
    return { output: specOrIndex, outputSha256: engine.hash(bytes), equations: objects.map(row) };
  }

  const bytes = await engine.readDocxInput(input);
  const sourceSha256 = engine.hash(bytes);
  const source = await engine.inspectDocx(bytes);
  if (command === 'inspect') {
    if (specOrIndex === undefined) {
      return { sourceSha256, numberFormat: source.numberFormat, equationCount: source.objects.length, equations: source.objects.map(row) };
    }
    if (!/^\d+$/.test(specOrIndex)) throw Error('Use a zero-based equation index');
    const object = source.objects[Number(specOrIndex)];
    if (!object) throw Error('Equation index not found');
    return { sourceSha256, equation: { ...row(object), characters: object.characters,
      ruler: object.ruler, typography: object.typography ?? null, typographyError: object.typographyError ?? null } };
  }
  const spec = await readSpec(specOrIndex);
  if (spec?.sourceSha256 !== sourceSha256) throw Error('Source changed. Inspect again and rebuild the request.');
  await assertWritableCopy(engine, source);

  keys(spec, ['sourceSha256', 'indices', 'layout'], 'arrangement spec');
  if (!Array.isArray(spec.indices) || !spec.indices.length || new Set(spec.indices).size !== spec.indices.length
    || spec.indices.some(index => !Number.isSafeInteger(index) || !source.objects[index])) {
    throw Error('Supply distinct zero-based equation indices');
  }
  keys(spec.layout, ['mode', 'numberFormat'], 'arrangement layout');
  if (!layoutModes.includes(spec.layout.mode)) {
    throw Error('Supply a supported equation layout mode');
  }
  for (const index of spec.indices) assertPlainTarget(engine, source.objects[index]);
  const updated = await engine.arrangeDocx(bytes, { indices: spec.indices, layout: spec.layout, defaultNumberingFamily: 'mathtype' });
  const beforeAudit = await engine.auditDocx(bytes);
  const afterAudit = await engine.auditDocx(updated);
  if (JSON.stringify(referenceIdentity(beforeAudit)) !== JSON.stringify(referenceIdentity(afterAudit))) {
    throw Error('Readback changed an existing reference or its resolution');
  }
  const result = await engine.inspectDocx(updated);
  compareReadback(source.objects, result.objects);
  await saveCopy(output, updated);
  return { output, sourceSha256, outputSha256: engine.hash(updated), equations: spec.indices.map(index => row(result.objects[index])) };
}

run().then(result => {
  if (result) console.log(JSON.stringify(result));
}).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
