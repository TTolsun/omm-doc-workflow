// Disposable input for deterministic fault tests and the opt-in local model smoke test.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ommCli } from '../src/omm-cli.mjs';
export const probeFile = 'app/src/main/java/dev/halcamera/Probe.kt';
export function makeFixture(blocks = 1) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hal-docgen-fixture-'));
  const put = (rel, text) => {
    const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text);
  };
  fs.cpSync(path.join(import.meta.dirname, '../src'), path.join(root, 'tools/docgen'), { recursive: true,
    filter: p => !['node_modules', 'state'].includes(path.basename(p)) });
  fs.cpSync(path.join(import.meta.dirname, '../style'), path.join(root, 'tools/docgen/style'), {recursive:true});
  put('docflow.json', JSON.stringify({version:1,sourceRoot:'.',bindings:'docs/guide/_bindings.yaml',stateDir:'tools/docgen/state',styleDir:'tools/docgen/style',agent:{kind:'ollama',model:'qwen3.5:4b'}}));
  put(probeFile, 'package dev.halcamera\nobject Probe { const val OBSERVE_MS = 10000L }\n');
  put('app/build.gradle.kts', 'android { namespace = "dev.halcamera" }\n');
  put('.omm/config.yaml', 'version: 0.1.0\nlanguage: Korean\n');
  put('.omm/sync-probe/description.md', 'Probe.OBSERVE_MS는 관측 시간을 10000ms로 지정합니다.\n');
  put('.omm/sync-probe/diagram.mmd', 'graph LR\n  timer["관측 시간"]\n');
  put('.omm/sync-probe/timer/description.md', 'Probe.OBSERVE_MS는 10000ms입니다.\n');
  let binding = 'version: 2\nsite:\n  root: docs/guide\n  content_dir: _content\n  inputs_dir: _inputs\nsources:\n  sync-probe:\n    kind: omm\n    evidence:\n      - ' + probeFile + '\npages:\n  probe.md:\n    title: 관측 시간\n    blocks:\n      - id: status\n        kind: status\n';
  let page = '# 관측 시간\n\n이 문장은 사람이 관리합니다.\n\n<!-- omm:begin id=status -->\n<!-- omm:end id=status -->\n';
  for (let i = 0; i < blocks; i++) {
    binding += `      - id: overview-${i}\n        kind: content\n        based_on: [sync-probe]\n        confidence: code\n        brief:\n          reader: HAL 개발자\n          answers:\n            - Probe.OBSERVE_MS가 지정하는 관측 시간은 몇 ms인가\n`;
    page += `\n<!-- omm:begin id=overview-${i} -->\n<!-- omm:end id=overview-${i} -->\n`;
    put(`docs/guide/_content/probe/overview-${i}.md`, manuscript('10000'));
  }
  put('docs/guide/_bindings.yaml', binding); put('docs/guide/probe.md', page);
  put('docs/guide/_inputs/decisions.md', '# 설계 결정\n');
  put('docs/guide/_inputs/device-verification.yaml', 'records: []\n');
  for (const [script, args] of [['extract.mjs', []], ['verify.mjs', ['--accept']], ['generate.mjs', []]]) {
    const r = spawnSync(process.execPath, [path.join(root, 'tools/docgen', script), ...args], { cwd: root, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stdout + r.stderr);
  }
  put(probeFile, 'package dev.halcamera\nobject Probe { const val OBSERVE_MS = 12000L }\n');
  return { root, put, cleanup() {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('hal-docgen-fixture-')) throw new Error('Unsafe cleanup');
    fs.rmSync(root, { recursive: true, force: true });
  } };
}
export const manuscript = ms => `---\nbased_on: [sync-probe]\nconfidence: code\nsources:\n  - ${probeFile}#Probe.OBSERVE_MS\ndecisions: []\nverifications: []\n---\nProbe.OBSERVE_MS는 관측 시간을 ${ms}ms로 지정합니다.\n`;
export function runSync(root, env = {}, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'tools/docgen/sync.mjs'), ...args], {
      cwd: root, env: { ...process.env, DOCGEN_OMM_CLI: ommCli(), ...env },
      windowsHide: true,
    });
    let out = ''; child.stdout.on('data', x => { out += x; }); child.stderr.on('data', x => { out += x; });
    child.on('error', reject); child.on('close', code => resolve({ code, out }));
  });
}
