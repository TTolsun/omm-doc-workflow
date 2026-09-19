// 모델 응답 반려·재요청 검사. 구조 스캔은 요소 단위로, 원고는 질문별 답변과 인용 파일을 받아 프로그램이 조립하는 계약입니다.
process.env.DOCFLOW_STATE_REL = 'tools/docgen/state';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { makeFixture, runSync, probeFile } from './helper.mjs';
import { snapshot, changedFiles } from '../src/transaction.mjs';
import { ommCli } from '../src/omm-cli.mjs';

async function server(t, handler) {
  const service = http.createServer(async (req, res) => {
    req.setEncoding('utf8');
    let text = ''; for await (const chunk of req) text += chunk;
    const data = JSON.parse(text);
    assert.equal(data.model, 'qwen3.5:4b'); assert.equal(data.stream, true);
    try { handler(data, res); }
    catch (error) { res.writeHead(500).end(); throw error; }
  });
  await new Promise(r => service.listen(0, '127.0.0.1', r));
  t.after(() => { service.closeAllConnections(); service.close(); });
  return `http://127.0.0.1:${service.address().port}`;
}
const packet = data => JSON.stringify(data) + '\n';
const reply = (res, content) => {
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.write(packet({ done: false, message: { content: JSON.stringify(content) } }));
  res.end(packet({ done: true, done_reason: 'stop', eval_count: 42, message: { content: '' } }));
};
const isScan = data => Boolean(data.format.properties.updates);
const elementOf = data => data.format.properties.updates.items.properties.element.enum[0];
const scanFor = data => ({ updates: [{ element: elementOf(data), field: 'description', text: 'Probe.OBSERVE_MS는 12000ms입니다.' }] });
// 조립 계약: 질문별 답변과 인용 파일만 보냅니다. 본문은 기존 원고의 본문을 그대로 씁니다.
const writer = body => ({ sections: { answer_1: body }, sources: [probeFile + '#Probe.OBSERVE_MS'] });
const good = 'Probe.OBSERVE_MS는 관측 시간을 12000ms로 지정합니다.';
const attempts = { DOCFLOW_SCAN_ATTEMPTS: '3', DOCFLOW_WRITER_ATTEMPTS: '3' };
function fixture(t, n = 1) { const f = makeFixture(n); t.after(f.cleanup); return f; }
// 조립된 원고는 front matter 를 JSON 값으로 쓰므로 본문과 인용 파일만 비교합니다.
const assertContent = f => {
  const text = fs.readFileSync(path.join(f.root, 'docs/guide/_content/probe/overview-0.md'), 'utf8');
  const [, meta, body] = text.match(/^---\n([^]*?)\n---\n([^]*)$/);
  assert.match(meta, /confidence: "code"/); assert.match(meta, new RegExp(probeFile + '#Probe.OBSERVE_MS'));
  assert.equal(body, good + '\n');
};

test('scan rejection restores the element, feeds the validation error back and applies the corrected updates', async t => {
  const f = fixture(t); const prompts = [];
  const diagramBefore = fs.readFileSync(path.join(f.root, '.omm/sync-probe/diagram.mmd'), 'utf8');
  const url = await server(t, (data, res) => {
    if (!isScan(data)) return reply(res, writer(good));
    if (elementOf(data) !== 'sync-probe') return reply(res, scanFor(data));
    prompts.push(data.messages.at(-1).content);
    // 첫 응답은 설명과 함께 방향 선언이 없는 diagram 을 보내고, 두 번째 응답은 설명만 고치되 요소를 파일 경로로 적습니다.
    if (prompts.length === 1) return reply(res, { updates: [...scanFor(data).updates, { element: 'sync-probe', field: 'diagram', text: 'timer["관측 시간"] --> done\n' }] });
    reply(res, { updates: [{ ...scanFor(data).updates[0], element: '.omm/sync-probe/description.md' }] });
  });
  const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url, ...attempts }); assert.equal(r.code, 0, r.out);
  assert.equal(prompts.length, 2);
  assert.doesNotMatch(prompts[0], /반려 사유/); assert.match(prompts[1], /## 이전 응답 반려 사유[^]*graph-declaration/);
  assert.match(r.out, /구조 반려 1\/3: .*graph-declaration/);
  assert.equal(fs.readFileSync(path.join(f.root, '.omm/sync-probe/diagram.mmd'), 'utf8'), diagramBefore);
  assert.match(fs.readFileSync(path.join(f.root, '.omm/sync-probe/description.md'), 'utf8'), /12000ms/);
});

