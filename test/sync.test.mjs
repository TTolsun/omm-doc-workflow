process.env.DOCFLOW_STATE_REL = 'tools/docgen/state';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { makeFixture, manuscript, runSync, probeFile, timerFile } from './helper.mjs';
import { snapshot, changedFiles, prepareCommit, applyCommit, recover, writeBytes, acquireLock } from '../src/transaction.mjs';
import { qwen } from '../src/qwen.mjs';
// config.mjs resolves the project at import time; point it at the example so unit imports work outside a fixture.
process.env.DOCFLOW_PROJECT_ROOT = path.join(import.meta.dirname, '../examples/camera-hal');
const { splitFrontMatter, citedFiles } = await import('../src/model.mjs');
const { manuscriptSchema, renderManuscript } = await import('../src/write-evidence.mjs');
delete process.env.DOCFLOW_PROJECT_ROOT;
const writer = markdown => { const { meta, body } = splitFrontMatter(markdown); return { sections: { answer_1: body }, sources: citedFiles(meta) }; };

test('structured writer preserves human evidence metadata and requires every requested answer', () => {
  const key = { block: { based_on: ['sync-probe'], confidence: 'code', brief: { answers: ['First?', 'Second?'] } } };
  const format = manuscriptSchema(key, [probeFile]);
  assert.deepEqual(format.properties.sources.items.enum, [probeFile]);
  const response = { sections: { answer_1: '첫 답변입니다.', answer_2: '두 번째 답변입니다.' }, sources: [probeFile], decisions: ['D-invented'] };
  const { meta, body } = splitFrontMatter(renderManuscript(key, response, { decisions: ['D-existing'], verifications: [] }));
  assert.deepEqual(meta.decisions, ['D-existing']); assert.deepEqual(meta.verifications, []);
  assert.match(body, /첫 답변입니다\.\n\n두 번째 답변입니다\./);
  for (const sections of [{ answer_1: 'only one' }, { ...response.sections, extra: 'unexpected' },
    { ...response.sections, answer_2: 'x'.repeat(2501) }, { ...response.sections, answer_2: '---\nconfidence: device' }]) {
    assert.throws(() => renderManuscript(key, { ...response, sections }), /질문별 답변/);
  }
});

async function server(t, handler) {
  const service = http.createServer(async (req, res) => {
    req.setEncoding('utf8');
    let text = ''; for await (const chunk of req) text += chunk;
    const data = JSON.parse(text);
    assert.equal(data.model, 'qwen3.5:4b'); assert.equal(data.think, false);
    assert.equal(data.tools, undefined); assert.equal(data.truncate, false);
    assert.equal(data.stream, true);
    try { handler(data, res); }
    catch (error) { res.writeHead(500).end(); throw error; }
  });
  await new Promise(r => service.listen(0, '127.0.0.1', r));
  t.after(() => { service.closeAllConnections(); service.close(); });
  return `http://127.0.0.1:${service.address().port}`;
}
const packet = data => JSON.stringify(data) + '\n';
const reply = (res, content, extra = {}) => {
  res.setHeader('Content-Type', 'application/x-ndjson');
  const text = JSON.stringify(content), middle = Math.floor(text.length / 2);
  res.write(packet({ done: false, message: { content: text.slice(0, middle) } }));
  res.write(packet({ done: false, message: { content: text.slice(middle) } }));
  res.end(packet({ done: true, done_reason: 'stop', eval_count: 42, message: { content: '' }, ...extra }));
};
const scan = { updates: [{ element: 'sync-probe', field: 'description', text: 'Probe.OBSERVE_MS는 12000ms입니다.' }] };
const scanFor = data => ({ updates: [{ ...scan.updates[0], element: data.format.properties.updates.items.properties.element.enum[0] }] });
function fixture(t, n = 1) { const f = makeFixture(n); t.after(f.cleanup); return f; }

