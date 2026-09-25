// verify --changes: a reviewer sees which evidence changed since the last review, and how.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeFixture, probeFile } from './helper.mjs';
import { blobSha } from '../src/text.mjs';

const verify = (root, ...args) => spawnSync(process.execPath, [path.join(root, 'tools/docgen/verify.mjs'), ...args], { cwd: root, encoding: 'utf8' });
const git = (root, ...args) => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
const initRepo = root => {
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'fixture@example.com');
  git(root, 'config', 'user.name', 'fixture');
  git(root, 'config', 'core.autocrlf', 'false');
};
const evidence = root => JSON.parse(fs.readFileSync(path.join(root, 'tools/docgen/state/evidence.json'), 'utf8'));
const reviewed = 'package dev.halcamera\nobject Probe { const val OBSERVE_MS = 10000L }\n';

test('blob hashes match git for LF and CRLF checkouts', () => {
  const f = makeFixture(0);
  try {
    initRepo(f.root);
    fs.writeFileSync(path.join(f.root, probeFile), reviewed);
    assert.equal(blobSha(reviewed), git(f.root, 'hash-object', probeFile));
    assert.equal(blobSha(reviewed.replace(/\n/g, '\r\n')), blobSha(reviewed));
  } finally { f.cleanup(); }
});

test('accept records a blob per evidence file and changes shows the diff since then', () => {
  const f = makeFixture(0);
  try {
    // makeFixture accepted the 10000L version and then changed it to 12000L. Commit the reviewed text so its blob exists.
    const changed = fs.readFileSync(path.join(f.root, probeFile), 'utf8');
    initRepo(f.root);
    fs.writeFileSync(path.join(f.root, probeFile), reviewed);
    git(f.root, 'add', '-A'); git(f.root, 'commit', '-qm', 'reviewed');
    fs.writeFileSync(path.join(f.root, probeFile), changed);

    const accepted = evidence(f.root).entries['omm:sync-probe'].accepted;
    assert.deepEqual(Object.keys(accepted.files), [probeFile]);
    assert.equal(accepted.files[probeFile], blobSha(reviewed));

    const r = verify(f.root, '--changes');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /## omm:sync-probe/);
    assert.match(r.stdout, new RegExp(`바뀐 근거 파일: ${probeFile}`));
    assert.match(r.stdout, /-object Probe \{ const val OBSERVE_MS = 10000L \}/);
    assert.match(r.stdout, /\+object Probe \{ const val OBSERVE_MS = 12000L \}/);
    // A key filter limits the output; changes never records a review.
    assert.doesNotMatch(verify(f.root, '--changes', 'omm:other').stdout + verify(f.root, '--changes', 'omm:other').stderr, /12000L/);
    assert.deepEqual(evidence(f.root).entries['omm:sync-probe'].accepted, accepted);
  } finally { f.cleanup(); }
});

test('without the reviewed blob changes still names the file', () => {
  const f = makeFixture(0);
  try {
    const r = verify(f.root, '--changes');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`바뀐 근거 파일: ${probeFile}`));
    assert.match(r.stdout, /저장소에서 찾을 수 없어 diff 를 표시하지 못했습니다/);
  } finally { f.cleanup(); }
});

test('records without file blobs fall back to the review commit, or say it is gone', () => {
  const f = makeFixture(0);
  try {
    const changed = fs.readFileSync(path.join(f.root, probeFile), 'utf8');
    initRepo(f.root);
    fs.writeFileSync(path.join(f.root, probeFile), reviewed);
    git(f.root, 'add', '-A'); git(f.root, 'commit', '-qm', 'reviewed');
    const sha = git(f.root, 'rev-parse', '--short', 'HEAD');
    fs.writeFileSync(path.join(f.root, probeFile), changed);
    const file = path.join(f.root, 'tools/docgen/state/evidence.json');
    const state = evidence(f.root);
    delete state.entries['omm:sync-probe'].accepted.files;
    state.entries['omm:sync-probe'].accepted.commit = sha;
    fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n');
    const byCommit = verify(f.root, '--changes', 'omm:sync-probe');
    assert.match(byCommit.stdout, new RegExp(`검토 커밋 ${sha} 기준`));
    assert.match(byCommit.stdout, /\+object Probe \{ const val OBSERVE_MS = 12000L \}/);

    // A squash merge leaves the review commit unreachable; say so instead of printing nothing.
    state.entries['omm:sync-probe'].accepted.commit = 'deadbeef';
    fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n');
    assert.match(verify(f.root, '--changes', 'omm:sync-probe').stdout, /검토 커밋 deadbeef을 저장소에서 찾을 수 없습니다/);
  } finally { f.cleanup(); }
});

test('records from before 0.6.0 gain file blobs only while the evidence still matches the review', () => {
  const f = makeFixture(0);
  try {
    const file = path.join(f.root, 'tools/docgen/state/evidence.json');
    const changed = fs.readFileSync(path.join(f.root, probeFile), 'utf8');
    const strip = () => {
      const state = evidence(f.root);
      delete state.entries['omm:sync-probe'].accepted.files;
      state.entries['omm:sync-probe'].accepted.reviewer = 'earlier reviewer';
      fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n');
    };
    // Evidence differs from the review: a hash taken now would describe code nobody reviewed, so none is recorded.
    strip();
    verify(f.root);
    assert.equal(evidence(f.root).entries['omm:sync-probe'].accepted.files, undefined);
    // Evidence equals the review: record the blobs, and keep who reviewed it.
    fs.writeFileSync(path.join(f.root, probeFile), reviewed);
    verify(f.root, '--dry-run');
    assert.equal(evidence(f.root).entries['omm:sync-probe'].accepted.files, undefined);
    verify(f.root);
    const accepted = evidence(f.root).entries['omm:sync-probe'].accepted;
    assert.deepEqual(accepted.files, { [probeFile]: blobSha(reviewed) });
    assert.equal(accepted.reviewer, 'earlier reviewer');
    fs.writeFileSync(path.join(f.root, probeFile), changed);
  } finally { f.cleanup(); }
});

test('check failure points a stale review at --changes', () => {
  const f = makeFixture(0);
  try {
    const r = verify(f.root, '--check');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /docflow verify --changes/);
  } finally { f.cleanup(); }
});
