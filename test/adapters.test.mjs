import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeFixture, manuscript, runSync, probeFile } from './helper.mjs';
import { snapshot, changedFiles } from '../src/transaction.mjs';
import { spawnSync } from 'node:child_process';

test('Hermes CLI contract passes Qwen profile and rejects agent filesystem writes', async t => {
  const f=makeFixture(); t.after(f.cleanup);
  const config=JSON.parse(fs.readFileSync(path.join(f.root,'docflow.json')));
  config.agent={kind:'hermes',model:'Qwen/example',baseUrl:'http://127.0.0.1:8000/v1'};
  f.put('docflow.json',JSON.stringify(config));
  const cli=path.join(f.root,'fake-hermes.mjs');
  f.put('fake-hermes.mjs', `import fs from 'node:fs'; import path from 'node:path';
const args=process.argv.slice(2); if(!args.includes('--query-file')||!args.includes('--quiet')) process.exit(2);
const config=JSON.parse(fs.readFileSync(path.join(process.env.HERMES_HOME,'config.yaml')));
if(args[args.indexOf('--toolsets')+1]!=='file'||JSON.stringify(config.agent.disabled_toolsets)!=='["file"]')process.exit(4);
if(config.model.provider!=='custom'||config.model.default!=='Qwen/example'||config.model.base_url!=='http://127.0.0.1:8000/v1') process.exit(3);
let prompt='';for await(const part of process.stdin)prompt+=part;
if(process.env.FIXTURE_AGENT_WRITE==='1')fs.writeFileSync('outside.md','unauthorized');
console.log(JSON.stringify(prompt.includes('구조 스캔:')?{updates:[{element:'sync-probe',field:'description',text:'관측 시간은 12000ms입니다.'}]}:{markdown:${JSON.stringify(manuscript('12000'))}}));`);
  const before=snapshot(f.root);
  const bad=await runSync(f.root,{DOCFLOW_HERMES_CLI:cli,FIXTURE_AGENT_WRITE:'1'}); assert.equal(bad.code,1,bad.out);
  assert.deepEqual(changedFiles(before,snapshot(f.root)),[]);
  const good=await runSync(f.root,{DOCFLOW_HERMES_CLI:cli}); assert.equal(good.code,0,good.out);
  assert.match(fs.readFileSync(path.join(f.root,'docs/guide/probe.md'),'utf8'),/12000/);
});

test('source repository may be outside the documentation project', async t => {
  const f=makeFixture(); t.after(f.cleanup);
  const source=fs.mkdtempSync(path.join(os.tmpdir(),'docflow-external-source-'));
  t.after(()=>{if(path.dirname(source)===os.tmpdir()&&path.basename(source).startsWith('docflow-external-source-'))fs.rmSync(source,{recursive:true,force:true});});
  fs.renameSync(path.join(f.root,'app'),path.join(source,'app'));
  const config=JSON.parse(fs.readFileSync(path.join(f.root,'docflow.json'))); config.sourceRoot=source;
  f.put('docflow.json',JSON.stringify(config));
  const before=snapshot(source);
  const result=await runSync(f.root,{},['--dry-run']); assert.equal(result.code,0,result.out);
  assert.match(result.out,/sync-probe/); assert.deepEqual(changedFiles(before,snapshot(source)),[]);
});

test('Hermes refuses oversized input before executing the CLI and supports configured model aliases', async t => {
  const f = makeFixture(); t.after(f.cleanup);
  const config = JSON.parse(fs.readFileSync(path.join(f.root, 'docflow.json')));
  config.agent = { kind: 'hermes', model: 'internal-code-model', baseUrl: 'http://127.0.0.1:8000/v1' };
  f.put('docflow.json', JSON.stringify(config));
  const marker = path.join(f.root, 'called.txt');
  f.put('agent-test.mjs', `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)},'called'); console.log('{"ok":true}');`);
  const run = limit => spawnSync(process.execPath, ['--input-type=module', '-e', `import { runAgent } from './tools/docgen/agent.mjs'; console.log(await runAgent('small prompt', {type:'object'}));`], {
    cwd: f.root, encoding: 'utf8', env: { ...process.env, DOCFLOW_HERMES_CLI: path.join(f.root, 'agent-test.mjs'), DOCGEN_MAX_PROMPT_CHARS: limit },
  });
  for (const limit of ['5', '20']) {
    const result = run(limit); assert.equal(result.status, 1); assert.match(result.stderr, /입력이 너무 큽니다/);
    assert.equal(fs.existsSync(marker), false);
  }
  const result = run('60000'); assert.equal(result.status, 0, result.stderr); assert.equal(fs.existsSync(marker), true);
});

test('ordinary staged projects omit unrelated application files but keep supplied evidence', async t => {
  const f = makeFixture(); t.after(f.cleanup);
  const config = JSON.parse(fs.readFileSync(path.join(f.root, 'docflow.json')));
  config.agent = { kind: 'hermes', model: 'internal-alias' }; f.put('docflow.json', JSON.stringify(config));
  f.put('unrelated/large.bin', Buffer.alloc(1024 * 1024));
  f.put('inspect-stage.mjs', `import fs from 'node:fs';
if(fs.existsSync('app')||fs.existsSync('unrelated'))process.exit(8);
let prompt='';for await(const chunk of process.stdin)prompt+=chunk;
if(!prompt.includes('12000L'))process.exit(9);
console.log(JSON.stringify(prompt.includes('구조 스캔:')?{updates:[]}:{markdown:${JSON.stringify(manuscript('12000'))}}));`);
  const r = await runSync(f.root, { DOCFLOW_HERMES_CLI: path.join(f.root, 'inspect-stage.mjs') });
  assert.equal(r.code, 0, r.out);
  assert.equal(fs.statSync(path.join(f.root, 'unrelated/large.bin')).size, 1024 * 1024);
});