test('scan rejection stops after the configured attempts without writing', async t => {
  const f = fixture(t); const before = snapshot(f.root); let scans = 0;
  const answers = [
    { updates: [{ element: '../app', field: 'description', text: 'x' }] },
    { updates: [null] },
    // 파일 이름(diagram)과 field(description)가 다른 필드를 가리키면 어느 쪽인지 알 수 없으므로 반려합니다.
    { updates: [{ element: 'sync-probe/diagram.mmd', field: 'description', text: 'x' }] },
    { updates: [{ element: 'sync-probe', field: 'diagram', text: 'broken diagram [' }] },
  ];
  const url = await server(t, (data, res) => {
    if (!isScan(data)) return reply(res, writer(good));
    reply(res, answers[scans++]);
  });
  const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url, DOCFLOW_SCAN_ATTEMPTS: '4' });
  assert.equal(r.code, 1, r.out); assert.equal(scans, 4);
  assert.match(r.out, /구조 반려 1\/4: 경로·필드·내용이 유효하지 않습니다/); assert.match(r.out, /구조 반려 2\/4: updates 항목이 객체가 아닙니다/);
  assert.match(r.out, /구조 반려 3\/4: element 의 파일 이름\(diagram\)과 field\(description\)/);
  assert.match(r.out, /sync-probe: 구조 스캔이 4회 시도 후에도 검증을 통과하지 못했습니다: error \[/);
  assert.deepEqual(changedFiles(before, snapshot(f.root)), [], r.out);
});

test('an OMM CLI failure during validate is not retried as a model rejection', async t => {
  const f = fixture(t); let scans = 0;
  // 검증 단계에서만 시간 초과를 흉내 냅니다. write 는 정상 CLI, validate 는 끝나지 않는 스크립트입니다.
  f.put('tools/slow-omm.mjs', `import { spawnSync } from 'node:child_process';
if (process.argv[2] === 'validate') { setInterval(() => {}, 1000); }
else { const r = spawnSync(process.execPath, [process.env.REAL_OMM_CLI, ...process.argv.slice(2)], { stdio: 'inherit' }); process.exit(r.status ?? 1); }
`);
  const before = snapshot(f.root);
  const url = await server(t, (data, res) => { if (isScan(data)) { scans++; return reply(res, scanFor(data)); } reply(res, writer(good)); });
  const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url, REAL_OMM_CLI: ommCli(), DOCGEN_OMM_CLI: path.join(f.root, 'tools/slow-omm.mjs'), DOCGEN_OMM_TIMEOUT_MS: '500', ...attempts });
  assert.equal(r.code, 1, r.out); assert.equal(scans, 1, r.out);
  assert.doesNotMatch(r.out, /구조 반려/); assert.match(r.out, /omm validate 실패/);
  assert.deepEqual(changedFiles(before, snapshot(f.root)), [], r.out);
});

// 계약은 지켰지만 본문이 조사 띄어쓰기, 비합니다체, 대화체 안내문을 담은 답변입니다.
const chatty = 'Probe.OBSERVE_MS 는 관측 시간을 12000ms 로 지정한다.\n\n다음 단계로 넘어가거나 추가 검토를 요구할 수 있다.';

test('writer rejection feeds the violated rules back and accepts the corrected answer', async t => {
  const f = fixture(t); const prompts = [];
  const url = await server(t, (data, res) => {
    if (isScan(data)) return reply(res, scanFor(data));
    prompts.push(data.messages.at(-1).content);
    return reply(res, writer(prompts.length === 1 ? chatty : good));
  });
  const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url, ...attempts }); assert.equal(r.code, 0, r.out);
  assert.equal(prompts.length, 2);
  assert.doesNotMatch(prompts[0], /반려 사유/);
  // 조사 띄어쓰기는 반려 대신 정리하므로 반려 사유에 나오지 않습니다.
  assert.match(prompts[1], /## 이전 응답 반려 사유[^]*\[종결어미\][^]*\[대화체·작업 보고\]/);
  assert.doesNotMatch(prompts[1], /\[조사 띄어쓰기\]/);
  assert.match(r.out, /원고 정리: 조사 띄어쓰기 2곳/);
  assert.match(r.out, /원고 반려 1\/3: 종결어미, 대화체·작업 보고/);
  assertContent(f);
});

