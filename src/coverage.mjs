#!/usr/bin/env node
// 담당 요소 검사.
//
// 검증기(verify.mjs)는 "기존 절이 낡았는가"만 봅니다. 이 스크립트는 반대 질문에 답합니다.
//   새 화면이나 패키지가 생겼는데, 그것을 담당하는 요소나 원고가 없는가?
//
// 검사 대상은 프로젝트가 정합니다. docflow.json 의 `coverageAdapter` 가 가리키는 모듈이
// `coverageTargets({ globFiles, sourcePath })` 를 내보내고, 검사 대상 경로 → { kind, files } 맵을 반환합니다.
// 어댑터가 없으면 검사 대상이 없으므로 항상 통과합니다.
//
// "담당이 있다"의 정의
//   - 바인딩의 sources.*.elements.*.evidence 에 명시된 글롭에 매치되거나
//   - 바인딩의 coverage.ignore 에 사유와 함께 적혀 있으면 담당이 있는 것으로 봅니다.
//   관점 전체 evidence(**/*.kt 같은 넓은 글롭)는 세지 않습니다. 그것까지 세면 무엇이든 담당이 있게 됩니다.
//   원고의 sources: 인용도 세지 않습니다. 인용은 문단 하나의 근거이지 요소의 소유가 아닙니다.
//
// 사용법
//   docflow coverage           표를 출력합니다.
//   docflow coverage --check   누락이 하나라도 있으면 종료 코드 1 (CI 용)
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CONFIG } from "./config.mjs";
import { readBindings, globFiles, repoPath, sourcePath, fail } from "./lib.mjs";

const args = process.argv.slice(2);
const check = args.includes("--check");

// --- 담당 목록 -------------------------------------------------------------------
export function coveredFiles(bindings) {
  const globs = [];
  for (const source of Object.values(bindings.sources ?? {})) {
    if (source.kind !== "omm") continue;
    for (const element of Object.values(source.elements ?? {})) {
      if (Array.isArray(element?.evidence)) globs.push(...element.evidence);
    }
  }
  return new Set(globFiles(globs));
}

export function ignoredTargets(bindings) {
  const list = bindings.coverage?.ignore ?? [];
  if (!Array.isArray(list)) throw new Error("coverage.ignore 는 목록이어야 합니다.");
  const map = new Map();
  for (const entry of list) {
    if (!entry?.path || !entry?.reason) throw new Error(`coverage.ignore 항목에는 path 와 reason 이 모두 필요합니다: ${JSON.stringify(entry)}`);
    map.set(String(entry.path), String(entry.reason));
  }
  return map;
}

// --- 검사 대상 -------------------------------------------------------------------
export async function coverageTargets() {
  if (!CONFIG.coverageAdapter) return new Map();
  const adapter = await import(pathToFileURL(repoPath(CONFIG.coverageAdapter)));
  if (typeof adapter.coverageTargets !== "function") throw new Error("coverageAdapter 는 coverageTargets 함수를 내보내야 합니다.");
  const targets = await adapter.coverageTargets({ globFiles, sourcePath });
  if (!(targets instanceof Map)) throw new Error("coverageTargets 는 Map 을 반환해야 합니다.");
  for (const [key, target] of targets) {
    if (typeof key !== "string" || !key || typeof target?.kind !== "string" || !Array.isArray(target.files) || target.files.some(f => typeof f !== "string")) {
      throw new Error(`coverageTargets 항목이 유효하지 않습니다: ${JSON.stringify(key)}`);
    }
  }
  return targets;
}

// 여러 파일로 이루어진 대상은 파일 하나라도 담당이 있으면 담당이 있는 것으로 봅니다. 파일 하나인 대상은 그 파일 자체가 있어야 합니다.
export async function coverageReport(bindings) {
  const covered = coveredFiles(bindings);
  const ignored = ignoredTargets(bindings);
  const rows = [];
  const targets = await coverageTargets();
  for (const [key, target] of targets) {
    if (ignored.has(key)) { rows.push({ key, kind: target.kind, state: "ignored", note: ignored.get(key) }); continue; }
    const hit = target.files.filter((f) => covered.has(f));
    if (hit.length) rows.push({ key, kind: target.kind, state: "covered", note: target.files.length > 1 ? `${hit.length}/${target.files.length} 파일` : "" });
    else rows.push({ key, kind: target.kind, state: "missing", note: "담당 요소 없음" });
  }
  for (const key of ignored.keys()) {
    if (!targets.has(key)) rows.push({ key, kind: "ignore", state: "unused", note: "coverage.ignore 에 있지만 검사 대상이 아닙니다" });
  }
  return rows;
}

const LABEL = { covered: "담당 있음", ignored: "제외", missing: "누락", unused: "불필요한 제외" };

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let bindings;
  try { bindings = readBindings(); } catch (error) { fail(error.message); }
  let rows;
  try { rows = await coverageReport(bindings); } catch (error) { fail(error.message); }
  if (!rows.length) {
    process.stdout.write(CONFIG.coverageAdapter ? "담당 요소 검사 대상이 없습니다.\n" : "coverageAdapter 가 없어 담당 요소 검사를 건너뜁니다.\n");
  } else {
    const width = Math.max(...rows.map((r) => r.key.length));
    for (const r of rows) process.stdout.write(`${r.key.padEnd(width)}  ${LABEL[r.state]}${r.note ? `  (${r.note})` : ""}\n`);
  }
  const problems = rows.filter((r) => r.state === "missing" || r.state === "unused");
  if (check && problems.length) {
    process.stderr.write(`\n담당 요소 검사 실패: ${problems.length}개 항목. 새 대상은 바인딩의 elements evidence 에 넣고, 문서화하지 않을 것은 coverage.ignore 에 사유와 함께 적으세요.\n`);
    process.exit(1);
  }
}
