#!/usr/bin/env node
// 문서 검사 진입점. CI 와 개발자 PC 가 같은 순서로 같은 검사를 실행합니다.
//
//   docflow check            로컬: 검사만 실행합니다. git 작업본 비교는 건너뜁니다.
//   docflow check --ci       CI:   마지막에 `git diff --exit-code` 로 상태 파일·원고·산출물이 커밋과 같은지도 봅니다.
//   docflow check --build    로컬: 검사 뒤 사이트 산출물을 실제로 빌드합니다 (배포 준비).
//
// 종료 코드
//   0  모든 단계 통과
//   1  검사 실패. 실패한 단계 이름을 마지막 줄에 표시하며 뒤 단계는 실행하지 않습니다.
//   2  실행 환경 문제 (Node 버전, 알 수 없는 인자)
//
// 단계 (실행 순서대로)
//   1. 디자인 생성 결과 일치      design --check   (docflow.json 에 design 이 있을 때)
//   2. 코드 근거 표시 정보 일치    inspect --check  (design.preset 이 reading·architecture 일 때)
//   3. 사실 추출                extract          (state/facts.json 을 다시 씁니다)
//   4. 원본 최신성 검사          verify --check
//   5. 담당 요소 검사            coverage --check (coverageAdapter 가 있을 때)
//   6. 생성 결과 일치 검사        generate --check
//   7. 사이트 산출물 일치 검사     site check       (site.root/_config.yml 이 있을 때)
//   8. (--ci) 상태 파일 일치 검사  git diff --exit-code -- <stateDir> <site.root> <output>
//   8. (--build) 사이트 빌드      site build
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { CONFIG, PROJECT_ROOT, STATE_REL } from "./config.mjs";
import { readBindings } from "./lib.mjs";
import { parseYaml } from "./yaml-lite.mjs";

const REQUIRED_NODE_MAJOR = 24;
const args = process.argv.slice(2);
const known = new Set(["--ci", "--build"]);
for (const arg of args) {
  if (!known.has(arg)) { console.error(`알 수 없는 인자: ${arg} (--ci | --build)`); process.exit(2); }
}
const ci = args.includes("--ci");
const buildSite = args.includes("--build");
if (ci && buildSite) { console.error("--ci 와 --build 는 함께 쓸 수 없습니다. CI 는 커밋된 산출물을 검사만 합니다."); process.exit(2); }

const major = Number(process.versions.node.split(".")[0]);
if (major < REQUIRED_NODE_MAJOR) {
  console.error(`Node.js ${REQUIRED_NODE_MAJOR} 이상이 필요합니다. 현재: ${process.version}`);
  process.exit(2);
}

const bindings = readBindings();
const siteConfigFile = path.join(PROJECT_ROOT, bindings.site.root, "_config.yml");
const hasSite = fs.existsSync(siteConfigFile);
const siteOutput = hasSite ? parseYaml(fs.readFileSync(siteConfigFile, "utf8").replace(/\r\n/g, "\n"))?.output : null;

const node = process.execPath;
const script = (name, ...extra) => ({ cmd: node, args: [path.join(import.meta.dirname, name), ...extra] });
const steps = [];
if (CONFIG.design) steps.push({ name: "디자인 생성 결과 일치 검사", ...script("design.mjs", "--check") });
if (["reading", "architecture"].includes(CONFIG.design?.preset)) steps.push({ name: "코드 근거 표시 정보 일치 검사", ...script("inspect.mjs", "--check") });
steps.push({ name: "사실 추출", ...script("extract.mjs") });
steps.push({ name: "원본 최신성 검사", ...script("verify.mjs", "--check") });
if (CONFIG.coverageAdapter) steps.push({ name: "담당 요소 검사", ...script("coverage.mjs", "--check") });
steps.push({ name: "생성 결과 일치 검사", ...script("generate.mjs", "--check") });
if (hasSite) steps.push({ name: "사이트 산출물 일치 검사", ...script("site.mjs", "check") });
if (ci) {
  const tracked = [STATE_REL, bindings.site.root, ...(siteOutput ? [siteOutput] : [])];
  steps.push({ name: "상태 파일 일치 검사", cmd: "git", args: ["diff", "--exit-code", "--", ...tracked] });
}
if (buildSite) {
  if (!hasSite) { console.error(`--build 에는 ${bindings.site.root}/_config.yml 이 필요합니다.`); process.exit(2); }
  // 로컬 배포 준비: 검사가 모두 통과한 뒤에만 산출물을 씁니다.
  steps.splice(steps.length - 1, 1, { name: "사이트 빌드", ...script("site.mjs", "build") });
}

for (const [index, step] of steps.entries()) {
  console.log(`\n[${index + 1}/${steps.length}] ${step.name}`);
  const result = spawnSync(step.cmd, step.args, { cwd: PROJECT_ROOT, stdio: "inherit", windowsHide: true });
  if (result.error) { console.error(result.error.message); }
  if (result.status !== 0) {
    console.error(`\n실패: ${step.name} (종료 코드 ${result.status ?? "없음"}). 뒤 단계는 실행하지 않았습니다.`);
    process.exit(1);
  }
}
console.log(`\n문서 검사 통과 (${steps.length}단계).${buildSite ? ` ${siteOutput}/ 산출물을 커밋하세요.` : ""}`);
