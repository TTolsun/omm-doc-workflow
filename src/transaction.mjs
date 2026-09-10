// Generate in a disposable copy; publish only validated files with a recovery journal.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const excluded = new Set(['.git', '.gradle', '.kotlin', '.idea', '.claude', '.codex',
  'node_modules', 'build', 'omm-backup', 'sync-transaction', '.sync-lock']);
const localOnly = name => name === 'local.properties' || name === 'keystore.properties' ||
  name === '.env' || name.startsWith('.env.') || /\.(jks|keystore|pem|key)$/i.test(name);

export function safePath(root, rel) {
  if (!rel || rel.includes('\\') || path.isAbsolute(rel) || rel.split('/').some(p => !p || p === '.' || p === '..')) {
    throw new Error(`Invalid relative path: ${rel}`);
  }
  const target = path.resolve(root, ...rel.split('/'));
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error(`Path escaped workspace: ${rel}`);
  // Do not follow a link introduced while the sync was running.
  let current = path.resolve(root);
  for (const part of rel.split('/')) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error(`Symlink is not supported: ${rel}`);
  }
  return target;
}

export function snapshot(root, roots = null, documentationRoots = roots ?? ['.omm', 'docs']) {
  const files = new Map();
  const selected = rel => !roots || roots.some(p => rel === p || rel.startsWith(p + '/') || p.startsWith(rel + '/'));
  function walk(dir, prefix = '') {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix + ent.name;
      if (!selected(rel)) continue;
      if (ent.name === '.sync-lock' || ent.name === 'sync-transaction') continue;
      // A documentation element may legitimately be named "build".
      const documentation = documentationRoots.some(p => rel === p || rel.startsWith(p + '/'));
      if (!documentation && (excluded.has(ent.name) || localOnly(ent.name))) continue;
      if (ent.isSymbolicLink()) throw new Error(`Symlink is not supported: ${rel}`);
      if (ent.isDirectory()) walk(path.join(dir, ent.name), rel + '/');
      else if (ent.isFile()) files.set(rel, fs.readFileSync(path.join(dir, ent.name)));
    }
  }
  walk(root);
  return files;
}

export function changedFiles(before, after) {
  return [...new Set([...before.keys(), ...after.keys()])].sort().filter(rel =>
    !before.has(rel) || !after.has(rel) || !before.get(rel).equals(after.get(rel)));
}

export function writeBytes(root, rel, bytes) {
  const target = safePath(root, rel);
  if (bytes === null) { if (fs.existsSync(target)) fs.unlinkSync(target); return; }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = target + `.sync-${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, bytes); fs.renameSync(temporary, target); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

export function copySnapshot(root, files) {
  for (const [rel, bytes] of files) writeBytes(root, rel, bytes);
}

export const journalPath = root => path.join(root, process.env.DOCFLOW_STATE_REL ?? '.docflow/state', 'sync-transaction', 'journal.json');
const digest = bytes => bytes === null ? null : crypto.createHash('sha256').update(bytes).digest('hex');
const currentBytes = (root, rel) => {
  const p = safePath(root, rel);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
};

export function prepareCommit(root, before, after, allowed) {
  const changes = changedFiles(before, after);
  const entries = changes.map(rel => {
    if (!allowed(rel)) throw new Error(`허용 범위를 벗어난 변경: ${rel}`);
    return { rel, before: before.has(rel) ? before.get(rel).toString('base64') : null,
      after: after.has(rel) ? after.get(rel).toString('base64') : null };
  });
  if (!entries.length) return null;
  const file = journalPath(root);
  if (fs.existsSync(file)) throw new Error('복구 기록이 남아 있습니다. sync.mjs --recover를 실행하세요.');
  const journal = { version: 1, root: path.resolve(root), entries };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), 'pending.json');
  fs.writeFileSync(temporary, JSON.stringify(journal));
  fs.renameSync(temporary, file);
  return journal;
}

export function recover(root, allowed) {
  const file = journalPath(root);
  if (!fs.existsSync(file)) return false;
  const journal = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (journal.version !== 1 || journal.root !== path.resolve(root) || !Array.isArray(journal.entries)) {
    throw new Error('복구 기록의 작업 경로 또는 형식이 일치하지 않습니다.');
  }
  // Check every file before restoring any, so later user edits are not overwritten.
  for (const e of journal.entries) {
    if (!allowed(e.rel)) throw new Error(`복구할 수 없는 경로: ${e.rel}`);
    const expected = [e.before, e.after].map(x => digest(x === null ? null : Buffer.from(x, 'base64')));
    if (!expected.includes(digest(currentBytes(root, e.rel)))) throw new Error(`복구 중단: 사용자가 수정한 파일 ${e.rel}`);
  }
  for (const e of journal.entries) writeBytes(root, e.rel, e.before === null ? null : Buffer.from(e.before, 'base64'));
  fs.unlinkSync(file);
  return true;
}

export function applyCommit(root, journal, allowed, writer = writeBytes) {
  if (!journal) return;
  try {
    for (const e of journal.entries) {
      const before = e.before === null ? null : Buffer.from(e.before, 'base64');
      if (digest(currentBytes(root, e.rel)) !== digest(before)) throw new Error(`반영 중 원본이 바뀌었습니다: ${e.rel}`);
      writer(root, e.rel, e.after === null ? null : Buffer.from(e.after, 'base64'));
    }
    fs.unlinkSync(journalPath(root));
  } catch (error) {
    recover(root, allowed);
    throw error;
  }
}

export function acquireLock(root, recovery = false) {
  const file = path.join(root, process.env.DOCFLOW_STATE_REL ?? '.docflow/state', '.sync-lock');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    const pid = Number(fs.readFileSync(file, 'utf8'));
    let running = false;
    if (Number.isSafeInteger(pid) && pid > 0) {
      try { process.kill(pid, 0); running = true; } catch (e) { if (e.code !== 'ESRCH') running = true; }
    }
    if (running || !recovery) throw new Error('다른 동기화가 실행 중이거나 중단 기록이 있습니다. 실행 상태를 확인한 뒤 --recover를 사용하세요.');
    fs.unlinkSync(file);
  }
  fs.writeFileSync(file, String(process.pid), { flag: 'wx' });
  return () => fs.unlinkSync(file);
}