function transportEnv(t, url, extra = {}) {
  for (const [key, value] of Object.entries({ DOCGEN_OLLAMA_URL: url, DOCGEN_LLM_TIMEOUT_MS: '10000', DOCGEN_LLM_IDLE_MS: '2000', ...extra })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
}

test('stream reconstructs split UTF-8, split lines and an unterminated final line', async t => {
  const expected = { markdown: '한국어 원고입니다.\n두 번째 줄입니다.' };
  const url = await server(t, (_data, res) => {
    const wire = Buffer.from(packet({ done: false, message: { content: JSON.stringify(expected) } }) + '\r\n' +
      JSON.stringify({ done: true, done_reason: 'stop', eval_count: 12 }));
    const split = wire.indexOf(Buffer.from('한')) + 1;
    res.write(wire.subarray(0, split));
    setImmediate(() => { res.write(wire.subarray(split, split + 3)); setImmediate(() => res.end(wire.subarray(split + 3))); });
  });
  transportEnv(t, url);
  assert.deepEqual(await qwen('test', {}), expected);
});

test('stream accepts final-chunk content and stops without waiting for EOF', async t => {
  const url = await server(t, (data, res) => {
    assert.equal(data.options.num_predict, 1234);
    res.write(packet({ done: false, message: { content: '{"value":' } }));
    res.write(packet({ done: true, done_reason: 'stop', message: { content: '42}' } }));
  });
  transportEnv(t, url, { DOCGEN_QWEN_NUM_PREDICT: '1234' });
  assert.deepEqual(await qwen('test', {}), { value: 42 });
});

test('default output budget remains 8192', async t => {
  const url = await server(t, (data, res) => {
    assert.equal(data.options.num_predict, 8192);
    reply(res, { ok: true });
  });
  transportEnv(t, url, { DOCGEN_QWEN_NUM_PREDICT: '8192' });
  delete process.env.DOCGEN_QWEN_NUM_PREDICT;
  assert.deepEqual(await qwen('test', {}), { ok: true });
});

for (const completes of [true, false]) {
  test(`active stream ${completes ? 'refreshes idle deadline' : 'cannot extend total deadline'}`, async t => {
    const url = await server(t, (_data, res) => {
      res.write(packet({ done: false, message: { content: '{"ok":true}' } }));
      let chunks = 0;
      const timer = setInterval(() => {
        res.write(packet({ done: false, message: { content: '' } }));
        if (completes && ++chunks === 8) res.end(packet({ done: true, done_reason: 'stop' }));
      }, 100);
      res.on('close', () => clearInterval(timer));
    });
    transportEnv(t, url, { DOCGEN_LLM_IDLE_MS: '500', DOCGEN_LLM_TIMEOUT_MS: completes ? '10000' : '800' });
    if (completes) assert.deepEqual(await qwen('test', {}), { ok: true });
    else await assert.rejects(qwen('test', {}), /전체 시간 제한 초과/);
  });
}

test('idle deadline also covers waiting for headers', async t => {
  const url = await server(t, () => {});
  transportEnv(t, url, { DOCGEN_LLM_IDLE_MS: '100' });
  await assert.rejects(qwen('test', {}), /유휴 시간 제한 초과/);
});

test('total deadline covers headers even when the idle budget is longer', async t => {
  const url = await server(t, () => {});
  transportEnv(t, url, { DOCGEN_LLM_IDLE_MS: '1000', DOCGEN_LLM_TIMEOUT_MS: '100' });
  await assert.rejects(qwen('test', {}), /전체 시간 제한 초과/);
});

test('local transport rejects redirects without contacting their destination', async t => {
  let destinationRequests = 0;
  const destination = await server(t, (_data, res) => { destinationRequests++; reply(res, {}); });
  const url = await server(t, (_data, res) => res.writeHead(307, { Location: destination }).end());
  transportEnv(t, url);
  await assert.rejects(qwen('test', {}), /Ollama HTTP 307/);
  assert.equal(destinationRequests, 0);
});

test('headers can arrive after 300 seconds within configured deadlines', { skip: process.env.DOCGEN_LONG_HEADERS !== '1', timeout: 330000 }, async t => {
  const url = await server(t, (_data, res) => {
    const finish = setTimeout(() => reply(res, { ok: true }), 305000);
    res.on('close', () => clearTimeout(finish));
  });
  transportEnv(t, url, { DOCGEN_LLM_TIMEOUT_MS: '1800000', DOCGEN_LLM_IDLE_MS: '600000' });
  assert.deepEqual(await qwen('test', {}), { ok: true });
});

test('stream survives the previous 300-second limit', { skip: process.env.DOCGEN_LONG_STREAM !== '1', timeout: 330000 }, async t => {
  const url = await server(t, (_data, res) => {
    res.write(packet({ done: false, message: { content: '{"ok":true}' } }));
    const heartbeat = setInterval(() => res.write(packet({ done: false, message: { content: '' } })), 1000);
    const finish = setTimeout(() => res.end(packet({ done: true, done_reason: 'stop' })), 305000);
    res.on('close', () => { clearInterval(heartbeat); clearTimeout(finish); });
  });
  transportEnv(t, url, { DOCGEN_LLM_TIMEOUT_MS: '1800000', DOCGEN_LLM_IDLE_MS: '120000' });
  delete process.env.DOCGEN_LLM_TIMEOUT_MS;
  delete process.env.DOCGEN_LLM_IDLE_MS;
  assert.deepEqual(await qwen('test', {}), { ok: true });
});

test('invalid transport settings fail before contacting Ollama', async t => {
  let requests = 0;
  const url = await server(t, (_data, res) => { requests++; reply(res, {}); });
  transportEnv(t, url);
  for (const key of ['DOCGEN_LLM_TIMEOUT_MS', 'DOCGEN_LLM_IDLE_MS', 'DOCGEN_QWEN_NUM_PREDICT']) {
    for (const value of ['0', '-1', '1.5', 'NaN']) {
      await t.test(`${key}=${value}`, async sub => {
        transportEnv(sub, url, { [key]: value });
        await assert.rejects(qwen('test', {}), new RegExp(key));
      });
    }
  }
  assert.equal(requests, 0);
});

test('timer overflow is rejected before a request and the maximum delay is accepted', async t => {
  let requests = 0;
  const url = await server(t, (_data, res) => { requests++; reply(res, { ok: true }); });
  for (const key of ['DOCGEN_LLM_TIMEOUT_MS', 'DOCGEN_LLM_IDLE_MS']) {
    for (const value of ['2147483648', String(Number.MAX_SAFE_INTEGER)]) {
      await t.test(`${key}=${value}`, async sub => {
        transportEnv(sub, url, { [key]: value });
        await assert.rejects(qwen('test', {}), new RegExp(`${key} must not exceed 2147483647ms`));
      });
    }
  }
  assert.equal(requests, 0);
  transportEnv(t, url, { DOCGEN_LLM_TIMEOUT_MS: '2147483647', DOCGEN_LLM_IDLE_MS: '2147483647' });
  assert.deepEqual(await qwen('test', {}), { ok: true });
  assert.equal(requests, 1);
});

test('local protocol completes scan/write/generate without accepting review', async t => {
  const f = fixture(t); const before = snapshot(f.root);
  const url = await server(t, (data, res) => reply(res, data.format.properties.updates ? scanFor(data) : writer(manuscript('12000'))));
  const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url }); assert.equal(r.code, 0, r.out);
  assert.match(fs.readFileSync(path.join(f.root, 'docs/guide/probe.md'), 'utf8'), /12000ms/);
  const accepted = bytes => Object.fromEntries(Object.entries(JSON.parse(bytes).entries).map(([k, v]) => [k, v.accepted]));
  assert.deepEqual(accepted(snapshot(f.root).get('tools/docgen/state/evidence.json')), accepted(before.get('tools/docgen/state/evidence.json')));
  assert.ok(changedFiles(before, snapshot(f.root)).every(p => p.startsWith('.omm/sync-probe/') || p.startsWith('docs/guide/') || p.startsWith('tools/docgen/state/')));
});

