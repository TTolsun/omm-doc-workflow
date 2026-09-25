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
//                                   key 를 생략하면 모든 키를 기록합니다. 근거 파일별 blob 해시도 남깁니다.
//   node verify.mjs --changes [key] 상태 표 뒤에, 관련 소스가 바뀐 항목마다 검토 이후 바뀐 근거 코드를 diff 로 보여 줍니다.
//                                   key 를 주면 그 항목만 보여 줍니다. 판정과 검토 기록은 바꾸지 않습니다.
import { execFileSync } from "node:child_process";
import { readBindings, readState, writeState, REPO_ROOT, fail } from "./lib.mjs";
import { collectKeys, collectElements, computeHashes, stateOf, STATE_LABEL } from "./model.mjs";
import { SOURCE_ROOT } from './config.mjs';
import { describeChanges, fileBlobs } from './review-diff.mjs';

const args = process.argv.slice(2);
const mode = args.includes("--check") ? "check" : args.includes("--accept") ? "accept" : "report";
const reviewer = args.find((a) => a.startsWith("--reviewer="))?.slice("--reviewer=".length) || "unspecified";
const targets = args.filter((a) => !a.startsWith("--"));
const showChanges = args.includes("--changes");

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
// Validate scan bindings before accepting or writing any freshness records.
try {
  for (const key of keys.filter(k => k.kind === "omm")) collectElements(bindings, key.source);
} catch (error) { fail(error.message); }

if ((mode === "accept" || showChanges) && targets.length) {
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
    record.accepted = { codeHash: current.codeHash, modelHash: current.modelHash, at: today, commit: head, reviewer, files: fileBlobs(current.files) };
  } else if (record.accepted && !record.accepted.files && record.accepted.codeHash === current.codeHash) {
    // 0.6.0 이전 기록에는 파일별 해시가 없습니다. codeHash 가 같으면 지금 근거가 곧 검토한 근거이므로 채워 둡니다.
    // 검토자·날짜·커밋은 그대로 두어, 검토하지 않은 사람이 기록을 덮어쓰지 않게 합니다.
    record.accepted.files = fileBlobs(current.files);
  }
  const st = stateOf(current, record.accepted);
  record.observed = { state: st };
  state.entries[entry.key] = record;
  rows.push({ key: entry.key, state: st, note: record.accepted ? `검토 ${record.accepted.at} @ ${record.accepted.commit ?? "?"}` : "", current, accepted: record.accepted });
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

// 재검토할 사람은 "무엇이 바뀌었는가"부터 알아야 합니다. 원본을 로컬 모델이 다시 썼더라도 값 변경을 놓쳤을 수 있으므로
// 바뀐 코드를 원본과 직접 대조하게 합니다.
if (showChanges) {
  const maxLines = Number.parseInt(process.env.DOCFLOW_CHANGES_MAX_LINES ?? "", 10) || 400;
  const shown = rows.filter((r) => r.state === "stale" && (!targets.length || targets.includes(r.key)));
  process.stdout.write(shown.length ? "\n" : "\n관련 소스가 바뀐 항목이 없습니다.\n");
  for (const r of shown) {
    const by = r.accepted?.reviewer ? `, ${r.accepted.reviewer}` : "";
    process.stdout.write(`## ${r.key}  (${r.note}${by})\n${describeChanges(r.current, r.accepted, { maxLines }).join("\n")}\n\n`);
  }
}

if (mode === "check" && problems) {
  process.stderr.write(`\n검증 실패: ${problems}개 항목이 최신이 아닙니다. 원본을 재검토한 뒤 'docflow verify --accept' 로 기록하세요.\n`);
  if (rows.some((r) => r.state === "stale")) {
    process.stderr.write(`검토 이후 바뀐 근거 코드는 'docflow verify --changes' 로 확인하고, 원본의 값·조건·순서를 그 코드와 직접 대조하세요.\n`);
  }
  process.exit(1);
}
// 근거 파일이 없는 항목은 검토로 지울 수 없습니다. 조용히 성공하면 CI에서만 드러납니다.
if (mode === "accept" && problems) {
  process.stderr.write(`\n검토 기록 실패: ${problems}개 항목의 원본 또는 인용한 근거 파일이 없습니다. 원고의 sources 를 고친 뒤 다시 실행하세요.\n`);
  process.exit(1);
}
if (mode === "accept") process.stdout.write(`\n검토 기록 완료 (${today}${head ? ` @ ${head}` : ""}).\n`);
