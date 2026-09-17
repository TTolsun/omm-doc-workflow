#!/usr/bin/env node
// 생성기.
//
// 역할은 "이미 작성된 내용을 정해진 위치에 안전하게 배치"하는 것뿐입니다.
// 글을 쓰지 않고, 코드를 읽지 않고, git 을 호출하지 않습니다.
//
// 입력: _bindings.yaml, .omm/, state/facts.json, state/evidence.json,
//       docs/guide/_content/, docs/guide/_inputs/
// 출력: docs/guide/<page>.md 의 마커 블록 내부만
//
// 두 단계로 동작합니다. 모든 페이지를 메모리에서 만들고 전부 검증한 뒤에야
// 파일을 씁니다. 어느 한 페이지라도 문제가 있으면 아무것도 쓰지 않습니다.
//
// 사용법
//   node generate.mjs           생성 결과를 페이지에 반영합니다.
//   node generate.mjs --check   반영하지 않고, 디스크와 다르면 종료 코드 1 (CI 용)
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CONFIG } from "./config.mjs";
import { repoPath } from "./lib.mjs";
import { externalReferences } from './model.mjs';
import { diagramTypeOf, checkDiagram } from './diagram.mjs';
import { readBindings, readState, readOmmField, ommChildren, ommExists, fail } from "./lib.mjs";
import {
  CONFIDENCE_LABEL,
  STATE_LABEL,
  pagePath,
  readContentBlock,
  readDecisions,
  readVerifications,
  citedFiles,
} from "./model.mjs";

const checkOnly = process.argv.includes("--check");

const bindings = readBindings();
const facts = readState("facts.json", { facts: {} }).facts;
const evidence = readState("evidence.json", { entries: {} }).entries;
const decisions = readDecisions(bindings);
const verifications = readVerifications(bindings);

const BEGIN = /^<!-- omm:begin id=([a-z0-9-]+) -->\s*$/;
const END = /^<!-- omm:end id=([a-z0-9-]+) -->\s*$/;

// --- 페이지 분해 -------------------------------------------------------------
function parsePage(text, page) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(eol);
  const segments = [];
  let prose = [];
  let open = null;
  const seen = new Set();
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const b = line.match(BEGIN);
    const e = line.match(END);
    if (b) {
      if (open) throw new Error(`${page}:${lineNo} 블록 '${open.id}' 가 닫히기 전에 '${b[1]}' 이 시작됩니다.`);
      if (seen.has(b[1])) throw new Error(`${page}:${lineNo} 블록 id '${b[1]}' 이 중복됩니다.`);
      seen.add(b[1]);
      segments.push({ type: "prose", lines: prose });
      prose = [];
      open = { id: b[1], lineNo };
      return;
    }
    if (e) {
      if (!open) throw new Error(`${page}:${lineNo} 열리지 않은 블록 '${e[1]}' 을 닫습니다.`);
      if (open.id !== e[1]) throw new Error(`${page}:${lineNo} 블록 '${open.id}' 를 '${e[1]}' 로 닫습니다.`);
      segments.push({ type: "block", id: open.id });
      open = null;
      return;
    }
    if (!open) prose.push(line);
  });
  if (open) throw new Error(`${page}:${open.lineNo} 블록 '${open.id}' 가 닫히지 않았습니다.`);
  segments.push({ type: "prose", lines: prose });
  return { eol, segments, ids: seen };
}

function assemble(parsed, rendered) {
  const { eol, segments } = parsed;
  const out = [];
  for (const seg of segments) {
    if (seg.type === "prose") {
      out.push(...seg.lines);
    } else {
      out.push(`<!-- omm:begin id=${seg.id} -->`);
      out.push("");
      out.push(...rendered.get(seg.id).split(/\r?\n/));
      out.push("");
      out.push(`<!-- omm:end id=${seg.id} -->`);
    }
  }
  return out.join(eol);
}

// --- 렌더링 ------------------------------------------------------------------
const code = (s) => `\`${s}\``;

function evidenceLine(parts) {
  return ['<details class="doc-evidence" markdown="1">', '<summary>근거와 검토 정보</summary>', "", ...parts.filter(Boolean).map(part => `- ${part}`), "", "</details>"].join("\n");
}

function acceptedNote(key) {
  const rec = evidence[key];
  if (!rec?.accepted) return null;
  return `검토 ${rec.accepted.at}${rec.accepted.commit ? ` @ ${code(rec.accepted.commit)}` : ""}${rec.accepted.reviewer ? ` · ${rec.accepted.reviewer}` : ""}`;
}

function observedState(key) {
  return evidence[key]?.observed?.state ?? "unknown";
}

function firstParagraph(text) {
  if (!text) return null;
  return text.split(/\n\s*\n/)[0].replace(/\s*\n\s*/g, " ").trim();
}