test('custom site roots preserve legitimate build folders during staged sync', async t => {
  const f = makeFixture(); t.after(f.cleanup);
  fs.renameSync(path.join(f.root, 'docs'), path.join(f.root, 'manual'));
  const config = JSON.parse(fs.readFileSync(path.join(f.root, 'docflow.json')));
  config.bindings = 'manual/guide/_bindings.yaml'; f.put('docflow.json', JSON.stringify(config));
  f.put(config.bindings, fs.readFileSync(path.join(f.root, config.bindings), 'utf8').replace('root: docs/guide', 'root: manual/guide'));
  f.put('manual/guide/build/notes.md', '보존할 문서입니다.\n');
  f.put(probeFile, 'package dev.halcamera\nobject Probe { const val OBSERVE_MS = 10000L }\n');
  const before = snapshot(f.root, null, ['.omm', 'manual', 'tools/docgen/state']);
  const r = await runSync(f.root, { DOCGEN_OLLAMA_URL: 'http://127.0.0.1:1' });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(changedFiles(before, snapshot(f.root, null, ['.omm', 'manual', 'tools/docgen/state'])), []);
});

test('Ollama uses the configured alias and refuses a conflicting environment model', t => {
  const f = makeFixture(); t.after(f.cleanup);
  const config = JSON.parse(fs.readFileSync(path.join(f.root, 'docflow.json')));
  config.agent.model = 'internal-model:latest'; f.put('docflow.json', JSON.stringify(config));
  const script = `import assert from 'node:assert/strict'; import {runAgent} from './tools/docgen/agent.mjs';
    globalThis.fetch = async (url, options) => { assert.equal(JSON.parse(options.body).model, 'internal-model:latest');
      return new Response(JSON.stringify({done:true,done_reason:'stop',message:{content:'{"ok":true}'}})); };
    assert.deepEqual(await runAgent('prompt', {type:'object'}), {ok:true});`;
  for (const model of ['', 'internal-model:latest', 'different-model']) {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {cwd:f.root, encoding:'utf8', env:{...process.env, DOCGEN_QWEN_MODEL:model}});
    assert.equal(r.status, model === 'different-model' ? 1 : 0, r.stderr);
    if (model === 'different-model') assert.match(r.stderr, /agent.model과 일치하지/);
  }
});

test('application status facts are rendered only by an explicit project renderer', t => {
  const f = makeFixture(); t.after(f.cleanup);
  f.put('tools/docgen/state/facts.json', JSON.stringify({facts:{'build-facts':{versionName:'1.2.3',versionCode:12}}}));
  const run = () => spawnSync(process.execPath, [path.resolve(import.meta.dirname, '../bin/docflow.mjs'), 'generate', '--project', f.root], {encoding:'utf8'});
  let r = run(); assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(fs.readFileSync(path.join(f.root, 'docs/guide/probe.md'), 'utf8'), /1\.2\.3|검증 기준 앱 버전/);
  const config = JSON.parse(fs.readFileSync(path.join(f.root, 'docflow.json')));
  config.factsRenderer = 'render-facts.mjs'; f.put('docflow.json', JSON.stringify(config));
  f.put('render-facts.mjs', 'export const renderStatus = ({facts}) => "릴리스 버전은 " + facts["build-facts"].versionName + "입니다.";');
  r = run(); assert.equal(r.status, 0, r.stderr);
  assert.match(fs.readFileSync(path.join(f.root, 'docs/guide/probe.md'), 'utf8'), /릴리스 버전은 1\.2\.3입니다/);
});

test('real Qwen documents C++ from a separate code repository', {skip:process.env.DOCGEN_REAL_QWEN !== '1', timeout:660000}, async t=>{
  const f=makeFixture();t.after(f.cleanup);
  const source=fs.mkdtempSync(path.join(os.tmpdir(),'docflow-cpp-source-'));
  t.after(()=>{if(path.dirname(source)===os.tmpdir()&&path.basename(source).startsWith('docflow-cpp-source-'))fs.rmSync(source,{recursive:true,force:true});});
  fs.writeFileSync(path.join(source,'Probe.cpp'),'namespace Probe { constexpr long OBSERVE_MS = 12000; }\n');
  const config=JSON.parse(fs.readFileSync(path.join(f.root,'docflow.json')));config.sourceRoot=source;
  f.put('docflow.json',JSON.stringify(config));
  for(const rel of ['docs/guide/_bindings.yaml','docs/guide/_content/probe/overview-0.md'])f.put(rel,fs.readFileSync(path.join(f.root,rel),'utf8').replaceAll(probeFile,'Probe.cpp'));
  const before=snapshot(source);
  const result=await runSync(f.root); console.log(result.out);assert.equal(result.code,0,result.out);
  assert.deepEqual(changedFiles(before,snapshot(source)),[]);
  assert.match(fs.readFileSync(path.join(f.root,'docs/guide/probe.md'),'utf8'),/12000|12,000|12\s*초/);
});
