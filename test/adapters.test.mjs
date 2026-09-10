import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeFixture, manuscript, runSync, probeFile } from './helper.mjs';
import { snapshot, changedFiles } from '../src/transaction.mjs';

test('Hermes CLI contract passes Qwen profile and rejects agent filesystem writes', async t => {
  const f=makeFixture(); t.after(f.cleanup);
  const config=JSON.parse(fs.readFileSync(path.join(f.root,'docflow.json')));
  config.agent={kind:'hermes',model:'Qwen/example',baseUrl:'http://127.0.0.1:8000/v1'};
  f.put('docflow.json',JSON.stringify(config));
  const cli=path.join(f.root,'fake-hermes.mjs');
  f.put('fake-hermes.mjs', `import fs from 'node:fs'; import path from 'node:path';
const args=process.argv.slice(2); if(!args.includes('--query-file')||!args.includes('--quiet')) process.exit(2);
const config=JSON.parse(fs.readFileSync(path.join(process.env.HERMES_HOME,'config.yaml')));
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
