import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONFIG, PROJECT_ROOT } from './config.mjs';
import { qwen, positiveInt, checkPrompt } from './qwen.mjs';
import { spawnHermes } from './hermes-cli.mjs';

export async function runAgent(prompt, schema) {
  checkPrompt(prompt);
  const settings = CONFIG.agent ?? { kind: 'hermes', model: 'qwen3.5:4b' };
  if (settings.kind === 'ollama') {
    if (process.env.DOCGEN_QWEN_MODEL && process.env.DOCGEN_QWEN_MODEL !== settings.model) throw new Error('DOCGEN_QWEN_MODEL이 agent.model과 일치하지 않습니다.');
    process.env.DOCGEN_QWEN_MODEL = settings.model ?? 'qwen3.5:4b';
    process.env.DOCGEN_OLLAMA_URL ??= settings.baseUrl ?? 'http://127.0.0.1:11434';
    return qwen(prompt, schema);
  }
  if (settings.kind !== 'hermes') throw new Error(`Unknown agent: ${settings.kind}`);
  if (typeof settings.model !== 'string' || !settings.model.trim()) throw new Error('agent.model을 지정하세요.');
  const endpoint = new URL(settings.baseUrl ?? 'http://127.0.0.1:11434/v1');
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new Error('Invalid Qwen endpoint');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'docflow-hermes-'));
  try {
    // A dedicated transient profile prevents unrelated providers, memory, plugins and fallback settings from being inherited.
    fs.writeFileSync(path.join(home, 'config.yaml'), JSON.stringify({
      model: { provider: 'custom', default: settings.model, base_url: endpoint.href,
        context_length: settings.contextLength ?? 65536,
        api_key: process.env.DOCFLOW_MODEL_API_KEY ?? '' },
      // Keep an explicit known toolset but disable it: omitting --toolsets enables defaults.
      agent: { max_turns: 8, disabled_toolsets: ['file'] },
      terminal: { cwd: PROJECT_ROOT },
    }), { mode: 0o600 });
    const args = ['chat', '--quiet', '--query-file', '-', '--ignore-rules', '--toolsets', 'file', '--max-turns', '8', '--model', settings.model];
    const input = prompt + '\n\n파일을 수정하지 말고 다음 스키마에 맞는 JSON 하나만 반환하세요.\n' + JSON.stringify(schema);
    checkPrompt(input);
    const result = spawnHermes(args, {
      cwd: PROJECT_ROOT, env: { ...process.env, HERMES_HOME: home }, windowsHide: true,
      input,
      encoding: 'utf8', timeout: positiveInt('DOCGEN_LLM_TIMEOUT_MS', 300000), maxBuffer: 16 * 1024 * 1024,
    });
    if (result.status !== 0) throw new Error(`Hermes 실행 실패: ${result.error?.code ?? result.status ?? result.signal}. CLI 설치와 Qwen 접속 설정을 확인하세요.`);
    const output = result.stdout.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, '$1');
    return JSON.parse(output);
  } finally {
    if (path.dirname(home) === os.tmpdir() && path.basename(home).startsWith('docflow-hermes-')) fs.rmSync(home, { recursive: true, force: true });
  }
}
