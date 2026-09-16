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
    // 구조·집필 반려 재시도는 아래 별도 검사에서 다루므로 여기서는 한 번만 요청합니다.
    const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url, DOCGEN_LLM_TIMEOUT_MS: scenario === 'timeout' ? '100' : '30000', DOCFLOW_SCAN_ATTEMPTS: '1', DOCFLOW_WRITER_ATTEMPTS: '1' });
    assert.equal(r.code, 1, r.out); assert.deepEqual(changedFiles(before, snapshot(f.root)), [], r.out);
    if (scenario === 'second-writer') assert.equal(writes, 2);
  });
}

test('scan rejection restores the perspective, feeds the validation error back and applies the corrected updates', async t => {
  const f = fixture(t); const prompts = [];
  const diagramBefore = fs.readFileSync(path.join(f.root, '.omm/sync-probe/diagram.mmd'), 'utf8');
  const url = await server(t, (data, res) => {
    if (!data.format.properties.updates) return reply(res, { markdown: manuscript('12000') });
    prompts.push(data.messages.at(-1).content);
    // 첫 응답은 설명과 함께 방향 선언이 없는 diagram 을 보내고, 두 번째 응답은 설명만 고치되 요소를 파일 경로로 적습니다.
    if (prompts.length === 1) return reply(res, { updates: [...scan.updates, { element: 'sync-probe', field: 'diagram', text: 'timer["관측 시간"] --> done\n' }] });
    reply(res, { updates: [{ ...scan.updates[0], element: '.omm/sync-probe/description.md' }] });
  });
  const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url }); assert.equal(r.code, 0, r.out);
  assert.equal(prompts.length, 2);
  assert.doesNotMatch(prompts[0], /반려 사유/); assert.match(prompts[1], /## 이전 응답 반려 사유[^]*graph-declaration/);
  assert.match(r.out, /구조 반려 1\/3: .*graph-declaration/);
  assert.equal(fs.readFileSync(path.join(f.root, '.omm/sync-probe/diagram.mmd'), 'utf8'), diagramBefore);
  assert.match(fs.readFileSync(path.join(f.root, '.omm/sync-probe/description.md'), 'utf8'), /12000ms/);
});

test('scan rejection stops after the configured attempts without writing', async t => {
  const f = fixture(t); const before = snapshot(f.root); let scans = 0;
  const url = await server(t, (data, res) => {
    if (!data.format.properties.updates) return reply(res, { markdown: manuscript('12000') });
    scans++; reply(res, scans === 1 ? { updates: [{ ...scan.updates[0], element: '../app' }] } : { updates: [{ ...scan.updates[0], field: 'diagram', text: 'broken diagram [' }] });
  });
  const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url, DOCFLOW_SCAN_ATTEMPTS: '2' });
  assert.equal(r.code, 1, r.out); assert.equal(scans, 2);
  assert.match(r.out, /구조 반려 1\/2: 경로·필드·내용이 유효하지 않습니다/); assert.match(r.out, /구조 스캔이 2회 시도 후에도 검증을 통과하지 못했습니다/);
  assert.deepEqual(changedFiles(before, snapshot(f.root)), [], r.out);
});

// front matter 는 정상이지만 본문이 조사 띄어쓰기, 비합니다체, 대화체 안내문을 담은 원고입니다.
const chatty = manuscript('12000').replace('Probe.OBSERVE_MS는 관측 시간을 12000ms로 지정합니다.',
  'Probe.OBSERVE_MS 는 관측 시간을 12000ms 로 지정한다.\n\n다음 단계로 넘어가거나 추가 검토를 요구할 수 있다.');

test('writer rejection feeds the violated rules back and accepts the corrected manuscript', async t => {
  const f = fixture(t); const prompts = [];
  const url = await server(t, (data, res) => {
    if (data.format.properties.updates) return reply(res, scan);
    prompts.push(data.messages.at(-1).content);
    // 첫 응답은 코드 펜스로 감싼 대화체 원고, 두 번째는 펜스로 감싼 정상 원고입니다. 펜스는 벗겨서 저장해야 합니다.
    return reply(res, { markdown: prompts.length === 1 ? '```markdown\n' + chatty + '```\n' : '\n```markdown\n' + manuscript('12000') + '```' });
  });
  const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url }); assert.equal(r.code, 0, r.out);
  assert.equal(prompts.length, 2);
  assert.doesNotMatch(prompts[0], /반려 사유/);
  // 조사 띄어쓰기는 반려 대신 정리하므로 반려 사유에 나오지 않습니다.
  assert.match(prompts[1], /## 이전 응답 반려 사유[^]*\[종결어미\][^]*\[대화체·작업 보고\]/);
  assert.doesNotMatch(prompts[1], /\[조사 띄어쓰기\]/);
  assert.match(r.out, /원고 정리: 조사 띄어쓰기 2곳/);
  assert.match(r.out, /원고 반려 1\/3: 종결어미, 대화체·작업 보고/);
  assert.equal(fs.readFileSync(path.join(f.root, 'docs/guide/_content/probe/overview-0.md'), 'utf8'), manuscript('12000'));
});

test('particle spacing alone is normalized and the manuscript is accepted on the first attempt', async t => {
  const f = fixture(t); let writes = 0;
  const spaced = manuscript('12000').replace('Probe.OBSERVE_MS는 관측 시간을 12000ms로 지정합니다.', 'Probe.OBSERVE_MS 는 관측 시간을 12000ms 로 지정합니다.');
  const url = await server(t, (data, res) => { if (data.format.properties.updates) return reply(res, scan); writes++; reply(res, { markdown: spaced }); });
  const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url }); assert.equal(r.code, 0, r.out);
  assert.equal(writes, 1); assert.doesNotMatch(r.out, /원고 반려/);
  assert.equal(fs.readFileSync(path.join(f.root, 'docs/guide/_content/probe/overview-0.md'), 'utf8'), manuscript('12000'));
});

test('writer rejection stops after the configured attempts without writing', async t => {
  const f = fixture(t); let writes = 0;
  // 바인딩의 must_link 심볼이 본문에 그대로 없으면 계약 위반입니다.
  f.put('docs/guide/_bindings.yaml', fs.readFileSync(path.join(f.root, 'docs/guide/_bindings.yaml'), 'utf8').replace('brief:\n', 'brief:\n          must_link: [Probe.OBSERVE_MS]\n'));
  const before = snapshot(f.root);
  const url = await server(t, (data, res) => {
    if (data.format.properties.updates) return reply(res, scan);
    writes++;
    if (writes === 1) return reply(res, { markdown: 'front matter 없이 시작하는 원고입니다.' });
    if (writes === 2) return reply(res, { markdown: manuscript('12000').replace('Probe.OBSERVE_MS는 관측', 'Probe.OBSERVE MS는 관측') });
    reply(res, { markdown: chatty });
  });
  const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url, DOCFLOW_WRITER_ATTEMPTS: '3' });
  assert.equal(r.code, 1, r.out); assert.equal(writes, 3);
  assert.match(r.out, /원고 반려 1\/3: front matter/); assert.match(r.out, /원고 반려 2\/3: 필수 심볼/);
  assert.match(r.out, /3회 시도 후에도 집필 규칙을 통과하지 못했습니다: 종결어미/);
  assert.deepEqual(changedFiles(before, snapshot(f.root)), [], r.out);
});

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