test('element prompts isolate code and fields while including only the parent description', async t => {
  const f = makeFixture(1, { splitEvidence: true }); t.after(f.cleanup);
  f.put('.omm/sync-probe/description.md', 'PARENT_DESCRIPTION_ONLY\n');
  f.put('.omm/sync-probe/note.md', 'PARENT_NOTE_NOT_FOR_CHILD\n');
  f.put('.omm/sync-probe/timer/note.md', 'CHILD_NOTE_NOT_FOR_PARENT\n');
  const seen = [];
  const url = await server(t, (data, res) => {
    const allowed = data.format.properties.updates.items.properties.element.enum;
    assert.equal(allowed.length, 1); seen.push(allowed[0]);
    assert.equal(data.format.properties.updates.items.properties.text.minLength, 1);
    const prompt = data.messages.at(-1).content;
    if (allowed[0] === 'sync-probe') {
      assert.ok(prompt.includes('## 파일: ' + probeFile));
      assert.ok(!prompt.includes('## 파일: ' + timerFile));
      assert.ok(!prompt.includes('CHILD_NOTE_NOT_FOR_PARENT'));
    } else {
      assert.ok(prompt.includes('## 파일: ' + timerFile));
      assert.ok(!prompt.includes('## 파일: ' + probeFile));
      assert.ok(prompt.includes('PARENT_DESCRIPTION_ONLY'));
      assert.ok(!prompt.includes('PARENT_NOTE_NOT_FOR_CHILD'));
    }
    reply(res, { updates: [] });
  });
  const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url }, ['--scan-only']);
  assert.equal(r.code, 0, r.out); assert.deepEqual(seen, ['sync-probe', 'sync-probe/timer']);
});

