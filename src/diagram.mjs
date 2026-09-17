// 관점별 다이어그램 종류와 결정적 검사.
//
// OMM 0.2.0 의 `omm validate` 는 diagram 이 graph/flowchart 방향 선언으로 시작해야 통과하므로
// classDiagram, sequenceDiagram, stateDiagram-v2 는 그대로 쓸 수 없습니다. 바인딩의 `diagram_type` 으로
// 관점마다 종류를 정하고, graph 계열은 OMM CLI 에, UML 계열은 이 파일의 검사기에 맡깁니다.
// 검사는 형식만 보며 코드와 그림이 일치하는지는 판단하지 않습니다. 그 검토는 사람이 합니다.
// 설정을 읽지 않으므로 어느 단계에서도 import 할 수 있습니다.

const GRAPH_DECLARATION = /^(graph|flowchart)\s+(LR|RL|TD|TB|BT)\s*$/i;

export const DIAGRAM_TYPES = {
  flow: {
    label: '흐름도(graph/flowchart)', example: 'graph LR', declaration: GRAPH_DECLARATION, omm: true,
    guide: '노드는 코드의 단계나 조건이고, 간선에는 |조건| 형식의 라벨을 붙입니다.',
  },
  component: {
    label: '컴포넌트 구조도(graph/flowchart)', example: 'graph TD', declaration: GRAPH_DECLARATION, omm: true,
    guide: '노드는 모듈·컴포넌트이고, 간선 라벨에는 호출이나 의존 이유를 씁니다. 상세 구조는 자식 요소로 나누고 한 그림에 15개가 넘는 노드를 넣지 않습니다.',
  },
  class: {
    label: '클래스 다이어그램(classDiagram)', example: 'classDiagram', declaration: /^classDiagram\s*$/, omm: false,
    sample: 'classDiagram\n    class Session {\n        -unsigned count_\n        +submit() bool\n    }\n    class Slot {\n        +reserve() bool\n    }\n    Session *-- Slot : 4개 소유\n    Session ..> Queue : canAccept 호출',
    guide: 'class 선언은 "class A {" 로 열고 "}" 로 닫으며, 멤버는 그 안에 "+이름() 반환형" 또는 "-타입 이름" 형태로 한 줄씩 씁니다. 중괄호 밖에는 class 선언과 관계 줄만 두고, 관계는 "A <|-- B : 이유"(상속), "A *-- B : 이유"(구성), "A o-- B : 이유"(집합), "A ..> B : 이유"(의존)만 코드에서 확인한 대로 씁니다.',
  },
  sequence: {
    label: '시퀀스 다이어그램(sequenceDiagram)', example: 'sequenceDiagram', declaration: /^sequenceDiagram\s*$/, omm: false,
    sample: 'sequenceDiagram\n    participant Caller as 호출자\n    participant Session\n    Caller->>Session: submit()\n    alt 수용 불가\n        Session-->>Caller: false\n    else 수용\n        loop 슬롯마다\n            Session->>Slot: reserve()\n        end\n        Session-->>Caller: true\n    end',
    guide: 'participant 를 먼저 선언하고 코드의 호출 순서대로 메시지를 씁니다. 허용 문법은 "participant A as 이름", "A->>B: 설명", "B-->>A: 반환값", "alt 조건" / "else" / "end", "loop 설명" / "end", "Note over A: 설명" 뿐이며, for·if 같은 코드 문장은 쓰지 않습니다.',
  },
  state: {
    label: '상태 다이어그램(stateDiagram-v2)', example: 'stateDiagram-v2', declaration: /^stateDiagram-v2\s*$/, omm: false,
    sample: 'stateDiagram-v2\n    [*] --> Free\n    Free --> Queued : reserve()\n    Queued --> Free : release()\n    note right of Free\n        다른 상태에서는 false 를 반환합니다.\n    end note',
    guide: '상태와 전이만 씁니다. 전이는 "A --> B : 조건" 형태이고 시작과 종료는 "[*] --> A", "A --> [*]" 로 씁니다. 설명은 "note right of A" 와 "end note" 사이에 쓰며, 코드 문장이나 함수 본문은 쓰지 않습니다.',
  },
};
export const DEFAULT_DIAGRAM_TYPE = 'flow';