test('a malformed answer is a rejection, not a crash', async t => {
  const f = fixture(t); let writes = 0;
  const url = await server(t, (data, res) => {
    if (isScan(data)) return reply(res, scanFor(data));
    writes++;
    // 답변 누락, front matter 흉내, 인용 파일 형식 오류는 조립 단계에서 걸러 반려 사유가 됩니다.
    if (writes === 1) return reply(res, { sections: {}, sources: [] });
    if (writes === 2) return reply(res, writer('---\nconfidence: device\n---\n' + good));
    reply(res, writer(good));
  });
  const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url, ...attempts }); assert.equal(r.code, 0, r.out);
  assert.equal(writes, 3);
  assert.match(r.out, /원고 반려 1\/3: 응답 형식/); assert.match(r.out, /원고 반려 2\/3: 응답 형식/);
  assertContent(f);
});

test('rejection text is shortened when the full list would exceed the prompt limit', async t => {
  const f = fixture(t); const prompts = [];
  // 위반 줄 10개를 인용하면 목록이 한도를 넘고, 규칙별 한 줄 요약은 들어갑니다. 한도는 기준 프롬프트(약 15,100자)에 맞춰 잡습니다.
  const noisy = Array.from({ length: 10 }, (_, i) => `Probe.OBSERVE_MS는 ${i}번째 문장에서 관측 시간을 12000ms로 지정하며 이 문장은 일부러 길게 써서 반려 목록을 키운다.`).join('\n');
  const url = await server(t, (data, res) => {
    if (isScan(data)) return reply(res, scanFor(data));
    prompts.push(data.messages.at(-1).content);
    reply(res, writer(prompts.length === 1 ? noisy : good));
  });
  const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url, DOCGEN_MAX_PROMPT_CHARS: '17000', ...attempts }); assert.equal(r.code, 0, r.out);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /## 이전 응답 반려 사유[^]*\[종결어미\] 모든 문장은/);
  assert.doesNotMatch(prompts[1], /행: /);
  assert.ok(prompts[1].length <= 17000 - 1000, `prompt ${prompts[1].length}`);
});

test('particle spacing alone is normalized and the answer is accepted on the first attempt', async t => {
  const f = fixture(t); let writes = 0;
  const url = await server(t, (data, res) => { if (isScan(data)) return reply(res, scanFor(data)); writes++; reply(res, writer('Probe.OBSERVE_MS 는 관측 시간을 12000ms 로 지정합니다.')); });
  const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url, ...attempts }); assert.equal(r.code, 0, r.out);
  assert.equal(writes, 1); assert.doesNotMatch(r.out, /원고 반려/);
  assertContent(f);
});

test('writer rejection stops after the configured attempts without writing', async t => {
  const f = fixture(t); let writes = 0;
  // 바인딩의 must_link 심볼이 본문에 그대로 없으면 계약 위반입니다.
  f.put('docs/guide/_bindings.yaml', fs.readFileSync(path.join(f.root, 'docs/guide/_bindings.yaml'), 'utf8').replace('brief:\n', 'brief:\n          must_link: [Probe.OBSERVE_MS]\n'));
  const before = snapshot(f.root);
  const url = await server(t, (data, res) => {
    if (isScan(data)) return reply(res, scanFor(data));
    writes++;
    if (writes === 1) return reply(res, { sections: { answer_1: '' }, sources: [probeFile] });
    if (writes === 2) return reply(res, writer(good.replace('Probe.OBSERVE_MS는 관측', 'Probe.OBSERVE MS는 관측')));
    reply(res, writer(chatty));
  });
  const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url, DOCFLOW_WRITER_ATTEMPTS: '3' });
  assert.equal(r.code, 1, r.out); assert.equal(writes, 3);
  assert.match(r.out, /원고 반려 1\/3: 응답 형식/); assert.match(r.out, /원고 반려 2\/3: 필수 심볼/);
  assert.match(r.out, /3회 시도 후에도 집필 규칙을 통과하지 못했습니다: 종결어미/);
  assert.deepEqual(changedFiles(before, snapshot(f.root)), [], r.out);
});

