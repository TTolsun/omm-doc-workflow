import test from 'node:test';
import assert from 'node:assert/strict';
import { lintManuscript, describeFindings, attachParticles, unwrapManuscript } from '../src/manuscript-lint.mjs';

const rules = body => [...new Set(lintManuscript(body).map(f => f.rule))];

test('clean manuscript in 합니다체 with attached particles passes', () => {
  const body = [
    'canAccept는 처리 중인 버퍼 수(`inFlight`)가 `kBufferLimit`보다 작을 때 true를 반환합니다.',
    '4 이상이면 false를 반환합니다. 경곗값은 RequestQueue.h의 kBufferLimit에 정의되어 있습니다.',
    '',
    '### 수용 기준',
    '',
    '- 기기에서 검증한 기록은 없으므로 실제 동작은 확인 필요 상태입니다.',
    '',
    '| 조건 | 결과 |',
    '| --- | --- |',
    '| inFlight < 4 | true |',
    '',
    '```cpp',
    'return inFlight < kBufferLimit; // 코드 블록은 검사하지 않는다',
    '```',
  ].join('\n');
  assert.deepEqual(lintManuscript(body), []);
});

test('real local-model output is rejected with every observed rule', () => {
  const body = [
    'canAccept는 요청 수 (inFlight) 가 kBufferLimit(4) 보다 작을 때 true 를, 4 이상일 때 false 를 반환한다.',
    '',
    '다음은 구체적인 동작이며 실제 기기 테스트 기록에 근거하지 않은 부분들은 확인 중이다:',
    '',
    '- **true 를 반환하는 조건**: inFlight < 4 인 경우',
    '',
    '다른 설계 기록이나 기기 검증 결과는 아직 없음.',
    '',
    '다음 블록을 위해 다음 단계로 넘어가거나, canAccept 의 동작에 대한 추가 검토를 요구할 수 있다.',
  ].join('\n');
  assert.deepEqual(rules(body).sort(), ['대화체·작업 보고', '조사 띄어쓰기', '종결어미'].sort());
  const first = lintManuscript(body)[0];
  assert.equal(first.line, 1);
  assert.match(first.detail, /합니다/);
});

test('manuscript references, absolute links and bold headings are rejected', () => {
  const body = [
    '**요청 수용 조건 확인**',
    '',
    '기존 원고에 따르면 canAccept는 4보다 작을 때 참입니다.',
    '',
    '- `kBufferLimit`: [RequestQueue.h](file://C:\\work\\RequestQueue.h#L3-L3)',
    '- 정의는 C:\\work\\RequestQueue.cpp 에 있습니다.',
  ].join('\n');
  assert.deepEqual(rules(body).sort(), ['굵은 글씨 제목', '원고·근거 언급', '절대 경로·줄 번호 링크', '조사 띄어쓰기'].sort());
});

test('headings and tables skip sentence rules but not link rules', () => {
  assert.deepEqual(lintManuscript('### canAccept 의 동작\n\n| canAccept 는 | 값 |\n| --- | --- |\n'), []);
  assert.deepEqual(rules('### 위치 file://C:/x.h\n'), ['절대 경로·줄 번호 링크']);
});

test('JSON residue and page-level headings are rejected', () => {
  const body = '## 조건 검증 기준\n\nkBufferLimit는 RequestQueue.h에 정의됩니다.”}\n';
  assert.deepEqual(rules(body).sort(), ['JSON 잔여물', '제목 수준'].sort());
  assert.deepEqual(rules('첫 문장입니다.\\n둘째 문장입니다.\n'), ['JSON 잔여물']);
  assert.deepEqual(rules('본문입니다.\n}\n'), ['JSON 잔여물']);
});

test('attachParticles removes only the gap before a particle and skips code blocks', () => {
  const input = 'canAccept 는 요청 수 (inFlight) 가 kBufferLimit(4) 보다 작을 때 true 를 반환합니다. `kBufferLimit` 은 4 로 정의됩니다.\n```\nx 는 y 를\n```\n영어 단어 The 와 a 를 구분합니다.\n';
  const { text, count } = attachParticles(input);
  assert.equal(count, 8);
  assert.equal(text, 'canAccept는 요청 수 (inFlight)가 kBufferLimit(4)보다 작을 때 true를 반환합니다. `kBufferLimit`은 4로 정의됩니다.\n```\nx 는 y 를\n```\n영어 단어 The와 a를 구분합니다.\n');
  assert.deepEqual(lintManuscript(text), []);
  assert.deepEqual(attachParticles('이미 붙은 문장입니다.\n'), { text: '이미 붙은 문장입니다.\n', count: 0 });
});

test('describeFindings lists contract items without a line and prose items with one', () => {
  const { summary, list, brief } = describeFindings([
    { rule: 'front matter', detail: '첫 줄은 --- 입니다.' },
    { rule: '종결어미', detail: '합니다체로 씁니다.', line: 3, text: '반환한다.' },
    { rule: '종결어미', detail: '합니다체로 씁니다.', line: 5, text: '고정된다.' },
  ]);
  assert.equal(summary, 'front matter, 종결어미');
  assert.match(list, /^- \[front matter\]\n  첫 줄은 --- 입니다\.\n- \[종결어미\] 3행: 반환한다\.\n  합니다체로 씁니다\.\n- \[종결어미\] 5행: 고정된다\.\n  합니다체로 씁니다\.$/);
  // 짧은 목록은 규칙마다 한 줄이며 위반한 줄을 인용하지 않습니다.
  assert.equal(brief, '- [front matter] 첫 줄은 --- 입니다.\n- [종결어미] 합니다체로 씁니다.');
});

test('unwrapManuscript strips only an outer fence, whatever its info string case, and keeps inner code blocks', () => {
  const inner = '---\nbased_on: [x]\n---\n본문입니다.\n\n```cpp\nreturn a;\n```\n\n끝 문장입니다.';
  assert.equal(unwrapManuscript('```Markdown\n' + inner + '\n```'), inner + '\n');
  assert.equal(unwrapManuscript('\r\n```md \r\n' + inner.replace(/\n/g, '\r\n') + '\r\n```\r\n'), inner + '\n');
  assert.equal(unwrapManuscript('  ' + inner + '\n\n'), inner + '\n');
  assert.equal(unwrapManuscript(undefined), '');
  // 닫히지 않은 바깥 펜스는 벗기지 않습니다. front matter 검사에서 반려됩니다.
  assert.equal(unwrapManuscript('```\n' + inner), '```\n' + inner + '\n');
});

test('review follow-ups: inline-code escapes, bold identifiers, closing brackets and ordinary prose', () => {
  // 백틱 안의 \n 은 JSON 잔여물이 아닙니다.
  assert.deepEqual(lintManuscript('로그는 `"\\n"`으로 줄을 나눕니다.\n'), []);
  // 굵은 식별자 뒤의 조사도 붙입니다.
  assert.deepEqual(attachParticles('**kBufferLimit** 은 4 를 넘지 않습니다.\n'), { text: '**kBufferLimit**은 4를 넘지 않습니다.\n', count: 2 });
  // 닫는 괄호나 따옴표 안에서 끝나는 문장도 종결어미를 봅니다.
  assert.deepEqual(rules('(inFlight가 4 이상이면 false를 반환한다.)\n'), ['종결어미']);
  assert.deepEqual(rules('"4 이상이면 false를 반환합니다."\n'), []);
  // 원고 안에서 앞 문장을 가리키는 말은 대화체가 아닙니다.
  assert.deepEqual(rules('위 내용은 코드로 확인한 동작입니다.\n'), []);
});
