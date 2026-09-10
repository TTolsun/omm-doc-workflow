import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CONFIG, PROJECT_ROOT } from './config.mjs';
import { qwen, positiveInt } from './qwen.mjs';

export async function runAgent(prompt, schema) {
  const settings = CONFIG.agent ?? { kind: 'hermes', model: 'qwen3.5:4b' };
  if (settings.kind === 'ollama') {
    process.env.DOCGEN_QWEN_MODEL ??= settings.model ?? 'qwen3.5:4b';
    process.env.DOCGEN_OLLAMA_URL ??= settings.baseUrl ?? 'http://127.0.0.1:11434';
    return qwen(prompt, schema);
  }
  if (settings.kind !== 'hermes') throw new Error(`Unknown agent: ${settings.kind}`);
  if (!/qwen/i.test(settings.model ?? '')) throw new Error('Hermes model must name the configured Qwen model');
  const endpoint = new URL(settings.baseUrl ?? 'http://127.0.0.1:11434/v1');
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new Error('Invalid Qwen endpoint');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'docflow-hermes-'));
  try {
    // A dedicated transient profile prevents unrelated providers, memory, plugins and fallback settings from being inherited.
    fs.writeFileSync(path.join(home, 'config.yaml'), JSON.stringify({
      model: { provider: 'custom', default: settings.model, base_url: endpoint.href,
        context_length: settings.contextLength ?? 65536,
        api_key: process.env.DOCFLOW_MODEL_API_KEY ?? '' },
      agent: { max_turns: 8 },
      terminal: { cwd: PROJECT_ROOT },
    }), { mode: 0o600 });
    const cli = process.env.DOCFLOW_HERMES_CLI ?? 'hermes';
    const js = /\.[cm]?js$/i.test(cli);
    const args = ['chat', '--quiet', '--query-file', '-', '--ignore-rules', '--toolsets', 'file', '--max-turns', '8', '--model', settings.model];
    const result = spawnSync(js ? process.execPath : cli, [...(js ? [cli] : []), ...args], {
      cwd: PROJECT_ROOT, env: { ...process.env, HERMES_HOME: home }, windowsHide: true,
      input: prompt + '\n\n파일을 수정하지 말고 다음 스키마에 맞는 JSON 하나만 반환하세요.\n' + JSON.stringify(schema),
      encoding: 'utf8', timeout: positiveInt('DOCGEN_LLM_TIMEOUT_MS', 300000), maxBuffer: 16 * 1024 * 1024,
    });
    if (result.status !== 0) throw new Error(`Hermes 실행 실패: ${result.error?.code ?? result.status ?? result.signal}. CLI 설치와 Qwen 접속 설정을 확인하세요.`);
    const output = result.stdout.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, '$1');
    return JSON.parse(output);
  } finally {
    if (path.dirname(home) === os.tmpdir() && path.basename(home).startsWith('docflow-hermes-')) fs.rmSync(home, { recursive: true, force: true });
  }
}