test('an answer that hits the length cap is rejected as truncated and the retry may be shorter', async t => {
  const f = fixture(t); const prompts = [];
  f.put('docs/guide/_bindings.yaml', fs.readFileSync(path.join(f.root, 'docs/guide/_bindings.yaml'), 'utf8').replace('brief:\n', 'brief:\n          must_link: [Probe.OBSERVE_MS]\n'));
  const url = await server(t, (data, res) => {
    if (isScan(data)) return reply(res, scanFor(data));
    prompts.push(data.messages.at(-1).content);
    assert.equal(data.format.properties.sections.properties.answer_1.maxLength, 300);
    // 첫 답변은 상한을 꽉 채운 채 필수 심볼 없이 끝나고(스키마가 끊은 모양), 두 번째는 짧고 심볼을 포함합니다.
    reply(res, writer(prompts.length === 1 ? '관측 시간은 12000ms입니다. '.repeat(40).slice(0, 300) : good));
  });
  const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url, DOCGEN_MAX_ANSWER_CHARS: '300', ...attempts }); assert.equal(r.code, 0, r.out);
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /필수 심볼 `Probe\.OBSERVE_MS`은\(는\) 본문에 코드에 적힌 그대로/);
  assert.match(r.out, /원고 반려 1\/3: 응답 형식/);
  assert.match(prompts[1], /300자 상한에 닿아 잘렸습니다\(answer_1\)/);
  assertContent(f);
});

// Ollama 가 출력 토큰 한도(num_predict)에 닿으면 done_reason 이 length 입니다. 스트림 형태는 같고 마지막 패킷만 다릅니다.
const replyLength = (res, content) => {
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.write(packet({ done: false, message: { content: JSON.stringify(content).slice(0, -2) } }));
  res.end(packet({ done: true, done_reason: 'length', eval_count: 8192, message: { content: '' } }));
};

test('a length stop in an evidence summary is retried once with the shorter instruction and a bounded num_predict', async t => {
  const f = fixture(t); f.put(probeFile, '/*' + 'x'.repeat(70000) + '*/');
  const calls = [];
  const url = await server(t, (data, res) => {
    if (isScan(data)) return reply(res, scanFor(data));
    if (data.format.properties.summary) {
      calls.push({ predict: data.options.num_predict, retry: /길이 초과 재시도/.test(data.messages.at(-1).content) });
      // 첫 조각의 첫 응답만 한도에 닿아 끊기고, 재시도와 나머지 조각은 정상입니다.
      if (calls.length === 1) return replyLength(res, { summary: 'Probe의 코드 근거입니다. '.repeat(50) });
      return reply(res, { summary: 'Probe의 코드 근거입니다.' });
    }
    reply(res, writer(good));
  });
  const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url }, ['--write-only']); assert.equal(r.code, 0, r.out);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(c => c.retry), [false, true, false]);
  assert.ok(calls.every(c => c.predict > 0 && c.predict < 8192), JSON.stringify(calls));
  assert.match(r.out, /근거 1 길이 초과 재시도 1\/1/);
  assertContent(f);
});

test('a length stop in the writer and in a scan becomes a rejection instead of a failure', async t => {
  const f = fixture(t); let scans = 0, writes = 0;
  const url = await server(t, (data, res) => {
    if (isScan(data)) { scans++; return scans === 1 ? replyLength(res, scanFor(data)) : reply(res, scanFor(data)); }
    writes++;
    return writes === 1 ? replyLength(res, writer(good)) : reply(res, writer(good));
  });
  const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url, ...attempts }); assert.equal(r.code, 0, r.out);
  assert.match(r.out, /구조 반려 1\/3: Qwen 응답이 완성되지 않았습니다 \(length\)/);
  assert.match(r.out, /원고 반려 1\/3: 응답 형식/);
  assert.equal(writes, 2);
  assertContent(f);
});