test('scan cache skips unchanged code, selects changed evidence and force rescans all elements', async t => {
  const f = makeFixture(1, { splitEvidence: true }); t.after(f.cleanup);
  const seen = [];
  const url = await server(t, (data, res) => {
    seen.push(data.format.properties.updates.items.properties.element.enum[0]); reply(res, { updates: [] });
  });
  const run = async args => { const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url }, args); assert.equal(r.code, 0, r.out); };
  await run(['--scan-only']); assert.deepEqual(seen, ['sync-probe', 'sync-probe/timer']);
  const cachePath = path.join(f.root, 'tools/docgen/state/scan.json');
  const first = JSON.parse(fs.readFileSync(cachePath));
  for (const entry of Object.values(first.entries)) { assert.match(entry.codeHash, /^[a-f0-9]{16}$/); assert.ok(Number.isFinite(Date.parse(entry.scannedAt))); }
  seen.length = 0;
  const before = snapshot(f.root);
  await run(['--scan-only']); assert.deepEqual(seen, []); assert.deepEqual(changedFiles(before, snapshot(f.root)), []);
  f.put(timerFile, 'package dev.halcamera\nobject Timer { const val OBSERVE_MS = 15000L }\n');
  await run(['--scan-only']); assert.deepEqual(seen, ['sync-probe/timer']);
  const next = JSON.parse(fs.readFileSync(cachePath));
  assert.deepEqual(next.entries['sync-probe'], first.entries['sync-probe']);
  assert.notEqual(next.entries['sync-probe/timer'].codeHash, first.entries['sync-probe/timer'].codeHash);
  seen.length = 0;
  const planned = snapshot(f.root);
  await run(['--scan-only', '--force', '--dry-run']); assert.deepEqual(seen, []); assert.deepEqual(changedFiles(planned, snapshot(f.root)), []);
  await run(['--scan-only', '--force']); assert.deepEqual(seen, ['sync-probe', 'sync-probe/timer']);
});