// 바인딩의 source 항목에서 종류를 읽습니다. 없으면 기존 동작과 같은 flow 입니다.
export function diagramTypeOf(source) {
  const type = source?.diagram_type ?? DEFAULT_DIAGRAM_TYPE;
  if (!DIAGRAM_TYPES[type]) throw new Error(`diagram_type 은 ${Object.keys(DIAGRAM_TYPES).join(', ')} 중 하나여야 합니다: ${type}`);
  return type;
}

// 스캔 프롬프트와 반려 안내에 넣는 한 줄 규칙입니다.
export function diagramRule(type) {
  const spec = DIAGRAM_TYPES[type];
  // UML 계열은 로컬 소형 모델이 for·if 같은 코드 문장을 그림에 넣는 일이 잦아 문법을 보여 주는 짧은 예를 함께 줍니다. 예의 이름은 코드의 이름으로 바꿔야 합니다.
  return `diagram 필드는 첫 줄이 "${spec.example}" 인 ${spec.label} 전체 내용입니다. ${spec.guide}${spec.sample ? ` 문법 예(이름은 코드의 이름으로 바꿉니다):\n${spec.sample}\n` : ''}`;
}

// 괄호 짝을 셉니다. 따옴표 안의 괄호는 라벨이므로 세지 않습니다. OMM 의 규칙과 같되,
// class·state 다이어그램의 중괄호 블록은 여러 줄에 걸치므로 대괄호·소괄호는 줄마다, 중괄호는 그림 전체로 봅니다.
function bracketCounts(text) {
  const counts = { '[': 0, ']': 0, '(': 0, ')': 0, '{': 0, '}': 0 };
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') { quoted = !quoted; continue; }
    if (!quoted && ch in counts) counts[ch] += 1;
  }
  return counts;
}
function balanced(line) {
  const counts = bracketCounts(line);
  return counts['['] === counts[']'] && counts['('] === counts[')'];
}

const SEQUENCE_MESSAGE = /^[^\s:]+?\s*(->>|-->>|->|-->|-x|--x|-\)|--\))\s*[+-]?\s*[^\s:]+?\s*(:\s*(.*))?$/;
const SEQUENCE_LINE = /^(participant|actor|create\s+(participant|actor)|destroy|autonumber|activate|deactivate|Note\s+(left of|right of|over)|note\s+(left of|right of|over)|loop|alt|else|opt|par|and|critical|option|break|rect|box|end|link|links|properties|details)\b/;
const CLASS_RELATION = /^\S+\s+(?:"[^"]*"\s+)?(<\|--|<\|\.\.|\*--|--\*|o--|--o|-->|<--|\.\.>|<\.\.|--|\.\.)\s+(?:"[^"]*"\s+)?\S+(\s*:\s*.*)?$/;
const CLASS_LINE = /^(class\s+\S+|<<\S+>>\s+\S+|\S+\s*:\s*\S.*|note\s|namespace\s+\S+\s*\{|direction\s+(LR|RL|TD|TB|BT)|classDef\s|cssClass\s|style\s|link\s|click\s|callback\s)/;
const STATE_TRANSITION = /^(\[\*\]|\S+)\s+-->\s+(\[\*\]|\S+)(\s*:\s*(.*))?$/;
const STATE_LINE = /^(state\s|\}|--$|\S+\s*:\s*\S.*|note\s+(left|right)\s+of\s|end note|direction\s+(LR|RL|TD|TB|BT)|classDef\s|class\s|\S+:::\S+$)/;

