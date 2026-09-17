process.env.DOCFLOW_STATE_REL = 'tools/docgen/state';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeFixture, manuscript, runSync, probeFile } from './helper.mjs';
import { snapshot, changedFiles } from '../src/transaction.mjs';
import { checkDiagram, formatDiagramIssues, diagramTypeOf, DIAGRAM_TYPES } from '../src/diagram.mjs';

const errors = (text, type, context) => checkDiagram(text, type, context).filter(x => x.level === 'error').map(x => x.rule);
const sequence = 'sequenceDiagram\n    participant Caller\n    participant Probe\n    Caller->>Probe: OBSERVE_MS 조회\n    alt 값이 있음\n        Probe-->>Caller: 12000\n    else\n        Probe-->>Caller: 없음\n    end\n';

test('diagram checker accepts each supported type and rejects a wrong declaration', () => {
  assert.deepEqual(errors('graph LR\n  a["시작"] -->|조건| b["끝"]', 'flow'), []);
  assert.deepEqual(errors('flowchart TD\n  a --> b', 'component'), []);
  assert.deepEqual(errors(sequence, 'sequence'), []);
  assert.deepEqual(errors('classDiagram\n    class Probe {\n        +OBSERVE_MS Long\n    }\n    class Timer\n    Timer ..> Probe : OBSERVE_MS 읽음', 'class'), []);
  assert.deepEqual(errors('stateDiagram-v2\n    [*] --> Idle\n    Idle --> Observing : start()\n    Observing --> Idle : OBSERVE_MS 경과\n    Idle --> [*]', 'state'), []);
  // 종류가 다른 선언은 첫 규칙에서 걸립니다. 반려 사유의 첫 줄이 되므로 규칙 이름이 고정되어야 합니다.
  assert.equal(errors('graph LR\n  a --> b', 'sequence')[0], 'diagram-type');
  assert.equal(errors('classDiagram\n  class A', 'flow')[0], 'diagram-type');
  assert.equal(errors('', 'state')[0], 'diagram-type');
  for (const type of Object.keys(DIAGRAM_TYPES)) assert.match(formatDiagramIssues('x', checkDiagram('', type)), /^x:\n {2}✗ invalid \(\d+ errors?\)\n {2}error \[diagram-type\] line 1:/);
});

test('diagram checker applies type-specific rules and keeps warnings from failing', () => {
  assert.deepEqual(errors('sequenceDiagram\n    A->>B\n    bogus line', 'sequence'), ['sequence-message', 'sequence-line']);
  assert.deepEqual(errors('sequenceDiagram\n    participant A', 'sequence'), ['sequence-message']);
  assert.deepEqual(errors('classDiagram\n    nothing here', 'class'), ['class-line', 'class-declaration']);
  assert.deepEqual(errors('classDiagram\n    class A {\n        +x()', 'class'), ['balanced-brackets']);
  // namespace 안의 class 선언도 선언으로 세고, 홀수 따옴표가 있는 줄이 뒤 줄의 중괄호 집계를 망치지 않습니다.
  assert.deepEqual(errors('classDiagram\n    namespace demo_hal {\n        class A {\n            +x() bool\n        }\n        class B\n    }\n    A ..> B : uses', 'class'), []);
  assert.deepEqual(errors('classDiagram\n    note "odd \\"quote"\n    class A {\n        +x() bool\n    }', 'class'), []);
  assert.deepEqual(errors('stateDiagram-v2\n    Idle --> Busy\n    weird', 'state'), ['state-line']);
  assert.deepEqual(errors('stateDiagram-v2\n    state Group {\n    Idle --> Busy : go\n    }\n    note right of Idle\n      설명\n    end note', 'state'), []);
  assert.deepEqual(errors('stateDiagram-v2\n    note right of Idle\n      설명', 'state'), ['state-line', 'state-transition']);
  const warnings = checkDiagram('stateDiagram-v2\n    [*] --> Idle\n    Idle --> Busy', 'state').filter(x => x.level === 'warning');
  assert.deepEqual(warnings.map(x => x.line), [3]);
  assert.deepEqual(errors('sequenceDiagram\n    A->>B: @other 참조', 'sequence', { element: 'me', perspectives: ['me', 'other'] }), []);
  assert.deepEqual(errors('sequenceDiagram\n    A->>B: @me @missing', 'sequence', { element: 'me', perspectives: ['me'] }), ['ref-self', 'ref-exists']);
  assert.equal(diagramTypeOf({ kind: 'omm' }), 'flow');
  assert.throws(() => diagramTypeOf({ kind: 'omm', diagram_type: 'uml' }), /diagram_type 은 flow, component, class, sequence, state/);
});