test('identical updates do not rewrite OMM content or metadata', async t => {
  const f = fixture(t);
  const before = snapshot(f.root);
  const url = await server(t, (data, res) => {
    const element = data.format.properties.updates.items.properties.element.enum[0];
    const text = fs.readFileSync(path.join(f.root, '.omm', element, 'description.md'), 'utf8').replace(/\r?\n/g, '\r\n');
    reply(res, { updates: [{ element, field: 'description', text }] });
  });
  const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url }, ['--scan-only']);
  assert.equal(r.code, 0, r.out);
  assert.ok(changedFiles(before, snapshot(f.root)).every(p => !p.startsWith('.omm/')));
  assert.ok(fs.existsSync(path.join(f.root, 'tools/docgen/state/scan.json')));
});

test('second element failure preserves prior OMM files and scan history', async t => {
  const f = fixture(t); const seen = [];
  f.put('tools/docgen/state/scan.json', JSON.stringify({ schema: 1, entries: {
    'sync-probe': { codeHash: '0000000000000000', scannedAt: '2026-01-01T00:00:00.000Z' },
  } }));
  const url = await server(t, (data, res) => {
    const element = data.format.properties.updates.items.properties.element.enum[0]; seen.push(element);
    if (element === 'sync-probe/timer') res.end(packet({ error: 'failed' }));
    else reply(res, scanFor(data));
  });
  const before = snapshot(f.root);
  const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url }, ['--scan-only']);
  assert.equal(r.code, 1, r.out); assert.deepEqual(seen, ['sync-probe', 'sync-probe/timer']);
  assert.deepEqual(changedFiles(before, snapshot(f.root)), []);
});

test('an element cannot modify its sibling even within the same perspective', async t => {
  const f = fixture(t); const before = snapshot(f.root);
  const url = await server(t, (_data, res) => reply(res, { updates: [{ ...scan.updates[0], element: 'sync-probe/timer' }] }));
  const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url }, ['--scan-only']);
  assert.equal(r.code, 1, r.out); assert.match(r.out, /경로·필드·내용/);
  assert.deepEqual(changedFiles(before, snapshot(f.root)), []);
});

for (const text of ['', ' \n ']) test('empty scan content is rejected without changing files: ' + JSON.stringify(text), async t => {
  const f = fixture(t); const before = snapshot(f.root);
  const url = await server(t, (_data, res) => reply(res, { updates: [{ ...scan.updates[0], text }] }));
  const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url }, ['--scan-only']);
  assert.equal(r.code, 1, r.out); assert.match(r.out, /sync-probe: 구조 스캔이 1회 시도 후에도 검증을 통과하지 못했습니다: 경로·필드·내용이 유효하지 않습니다/);
  assert.deepEqual(changedFiles(before, snapshot(f.root)), []);
});

test('writer selects cited files and exact must_link filenames, retaining OMM context', async t => {
  const f = makeFixture(1, { splitEvidence: true }); t.after(f.cleanup);
  f.put('app/src/main/java/dev/halcamera/Unrelated.kt', 'UNRELATED_CODE_SENTINEL');
  const bindingFile = path.join(f.root, 'docs/guide/_bindings.yaml');
  f.put('docs/guide/_bindings.yaml', fs.readFileSync(bindingFile, 'utf8')
    .replace('        brief:', '        brief:\n          must_link: [Timer, ProbeMissing]'));
  const url = await server(t, (data, res) => {
    const prompt = data.messages.at(-1).content;
    assert.match(prompt, /## 근거: .omm\/sync-probe/);
    assert.match(prompt, /Probe.OBSERVE_MS는 관측 시간을 10000ms로 지정/);
    assert.ok(prompt.includes('## 파일: ' + probeFile));
    assert.ok(prompt.includes('## 파일: ' + timerFile));
    assert.ok(!prompt.includes('UNRELATED_CODE_SENTINEL'));
    assert.equal(prompt.split('## 파일: ' + probeFile).length, 2);
    // must_link 심볼은 본문에 그대로 있어야 받아들입니다.
    reply(res, writer(manuscript('12000').replace('Probe.OBSERVE_MS는 관측 시간을', 'Timer.OBSERVE_MS와 ProbeMissing 값은 관측 시간을')));
  });
  const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url }, ['--write-only']);
  assert.equal(r.code, 0, r.out);
});

