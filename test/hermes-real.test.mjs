// Opt-in contract test: run the installed Hermes CLI against a loopback model stub.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { makeFixture } from './helper.mjs';

test('real Hermes sends no tool schemas with the isolated docflow profile', {
  skip: !process.env.DOCFLOW_REAL_HERMES_CLI, timeout: 180000,
}, async t => {
  const f = makeFixture(); t.after(f.cleanup);
  const calls = [];
  const service = http.createServer(async (req, res) => {
    if (req.method === 'GET') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({data:[{id:'qwen-docflow-probe',object:'model'}]})); return; }
    let text = ''; for await (const part of req) text += part;
    const data = JSON.parse(text); calls.push({url:req.url, data});
    const message = {role:'assistant', content:'{"ok":true}'};
    if (data.stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      for (const choice of [{delta:message,finish_reason:null}, {delta:{},finish_reason:'stop'}]) {
        res.write(`data: ${JSON.stringify({id:'chatcmpl-docflow',object:'chat.completion.chunk',model:'qwen-docflow-probe',choices:[{index:0,...choice}]})}\n\n`);
      }
      res.end('data: [DONE]\n\n');
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({id:'chatcmpl-docflow',object:'chat.completion',model:'qwen-docflow-probe',choices:[{index:0,message,finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}}));
    }
  });
  await new Promise(resolve => service.listen(0, '127.0.0.1', resolve));
  t.after(() => { service.closeAllConnections(); service.close(); });
  const config = JSON.parse(fs.readFileSync(path.join(f.root, 'docflow.json')));
  config.agent = {kind:'hermes', model:'qwen-docflow-probe', baseUrl:`http://127.0.0.1:${service.address().port}/v1`};
  f.put('docflow.json', JSON.stringify(config));
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', `import assert from 'node:assert/strict'; import {runAgent} from './tools/docgen/agent.mjs'; assert.deepEqual(await runAgent('docflow-tool-contract-probe: return {"ok":true}', {type:'object',properties:{ok:{type:'boolean'}}}), {ok:true});`], {
      cwd:f.root, env:{...process.env, DOCFLOW_HERMES_CLI:process.env.DOCFLOW_REAL_HERMES_CLI, DOCFLOW_MODEL_API_KEY:'docflow-test-key', DOCGEN_LLM_TIMEOUT_MS:'120000', PYTHONUTF8:'1'},
    });
    let out = ''; child.stdout.on('data', x => out += x); child.stderr.on('data', x => out += x);
    child.on('error', reject); child.on('close', code => resolve({code,out}));
  });
  assert.equal(result.code, 0, result.out);
  const prompts = calls.filter(call => JSON.stringify(call.data.messages).includes('docflow-tool-contract-probe'));
  assert.ok(prompts.length, 'Hermes must send the actual prompt to the loopback API');
  for (const {data} of prompts) {
    assert.equal(data.model, 'qwen-docflow-probe');
    assert.deepEqual(data.tools ?? [], []);
    assert.deepEqual(data.functions ?? [], []);
  }
});