// 종류별 규칙으로 diagram 본문을 검사합니다. OMM 출력과 같은 {level, rule, message, line} 목록을 돌려줍니다.
// context 는 { element, perspectives } 이며, @참조가 다른 perspective 를 가리키는지 확인할 때 씁니다.
export function checkDiagram(text, type, context = null) {
  const spec = DIAGRAM_TYPES[type];
  if (!spec) throw new Error(`알 수 없는 diagram_type: ${type}`);
  const issues = [];
  const push = (level, rule, message, line) => issues.push({ level, rule, message, line });
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const content = lines.map((line, index) => ({ line: line.trim(), no: index + 1 })).filter(x => x.line && !x.line.startsWith('%%'));
  if (!content.length || !spec.declaration.test(content[0].line)) {
    push('error', 'diagram-type', `diagram 은 "${spec.example}" 로 시작해야 합니다 (diagram_type: ${type}).`, content[0]?.no ?? 1);
  }
  for (const { line, no } of content) if (!balanced(line)) push('error', 'balanced-brackets', `괄호 짝이 맞지 않습니다: ${line}`, no);
  const braces = bracketCounts(content.map(x => x.line).join('\n'));
  if (braces['{'] !== braces['}']) push('error', 'balanced-brackets', '중괄호 짝이 맞지 않습니다.');
  if (context) {
    for (const [, ref] of String(text).matchAll(/@([\w-]+)/g)) {
      if (ref === context.element) push('error', 'ref-self', `자기 자신을 참조합니다: @${ref}`);
      else if (!context.perspectives.includes(ref)) push('error', 'ref-exists', `@${ref} 가 없습니다. 사용 가능: ${context.perspectives.join(', ')}`);
    }
  }
  const body = content.slice(1);
  if (type === 'sequence') {
    let messages = 0;
    for (const { line, no } of body) {
      const message = line.match(SEQUENCE_MESSAGE);
      if (message) {
        messages += 1;
        if (!message[3]?.trim()) push('error', 'sequence-message', `메시지에 ": 설명" 이 없습니다: ${line}`, no);
      } else if (!SEQUENCE_LINE.test(line)) push('error', 'sequence-line', `시퀀스 다이어그램 문법이 아닙니다(허용: participant, A->>B: 설명, alt/else/opt/loop/end, Note over): ${line}`, no);
    }
    if (!messages) push('error', 'sequence-message', '메시지(A->>B: 설명)가 하나 이상 있어야 합니다.');
  } else if (type === 'class') {
    let declared = 0, depth = 0;
    for (const { line, no } of body) {
      if (depth > 0) { if (line === '}') depth -= 1; continue; }
      if (CLASS_RELATION.test(line) || /^class\s+\S+/.test(line) || /^<<\S+>>\s+\S+/.test(line) || /^\S+\s*:\s*\S/.test(line)) declared += 1;
      if (!CLASS_RELATION.test(line) && !CLASS_LINE.test(line)) push('error', 'class-line', `클래스 다이어그램 문법이 아닙니다(중괄호 밖에는 class 선언과 A <|-- B : 이유 관계만 허용): ${line}`, no);
      if (line.endsWith('{')) depth += 1;
    }
    if (!declared) push('error', 'class-declaration', 'class 선언이나 관계(A <|-- B)가 하나 이상 있어야 합니다.');
  } else if (type === 'state') {
    let transitions = 0, inNote = false;
    for (const { line, no } of body) {
      if (inNote) { if (line === 'end note') inNote = false; continue; }
      const transition = line.match(STATE_TRANSITION);
      if (transition) {
        transitions += 1;
        // 시작·종료 전이([*])는 조건이 없는 것이 보통이므로 라벨 경고에서 뺍니다.
        if (!transition[4]?.trim() && transition[1] !== '[*]' && transition[2] !== '[*]') push('warning', 'transition-label', `전이에 조건 라벨이 없습니다: ${line}`, no);
      } else if (!STATE_LINE.test(line)) push('error', 'state-line', `상태 다이어그램 문법이 아닙니다(허용: A --> B : 조건, [*], state, note right of A / end note): ${line}`, no);
      if (/^note\s+(left|right)\s+of\s+\S+\s*$/.test(line)) inNote = true;
    }
    if (inNote) push('error', 'state-line', 'note 블록이 end note 로 닫히지 않았습니다.');
    if (!transitions) push('error', 'state-transition', '전이(A --> B : 조건)가 하나 이상 있어야 합니다.');
  }
  return issues;
}

// OMM CLI 의 validate 출력과 같은 모양으로 만듭니다. sync 로그와 반려 사유가 같은 형식을 쓰기 위해서입니다.
export function formatDiagramIssues(element, issues) {
  const errors = issues.filter(x => x.level === 'error').length;
  const warnings = issues.filter(x => x.level === 'warning').length;
  const status = errors ? `✗ invalid (${errors} error${errors > 1 ? 's' : ''}${warnings ? `, ${warnings} warning${warnings > 1 ? 's' : ''}` : ''})`
    : `✓ valid${warnings ? ` (${warnings} warning${warnings > 1 ? 's' : ''})` : ''}`;
  return [`${element}:`, `  ${status}`, ...issues.map(x => `  ${x.level} [${x.rule}]${x.line ? ` line ${x.line}:` : ''} ${x.message}`)].join('\n');
}
