// 검증기와 생성기가 공유하는 원본 모델.
//
// "무엇을 검사하는가"의 정의를 한 곳에 둡니다. 검증 키 목록, 각 키의 근거 파일,
// 해시 계산, 상태 판정 규칙이 여기 있습니다. 검증기는 이 정의로 해시를 계산해서
// 저장하고, 생성기는 저장된 결과를 읽어 표시만 합니다.
import fs from "node:fs";
import path from "node:path";
import { globFiles, hashFiles, hashText, repoPath, readOmmField, ommExists, ommChildren } from "./lib.mjs";
import { parseYaml } from "./yaml-lite.mjs";
import { CONFIG, SOURCE_ROOT, STATE_DIR, sourcePath } from './config.mjs';
import { selectCommits, selectExternal } from './evidence-scope.mjs';

export const OMM_FIELDS = ["description", "diagram", "constraint", "concern", "context", "todo", "note"];

export const CONFIDENCE_LABEL = {
  code: "코드 확인",
  device: "기기 검증",
  intent: "설계 의도 / 추정",
};

// 최신성 상태. 검증기가 계산해서 저장하고 생성기가 표시합니다.
export const STATE_LABEL = {
  fresh: "최신",
  stale: "관련 소스 변경됨: 재검토 필요",
  unreviewed: "원본이 갱신됨: 검토 대기",
  unknown: "검증 정보 없음",
  missing: "원본 또는 근거 없음",
};

export function readWritingStyle() {
  return ['README.md', 'i-have-adhd.md', 'fluent-korean.md'].map(name =>
    name + '\n' + fs.readFileSync(CONFIG.styleDir ? repoPath(CONFIG.styleDir, name) : path.join(import.meta.dirname, '../style', name), 'utf8')
  ).join('\n\n');
}

export function evidenceScope(bindings, entry) {
  if (entry.kind === 'omm') return { patterns: entry.evidence, references: [] };
  const meta = readContentBlock(bindings, entry.page, entry.block)?.meta;
  return { patterns: [...(entry.block.based_on ?? []).flatMap(name => bindings.sources[name]?.evidence ?? []), ...citedFiles(meta)],
    references: Array.isArray(meta?.references) ? meta.references.map(String) : [] };
}

export function externalEvidenceText(bindings, entry) {
  if (!CONFIG.jira?.enabled && CONFIG.changes?.mode !== 'commits') return '';
  const read = (name, fallback) => {
    const file = path.join(STATE_DIR, name);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
  };
  const scope = evidenceScope(bindings, entry);
  const saved = read('scopes.json', { entries: {} }).entries[entry.key];
  const commits = selectCommits(saved ? { commits: saved } : read('batch.json', null), scope.patterns);
  const external = CONFIG.jira?.enabled ? selectExternal(read('external.json', {}), commits, scope.references) : { issues: [], confluence: [] };
  return commits.length || external.issues.length || external.confluence.length ? JSON.stringify({ commits, ...external }) : '';
}

export function externalReferences() {
  const file = path.join(STATE_DIR, 'external.json');
  if (!CONFIG.jira?.enabled || !fs.existsSync(file)) return new Map();
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return new Map([
    ...(data.issues ?? []).map(x => [`jira:${x.key}`, x]),
    ...(data.confluence ?? []).filter(x => x.id).map(x => [`confluence:${x.id}`, x]),
  ]);
}

// --- front matter ---------------------------------------------------------
export function splitFrontMatter(text) {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return { meta: {}, body: normalized };
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) throw new Error("front matter 가 닫히지 않았습니다.");
  const metaText = normalized.slice(4, end);
  const body = normalized.slice(end + 5);
  return { meta: parseYaml(metaText) ?? {}, body };
}

// --- 경로 -----------------------------------------------------------------
export function siteRoot(bindings) {
  return repoPath(...bindings.site.root.split("/"));
}

export function pagePath(bindings, page) {
  return path.join(siteRoot(bindings), page);
}

export function contentPath(bindings, page, blockId) {
  const pageDir = page.replace(/\.md$/, "");
  return path.join(siteRoot(bindings), bindings.site.content_dir, pageDir, `${blockId}.md`);
}

export function inputPath(bindings, name) {
  return path.join(siteRoot(bindings), bindings.site.inputs_dir, name);
}

export function readContentBlock(bindings, page, block) {
  const file = contentPath(bindings, page, block.id);
  if (!fs.existsSync(file)) return null;
  const { meta, body } = splitFrontMatter(fs.readFileSync(file, "utf8"));
  return { file, meta, body: body.trim() };
}