// 기존 fixture 에 sequence 관점을 하나 더 붙입니다. 기존 관점은 diagram_type 없이 flow 로 동작해야 합니다.
function withSequenceSource(f, diagram) {
  const bindings = fs.readFileSync(path.join(f.root, 'docs/guide/_bindings.yaml'), 'utf8')
    .replace('pages:\n', `  lifecycle:\n    kind: omm\n    diagram_type: sequence\n    evidence:\n      - ${probeFile}\npages:\n`)
    + '      - id: lifecycle-diagram\n        kind: omm\n        source: lifecycle\n        field: diagram\n        confidence: code\n';
  f.put('docs/guide/_bindings.yaml', bindings);
  f.put('docs/guide/probe.md', fs.readFileSync(path.join(f.root, 'docs/guide/probe.md'), 'utf8') + '\n<!-- omm:begin id=lifecycle-diagram -->\n<!-- omm:end id=lifecycle-diagram -->\n');
  f.put('.omm/lifecycle/description.md', 'Probe.OBSERVE_MS 를 읽는 순서입니다.\n');
  f.put('.omm/lifecycle/diagram.mmd', diagram);
}
async function server(t, handler) {
  const service = http.createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    handler(JSON.parse(text), res);
  });
  await new Promise(r => service.listen(0, '127.0.0.1', r));
  t.after(() => { service.closeAllConnections(); service.close(); });
  return `http://127.0.0.1:${service.address().port}`;
}
const reply = (res, content) => res.end(JSON.stringify({ done: true, done_reason: 'stop', message: { content: JSON.stringify(content) } }));

test('sync validates a sequence perspective with the type rules, rejects a graph answer and accepts the corrected diagram', async t => {
  const f = makeFixture(); t.after(f.cleanup);
  withSequenceSource(f, 'graph LR\n  a["옛 그림"]\n');
  const prompts = [];
  const url = await server(t, (data, res) => {
    const prompt = data.messages.at(-1).content;
    if (!data.format.properties.updates) return reply(res, { markdown: manuscript('12000') });
    if (!prompt.startsWith('구조 스캔: lifecycle')) return reply(res, { updates: [{ element: 'sync-probe', field: 'description', text: 'Probe.OBSERVE_MS는 12000ms입니다.' }] });
    prompts.push(prompt);
    // 첫 응답은 기존 종류(graph)로 다시 그리고, 두 번째 응답은 요구한 sequence 로 그립니다.
    if (prompts.length === 1) return reply(res, { updates: [{ element: 'lifecycle', field: 'diagram', text: 'graph LR\n  a["새 그림"] -->|조건| b["끝"]\n' }] });
    reply(res, { updates: [{ element: 'lifecycle', field: 'diagram', text: sequence }] });
  });
  const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: url }); assert.equal(r.code, 0, r.out);
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /diagram 필드는 첫 줄이 "sequenceDiagram" 인 시퀀스 다이어그램/);
  assert.match(prompts[1], /## 이전 응답 반려 사유[^]*diagram-type/);
  assert.match(r.out, /- lifecycle \(diagram_type: sequence\)/);
  assert.match(r.out, /구조 반려 1\/3: error \[diagram-type\]/);
  assert.equal(fs.readFileSync(path.join(f.root, '.omm/lifecycle/diagram.mmd'), 'utf8'), sequence);
  assert.match(fs.readFileSync(path.join(f.root, 'docs/guide/probe.md'), 'utf8'), /```mermaid\nsequenceDiagram\n/);
});

test('generate refuses a diagram whose declaration does not match diagram_type and rejects unknown types', t => {
  const f = makeFixture(); t.after(f.cleanup);
  withSequenceSource(f, 'graph LR\n  a["옛 그림"]\n');
  const before = snapshot(f.root);
  const generate = () => spawnSync(process.execPath, [path.join(f.root, 'tools/docgen/generate.mjs')], { cwd: f.root, encoding: 'utf8' });
  let r = generate();
  assert.equal(r.status, 1); assert.match(r.stderr, /\.omm\/lifecycle\/diagram \(diagram_type: sequence\): diagram 은 "sequenceDiagram" 로 시작해야 합니다/);
  assert.deepEqual(changedFiles(before, snapshot(f.root)), []);
  f.put('.omm/lifecycle/diagram.mmd', sequence);
  r = generate(); assert.equal(r.status, 0, r.stderr);
  f.put('docs/guide/_bindings.yaml', fs.readFileSync(path.join(f.root, 'docs/guide/_bindings.yaml'), 'utf8').replace('diagram_type: sequence', 'diagram_type: uml'));
  r = generate(); assert.equal(r.status, 1); assert.match(r.stderr, /diagram_type 은 flow, component, class, sequence, state 중 하나여야 합니다: uml/);
});

test('changing diagram_type marks the perspective for review while the default keeps existing hashes', t => {
  const f = makeFixture(); t.after(f.cleanup);
  const verify = () => spawnSync(process.execPath, [path.join(f.root, 'tools/docgen/verify.mjs')], { cwd: f.root, encoding: 'utf8' }).stdout;
  // fixture 는 코드가 바뀐 상태이므로 코드를 되돌려 fresh 로 만든 뒤 종류만 바꿉니다.
  f.put(probeFile, 'package dev.halcamera\nobject Probe { const val OBSERVE_MS = 10000L }\n');
  assert.match(verify(), /omm:sync-probe\s+최신/);
  const bindings = fs.readFileSync(path.join(f.root, 'docs/guide/_bindings.yaml'), 'utf8');
  f.put('docs/guide/_bindings.yaml', bindings.replace('    kind: omm\n', '    kind: omm\n    diagram_type: flow\n'));
  assert.match(verify(), /omm:sync-probe\s+최신/);
  f.put('docs/guide/_bindings.yaml', bindings.replace('    kind: omm\n', '    kind: omm\n    diagram_type: component\n'));
  assert.match(verify(), /omm:sync-probe\s+원본이 갱신됨/);
});
