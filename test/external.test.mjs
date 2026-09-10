import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { issueSections, collectExternal } from '../src/external.mjs';
import { collectChanges } from '../src/changes.mjs';

test('Jira sections preserve missing values, custom fields and ADF paragraphs', () => {
  assert.deepEqual(issueSections({description:'h2. Problem\n버퍼 정지\nh2. Cause\n소유권 충돌\nh2. Solution\n반환 시점 수정'}), {Problem:'버퍼 정지', Cause:'소유권 충돌', Solution:'반환 시점 수정'});
  assert.equal(issueSections({description:'**Problem:**\n지연\n**Solution:**\n수정'}).Cause, null);
  assert.equal(issueSections({customfield_1:'별도 필드'}, {Cause:'customfield_1'}).Cause, '별도 필드');
  const doc = {type:'doc', content:[{type:'heading',content:[{type:'text',text:'Problem'}]},{type:'paragraph',content:[{type:'text',text:'프레임 지연'}]}]};
  assert.equal(issueSections({description:doc}).Problem, '프레임 지연');
});

test('collects linked design revisions and image references without crawling other origins', async () => {
  const calls=[];
  const fetcher=async url => {
    calls.push(String(url));
    if (url.hostname === 'jira.invalid') return new Response(JSON.stringify({fields:{summary:'CSWPR example',description:'Problem\n지연\nCause\n큐 적체\nSolution\n한도 수정\nhttps://design.invalid/pages/viewpage.action?pageId=123\nhttps://outside.invalid/secret',attachment:[{id:'7',filename:'queue.png',mimeType:'image/png',content:'https://jira.invalid/attachment/7'}]}}));
    assert.equal(url.hostname,'design.invalid');
    return new Response(JSON.stringify({title:'Queue ownership',version:{number:3,when:'2026-09-01'},body:{storage:{value:'<p>소유권을 호출자에게 반환합니다.</p>'}}}));
  };
  const data=await collectExternal({jira:{enabled:true,baseUrl:'https://jira.invalid'},confluence:{enabled:true,baseUrl:'https://design.invalid'}},{issues:['CSWPR-123']},fetcher);
  assert.equal(data.issues[0].sections.Problem,'지연'); assert.equal(data.confluence[0].revision,3);
  assert.equal(data.issues[0].attachments[0].state,'linked-not-inspected'); assert.equal(calls.length,2);
});

test('disabled connectors make no requests and required/optional failures differ', async () => {
  assert.deepEqual(await collectExternal({},null,()=>{throw new Error('must not call');}),{schema:1,issues:[],confluence:[]});
  const config={jira:{enabled:true,baseUrl:'https://jira.invalid'}};
  await assert.rejects(collectExternal(config,{issues:['CSWPR-1']},async()=>new Response('',{status:503})), /HTTP 503/);
  config.jira.failurePolicy='record-missing';
  const data=await collectExternal(config,{issues:['CSWPR-1']},async()=>new Response('',{status:503}));
  assert.equal(data.issues[0].state,'unavailable');
});

test('commit range uses the acknowledged cursor and extracts CSWPR IDs from commit bodies', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'docflow-git-test-'));
  t.after(()=>{if(path.dirname(root)===os.tmpdir()&&path.basename(root).startsWith('docflow-git-test-')) fs.rmSync(root,{recursive:true,force:true});});
  const source=path.join(root,'source'),state=path.join(root,'state'); fs.mkdirSync(source); fs.mkdirSync(state);
  const git=(...args)=>execFileSync('git',args,{cwd:source,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-b','main'); git('config','user.email','fixture@example.invalid'); git('config','user.name','Fixture');
  fs.writeFileSync(path.join(source,'한글.cpp'),'int limit = 4;\n'); git('add','.'); git('commit','-m','baseline'); const base=git('rev-parse','HEAD');
  fs.writeFileSync(path.join(source,'한글.cpp'),'int limit = 6;\n'); git('add','.'); git('commit','-m','CSWPR-123: buffer limit','-m','Related: CSWPR 124');
  const config={changes:{mode:'commits',initialCommit:base},jira:{enabled:true,projectKey:'CSWPR',issuePattern:'\\bCSWPR[- ]?(\\d+)\\b'}};
  const batch=collectChanges(config,source,state);
  assert.deepEqual(batch.issues,['CSWPR-123','CSWPR-124']); assert.equal(batch.changedFiles[0].path,'한글.cpp');
  assert.equal(batch.commits[0].changedFiles[0].path, '한글.cpp');
  assert.deepEqual(collectChanges({changes:config.changes},source,state).issues, []);
  assert.throws(() => collectChanges({...config,jira:{enabled:true}},source,state), /projectKey와 issuePattern/);
  assert.equal(fs.existsSync(path.join(state,'checkpoint.json')),false);
  fs.writeFileSync(path.join(state,'checkpoint.json'),JSON.stringify({sourceCommit:batch.headCommit}));
  assert.equal(collectChanges(config,source,state).commits.length,0);
  fs.appendFileSync(path.join(source,'한글.cpp'),'// dirty'); assert.throws(()=>collectChanges(config,source,state),/변경 없는/);
});