// --- 사람 입력 ---------------------------------------------------------------
export function readDecisions(bindings) {
  const file = inputPath(bindings, "decisions.md");
  if (!fs.existsSync(file)) return { file, ids: new Set() };
  const ids = new Set();
  for (const m of fs.readFileSync(file, "utf8").matchAll(/^##\s+(D-\d+)\b/gm)) ids.add(m[1]);
  return { file, ids };
}

export function readVerifications(bindings) {
  const file = inputPath(bindings, "device-verification.yaml");
  if (!fs.existsSync(file)) return { file, records: new Map() };
  const parsed = parseYaml(fs.readFileSync(file, "utf8")) ?? {};
  const records = new Map();
  for (const r of parsed.records ?? []) {
    if (r?.id) records.set(r.id, r);
  }
  return { file, records };
}

// --- 검증 키 -----------------------------------------------------------------
// omm 원본 하나, 원고 하나가 각각 검증 키 하나입니다.
//   omm:<source>                 코드 근거 = evidence 글롭, 원본 = .omm 필드 파일
//   content:<page>/<block-id>    코드 근거 = based_on 의 evidence + 원고가 인용한 sources,
//                                원본 = based_on 의 .omm 필드 + 원고 파일 자체
export function collectKeys(bindings) {
  const keys = [];
  for (const [name, source] of Object.entries(bindings.sources)) {
    if (source.kind !== "omm") continue;
    keys.push({ key: `omm:${name}`, kind: "omm", source: name, evidence: source.evidence ?? [] });
  }
  for (const [page, def] of Object.entries(bindings.pages)) {
    for (const block of def.blocks ?? []) {
      if (block.kind !== "content") continue;
      keys.push({ key: `content:${page}/${block.id}`, kind: "content", page, block });
    }
  }
  return keys;
}

function ommModelText(source) {
  const parts = [];
  for (const field of OMM_FIELDS) parts.push(`${field}\u0000${readOmmField(source, field) ?? ""}`);
  for (const child of ommChildren(source)) parts.push(`child:${child}\u0000${ommModelText(`${source}/${child}`)}`);
  return parts.join("\u0001");
}

// 원고가 인용한 근거 파일. `path/to/File.kt#Symbol` 형태를 허용하고 파일 부분만 씁니다.
export function citedFiles(meta) {
  const cited = Array.isArray(meta?.sources) ? meta.sources : [];
  return cited.map((s) => String(s).split("#")[0]).filter(Boolean);
}

export function computeHashes(bindings, entry) {
  if (entry.kind === "omm") {
    const files = globFiles(entry.evidence);
    return {
      codeHash: hashFiles(files),
      modelHash: hashText(ommModelText(entry.source) + externalEvidenceText(bindings, entry)),
      fileCount: files.length,
      exists: ommExists(entry.source),
    };
  }
  const content = readContentBlock(bindings, entry.page, entry.block);
  const basedOn = entry.block.based_on ?? [];
  const globs = basedOn.flatMap((name) => bindings.sources[name]?.evidence ?? []);
  const files = new Set(globFiles(globs));
  const missingCited = [];
  for (const rel of citedFiles(content?.meta)) {
    if (fs.existsSync(sourcePath(rel))) files.add(rel);
    else missingCited.push(rel);
  }
  const modelParts = basedOn.map((name) => `${name}\u0000${ommModelText(name)}`);
  modelParts.push(`content\u0000${content ? fs.readFileSync(content.file, "utf8") : ""}`);
  // brief.mjs exposes both human-input files and all facts to the writer.
  // Hash their content, not merely the cited IDs, and include the writing contract.
  for (const name of ["decisions.md", "device-verification.yaml"]) {
    const file = inputPath(bindings, name);
    modelParts.push(name + "\u0000" + (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "(missing)"));
  }
  modelParts.push("writing-style\u0000" + readWritingStyle());
  modelParts.push("brief\u0000" + JSON.stringify(entry.block));
  const external = externalEvidenceText(bindings, entry);
  if (external) modelParts.push('external-evidence\u0000' + external);
  const factsFile = path.join(STATE_DIR, 'facts.json');
  modelParts.push("facts\u0000" + (fs.existsSync(factsFile) ? fs.readFileSync(factsFile, "utf8") : "(missing)"));
  return {
    codeHash: hashFiles([...files]),
    modelHash: hashText(modelParts.join("\u0001")),
    fileCount: files.size,
    exists: content !== null,
    missingCited,
  };
}

export function stateOf(current, accepted) {
  if (!accepted) return "unknown";
  if (current.codeHash !== accepted.codeHash) return "stale";
  if (current.modelHash !== accepted.modelHash) return "unreviewed";
  return "fresh";
}
