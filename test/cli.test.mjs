import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeFixture } from './helper.mjs';
import { snapshot, changedFiles } from '../src/transaction.mjs';

const repo = path.resolve(import.meta.dirname, '..');
const cli = path.join(repo, 'bin/docflow.mjs');
export function runCli(root, command, args = [], env = {}) {
  const result = spawnSync(process.execPath, [cli, command, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: result.status, out: result.stdout + result.stderr };
}

test('public CLI runs example dry-run and generated-page checks without mutation', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docflow-cli-'));
  t.after(() => { if (path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('docflow-cli-')) fs.rmSync(root, { recursive: true, force: true }); });
  fs.cpSync(path.join(repo, 'examples/camera-hal'), root, { recursive: true, filter: p => path.basename(p) !== '.docflow' });
  const source = path.join(repo, 'fixtures/camera-hal');
  const before = snapshot(root);
  for (const [command, args] of [['sync', ['--dry-run']], ['verify', ['--dry-run']], ['generate', ['--check']]]) {
    const r = runCli(repo, command, ['--project', root, '--source', source, ...args]);
    assert.equal(r.code, 0, r.out);
  }
  assert.deepEqual(changedFiles(before, snapshot(root)), []);
});

test('public CLI uses cwd, accepts relative configs and rejects absolute configs and unknown commands', t => {
  const f = makeFixture(); t.after(f.cleanup);
  let r = runCli(f.root, 'sync', ['--dry-run']); assert.equal(r.code, 0, r.out);
  f.put('alternate.json', fs.readFileSync(path.join(f.root, 'docflow.json')));
  r = runCli(repo, 'sync', ['--project', f.root, '--config', 'alternate.json', '--dry-run']); assert.equal(r.code, 0, r.out);
  r = runCli(repo, 'sync', ['--project', f.root, '--config', path.join(f.root, 'alternate.json'), '--dry-run']);
  assert.equal(r.code, 1); assert.match(r.out, /프로젝트 상대 경로/);
  r = runCli(f.root, 'nonsense'); assert.equal(r.code, 1);
  r = runCli(f.root, 'sync', ['--project']); assert.equal(r.code, 1); assert.match(r.out, /needs a value/);
  r = runCli(f.root, 'ack', ['--reviewer=test', '--source-commit=abc']); assert.equal(r.code, 1); assert.match(r.out, /commits에서만/);
});

test('doctor distinguishes missing Hermes executable from an unsupported CLI contract', t => {
  const f = makeFixture(); t.after(f.cleanup);
  const config = JSON.parse(fs.readFileSync(path.join(f.root, 'docflow.json')));
  config.agent.kind = 'hermes'; f.put('docflow.json', JSON.stringify(config));
  let r = runCli(f.root, 'doctor', [], { DOCFLOW_HERMES_CLI: path.join(f.root, 'missing.exe') });
  assert.equal(r.code, 1); assert.match(r.out, /ENOENT/);
  f.put('hermes-test.mjs', 'console.log("unsupported")');
  r = runCli(f.root, 'doctor', [], { DOCFLOW_HERMES_CLI: path.join(f.root, 'hermes-test.mjs') });
  assert.equal(r.code, 1); assert.match(r.out, /--query-file 지원/);
  f.put('hermes-test.mjs', 'console.log("--query-file")');
  r = runCli(f.root, 'doctor', [], { DOCFLOW_HERMES_CLI: path.join(f.root, 'hermes-test.mjs') });
  assert.equal(r.code, 0, r.out);
});

test('Windows doctor discovers a cmd shim on PATH, including paths with spaces', { skip: process.platform !== 'win32' }, t => {
  const f = makeFixture(); t.after(f.cleanup);
  const config = JSON.parse(fs.readFileSync(path.join(f.root, 'docflow.json')));
  config.agent.kind = 'hermes'; f.put('docflow.json', JSON.stringify(config));
  f.put('shim folder/hermes.cmd', '@echo off\r\necho --query-file\r\n');
  const r = runCli(f.root, 'doctor', [], { DOCFLOW_HERMES_CLI: 'hermes', PATH: path.join(f.root, 'shim folder') + path.delimiter + process.env.PATH });
  assert.equal(r.code, 0, r.out);
});