test('uncited perspective changes reach the writer through refreshed OMM context', async t => {
  const f = makeFixture(1, { splitEvidence: true }); t.after(f.cleanup);
  f.put(timerFile, 'object Timer { const val OBSERVE_MS = 15000L }');
  let written = false;
  const url = await server(t, (data, res) => {
    if (data.format.properties.updates) {
      const element = data.format.properties.updates.items.properties.element.enum[0];
      return reply(res, { updates: [{ element, field: 'description', text: element.endsWith('/timer') ?
        'Timer.OBSERVE_MS는 15000ms입니다.' : 'Probe.OBSERVE_MS는 12000ms입니다.' }] });
    }
    const prompt = data.messages.at(-1).content;
    assert.match(prompt, /Timer.OBSERVE_MS는 15000ms입니다/);
    assert.ok(!prompt.includes('## 파일: ' + timerFile));
    written = true; reply(res, writer(manuscript('12000')));
  });
  const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url });
  assert.equal(r.code, 0, r.out); assert.equal(written, true);
});

test('writer rejects empty evidence before contacting the model and preserves files', async t => {
  const f = fixture(t);
  f.put('docs/guide/_content/probe/overview-0.md', manuscript('10000').replace('  - ' + probeFile + '#Probe.OBSERVE_MS', ''));
  const before = snapshot(f.root);
  let requests = 0;
  const url = await server(t, (_data, res) => { requests++; reply(res, {}); });
  const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url }, ['--write-only']);
  assert.notEqual(r.code, 0); assert.match(r.out, /docflow brief probe.md overview-0/);
  assert.equal(requests, 0); assert.deepEqual(changedFiles(before, snapshot(f.root)), []);
});

for (const eol of ['\n', '\r\n']) test(`large writer preserves all LF-normalized code for ${JSON.stringify(eol)} checkouts`, async t => {
  const f = fixture(t);
  const source = '/*' + '한국어-0123456789 '.repeat(6000) + '*/\nobject Probe { const val OBSERVE_MS = 12000L }\n';
  f.put(probeFile, source.replace(/\n/g, eol));
  const slices = []; let writes = 0;
  const url = await server(t, (data, res) => {
    const prompt = data.messages.at(-1).content;
    assert.ok(prompt.length <= 60000);
    if (data.format.properties.summary) {
      const match = prompt.match(/\[문자 (\d+):(\d+)\/(\d+)\]\n([\s\S]*)\n$/);
      assert.ok(match); assert.equal(Number(match[3]), source.length);
      assert.ok(match[4] === source.slice(Number(match[1]), Number(match[2])), `slice ${match[1]}:${match[2]} has ${match[4].length} chars, head ${JSON.stringify(match[4].slice(0, 10))}, tail ${JSON.stringify(match[4].slice(-20))}`);
      slices.push(match[4]);
      reply(res, { summary: 'Probe.OBSERVE_MS는 12000ms입니다.' });
    } else {
      writes++;
      assert.match(prompt, /## 근거: .omm\/sync-probe/);
      assert.match(prompt, /## 코드 근거 요약/);
      assert.match(prompt, /## 현재 원고/);
      reply(res, writer(manuscript('12000')));
    }
  });
  const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url }, ['--write-only']);
  assert.equal(r.code, 0, r.out); assert.equal(writes, 1);
  assert.ok(slices.length > 1); assert.equal(slices.join(''), source);
});

for (const summary of ['', 'x'.repeat(4001)]) test(`invalid evidence summary preserves the original: ${summary.length} chars`, async t => {
  const f = fixture(t); f.put(probeFile, '/*' + 'x'.repeat(70000) + '*/');
  const before = snapshot(f.root);
  let requests = 0;
  const url = await server(t, (_data, res) => { requests++; reply(res, { summary }); });
  const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url }, ['--write-only']);
  assert.notEqual(r.code, 0); assert.match(r.out, /요약이 비어 있거나/);
  assert.equal(requests, summary.length ? 2 : 1);
  assert.deepEqual(changedFiles(before, snapshot(f.root)), []);
});

