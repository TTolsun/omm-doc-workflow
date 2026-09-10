import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { makeFixture, probeFile, runSync } from './helper.mjs';

const cli = path.resolve(import.meta.dirname, '../bin/docflow.mjs');
function run(f, command, args = []) {
  const r = spawnSync(process.execPath, [cli, command, '--project', f.root, ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
}
const ok = result => assert.equal(result.code, 0, result.out);
const state = (f, name) => JSON.parse(fs.readFileSync(path.join(f.root, 'tools/docgen/state', name)));

test('unrelated commits remain fresh both before and after ack; relevant commits invalidate only their key', async t => {
  const f = makeFixture(); t.after(f.cleanup);
  const source = path.join(f.root, 'source'); fs.mkdirSync(source);
  fs.cpSync(path.join(f.root, 'app'), path.join(source, 'app'), { recursive: true });
  const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const commit = message => { git('add', '.'); git('commit', '-m', message); return git('rev-parse', 'HEAD'); };
  git('init', '-b', 'main'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Test');
  const base = commit('baseline');
  fs.appendFileSync(path.join(source, probeFile), '// relevant\n'); const relevant = commit('relevant change');
  const config = JSON.parse(fs.readFileSync(path.join(f.root, 'docflow.json')));
  config.sourceRoot = 'source'; config.changes = { mode: 'commits', initialCommit: base }; f.put('docflow.json', JSON.stringify(config));
  f.put('.omm/other/description.md', '독립적인 관점입니다.\n');
  const bindingsFile = 'docs/guide/_bindings.yaml';
  f.put(bindingsFile, fs.readFileSync(path.join(f.root, bindingsFile), 'utf8').replace('\npages:', '\n  other:\n    kind: omm\n    evidence:\n      - app/build.gradle.kts\npages:'));
  ok(run(f, 'collect')); ok(run(f, 'verify', ['--accept', '--reviewer=fixture']));
  const accepted = state(f, 'evidence.json').entries;
  fs.writeFileSync(path.join(source, 'README.md'), 'unrelated\n'); commit('readme only');
  ok(run(f, 'collect')); ok(run(f, 'verify', ['--check']));
  assert.deepEqual(state(f, 'evidence.json').entries, accepted);
  ok(run(f, 'ack', [`--source-commit=${git('rev-parse', 'HEAD')}`, '--reviewer=fixture']));
  fs.appendFileSync(path.join(source, 'README.md'), 'again\n'); commit('next unrelated batch');
  ok(run(f, 'collect')); ok(run(f, 'verify', ['--check']));
  assert.equal(state(f, 'scopes.json').entries['omm:sync-probe'][0].sha, relevant);
  const sync = await runSync(f.root, { DOCGEN_OLLAMA_URL: 'http://127.0.0.1:1' }); ok(sync);
  assert.match(sync.out, /재스캔 대상 perspective: \(없음\)/);
  fs.appendFileSync(path.join(source, probeFile), '// relevant again\n'); commit('second relevant batch');
  ok(run(f, 'collect')); assert.equal(run(f, 'verify', ['--check']).code, 1);
  assert.equal(state(f, 'evidence.json').entries['omm:other'].observed.state, 'fresh');
});

test('key selection matches deleted paths and content-only citations without using global head metadata', t => {
  const f = makeFixture(); t.after(f.cleanup);
  const script = `
    import assert from 'node:assert/strict';
    import { selectCommits } from './tools/docgen/evidence-scope.mjs';
    import { evidenceScope } from './tools/docgen/model.mjs';
    import { readBindings } from './tools/docgen/lib.mjs';
    const commit = { sha: 'a', issues: [], changedFiles: [{ status:'D', path:'src/removed.cpp' }, {status:'A', path:'src/new.cpp'}] };
    assert.equal(selectCommits({commits:[commit]}, ['src/**/*.cpp']).length, 1);
    assert.deepEqual(selectCommits({commits:[commit]}, ['other/**']), []);
    const bindings = readBindings(); const block = bindings.pages['probe.md'].blocks.find(b => b.kind === 'content');
    const scope = evidenceScope(bindings, {kind:'content', page:'probe.md', block});
    assert.ok(scope.patterns.includes('only-cited.cpp'));
    assert.equal(selectCommits({commits:[{...commit, changedFiles:[{status:'D',path:'only-cited.cpp'}]}]}, scope.patterns).length, 1);
  `;
  const rel = 'docs/guide/_content/probe/overview-0.md';
  f.put(rel, fs.readFileSync(path.join(f.root, rel), 'utf8').replace('sources:', 'sources:\n  - only-cited.cpp#DeletedSymbol'));
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {cwd:f.root, encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr);
});

test('key-scoped Jira prompts exclude unrelated issues and prune obsolete evidence while retaining citations', async t => {
  const f = makeFixture(); t.after(f.cleanup);
  const service = http.createServer((req, res) => {
    const key = req.url.split('/').pop();
    if (req.url.includes('/issue/')) res.end(JSON.stringify({ fields: { summary: key, description: `Problem\n${key} evidence\nhttp://127.0.0.1:${service.address().port}/pages/123` } }));
    else res.end(JSON.stringify({ title: 'Design', version: { number: 1 }, body: { storage: { value: '<p>Decision</p>' } } }));
  });
  await new Promise(resolve => service.listen(0, '127.0.0.1', resolve));
  t.after(() => { service.closeAllConnections(); service.close(); });
  const baseUrl = `http://127.0.0.1:${service.address().port}`;
  const config = JSON.parse(fs.readFileSync(path.join(f.root, 'docflow.json')));
  config.changes = { mode: 'commits' };
  config.jira = { enabled: true, projectKey: 'TEAM', issuePattern: 'TEAM-(\\d+)', baseUrl };
  config.confluence = { enabled: true, baseUrl }; f.put('docflow.json', JSON.stringify(config));
  const collect = async commits => {
    f.put('batch-input.json', JSON.stringify({ commits, changedFiles: commits.flatMap(c => c.changedFiles), issues: commits.flatMap(c => c.issues), headCommit: commits.at(-1).sha }));
    const r = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cli, 'collect', '--project', f.root], { env: { ...process.env, DOCFLOW_CHANGE_FILE: path.join(f.root, 'batch-input.json') } });
      let out = ''; child.stdout.on('data', x => out += x); child.stderr.on('data', x => out += x);
      child.on('error', reject); child.on('close', code => resolve({ code, out }));
    }); ok(r);
  };
  const change = (n, file) => ({ sha: String(n), message: `TEAM-${n}`, issues: [`TEAM-${n}`], changedFiles: [{ status: 'M', path: file }] });
  await collect([change(1, probeFile), change(2, 'unrelated.md')]);
  ok(run(f, 'verify', ['--accept', '--reviewer=fixture']));
  let brief = run(f, 'brief', ['probe.md', 'overview-0']); ok(brief);
  assert.match(brief.out, /TEAM-1 evidence/); assert.doesNotMatch(brief.out, /TEAM-2/); assert.match(brief.out, /<p>Decision/);
  await collect([change(3, 'unrelated.md')]);
  ok(run(f, 'verify', ['--check']));
  assert.deepEqual(state(f, 'external.json').issues.map(x => x.key), ['TEAM-1', 'TEAM-3']);
  const rel = 'docs/guide/_content/probe/overview-0.md';
  f.put(rel, fs.readFileSync(path.join(f.root, rel), 'utf8').replace('decisions: []', 'references: [jira:TEAM-1]\ndecisions: []'));
  await collect([change(4, probeFile)]);
  assert.deepEqual(state(f, 'external.json').issues.map(x => x.key), ['TEAM-1', 'TEAM-4']);
  brief = run(f, 'brief', ['probe.md', 'overview-0']); ok(brief); assert.match(brief.out, /TEAM-1 evidence/); assert.match(brief.out, /TEAM-4 evidence/);
  f.put(rel, fs.readFileSync(path.join(f.root, rel), 'utf8').replace('references: [jira:TEAM-1]\n', ''));
  await collect([change(5, 'unrelated.md')]);
  assert.deepEqual(state(f, 'external.json').issues.map(x => x.key), ['TEAM-4', 'TEAM-5']);
});
