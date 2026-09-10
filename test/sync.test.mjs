process.env.DOCFLOW_STATE_REL = 'tools/docgen/state';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { makeFixture, manuscript, runSync, probeFile } from './helper.mjs';
import { snapshot, changedFiles, prepareCommit, applyCommit, recover, writeBytes, acquireLock } from '../src/transaction.mjs';

async function server(t, handler) {
  const service = http.createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    const data = JSON.parse(text);
    assert.equal(data.model, 'qwen3.5:4b'); assert.equal(data.think, false);
    assert.equal(data.tools, undefined); assert.equal(data.truncate, false);
    handler(data, res);
  });
  await new Promise(r => service.listen(0, '127.0.0.1', r));
  t.after(() => { service.closeAllConnections(); service.close(); });
  return `http://127.0.0.1:${service.address().port}`;
}
const reply = (res, content, extra = {}) => res.end(JSON.stringify({ done: true, done_reason: 'stop', message: { content: JSON.stringify(content) }, ...extra }));
const scan = { updates: [{ element: 'sync-probe', field: 'description', text: 'Probe.OBSERVE_MS는 12000ms입니다.' }] };
function fixture(t, n = 1) { const f = makeFixture(n); t.after(f.cleanup); return f; }

test('local protocol completes scan/write/generate without accepting review', async t => {
  const f = fixture(t); const before = snapshot(f.root);
  const url = await server(t, (data, res) => reply(res, data.format.properties.updates ? scan : { markdown: manuscript('12000') }));
  const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url }); assert.equal(r.code, 0, r.out);
  assert.match(fs.readFileSync(path.join(f.root, 'docs/guide/probe.md'), 'utf8'), /12000ms/);
  const accepted = bytes => Object.fromEntries(Object.entries(JSON.parse(bytes).entries).map(([k, v]) => [k, v.accepted]));
  assert.deepEqual(accepted(snapshot(f.root).get('tools/docgen/state/evidence.json')), accepted(before.get('tools/docgen/state/evidence.json')));
  assert.ok(changedFiles(before, snapshot(f.root)).every(p => p.startsWith('.omm/sync-probe/') || p.startsWith('docs/guide/') || p.startsWith('tools/docgen/state/')));
});

for (const scenario of ['http', 'timeout', 'json', 'truncated', 'path', 'validation', 'writer-empty', 'writer-source', 'second-writer', 'marker']) {
  test(`${scenario} failure preserves every original byte`, async t => {
    const f = fixture(t, 2); let writes = 0;
    if (scenario === 'marker') f.put('docs/guide/probe.md', '<!-- omm:begin id=status -->\n');
    const before = snapshot(f.root);
    const url = await server(t, (data, res) => {
      if (scenario === 'timeout') return;
      if (scenario === 'http') { res.statusCode = 503; return res.end(); }
      if (scenario === 'json') return res.end('{bad');
      if (scenario === 'truncated') return reply(res, scan, { done_reason: 'length' });
      if (data.format.properties.updates) {
        if (scenario === 'path') return reply(res, { updates: [{ ...scan.updates[0], element: '../app' }] });
        if (scenario === 'validation') return reply(res, { updates: [{ ...scan.updates[0], field: 'diagram', text: 'broken diagram [' }] });
        return reply(res, scan);
      }
      writes++;
      if (scenario === 'writer-empty' || (scenario === 'second-writer' && writes === 2)) return reply(res, { markdown: '' });
      return reply(res, { markdown: scenario === 'writer-source' ? manuscript('12000').replace(probeFile, 'missing.kt') : manuscript('12000') });
    });
    const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url, DOCGEN_LLM_TIMEOUT_MS: scenario === 'timeout' ? '100' : '30000' });
    assert.equal(r.code, 1, r.out); assert.deepEqual(changedFiles(before, snapshot(f.root)), [], r.out);
    if (scenario === 'second-writer') assert.equal(writes, 2);
  });
}

test('concurrent original edit prevents publication and preserves user text', async t => {
  const f = fixture(t); const before = snapshot(f.root);
  const url = await server(t, (data, res) => {
    f.put(probeFile, '// user edit\n');
    reply(res, data.format.properties.updates ? scan : { markdown: manuscript('12000') });
  });
  const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url }); assert.equal(r.code, 1, r.out);
  assert.deepEqual(changedFiles(before, snapshot(f.root)), [probeFile]);
});