test('oversized evidence is retried once from the same code and only valid notes reach the writer', async t => {
  const f = fixture(t); f.put(probeFile, '/*' + 'x'.repeat(70000) + '*/');
  let firstPrompt; let summaries = 0; let writes = 0;
  const invalid = 'INVALID'.repeat(600);
  const url = await server(t, (data, res) => {
    const prompt = data.messages.at(-1).content;
    assert.ok(prompt.length <= 60000);
    assert.ok(!prompt.includes(invalid));
    if (data.format.properties.summary) {
      summaries++;
      if (summaries === 1) { firstPrompt = prompt; return reply(res, { summary: invalid }); }
      if (summaries === 2) {
        assert.ok(prompt.startsWith(firstPrompt));
        assert.match(prompt, /길이 초과 재시도/);
        assert.match(prompt, /1000자 이하/);
      }
      return reply(res, { summary: 'Probe의 코드 근거입니다.' });
    }
    writes++; assert.match(prompt, /Probe의 코드 근거입니다/);
    reply(res, writer(manuscript('12000')));
  });
  const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url }, ['--write-only']);
  assert.equal(r.code, 0, r.out); assert.equal(summaries, 3); assert.equal(writes, 1);
});

test('summarized writer still rejects citations outside the selected evidence', async t => {
  const f = fixture(t); f.put(probeFile, '/*' + 'x'.repeat(70000) + '*/');
  const before = snapshot(f.root);
  const url = await server(t, (data, res) => reply(res, data.format.properties.summary ?
    { summary: 'Probe의 코드 근거입니다.' } : writer(manuscript('12000').replace(probeFile, 'missing.kt'))));
  const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url }, ['--write-only']);
  assert.notEqual(r.code, 0); assert.match(r.out, /원고 반려 1\/1: 코드 근거 인용/);
  assert.deepEqual(changedFiles(before, snapshot(f.root)), []);
});

test('write-only never calls the scanner or records a scan', async t => {
  const f = fixture(t); const before = snapshot(f.root);
  const url = await server(t, (data, res) => {
    assert.ok(!data.format.properties.updates); reply(res, writer(manuscript('12000')));
  });
  const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url }, ['--write-only']);
  assert.equal(r.code, 0, r.out);
  assert.ok(changedFiles(before, snapshot(f.root)).every(p => !p.startsWith('.omm/') && !p.endsWith('/scan.json')));
});

for (const scenario of ['http', 'timeout', 'idle', 'json', 'truncated', 'incomplete', 'stream-error', 'path', 'validation', 'writer-empty', 'writer-source', 'second-writer', 'marker']) {
  test(`${scenario} failure preserves every original byte`, async t => {
    const f = fixture(t, 2); let writes = 0;
    if (scenario === 'marker') f.put('docs/guide/probe.md', '<!-- omm:begin id=status -->\n');
    const before = snapshot(f.root);
    const url = await server(t, (data, res) => {
      if (scenario === 'timeout') return;
      if (scenario === 'idle') return res.write(packet({ done: false, message: { content: '{' } }));
      if (scenario === 'http') { res.statusCode = 503; return res.end(); }
      if (scenario === 'json') return res.end('{bad');
      if (scenario === 'incomplete') return res.end(packet({ done: false, message: { content: JSON.stringify(scan) } }));
      if (scenario === 'stream-error') return res.end(packet({ error: 'model failed' }));
      if (scenario === 'truncated') return reply(res, scan, { done_reason: 'length' });
      if (data.format.properties.updates) {
        if (scenario === 'path') return reply(res, { updates: [{ ...scan.updates[0], element: '../app' }] });
        if (scenario === 'validation') return reply(res, { updates: [{ ...scan.updates[0], field: 'diagram', text: 'broken diagram [' }] });
        return reply(res, scanFor(data));
      }
      writes++;
      if (scenario === 'writer-empty' || (scenario === 'second-writer' && writes === 2)) return reply(res, writer(''));
      return reply(res, writer(scenario === 'writer-source' ? manuscript('12000').replace(probeFile, 'missing.kt') : manuscript('12000')));
    });
    const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url, DOCGEN_LLM_TIMEOUT_MS: scenario === 'timeout' ? '100' : '30000', DOCGEN_LLM_IDLE_MS: '1000' });
    assert.equal(r.code, 1, r.out); assert.deepEqual(changedFiles(before, snapshot(f.root)), [], r.out);
    if (scenario === 'idle') assert.match(r.out, /유휴 시간 제한 초과/);
    if (scenario === 'timeout') assert.match(r.out, /전체 시간 제한 초과/);
    if (scenario === 'second-writer') assert.equal(writes, 2);
  });
}

