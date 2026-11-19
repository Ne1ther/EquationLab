import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const operations = new Set([
  'inspect', 'audit', 'create', 'edit', 'arrange', 'planNumbering', 'applyNumbering',
  'planTypography', 'applyTypography',
]);
const markerUuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const reportName = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}\.json$/;
const retentionMs = 24 * 60 * 60 * 1000;

async function activeSession(directory) {
  const info = await lstat(directory);
  if (!info.isDirectory() || (process.getuid && info.uid !== process.getuid())) return null;
  const marker = await open(join(directory, 'enabled'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!(await marker.stat()).isFile()) return null;
    const buffer = Buffer.alloc(65);
    const { bytesRead } = await marker.read(buffer);
    if (bytesRead === buffer.length) return null;
    const token = buffer.toString('utf8', 0, bytesRead).trim();
    return markerUuid.test(token) ? token : null;
  } finally {
    await marker.close();
  }
}

async function publish(directory, base, phase) {
  const path = join(directory, `${base.runId}.json`);
  const temporary = join(directory, `.${base.runId}.tmp`);
  try {
    const report = { ...base, phase, updatedAt: Math.max(base.startedAt, Date.now()) };
    await writeFile(temporary, JSON.stringify(report) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } catch (error) {
    if (error.code !== 'EEXIST') await unlink(temporary).catch(() => {});
  }
}

async function prune(directory, now) {
  for (const name of await readdir(directory)) {
    if (!reportName.test(name)) continue;
    const path = join(directory, name);
    try {
      const file = await lstat(path);
      if (file.isFile() && file.mtimeMs < now - retentionMs) await unlink(path);
    } catch { /* An independent invocation can be pruning the same file. */ }
  }
}

/** Best-effort local App status. The callback's result and errors are preserved. */
export async function withAIActivity(operation, callback, {
  directory = process.env.EQUATIONLAB_AI_COORDINATION_DIR || join(homedir(), 'Library', 'Application Support', 'Equation Lab', 'ai-coordination'),
} = {}) {
  if (!operations.has(operation)) return callback();
  const sessionId = await activeSession(directory).catch(() => null);
  if (!sessionId) return callback();

  const base = { schema: 1, sessionId, runId: randomUUID(), operation, startedAt: Date.now(), pid: process.pid };
  await publish(directory, base, 'running');
  const cleanup = prune(directory, base.startedAt).catch(() => {});
  let phase = 'failed';
  try {
    const result = await callback();
    phase = 'completed';
    return result;
  } finally {
    if (await activeSession(directory).catch(() => null) === sessionId) await publish(directory, base, phase);
    await cleanup;
  }
}
