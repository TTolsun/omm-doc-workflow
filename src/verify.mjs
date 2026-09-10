#!/usr/bin/env node
// 검증기.
//
// 두 가지 질문에 답합니다.
//   1. 관련 코드가 바뀌었는데 .omm/ 이나 원고의 재검토가 빠졌는가?  (원본 최신성)
//   2. 원본이 바뀌었는데 사람의 검토(accept)가 아직인가?            (검토 대기)
//
// 소유권: 이 스크립트만 state/evidence.json 을 씁니다.
// 코드와 git 을 읽는 것은 이 단계까지입니다. 생성기는 여기 저장된 결과만 봅니다.
//
// 사용법
//   node verify.mjs                 상태 표를 출력하고 observed 를 갱신합니다.
//   node verify.mjs --check         하나라도 "최신"이 아니면 종료 코드 1 (CI 용)
//   node verify.mjs --accept [key]  사람이 검토를 마친 뒤 현재 해시를 기준으로 기록합니다.
//                                   key 를 생략하면 모든 키를 기록합니다.
import { execFileSync } from "node:child_process";
import { readBindings, readState, writeState, REPO_ROOT, fail } from "./lib.mjs";
import { collectKeys, computeHashes, stateOf, STATE_LABEL } from "./model.mjs";
import { SOURCE_ROOT } from './config.mjs';

const args = process.argv.slice(2);
const mode = args.includes("--check") ? "check" : args.includes("--accept") ? "accept" : "report";
const reviewer = args.find((a) => a.startsWith("--reviewer="))?.slice("--reviewer=".length) || "unspecified";
const targets = args.filter((a) => !a.startsWith("--"));

function gitShortHead() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: SOURCE_ROOT, encoding: "utf8", stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

const bindings = readBindings();
const state = readState("evidence.json", { schema: 1, entries: {} });
const keys = collectKeys(bindings);

if (mode === "accept" && targets.length) {
  const known = new Set(keys.map((k) => k.key));
  for (const t of targets) if (!known.has(t)) fail(`알 수 없는 검증 키입니다: ${t}`);
}

const today = new Date().toISOString().slice(0, 10);
const head = gitShortHead();
const rows = [];
let problems = 0;

for (const entry of keys) {
  const current = computeHashes(bindings, entry);
  const record = state.entries[entry.key] ?? {};

  if (!current.exists) {
    record.observed = { state: "missing" };
    state.entries[entry.key] = record;
    rows.push({ key: entry.key, state: "missing", note: "원본 파일이 없습니다" });
    problems += 1;
    continue;
  }
  if (current.missingCited?.length) {
    record.observed = { state: "missing" };
    state.entries[entry.key] = record;
    rows.push({ key: entry.key, state: "missing", note: `인용한 근거 파일이 없습니다: ${current.missingCited.join(", ")}` });
    problems += 1;
    continue;
  }

  const accepting = mode === "accept" && (targets.length === 0 || targets.includes(entry.key));
  if (accepting) {
    record.accepted = { codeHash: current.codeHash, modelHash: current.modelHash, at: today, commit: head, reviewer };
  }
  const st = stateOf(current, record.accepted);
  record.observed = { state: st };
  state.entries[entry.key] = record;
  rows.push({ key: entry.key, state: st, note: record.accepted ? `검토 ${record.accepted.at} @ ${record.accepted.commit ?? "?"}` : "" });
  if (st !== "fresh") problems += 1;
}

// 바인딩에서 사라진 키는 정리합니다.
for (const key of Object.keys(state.entries)) {
  if (!keys.some((k) => k.key === key)) delete state.entries[key];
}

if (!args.includes("--dry-run")) writeState("evidence.json", state);

const width = Math.max(...rows.map((r) => r.key.length));
for (const r of rows) {
  const label = r.state === "missing" ? "원본 없음" : STATE_LABEL[r.state];
  process.stdout.write(`${r.key.padEnd(width)}  ${label}${r.note ? `  (${r.note})` : ""}\n`);
}

if (mode === "check" && problems) {
  process.stderr.write(`\n검증 실패: ${problems}개 항목이 최신이 아닙니다. 원본을 재검토한 뒤 'node verify.mjs --accept' 로 기록하세요.\n`);
  process.exit(1);
}
if (mode === "accept") process.stdout.write(`\n검토 기록 완료 (${today}${head ? ` @ ${head}` : ""}).\n`);