test('concurrent original edit prevents publication and preserves user text', async t => {
  const f = fixture(t); const before = snapshot(f.root);
  const url = await server(t, (data, res) => {
    f.put(probeFile, '// user edit\n');
    reply(res, data.format.properties.updates ? scanFor(data) : writer(manuscript('12000')));
  });
  const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url }); assert.equal(r.code, 1, r.out);
  assert.deepEqual(changedFiles(before, snapshot(f.root)), [probeFile]);
});

test('publish write failure rolls back already written files', t => {
  const f = fixture(t); const before = snapshot(f.root); const after = new Map(before);
  after.set('.omm/sync-probe/description.md', Buffer.from('new')); after.set('docs/guide/new.md', Buffer.from('new'));
  const allowed = p => p.startsWith('.omm/') || p.startsWith('docs/guide/');
  const journal = prepareCommit(f.root, before, after, allowed); let count = 0;
  assert.throws(() => applyCommit(f.root, journal, allowed, (...args) => { if (++count === 2) throw new Error('disk'); writeBytes(...args); }), /disk/);
  assert.deepEqual(changedFiles(before, snapshot(f.root)), []);
});

test('interrupted publish can recover; newer edits block recovery before any writes', t => {
  const f = fixture(t); const before = snapshot(f.root); const after = new Map(before);
  after.set('.omm/sync-probe/description.md', Buffer.from('new')); after.set('docs/guide/new.md', Buffer.from('new'));
  const allowed = p => p.startsWith('.omm/') || p.startsWith('docs/guide/');
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
  const scanPath = 'tools/docgen/state/scan.json';
  const scanBytes = Buffer.from(JSON.stringify({ schema: 1, entries: { 'sync-probe': { codeHash: '0123456789abcdef', scannedAt: '2026-01-01T00:00:00.000Z' } } }));
  after.set(scanPath, scanBytes);
  prepareCommit(f.root, before, after, p => p === target || p === scanPath);
  writeBytes(f.root, target, Buffer.from('new'));
  writeBytes(f.root, scanPath, scanBytes);
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

test('real installed Qwen completes the same pipeline', { skip: process.env.DOCGEN_REAL_QWEN !== '1', timeout: 5460000 }, async t => {
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

test('real installed Qwen writes one manuscript without scanning', { skip: process.env.DOCGEN_REAL_QWEN !== '1', timeout: 1860000 }, async t => {
  const f = fixture(t); const before = snapshot(f.root);
  const r = await runSync(f.root, {}, ['--write-only']);
  console.log(r.out); assert.equal(r.code, 0, r.out);
  assert.ok(changedFiles(before, snapshot(f.root)).every(p => !p.startsWith('.omm/')));
  const page = fs.readFileSync(path.join(f.root, 'docs/guide/probe.md'), 'utf8');
  assert.match(page, /12000|12,000|12\s*초/); assert.doesNotMatch(page, /10000|10,000|10\s*초/);
});