test('publish write failure rolls back already written files', t => {
  const f = fixture(t); const before = snapshot(f.root); const after = new Map(before);
  after.set('.omm/sync-probe/description.md', Buffer.from('new')); after.set('docs/guide/new.md', Buffer.from('new'));
  const allowed = p => p.startsWith('.omm/') || p.startsWith('docs/');
  const journal = prepareCommit(f.root, before, after, allowed); let count = 0;
  assert.throws(() => applyCommit(f.root, journal, allowed, (...args) => { if (++count === 2) throw new Error('disk'); writeBytes(...args); }), /disk/);
  assert.deepEqual(changedFiles(before, snapshot(f.root)), []);
});

test('interrupted publish can recover; newer edits block recovery before any writes', t => {
  const f = fixture(t); const before = snapshot(f.root); const after = new Map(before);
  after.set('.omm/sync-probe/description.md', Buffer.from('new')); after.set('docs/guide/new.md', Buffer.from('new'));
  const allowed = p => p.startsWith('.omm/') || p.startsWith('docs/');
  prepareCommit(f.root, before, after, allowed);
  writeBytes(f.root, '.omm/sync-probe/description.md', Buffer.from('new'));
  writeBytes(f.root, 'docs/guide/new.md', Buffer.from('user'));
  const interrupted = snapshot(f.root);
  assert.throws(() => recover(f.root, allowed), /사용자가 수정/);
  assert.deepEqual(changedFiles(interrupted, snapshot(f.root)), []);
  writeBytes(f.root, 'docs/guide/new.md', Buffer.from('new'));
  assert.equal(recover(f.root, allowed), true);
  assert.deepEqual(changedFiles(before, snapshot(f.root)), []);
  assert.equal(recover(f.root, allowed), false);
});

test('recover command handles an interrupted commit and stale lock', async t => {
  const f = fixture(t); const before = snapshot(f.root); const after = new Map(before);
  const target = '.omm/sync-probe/description.md'; after.set(target, Buffer.from('new'));
  prepareCommit(f.root, before, after, p => p === target);
  writeBytes(f.root, target, Buffer.from('new'));
  f.put('tools/docgen/state/.sync-lock', '2147483647');
  const blocked = await runSync(f.root); assert.equal(blocked.code, 1, blocked.out);
  const r = await runSync(f.root, {}, ['--recover']); assert.equal(r.code, 0, r.out);
  assert.deepEqual(changedFiles(before, snapshot(f.root)), []);
  assert.equal(fs.existsSync(path.join(f.root, 'tools/docgen/state/.sync-lock')), false);
});

test('live lock rejects concurrent sync and recovery', async t => {
  const f = fixture(t); const unlock = acquireLock(f.root);
  try {
    for (const args of [[], ['--recover']]) {
      const r = await runSync(f.root, {}, args); assert.equal(r.code, 1, r.out); assert.match(r.out, /다른 동기화/);
    }
  } finally { unlock(); }
});

test('up-to-date repository makes no model request', async t => {
  const f = fixture(t); f.put(probeFile, 'package dev.halcamera\nobject Probe { const val OBSERVE_MS = 10000L }\n');
  const before = snapshot(f.root);
  const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: 'http://127.0.0.1:1' });
  assert.equal(r.code, 0, r.out); assert.deepEqual(changedFiles(before, snapshot(f.root)), []);
});

test('remote endpoint and oversized prompt fail without writes', async t => {
  const f = fixture(t); const before = snapshot(f.root);
  for (const env of [{ DOCGEN_OLLAMA_URL: 'https://example.com' }, { DOCGEN_MAX_PROMPT_CHARS: '10' }]) {
    const r = await runSync(f.root, env); assert.equal(r.code, 1, r.out);
    assert.deepEqual(changedFiles(before, snapshot(f.root)), []);
  }
});

test('real installed Qwen completes the same pipeline', { skip: process.env.DOCGEN_REAL_QWEN !== '1', timeout: 660000 }, async t => {
  const f = fixture(t); const before = snapshot(f.root);
  const failed = await runSync(f.root, { DOCGEN_LLM_TIMEOUT_MS: '1' });
  assert.equal(failed.code, 1, failed.out);
  assert.deepEqual(changedFiles(before, snapshot(f.root)), []);
  const r = await runSync(f.root);
  console.log(r.out); assert.equal(r.code, 0, r.out);
  const model = fs.readFileSync(path.join(f.root, '.omm/sync-probe/description.md'), 'utf8');
  const page = fs.readFileSync(path.join(f.root, 'docs/guide/probe.md'), 'utf8');
  assert.match(model, /12000|12,000|12\s*초/); assert.doesNotMatch(model, /10000|10,000|10\s*초/);
  assert.match(fs.readFileSync(path.join(f.root, '.omm/sync-probe/timer/description.md'), 'utf8'), /12000|12,000|12\s*초/);
  assert.match(page, /12000|12,000|12\s*초/); assert.doesNotMatch(page, /10000|10,000|10\s*초/);
});
