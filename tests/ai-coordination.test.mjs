import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { withAIActivity } from '../src/ai-coordination.mjs';

const run = promisify(execFile);
const fields = ['operation', 'phase', 'pid', 'runId', 'schema', 'sessionId', 'startedAt', 'updatedAt'];

async function sandbox(t) {
  const directory = await mkdtemp(join(tmpdir(), 'equation-lab-ai-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, marker: join(directory, 'enabled') };
}

async function reports(directory) {
  const names = (await readdir(directory)).filter(name => name.endsWith('.json'));
  return Promise.all(names.map(async name => {
    const report = JSON.parse(await readFile(join(directory, name), 'utf8'));
    assert.equal(name, `${report.runId}.json`);
    assert.deepEqual(Object.keys(report).sort(), fields);
    assert.match(report.runId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    assert.equal(report.schema, 1);
    assert.ok(Number.isSafeInteger(report.startedAt));
    assert.ok(Number.isSafeInteger(report.updatedAt) && report.updatedAt >= report.startedAt);
    assert.ok(Number.isSafeInteger(report.pid) && report.pid > 0);
    assert.equal((await stat(join(directory, name))).mode & 0o077, 0);
    return report;
  }));
}

test('the absent or invalid marker leaves operations and the directory untouched', async t => {
  const { directory, marker } = await sandbox(t);
  assert.equal(await withAIActivity('inspect', () => 23, { directory }), 23);
  assert.deepEqual(await readdir(directory), []);
  await writeFile(marker, 'malformed marker');
  assert.equal(await withAIActivity('inspect', () => 23, { directory }), 23);
  assert.deepEqual(await readdir(directory), ['enabled']);
});

test('local reports run concurrently, expose only metadata, and preserve failures', async t => {
  const { directory, marker } = await sandbox(t);
  const sessionId = randomUUID().toUpperCase();
  await writeFile(marker, `${sessionId}\n`);
  const oldReport = join(directory, `${randomUUID()}.json`);
  const unrelated = join(directory, 'external.json');
  const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
  for (const file of [oldReport, unrelated]) {
    await writeFile(file, '{}');
    await utimes(file, oldDate, oldDate);
  }
  const error = new Error('private fixture /example/input.docx');
  const result = await Promise.allSettled([
    withAIActivity('audit', async () => {
      const names = await readdir(directory);
      const candidates = names.filter(name => name !== 'external.json' && name !== 'enabled');
      const records = await Promise.all(candidates.map(name => readFile(join(directory, name), 'utf8').catch(() => '{}')));
      assert.ok(records.map(JSON.parse).some(report => report.operation === 'audit' && report.phase === 'running'));
      return 42;
    }, { directory }),
    withAIActivity('edit', () => { throw error; }, { directory }),
  ]);
  assert.deepEqual(result[0], { status: 'fulfilled', value: 42 });
  assert.equal(result[1].reason, error);
  assert.deepEqual(await readFile(unrelated, 'utf8'), '{}');
  await assert.rejects(stat(oldReport), { code: 'ENOENT' });
  await rm(unrelated);
  const records = await reports(directory);
  assert.equal(records.length, 2);
  assert.ok(records.every(report => report.sessionId === sessionId));
  assert.equal(records.find(item => item.operation === 'audit').phase, 'completed');
  assert.equal(records.find(item => item.operation === 'edit').phase, 'failed');
});

test('a changed marker prevents the previous session from publishing its final state', async t => {
  const { directory, marker } = await sandbox(t);
  const previous = randomUUID();
  const current = randomUUID();
  await writeFile(marker, previous);
  await withAIActivity('create', () => writeFile(marker, current), { directory });
  await withAIActivity('arrange', () => {}, { directory });
  const records = await reports(directory);
  assert.equal(records.find(item => item.sessionId === previous).phase, 'running');
  assert.equal(records.find(item => item.sessionId === current).phase, 'completed');
});

test('the CLI and the portable skill emit matching reports without changing stdout', async t => {
  const { directory, marker } = await sandbox(t);
  const sessionId = randomUUID();
  await writeFile(marker, sessionId);
  const path = relative => fileURLToPath(new URL(`../${relative}`, import.meta.url));
  const input = path('docs/examples/equation-lab-30-formulas.docx');
  const env = { ...process.env, EQUATIONLAB_AI_COORDINATION_DIR: directory };
  const [audit, inspect] = await Promise.all([
    run(process.execPath, [path('src/cli.mjs'), 'audit', input], { env }),
    run(process.execPath, [path('skills/equation-lab/scripts/equation-lab.mjs'), 'inspect', input], { env }),
  ]);
  assert.equal(JSON.parse(audit.stdout).equations.length, 30);
  assert.equal(JSON.parse(inspect.stdout).equationCount, 30);
  assert.equal(audit.stderr, '');
  assert.equal(inspect.stderr, '');
  const records = await reports(directory);
  assert.deepEqual(records.map(item => item.operation).sort(), ['audit', 'inspect']);
  assert.ok(records.every(item => item.phase === 'completed' && item.sessionId === sessionId));
});
