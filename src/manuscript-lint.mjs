// 집필 결과 검사기.
//
// 로컬 모델은 집필 규칙을 확률적으로만 따르므로, 프롬프트만으로는 같은 위반이 반복됩니다.
// 이 모듈은 사람이 읽기 전에 기계적으로 잡을 수 있는 위반만 결정적으로 찾습니다.
// 사실 관계나 근거 수준은 판단하지 않으며, 그 검토는 verify --accept 에서 사람이 합니다.
//
// 반환값은 { rule, line, text } 목록입니다. 비어 있으면 통과입니다.
// sync-worker 는 이 목록을 재집필 프롬프트의 반려 사유로 그대로 넣습니다.

// 식별자·숫자·괄호·백틱 뒤에 한 칸 띄고 붙은 조사. 로컬 모델이 가장 자주 내는 위반이며 공백만 지우면 됩니다.
const PARTICLE_GAP = /([A-Za-z0-9_)\]`]) (는|은|가|을|를|의|에서|에|와|과|로|으로|보다|부터|까지|도)(?=[\s,.!?)])/g;

const RULES = [
  {
    rule: 'JSON 잔여물',
    detail: '원고 본문에 JSON 포장의 흔적("}, ”}, 이스케이프된 \\n)이 남아 있습니다. markdown 값에는 원고 본문만 넣습니다.',
    test: line => /["”]\s*}+\s*$/.test(line) || /^\s*}+\s*$/.test(line) || /\\n/.test(line),
  },
  {
    rule: '제목 수준',
    detail: '블록 안에서는 ### 이하의 소제목만 씁니다. # 과 ## 은 페이지가 배치하는 제목과 충돌합니다.',
    test: line => /^\s*#{1,2}\s/.test(line),
  },
  {
    rule: '대화체·작업 보고',
    detail: '독자에게 말을 걸거나 다음 단계·검토를 안내하거나 작업을 보고하는 문장은 원고가 아닙니다.',
    test: line => /(다음 단계로|추가 검토를 요구|검토를 요청|검토를 요구|이 원고는|본 원고는|이 블록은|위 내용은|요청하신|요청에 따라|확인 중이다|확인 중입니다)/.test(line),
  },
  {
    rule: '원고·근거 언급',
    detail: '독자는 요청문을 보지 못하므로 "기존 원고에 따르면", "제공된 코드에서" 같은 표현 없이 사실만 씁니다.',
    test: line => /(기존 원고|현재 원고|이전 원고|제공된 코드|제공된 근거|제공된 자료|위 근거|아래 근거|위 코드 근거|근거 자료에 따르면)/.test(line),
  },
  {
    rule: '절대 경로·줄 번호 링크',
    detail: '코드 위치는 "## 코드:" 제목의 상대 경로와 심볼 이름으로만 씁니다. file:// 링크, 드라이브 경로, #L12 같은 줄 번호는 쓰지 않습니다.',
    test: line => /file:\/\/|(?:^|[\s(\[`])[A-Za-z]:[\\/]|#L\d+/.test(line),
  },
  {
    rule: '굵은 글씨 제목',
    detail: '소제목은 ### 이하의 Markdown 제목으로만 씁니다. **굵은 글씨** 한 줄을 제목처럼 쓰지 않습니다.',
    test: line => /^\s*\*\*[^*\n]+\*\*\s*:?\s*$/.test(line),
  },
  {
    rule: '종결어미',
    detail: '모든 문장은 "~합니다", "~입니다"로 끝냅니다. "~한다", "~이다", "~함", "~없음" 같은 형태로 끝내지 않습니다.',
    test: line => sentences(line).some(s => /(?<!니)다$/.test(s) || /(함|됨|없음|있음)$/.test(s)),
    sentence: true,
  },
  {
    rule: '조사 띄어쓰기',
    detail: '조사는 앞말에 붙여 씁니다. 코드 식별자, 숫자, 괄호, 백틱 뒤에서도 띄지 않습니다. 예: "kBufferLimit 은" 대신 "kBufferLimit은".',
    test: line => new RegExp(PARTICLE_GAP.source).test(line),
    sentence: true,
  },
];

// 조사 앞의 공백만 지웁니다. 코드 블록은 건너뛰고 다른 글자는 바꾸지 않으므로 원고의 의미는 그대로입니다.
// 반환값의 count 는 로그용이며, 0 이면 text 는 입력과 같습니다.
export function attachParticles(markdown) {
  let count = 0, fenced = false;
  const text = markdown.replace(/\r\n/g, '\n').split('\n').map(line => {
    if (/^\s*```/.test(line)) { fenced = !fenced; return line; }
    return fenced ? line : line.replace(PARTICLE_GAP, (_, head, particle) => { count++; return head + particle; });
  }).join('\n');
  return { text, count };
}

// 문장 끝만 보기 위해 마침표·물음표·느낌표로 나누고 인라인 코드와 강조 기호를 걷어냅니다.
function sentences(line) {
  const prose = line.replace(/`[^`]*`/g, ' ').replace(/[*_]+/g, '').replace(/^\s*(?:[-*+]|\d+\.)\s+/, '');
  return prose.split(/[.!?](?=\s|$)/).map(s => s.trim()).filter(Boolean);
}

export function lintManuscript(body) {
  const findings = [];
  let fenced = false;
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  lines.forEach((line, index) => {
    if (/^\s*```/.test(line)) { fenced = !fenced; return; }
    if (fenced) return;
    // 제목과 표는 완성 문장이 아니어도 되므로 문장 규칙(종결어미, 조사)은 건너뜁니다. 나머지 규칙은 모든 줄에 적용합니다.
    const prose = !/^\s*#{1,6}\s/.test(line) && !/^\s*\|/.test(line);
    for (const { rule, detail, test, sentence } of RULES) {
      if (sentence && !prose) continue;
      if (test(line)) findings.push({ rule, detail, line: index + 1, text: line.trim() });
    }
  });
  return findings;
}

// 반려 사유를 사람이 읽는 한 줄과 재집필 프롬프트용 목록으로 만듭니다. 계약 위반처럼 줄이 없는 항목도 받습니다.
export function describeFindings(findings) {
  const rules = [...new Set(findings.map(f => f.rule))];
  const list = findings.map(f => `- [${f.rule}]${f.line ? ` ${f.line}행: ${f.text}` : ''}\n  ${f.detail}`).join('\n');
  return { summary: rules.join(', '), list };
}
