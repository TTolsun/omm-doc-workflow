// 공통 유틸리티. 경로 해석, 글롭, 해시, 상태 파일 입출력을 담당합니다.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { parseYaml } from "./yaml-lite.mjs";
import { normalizeText } from "./text.mjs";
import { PROJECT_ROOT, STATE_DIR, OMM_DIR, BINDINGS_FILE, SOURCE_ROOT, sourcePath, within } from './config.mjs';
import { diagramTypeOf } from './diagram.mjs';
export { STATE_DIR, OMM_DIR, SOURCE_ROOT, sourcePath } from './config.mjs';

// tools/docgen 기준으로 저장소 루트는 두 단계 위입니다.
export const REPO_ROOT = PROJECT_ROOT;

export const repoPath = (...parts) => path.join(REPO_ROOT, ...parts);

export function readBindings() {
  const file = BINDINGS_FILE;
  const parsed = parseYaml(fs.readFileSync(file, "utf8"));
  if (parsed?.version !== 2) {
    throw new Error(`_bindings.yaml 의 version 이 2 가 아닙니다: ${parsed?.version}`);
  }
  const root = within(PROJECT_ROOT, parsed.site?.root);
  within(root, parsed.site.content_dir); within(root, parsed.site.inputs_dir);
  for (const [name, source] of Object.entries(parsed.sources ?? {})) {
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`Invalid source ID: ${name}`);
    for (const glob of source.evidence ?? []) within(SOURCE_ROOT, glob);
    if (source.kind === "omm") diagramTypeOf(source);
  }
  for (const [page, def] of Object.entries(parsed.pages ?? {})) {
    within(root, page);
    if (!page.endsWith('.md')) throw new Error(`Markdown page required: ${page}`);
    for (const block of def.blocks ?? []) if (!/^[a-z0-9-]+$/.test(block.id)) throw new Error(`Invalid block ID: ${block.id}`);
  }
  return parsed;
}

export function readState(name, fallback = null) {
  const file = path.join(STATE_DIR, name);
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function writeState(name, value) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const file = path.join(STATE_DIR, name);
  // 줄 단위 diff 를 읽기 쉽게 하기 위해 들여쓴 JSON 과 끝 개행을 유지합니다.
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

// --- 글롭 -----------------------------------------------------------------
// `**` 는 여러 디렉터리를, `*` 는 한 경로 조각 안에서만 매칭합니다.
export function globToRegExp(pattern) {
  let out = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        // `**/` 는 0개 이상의 디렉터리를 뜻하므로 슬래시까지 함께 소비합니다.
        i += 1;
        if (pattern[i + 1] === "/") i += 1;
        out += "(?:.*/)?";
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else if (".+^${}()|[]\\".includes(c)) {
      out += "\\" + c;
    } else {
      out += c;
    }
  }
  return new RegExp(`^${out}$`);
}

const IGNORED_DIRS = new Set([".git", ".repo", "node_modules", "out", "build", ".gradle", ".idea"]);

function walk(dir, base, acc) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    const rel = path.posix.join(base, entry.name);
    if (entry.isDirectory()) walk(abs, rel, acc);
    else if (entry.isFile()) acc.push(rel);
  }
  return acc;
}

let fileIndex = null;
export function resetGlobCache() { fileIndex = null; }
function repoFiles() {
  if (!fileIndex) fileIndex = walk(SOURCE_ROOT, "", []).sort();
  return fileIndex;
}

export function globFiles(patterns) {
  const regexes = patterns.map(globToRegExp);
  return repoFiles().filter((rel) => regexes.some((re) => re.test(rel)));
}

// --- 해시 -----------------------------------------------------------------
// 파일 목록과 각 파일의 내용을 함께 해시합니다. 파일이 추가되거나 삭제된
// 경우도 변경으로 잡아내기 위해서입니다.
export function hashFiles(relPaths) {
  const hash = crypto.createHash("sha256");
  for (const rel of [...relPaths].sort()) {
    hash.update(rel);
    hash.update("\0");
    hash.update(normalizeText(fs.readFileSync(sourcePath(rel), "utf8")));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

export function hashText(text) {
  return crypto.createHash("sha256").update(normalizeText(text), "utf8").digest("hex").slice(0, 16);
}

// --- omm 원본 읽기 --------------------------------------------------------
const FIELD_FILES = {
  description: "description.md",
  constraint: "constraint.md",
  concern: "concern.md",
  context: "context.md",
  note: "note.md",
  todo: "todo.md",
  diagram: "diagram.mmd",
};

export function ommFieldPath(source, field) {
  const filename = FIELD_FILES[field];
  if (!filename) throw new Error(`알 수 없는 omm 필드입니다: ${field}`);
  return path.join(OMM_DIR, ...source.split("/"), filename);
}

export function readOmmField(source, field) {
  const file = ommFieldPath(source, field);
  if (!fs.existsSync(file)) return null;
  // autocrlf 체크아웃에서는 파일이 CRLF 로 읽힙니다. 생성기가 줄을 다시 합칠 때
  // \r 이 남지 않도록 여기서 LF 로 정규화합니다.
  const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").trim();
  return text.length ? text : null;
}

export function ommChildren(source) {
  const dir = path.join(OMM_DIR, ...source.split("/"));
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort();
}

export function ommExists(source) {
  return fs.existsSync(path.join(OMM_DIR, ...source.split("/")));
}

export const fail = (message) => {
  process.stderr.write(`오류: ${message}\n`);
  process.exit(1);
};

// 설정 없이 쓰는 모듈도 같은 정규화를 쓰도록 text.mjs 에 두고 여기서 다시 내보냅니다.
export { normalizeText };
