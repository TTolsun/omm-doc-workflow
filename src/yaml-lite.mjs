// YAML 부분집합 파서.
//
// 왜 직접 만들었는가: 이 저장소의 작업본은 Google Drive 가상 파일 시스템 위에
// 있습니다. 그 경로에서 `npm install` 을 하면 파일이 0바이트로 남기 때문에
// 외부 의존성을 쓸 수 없습니다. 생성기가 Drive 작업본과 CI 양쪽에서 똑같이
// 동작해야 하므로 의존성을 두지 않습니다.
//
// 지원 범위: 블록 매핑, 블록 시퀀스, 인라인 시퀀스, 따옴표 있는/없는 스칼라,
// 주석. 앵커, 여러 줄 스칼라, 인라인 매핑은 지원하지 않습니다.
//
// 지원 범위를 벗어나면 조용히 잘못 해석하지 않고 줄 번호와 함께 예외를
// 던집니다. 문서 생성기의 입력이 잘못 읽히는 것보다 즉시 멈추는 편이 낫습니다.

const INDENT_UNIT = 2;

class Cursor {
  constructor(lines) {
    this.lines = lines;
    this.i = 0;
  }
  peek() {
    return this.i < this.lines.length ? this.lines[this.i] : null;
  }
  next() {
    return this.lines[this.i++];
  }
  replace(line) {
    this.lines[this.i] = line;
  }
}

function stripComment(text, lineNo) {
  let out = "";
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
      out += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      out += c;
      continue;
    }
    // 공백 뒤의 # 부터는 주석입니다. 값 안의 # 은 공백이 앞서지 않습니다.
    if (c === "#" && (i === 0 || /\s/.test(text[i - 1]))) break;
    out += c;
  }
  if (quote) throw new Error(`${lineNo}행: 따옴표가 닫히지 않았습니다.`);
  return out.trimEnd();
}

function tokenize(text) {
  const lines = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const lineNo = index + 1;
    const stripped = stripComment(raw, lineNo);
    if (!stripped.trim()) return;
    if (stripped.includes("\t")) {
      throw new Error(`${lineNo}행: 탭 문자는 지원하지 않습니다. 공백을 사용하세요.`);
    }
    const indent = stripped.length - stripped.trimStart().length;
    if (indent % INDENT_UNIT !== 0) {
      throw new Error(`${lineNo}행: 들여쓰기는 ${INDENT_UNIT}칸 단위여야 합니다.`);
    }
    let content = stripped.trim();
    let isSeq = false;
    if (content === "-" || content.startsWith("- ")) {
      isSeq = true;
      content = content.slice(1).trim();
    }
    lines.push({ indent, content, isSeq, lineNo });
  });
  return lines;
}

function parseScalar(text, lineNo) {
  if (text === "") return null;
  if (text.startsWith("[")) {
    if (!text.endsWith("]")) throw new Error(`${lineNo}행: 인라인 시퀀스가 닫히지 않았습니다.`);
    const inner = text.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((part) => parseScalar(part.trim(), lineNo));
  }
  if (text.startsWith("{")) {
    throw new Error(`${lineNo}행: 인라인 매핑은 지원하지 않습니다.`);
  }
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null" || text === "~") return null;
  if (/^-?\d+$/.test(text)) return Number(text);
  if (/^-?\d*\.\d+$/.test(text)) return Number(text);
  return text;
}

// `key: value` 를 분해합니다. 값 안의 콜론과 구분하기 위해 콜론 뒤에 공백이
// 오거나 줄이 끝나는 경우만 구분자로 봅니다.
function splitKey(content, lineNo) {
  let quote = null;
  for (let i = 0; i < content.length; i += 1) {
    const c = content[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === ":" && (i === content.length - 1 || content[i + 1] === " ")) {
      const key = content.slice(0, i).trim();
      if (!key) throw new Error(`${lineNo}행: 키가 비어 있습니다.`);
      return [parseScalar(key, lineNo), content.slice(i + 1).trim()];
    }
  }
  return null;
}

function parseNode(cursor, indent) {
  const line = cursor.peek();
  if (!line || line.indent < indent) return null;
  if (line.isSeq && line.indent === indent) return parseSeq(cursor, indent);
  return parseMap(cursor, indent);
}

function parseSeq(cursor, indent) {
  const items = [];
  while (true) {
    const line = cursor.peek();
    if (!line || line.indent !== indent || !line.isSeq) break;
    const pair = splitKey(line.content, line.lineNo);
    if (pair) {
      // `- key: value` 는 이 항목이 매핑임을 뜻합니다. 대시를 제거한 줄을
      // 한 단계 깊은 들여쓰기로 되돌려 놓고 매핑으로 읽습니다.
      cursor.replace({ ...line, indent: indent + INDENT_UNIT, isSeq: false });
      items.push(parseMap(cursor, indent + INDENT_UNIT));
    } else {
      cursor.next();
      items.push(parseScalar(line.content, line.lineNo));
    }
  }
  return items;
}

function parseMap(cursor, indent) {
  const map = {};
  while (true) {
    const line = cursor.peek();
    if (!line || line.indent !== indent || line.isSeq) break;
    const pair = splitKey(line.content, line.lineNo);
    if (!pair) throw new Error(`${line.lineNo}행: 매핑 항목이 아닙니다 -> ${line.content}`);
    const [key, rest] = pair;
    cursor.next();
    if (rest === "") {
      const nested = cursor.peek();
      if (nested && nested.indent > indent) {
        map[key] = parseNode(cursor, nested.indent);
      } else {
        map[key] = null;
      }
    } else {
      map[key] = parseScalar(rest, line.lineNo);
    }
    if (Object.prototype.hasOwnProperty.call(map, key) && map[key] === undefined) {
      throw new Error(`${line.lineNo}행: 값을 읽지 못했습니다.`);
    }
  }
  return map;
}

export function parseYaml(text) {
  const cursor = new Cursor(tokenize(text));
  if (!cursor.peek()) return null;
  const value = parseNode(cursor, cursor.peek().indent);
  const leftover = cursor.peek();
  if (leftover) {
    throw new Error(`${leftover.lineNo}행: 들여쓰기가 맞지 않아 해석하지 못했습니다.`);
  }
  return value;
}
