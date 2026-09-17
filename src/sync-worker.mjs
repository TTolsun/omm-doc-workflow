#!/usr/bin/env node
// Internal worker: all mutations occur in the supervisor's disposable copy.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readBindings, readState, writeState, REPO_ROOT, readOmmField } from './lib.mjs';
import { collectKeys, collectElements, contentPath, splitFrontMatter, computeHashes, stateOf, OMM_FIELDS, citedFiles, readContentBlock } from './model.mjs';
import { snapshot as snapshotFiles, changedFiles } from './transaction.mjs';
import { runAgent } from './agent.mjs';
import { positiveInt } from './qwen.mjs';
import { lintManuscript, describeFindings, attachParticles } from './manuscript-lint.mjs';
import { CONFIG, SOURCE_ROOT, STATE_REL } from './config.mjs';
import { DIAGRAM_TYPES, checkDiagram, formatDiagramIssues } from './diagram.mjs';
import { elementInput } from './scan-prompt.mjs';
import { manuscriptFiles, manuscriptPlan, manuscriptPrompt, manuscriptSchema, renderManuscript } from './write-evidence.mjs';

const documentRoots = ['.omm', readBindings().site.root, STATE_REL, CONFIG.styleDir].filter(Boolean);
const snapshot = root => snapshotFiles(root, null, root === REPO_ROOT ? documentRoots : []);

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
if (!dryRun && process.env.DOCGEN_STAGED_WORKER !== '1') throw new Error('sync 명령을 통해 실행하세요.');
const runNode = (name, ...extra) => {
  const r = spawnSync(process.execPath, [path.join(import.meta.dirname, name), ...extra],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${name} 실패: ${r.stderr || r.error?.message || r.stdout}`);
  return r.stdout;
};
const omm = (...extra) => {
  const cli = process.env.DOCGEN_OMM_CLI;
  if (!cli || !fs.existsSync(cli)) throw new Error('OMM CLI가 없습니다. 설치한 OMM CLI 모듈의 경로를 DOCGEN_OMM_CLI로 지정하세요.');
  const r = spawnSync(process.execPath, [cli, ...extra], { cwd: REPO_ROOT, encoding: 'utf8', timeout: positiveInt('DOCGEN_OMM_TIMEOUT_MS', 30000) });
  if (r.status !== 0) {
    const error = new Error(`omm ${extra[0]} 실패: ${r.stderr || r.stdout || r.error?.message}`);
    // 실행 자체가 안 된 경우(시간 초과, 스폰 오류)는 모델 응답 품질과 무관하므로 반려 재요청 대상이 아닙니다.
    error.modelOutput = !r.error && r.status !== null;
    throw error;
  }
};
// 요소의 diagram 을 관점의 diagram_type 에 맞게 검증합니다. graph 계열은 OMM CLI 의 규칙을 그대로 쓰고,
// UML 계열은 OMM 0.2.0 이 graph 선언을 요구하므로 diagram.mjs 의 종류별 규칙으로 검사합니다.
// 두 경로 모두 검증 오류는 modelOutput 으로 표시해 반려 재요청 대상이 되게 합니다.
const validateElement = (element, type) => {
  if (DIAGRAM_TYPES[type].omm) return omm('validate', element);
  const file = path.join(REPO_ROOT, '.omm', ...element.split('/'), 'diagram.mmd');
  if (!fs.existsSync(file)) return;
  const perspectives = fs.readdirSync(path.join(REPO_ROOT, '.omm'), { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name);
  const issues = checkDiagram(fs.readFileSync(file, 'utf8'), type, { element, perspectives });
  if (issues.some(x => x.level === 'error')) {
    const error = new Error(`diagram 검증 실패: ${formatDiagramIssues(element, issues)}`);
    error.modelOutput = true;
    throw error;
  }
};
// 구조 응답의 형태만 검사합니다. 문제가 있으면 반려 사유 문장을, 없으면 빈 문자열을 돌려줍니다.
// 요소 단위 스캔이므로 허용 요소는 하나뿐입니다. 모델이 요소를 파일 경로(.omm/request-flow/diagram.mmd, request-flow/)로 적는 경우는
// 요소 디렉터리가 하나로 정해지므로 요소 경로로 되돌려 받아들입니다. 다만 파일 이름이 field 와 다른 필드를 가리키면 반려합니다.
const checkUpdates = (result, elements) => {
  if (!Array.isArray(result.updates)) return 'updates 배열이 없습니다.';
  const seen = new Set();
  for (const update of result.updates) {
    if (!update || typeof update !== 'object') return `updates 항목이 객체가 아닙니다: ${JSON.stringify(update)}`;
    if (typeof update.element === 'string') {
      const stem = update.element.match(/\/([^/]+)\.(md|mmd)$/)?.[1];
      if (stem && OMM_FIELDS.includes(stem) && stem !== update.field) {
        return `element 의 파일 이름(${stem})과 field(${update.field})가 다른 필드를 가리킵니다. element 에는 요소 경로만 쓰고 field 로 필드를 지정하세요.`;
      }
      update.element = update.element.replace(/^\.omm\//, '').replace(/\/[^/]+\.(md|mmd)$/, '').replace(/\/+$/, '');
    }
    if (!elements.includes(update.element) || !OMM_FIELDS.includes(update.field) || typeof update.text !== 'string' || !update.text.trim()) {
      return `경로·필드·내용이 유효하지 않습니다: ${JSON.stringify({ element: update.element, field: update.field })}. 허용 요소 ${JSON.stringify(elements)}, 허용 필드 ${OMM_FIELDS.join(', ')}. 빈 문자열로 필드를 채우지 않습니다.`;
    }
    const key = `${update.element}/${update.field}`;
    if (seen.has(key)) return `같은 필드를 두 번 수정했습니다: ${key}`;
    seen.add(key);
  }
  return '';
};
// 반려 사유를 붙인 프롬프트가 입력 한도를 넘지 않게 맞춥니다. 전체 목록이 들어가면 그대로, 아니면 위반 줄 인용을 뺀 짧은 목록을,
// 그래도 넘치면 한도에 맞게 자릅니다. agent.mjs 가 뒤에 붙이는 JSON 계약 몫으로 여유를 둡니다.
const fitRejection = (base, full, short) => {
  const room = positiveInt('DOCGEN_MAX_PROMPT_CHARS', 60000) - base.length - 1000;
  if (full.length <= room) return full;
  if (short.length <= room) return short;
  return short.slice(0, Math.max(0, room));
};
// 반려된 요소의 파일을 스냅샷 상태로 되돌립니다. 새로 생긴 파일은 지우고, 바뀐 파일은 원래 바이트로 다시 씁니다.
const restoreFiles = (before, prefix) => {
  for (const rel of changedFiles(before, snapshot(REPO_ROOT)).filter(p => p.startsWith(prefix))) {
    const file = path.join(REPO_ROOT, rel);
    if (before.has(rel)) fs.writeFileSync(file, before.get(rel));
    else fs.rmSync(file, { force: true });
  }
};
// 로그에는 검증 출력 중 오류를 설명하는 첫 줄만 남깁니다. OMM 은 "✗ invalid" 요약 뒤에 "error [규칙] ..." 줄을 냅니다.
const firstProblem = text => {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return lines.find(line => /^error\b/.test(line)) ?? lines.find(line => /없습니다|않습니다|✗/.test(line)) ?? lines[0] ?? '';
};
// 조립한 원고의 계약(based_on, confidence, 인용 근거, 필수 심볼)과 문체 규칙을 검사해 반려 사유 목록을 만듭니다.
// front matter 는 프로그램이 조립하므로 모델 응답에서 검사할 것은 인용 근거와 본문뿐입니다. 계약이 깨지면 본문 검사는 하지 않습니다.
const checkManuscript = (markdown, key, sourceFiles) => {
  const { meta, body } = splitFrontMatter(markdown);
  const findings = [];
  if (!body.trim() || !Array.isArray(meta.based_on) || meta.confidence !== key.block.confidence ||
      JSON.stringify([...meta.based_on].sort()) !== JSON.stringify([...(key.block.based_on ?? [])].sort())) {
    findings.push({ rule: '원고 계약', detail: `본문이 비어 있지 않아야 하며 based_on 은 [${(key.block.based_on ?? []).join(', ')}], confidence 는 ${key.block.confidence} 여야 합니다.` });
  }
  if (!Array.isArray(meta.sources) || (meta.confidence === 'code' && !meta.sources.length) || citedFiles(meta).some(p => !sourceFiles.includes(p))) {
    findings.push({ rule: '코드 근거 인용', detail: `sources 에는 제공된 코드 근거의 상대 경로만 적습니다: ${sourceFiles.join(', ')}` });
  }
  if (meta.confidence !== 'device' && meta.verifications?.length) findings.push({ rule: '기기 검증 기록', detail: 'confidence 가 device 가 아니면 verifications 는 빈 목록이어야 합니다.' });
  // 모델이 식별자를 쪼개거나 바꿔 쓰면(kBuffer Limit, canReceive) 독자가 코드를 찾지 못하므로 바인딩의 must_link 는 본문에 그대로 있어야 합니다.
  const missing = (key.block.brief?.must_link ?? []).filter(symbol => !body.includes(symbol));
  if (missing.length) findings.push({ rule: '필수 심볼', detail: `본문에 다음 심볼을 코드에 적힌 그대로 써야 합니다: ${missing.join(', ')}` });
  return findings.length ? findings : lintManuscript(body);
};
// 에이전트는 수정안만 반환합니다. 문서 사본이나 코드 사본을 직접 고치면 실패로 처리합니다.
async function qwen(prompt, schema) {
  const before = snapshot(REPO_ROOT);
  const codeBefore = snapshot(SOURCE_ROOT);
  const result = await runAgent(prompt, schema);
  if (changedFiles(before, snapshot(REPO_ROOT)).length || changedFiles(codeBefore, snapshot(SOURCE_ROOT)).length) throw new Error('에이전트가 수정안 반환 대신 파일을 수정했습니다.');
  return result;
}
const schema = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

try {
  if (!dryRun && (CONFIG.jira?.enabled || CONFIG.changes?.mode === 'commits')) console.log(runNode('collect.mjs'));
  console.log('1/4 추출과 최신성 검사');
  runNode('extract.mjs', ...(dryRun ? ['--dry-run'] : []));
  runNode('verify.mjs', ...(dryRun ? ['--dry-run'] : []));
  const bindings = readBindings();
  const evidence = readState('evidence.json', { entries: {} }).entries;
  const keys = collectKeys(bindings);
  const needs = key => {
    const current = computeHashes(bindings, key);
    return args.has('--force') || !current.exists || current.missingCited?.length || stateOf(current, evidence[key.key]?.accepted) !== 'fresh';
  };
  const scans = keys.filter(k => k.kind === 'omm' && needs(k));
  const scanState = readState('scan.json', { schema: 1, entries: {} });
  if (scanState?.schema !== 1 || !scanState.entries || typeof scanState.entries !== 'object' || Array.isArray(scanState.entries)) {
    throw new Error('scan.json 형식이 유효하지 않습니다.');
  }
  let scanned = 0;
  console.log(`  재스캔 대상 perspective: ${scans.map(k => k.source).join(', ') || '(없음)'}`);
  console.log('2/4 Qwen 구조 갱신');
  if (!args.has('--write-only')) for (const k of scans) {
    // 최신성은 관점 단위로 판정하지만 스캔은 요소 단위로 나눠 프롬프트 한도 안에서 실행합니다.
    // 근거가 바뀌지 않은 요소는 scan.json 의 기록으로 건너뜁니다(--force 는 무시).
    const elements = collectElements(bindings, k.source);
    if (!elements.length) throw new Error(`기존 OMM 구조가 없습니다: ${k.source}`);
    console.log(`  - ${k.source} (diagram_type: ${k.diagramType}, 요소 ${elements.length}개)`);
    for (const element of elements) {
      const input = elementInput(element, bindings, k);
      const cached = scanState.entries[element.path];
      if (!args.has('--force') && cached?.codeHash === input.codeHash && Number.isFinite(Date.parse(cached.scannedAt))) {
        console.log(`    · ${element.path}: 근거 변경 없음, 건너뜀`);
        continue;
      }
      console.log(`    · ${element.path}: 입력 ${input.prompt.length}자, 근거 ${input.files.length}개`);
      if (dryRun) continue;
      const started = Date.now();
      const before = snapshot(REPO_ROOT);
      const prefix = `.omm/${element.path}/`;
      // OMM CLI may register an existing child in its parent's metadata.
      const parentMeta = element.parent && `.omm/${element.parent}/meta.yaml`;
      const updateSchema = schema({ updates: { type: 'array', items: schema({
        element: { type: 'string', enum: [element.path] }, field: { type: 'string', enum: OMM_FIELDS }, text: { type: 'string', minLength: 1 },
      }) } });
      // 로컬 모델은 diagram 을 방향 선언 없이 다시 쓰는 등 OMM 검증에 걸리는 응답을 자주 냅니다.
      // 사본에 적용해 검증하고, 실패하면 그 요소의 파일만 되돌린 뒤 검증 오류를 붙여 다시 요청합니다.
      const attempts = positiveInt('DOCFLOW_SCAN_ATTEMPTS', 3);
      let done = false, rejection = '', reason = '';
      for (let attempt = 1; attempt <= attempts && !done; attempt++) {
        const result = await qwen(input.prompt + rejection, updateSchema);
        reason = checkUpdates(result, [element.path]);
        if (!reason) {
          for (const update of result.updates) {
            if (readOmmField(update.element, update.field) === update.text.replace(/\r\n/g, '\n').trim()) continue;
            console.log(`      수정: ${update.element}/${update.field}`);
            omm('write', update.element, update.field, update.text);
          }
          // 범위 위반은 모델 응답 품질이 아니라 실행기 안전 조건이므로 다시 요청하지 않습니다.
          const outside = changedFiles(before, snapshot(REPO_ROOT)).filter(p => path.posix.dirname(p) !== `.omm/${element.path}` && p !== parentMeta);
          if (outside.length) throw new Error(`구조 갱신 범위 위반: ${outside.join(', ')}`);
          try { validateElement(element.path, k.diagramType); done = true; }
          catch (error) {
            // CLI 시간 초과나 스폰 오류는 다시 요청해도 같으므로 그대로 실패시킵니다. 검증 오류만 반려 사유가 됩니다.
            if (!error.modelOutput) throw error;
            reason = error.message; restoreFiles(before, prefix);
          }
        }
        if (!done) {
          console.log(`      구조 반려 ${attempt}/${attempts}: ${firstProblem(reason)}`);
          const guide = `\n\n## 이전 응답 반려 사유\n이전 응답은 다음 이유로 반려되었습니다. 같은 근거로 다시 응답하되 아래 문제를 고칩니다.
- element 는 ${JSON.stringify(element.path)} 를 그대로 씁니다. 파일 이름이나 .omm/ 접두사를 붙이지 않습니다.
- diagram 을 고칠 때는 바뀐 줄만 보내지 않고 전체를 보냅니다.
- text 는 해당 필드의 전체 내용이며 빈 문자열이 아닙니다.
반려 이유:\n`;
          rejection = fitRejection(input.prompt, guide + reason, guide + firstProblem(reason));
        }
      }
      if (!done) throw new Error(`${element.path}: 구조 스캔이 ${attempts}회 시도 후에도 검증을 통과하지 못했습니다: ${firstProblem(reason)}`);
      scanState.entries[element.path] = { codeHash: input.codeHash, scannedAt: new Date().toISOString() };
      scanned++;
      console.log(`      완료: ${element.path}, ${((Date.now() - started) / 1000).toFixed(1)}초`);
    }
  }
  if (scanned) writeState('scan.json', scanState);
  console.log('3/4 Qwen 원고 갱신');
  if (!args.has('--scan-only')) for (const k of keys.filter(k => k.kind === 'content' && needs(k))) {
    console.log(`  - ${k.page}/${k.block.id}`);
    // 집필 근거는 관점 evidence 전체가 아니라 원고가 인용한 파일과 must_link 파일입니다. 한도를 넘으면 근거를 나눠 요약한 뒤 집필합니다.
    const sourceFiles = manuscriptFiles(bindings, k);
    const plan = manuscriptPlan(k, runNode('brief.mjs', k.page, k.block.id), sourceFiles);
    const prompt = await manuscriptPrompt(plan, qwen, dryRun);
    if (dryRun) continue;
    const existingMeta = readContentBlock(bindings, k.page, k.block)?.meta;
    // 로컬 모델은 집필 규칙을 확률적으로만 따릅니다. 계약과 문체 검사를 통과할 때까지 반려 사유를 붙여 다시 요청하고,
    // 횟수를 다 쓰면 원본을 건드리지 않고 실패합니다. 반려는 모델 호출 실패가 아니므로 agent.mjs 의 재시도와 별개입니다.
    const attempts = positiveInt('DOCFLOW_WRITER_ATTEMPTS', 3);
    let accepted, rejection = '', summary = '';
    for (let attempt = 1; attempt <= attempts && accepted === undefined; attempt++) {
      const result = await qwen(prompt + rejection, manuscriptSchema(k, sourceFiles));
      let findings;
      try {
        // 식별자 뒤 조사 띄어쓰기는 가장 흔한 위반이고 공백 한 칸 제거로 끝나므로 재요청 대신 정리합니다. 정리 횟수는 로그로 남깁니다.
        const { text: markdown, count } = attachParticles(renderManuscript(k, result, existingMeta));
        if (count) console.log(`    원고 정리: 조사 띄어쓰기 ${count}곳`);
        findings = checkManuscript(markdown, k, sourceFiles);
        if (!findings.length) { accepted = markdown; break; }
      } catch (error) {
        // 답변 누락·길이 초과·front matter 흉내 같은 조립 실패도 모델 응답 문제이므로 반려 사유가 됩니다.
        findings = [{ rule: '응답 형식', detail: `${error.message} 응답은 {"sections":{"answer_1":...},"sources":[...]} 이어야 합니다.` }];
      }
      const described = describeFindings(findings);
      summary = described.summary;
      console.log(`    원고 반려 ${attempt}/${attempts}: ${summary}`);
      const guide = '\n\n## 이전 응답 반려 사유\n\n이전 응답은 다음 규칙을 어겨 반려되었습니다. 같은 근거로 답변 전체를 다시 쓰되 아래 항목을 모두 고칩니다.\n\n';
      rejection = fitRejection(prompt, guide + described.list, guide + described.brief);
    }
    if (accepted === undefined) throw new Error(`${k.page}/${k.block.id}: 원고가 ${attempts}회 시도 후에도 집필 규칙을 통과하지 못했습니다: ${summary}`);
    const target = contentPath(bindings, k.page, k.block.id);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, accepted);
  }
  console.log('4/4 검증과 문서 생성');
  if (!dryRun) {
    console.log(runNode('verify.mjs'));
    console.log(runNode('inspect.mjs'));
    console.log(runNode('generate.mjs'));
    console.log(runNode('design.mjs'));
  } else console.log('[dry-run] 실제 변경 없음');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