function renderStatus(page, def) {
  const usedOmm = new Set();
  const contents = [];
  for (const b of def.blocks) {
    if (b.source && bindings.sources[b.source]?.kind === "omm") usedOmm.add(b.source);
    for (const s of b.based_on ?? []) usedOmm.add(s);
    if (b.kind === "content") contents.push(b.id);
  }
  const rows = [];
  for (const s of [...usedOmm].sort()) {
    const key = `omm:${s}`;
    rows.push(`| 구조 원본 ${code(s)} | ${STATE_LABEL[observedState(key)]} | ${acceptedNote(key) ?? "—"} |`);
  }
  for (const id of contents) {
    const key = `content:${page}/${id}`;
    rows.push(`| 원고 ${code(id)} | ${STATE_LABEL[observedState(key)]} | ${acceptedNote(key) ?? "—"} |`);
  }
  return [
    ...(projectRenderer?.renderStatus ? [projectRenderer.renderStatus({ facts, code, evidenceLine }), ''] : []),
    "| 항목 | 최신성 | 검토 |",
    "| --- | --- | --- |",
    ...rows,
  ].join("\n");
}

function renderOmmField(block) {
  const text = readOmmField(block.source, block.field);
  if (text === null) throw new Error(`.omm/${block.source}/${block.field} 가 비어 있거나 없습니다.`);
  if (block.field === "diagram") {
    // 손으로 고친 그림이 바인딩의 diagram_type 과 다르면 페이지에 넣지 않습니다. 형식만 보며 내용은 판단하지 않습니다.
    const type = diagramTypeOf(bindings.sources[block.source]);
    const problem = checkDiagram(text, type).find((x) => x.level === "error");
    if (problem) throw new Error(`.omm/${block.source}/diagram (diagram_type: ${type}): ${problem.message}`);
  }
  const body = block.field === "diagram" ? ["```mermaid", text, "```"].join("\n") : text;
  return [
    body,
    "",
    evidenceLine([`근거: ${code(`.omm/${block.source}/${block.field}`)}`, `근거 수준: ${CONFIDENCE_LABEL[block.confidence]}`]),
  ].join("\n");
}

