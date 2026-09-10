#!/usr/bin/env node
// Run generation in a temporary copy. Only a fully validated result reaches the checkout.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, readBindings, globFiles, resetGlobCache, sourcePath } from './lib.mjs';
import { CONFIG, CONFIG_REL, STATE_REL, STATE_DIR, SOURCE_ROOT } from './config.mjs';
import { collectChanges } from './changes.mjs';
import { collectKeys, readContentBlock, citedFiles } from './model.mjs';
process.env.DOCFLOW_STATE_REL = STATE_REL;
import { ommCli } from './omm-cli.mjs';
import { snapshot, changedFiles, copySnapshot, prepareCommit, applyCommit, recover, journalPath, acquireLock } from './transaction.mjs';

function outputPolicy(bindings) {
  const exact = new Set([`${STATE_REL}/facts.json`, `${STATE_REL}/evidence.json`, `${STATE_REL}/batch.json`, `${STATE_REL}/external.json`]);
  const prefixes = [];
  if (CONFIG.design) exact.add(`${bindings.site.root}/assets/docflow-design.css`);
  for (const [name, source] of Object.entries(bindings.sources)) {
    if (source.kind === 'omm') {
      if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`Invalid perspective: ${name}`);
      prefixes.push(`.omm/${name}/`);
    }
  }
  for (const [page, def] of Object.entries(bindings.pages)) {
    exact.add(`${bindings.site.root}/${page}`);
    for (const block of def.blocks ?? []) if (block.kind === 'content') {
      exact.add(`${bindings.site.root}/${bindings.site.content_dir}/${page.replace(/\.md$/, '')}/${block.id}.md`);
    }
  }
  return rel => exact.has(rel) || prefixes.some(prefix => rel.startsWith(prefix));
}

function sourceSnapshot(bindings) {
  resetGlobCache();
  const globs = [...(CONFIG.sourceInputs ?? []), ...Object.values(bindings.sources).flatMap(s => s.evidence ?? [])];
  const files = new Set(globFiles(globs));
  for (const k of collectKeys(bindings).filter(k => k.kind === 'content')) {
    for (const rel of citedFiles(readContentBlock(bindings, k.page, k.block)?.meta)) files.add(rel);
  }
  return new Map([...files].sort().map(rel => [rel, fs.readFileSync(sourcePath(rel))]));
}
const args = process.argv.slice(2);
const known = new Set(['--dry-run', '--force', '--scan-only', '--write-only', '--recover']);
let temp;
let unlock;
try {
  for (const arg of args) if (!known.has(arg)) throw new Error(`알 수 없는 옵션: ${arg}`);
  if (args.includes('--scan-only') && args.includes('--write-only')) throw new Error('--scan-only와 --write-only는 함께 사용할 수 없습니다.');
  const bindings = readBindings();
  const allowed = outputPolicy(bindings);
  if (args.includes('--recover')) {
    if (args.length !== 1) throw new Error('--recover는 단독으로 실행하세요.');
    unlock = acquireLock(REPO_ROOT, true);
    console.log(recover(REPO_ROOT, allowed) ? '중단된 반영을 실행 전 상태로 복구했습니다.' : '복구할 반영 기록이 없습니다.');
  } else if (args.includes('--dry-run')) {
    const r = spawnSync(process.execPath, [path.join(import.meta.dirname, 'sync-worker.mjs'), ...args], { cwd: REPO_ROOT, stdio: 'inherit' });
    if (r.status !== 0) throw new Error('동기화 계획 확인에 실패했습니다.');
  } else {
    if (fs.existsSync(journalPath(REPO_ROOT))) throw new Error('중단된 반영 기록이 있습니다. sync.mjs --recover를 실행하세요.');
    unlock = acquireLock(REPO_ROOT);
    const before = snapshot(REPO_ROOT);
    const sourceBefore = sourceSnapshot(bindings);
    const changes = collectChanges(CONFIG, SOURCE_ROOT, STATE_DIR);
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hal-docgen-sync-'));
    const stage = path.join(temp, 'project');
    const stageSource = path.join(temp, 'source');
    fs.mkdirSync(stageSource);
    const changeFile = path.join(temp, 'changes.json');
    fs.writeFileSync(changeFile, JSON.stringify(changes));
    fs.mkdirSync(stage);
    copySnapshot(stage, before);
    copySnapshot(stageSource, sourceBefore);
    console.log('임시 복사본에서 동기화를 시작합니다. 검증 전에는 원본 파일을 바꾸지 않습니다.');
    const r = spawnSync(process.execPath, [path.join(import.meta.dirname, 'sync-worker.mjs'), ...args], {
      cwd: stage, stdio: 'inherit', env: { ...process.env, DOCGEN_STAGED_WORKER: '1', DOCFLOW_PROJECT_ROOT: stage, DOCFLOW_SOURCE_ROOT: stageSource, DOCFLOW_CONFIG: CONFIG_REL, DOCFLOW_CHANGE_FILE: changeFile,
        DOCGEN_OMM_CLI: ommCli() },
    });
    if (r.status !== 0) throw new Error(`동기화 실패(${r.status ?? r.error?.code ?? r.signal}). 원본은 변경하지 않았습니다.`);
    const after = snapshot(stage);
    if (changedFiles(sourceBefore, snapshot(stageSource)).length) throw new Error('에이전트가 코드 사본을 수정했습니다. 반영하지 않습니다.');
    if (changedFiles(sourceBefore, sourceSnapshot(bindings)).length) throw new Error('실행 중 코드 원본이 변경되었습니다. 반영하지 않습니다.');
    const concurrent = changedFiles(before, snapshot(REPO_ROOT));
    if (concurrent.length) throw new Error(`실행 중 원본이 바뀌어 반영하지 않습니다: ${concurrent.join(', ')}`);
    // An automatic scan must never manufacture a review record.
    const reviews = files => JSON.parse(files.get(`${STATE_REL}/evidence.json`) ?? '{"entries":{}}').entries;
    const priorReviews = reviews(before);
    const nextReviews = reviews(after);
    for (const key of new Set([...Object.keys(priorReviews), ...Object.keys(nextReviews)])) {
      if (JSON.stringify(nextReviews[key]?.accepted) !== JSON.stringify(priorReviews[key]?.accepted)) throw new Error(`자동 검토 기록 변경 금지: ${key}`);
    }
    const journal = prepareCommit(REPO_ROOT, before, after, allowed);
    applyCommit(REPO_ROOT, journal, allowed);
    console.log(`동기화 결과 ${journal?.entries.length ?? 0}개 파일을 반영했습니다. 검토 승인은 별도로 진행하세요.`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (temp) {
    const resolved = path.resolve(temp);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('hal-docgen-sync-')) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }
  if (unlock) unlock();
}