function renderOmmTree(block) {
  const children = ommChildren(block.source);
  if (!children.length) throw new Error(`.omm/${block.source} 에 자식 요소가 없습니다.`);
  const items = children.map((child) => {
    const desc = firstParagraph(readOmmField(`${block.source}/${child}`, "description")) ?? "확인 필요";
    const grandchildren = ommChildren(`${block.source}/${child}`);
    const sub = grandchildren.length ? ` (하위: ${grandchildren.map(code).join(", ")})` : "";
    return `- **${child}**: ${desc}${sub}`;
  });
  return [
    ...items,
    "",
    evidenceLine([`근거: ${code(`.omm/${block.source}/*/description.md`)}`, `근거 수준: ${CONFIDENCE_LABEL[block.confidence]}`]),
  ].join("\n");
}

function renderConcerns(block) {
  const concern = readOmmField(block.source, "concern");
  const todo = readOmmField(block.source, "todo");
  const out = [];
  out.push("다음 항목은 구조 스캔에서 확인한 제약이나 추가 검증이 필요한 사항입니다.");
  out.push("");
  out.push(concern ?? "- (기록 없음)");
  if (todo) {
    out.push("");
    out.push("**후속 작업**");
    out.push("");
    out.push(todo);
  }
  out.push("");
  out.push(evidenceLine([`근거: ${code(`.omm/${block.source}/concern.md`)}, ${code(`.omm/${block.source}/todo.md`)}`, `근거 수준: ${CONFIDENCE_LABEL[block.confidence]}`]));
  return out.join("\n");
}

const projectRenderer = CONFIG.factsRenderer ? await import(pathToFileURL(repoPath(CONFIG.factsRenderer))) : null;
function renderFact(block) {
  if (projectRenderer) return projectRenderer.renderFact(block, {facts, code, evidenceLine, CONFIDENCE_LABEL});
  const data = facts[block.source];
  if (data === undefined) throw new Error('Missing facts: ' + block.source);
  return ['| 항목 | 값 |', '| --- | --- |', ...Object.entries(data).map(([key, value]) => '| ' + key + ' | ' + JSON.stringify(value).replaceAll('|', '&#124;') + ' |')].join('\n');
}

function renderContent(page, block) {
  const content = readContentBlock(bindings, page, block);
  if (!content) throw new Error(`원고 파일이 없습니다: _content/${page.replace(/\.md$/, "")}/${block.id}.md`);
  const meta = content.meta;
  const confidence = meta.confidence ?? block.confidence;
  if (!CONFIDENCE_LABEL[confidence]) throw new Error(`${page}/${block.id}: confidence 값이 잘못되었습니다: ${confidence}`);

  // 근거 수준에 따른 사람 입력 요구. 기기 검증 주장에는 기록이, 설계 의도에는 결정 기록이 있어야 합니다.
  const cited = [];
  const references = externalReferences();
  if (meta.references !== undefined && !Array.isArray(meta.references)) throw new Error('references must be an array');
  for (const id of meta.references ?? []) {
    const reference = references.get(id);
    if (!reference || reference.state !== 'available') throw new Error(`확인할 수 없는 외부 근거: ${id}`);
    cited.push(`문서 근거: [${id}](${reference.url})${reference.revision ? ` · 개정 ${reference.revision}` : ''}`);
  }
  if (confidence === "device") {
    const ids = Array.isArray(meta.verifications) ? meta.verifications : [];
    if (!ids.length) throw new Error(`${page}/${block.id}: confidence=device 인데 verifications 가 없습니다.`);
    for (const id of ids) if (!verifications.records.has(id)) throw new Error(`${page}/${block.id}: 기기 검증 기록 '${id}' 가 device-verification.yaml 에 없습니다.`);
    cited.push(`기기 검증: ${ids.map(code).join(", ")}`);
  }
  if (Array.isArray(meta.decisions) && meta.decisions.length) {
    for (const id of meta.decisions) if (!decisions.ids.has(id)) throw new Error(`${page}/${block.id}: 설계 결정 '${id}' 가 decisions.md 에 없습니다.`);
    cited.push(`설계 결정: ${meta.decisions.map(code).join(", ")}`);
  }

  const key = `content:${page}/${block.id}`;
  const st = observedState(key);
  const review = st === "fresh" ? acceptedNote(key) : `검토 상태: ${STATE_LABEL[st]}`;
  const files = citedFiles(meta);
  return [
    content.body,
    "",
    evidenceLine([
      files.length ? `근거 파일: ${files.map(code).join(", ")}` : null,
      ...cited,
      `근거 수준: ${CONFIDENCE_LABEL[confidence]}`,
      review,
    ]),
  ].join("\n");
}

function renderBlock(page, def, block) {
  switch (block.kind) {
    case "status":
      return renderStatus(page, def);
    case "omm":
      return renderOmmField(block);
    case "omm-tree":
      return renderOmmTree(block);
    case "omm-concerns":
      return renderConcerns(block);
    case "fact":
      return renderFact(block);
    case "content":
      return renderContent(page, block);
    default:
      throw new Error(`${page}/${block.id}: 알 수 없는 블록 kind '${block.kind}'`);
  }
}

// --- 1단계: 전부 만들고 전부 검증 -------------------------------------------------
const plan = [];
const errors = [];
for (const [page, def] of Object.entries(bindings.pages)) {
  const file = pagePath(bindings, page);
  try {
    if (!fs.existsSync(file)) throw new Error(`${page}: 페이지 파일이 없습니다. 산문과 마커가 있는 뼈대를 먼저 만드세요.`);
    const original = fs.readFileSync(file, "utf8");
    const parsed = parsePage(original, page);

    const bound = new Set((def.blocks ?? []).map((b) => b.id));
    for (const id of parsed.ids) if (!bound.has(id)) throw new Error(`${page}: 마커 '${id}' 가 _bindings.yaml 에 없습니다.`);
    for (const id of bound) if (!parsed.ids.has(id)) throw new Error(`${page}: 바인딩된 블록 '${id}' 의 마커가 페이지에 없습니다.`);
    for (const b of def.blocks) {
      if (b.source && !bindings.sources[b.source]) throw new Error(`${page}/${b.id}: 정의되지 않은 source '${b.source}'`);
      if (b.source && bindings.sources[b.source].kind === "omm" && !ommExists(b.source)) throw new Error(`${page}/${b.id}: .omm/${b.source} 가 없습니다.`);
      for (const s of b.based_on ?? []) if (!ommExists(s)) throw new Error(`${page}/${b.id}: based_on 의 .omm/${s} 가 없습니다.`);
    }

    const rendered = new Map();
    for (const b of def.blocks) rendered.set(b.id, renderBlock(page, def, b));
    const next = assemble(parsed, rendered);
    plan.push({ page, file, original, next });
  } catch (err) {
    errors.push(err.message);
  }
}

if (errors.length) {
  process.stderr.write(`생성 중단: 아무 파일도 쓰지 않았습니다.\n${errors.map((e) => `  - ${e}`).join("\n")}\n`);
  process.exit(1);
}

// --- 2단계: 반영 또는 비교 -------------------------------------------------------
const changed = plan.filter((p) => p.original !== p.next);
if (checkOnly) {
  if (changed.length) {
    process.stderr.write(`생성 결과 불일치: ${changed.map((p) => p.page).join(", ")}\n'node generate.mjs' 를 실행해 반영한 뒤 커밋하세요.\n`);
    process.exit(1);
  }
  process.stdout.write(`생성 결과 일치: ${plan.length}개 페이지\n`);
} else {
  for (const p of changed) fs.writeFileSync(p.file, p.next, "utf8");
  process.stdout.write(`생성 완료: ${plan.length}개 페이지 중 ${changed.length}개 갱신${changed.length ? ` (${changed.map((p) => p.page).join(", ")})` : ""}\n`);
}
