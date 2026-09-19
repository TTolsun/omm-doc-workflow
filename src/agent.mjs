import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONFIG, PROJECT_ROOT } from './config.mjs';
import { qwen, positiveInt, checkPrompt } from './qwen.mjs';
import { spawnHermes } from './hermes-cli.mjs';

// Hermes may print advisories (security scanner availability, "No reply" turn explanations) on stdout around the answer.
// Prefer the JSON object that ends the output, then the last fenced block, then the first balanced object followed by other text.
export function parseAgentOutput(stdout) {
  const text = stdout.trim();
  const starts = [...text.matchAll(/^[ \t]*\{/gm)].map(m => m.index + m[0].length - 1);
  const fenced = [...text.matchAll(/```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```/g)].map(m => m[1]);
  const candidates = [...starts.map(i => text.slice(i).replace(/\s*```\s*$/, '')).reverse(), ...fenced.reverse(), ...starts.map(i => balancedObject(text, i))];
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch {}
  }
  return undefined;
}

function balancedObject(text, start) {
  let depth = 0, quoted = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (ch === '\\') i++; else if (ch === '"') quoted = false; }
    else if (ch === '"') quoted = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return '';
}

export async function runAgent(prompt, schema, options = {}) {
  checkPrompt(prompt);
  const settings = CONFIG.agent ?? { kind: 'hermes', model: 'qwen3.5:4b' };
  if (settings.kind === 'ollama') {
    const model = settings.model ?? 'qwen3.5:4b';
    if (process.env.DOCGEN_QWEN_MODEL && process.env.DOCGEN_QWEN_MODEL !== model) throw new Error('DOCGEN_QWEN_MODEL이 agent.model과 일치하지 않습니다.');
    process.env.DOCGEN_QWEN_MODEL = model;
    process.env.DOCGEN_OLLAMA_URL ??= settings.baseUrl ?? 'http://127.0.0.1:11434';
    return qwen(prompt, schema, options);
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
      // test/hermes-real.test.mjs checks the real CLI's outgoing API request has no tools.
      // Without an effort Hermes omits reasoning_effort and the server default (thinking on for Qwen3) applies,
      // which made large manuscripts exceed DOCGEN_LLM_TIMEOUT_MS. Mirror the Ollama transport's think:false.
      agent: { max_turns: 8, disabled_toolsets: ['file'], reasoning_effort: 'none' },
      // The profile is deleted after the call, so the extra session-title model request is wasted work.
      auxiliary: { title_generation: { enabled: false } },
      terminal: { cwd: PROJECT_ROOT },
    }), { mode: 0o600 });
    const args = ['chat', '--quiet', '--query-file', '-', '--ignore-rules', '--toolsets', 'file', '--max-turns', '8', '--reasoning', 'none', '--model', settings.model];
    const input = prompt + '\n\n파일을 수정하지 말고 다음 스키마에 맞는 JSON 하나만 반환하세요.\n' + JSON.stringify(schema);
    checkPrompt(input);
    const attempts = positiveInt('DOCFLOW_AGENT_ATTEMPTS', 3);
    const failures = [];
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const start = Date.now();
      const result = spawnHermes(args, {
        cwd: PROJECT_ROOT, env: { ...process.env, HERMES_HOME: home }, windowsHide: true,
        input,
        encoding: 'utf8', timeout: positiveInt('DOCGEN_LLM_TIMEOUT_MS', 300000), maxBuffer: 16 * 1024 * 1024,
      });
      // A missing executable, an unsafe argument or a timeout repeats identically: fail without retrying.
      if (result.error) throw new Error(`Hermes 실행 실패: ${result.error.code ?? result.signal}. CLI 설치와 Qwen 접속 설정을 확인하세요.`);
      const value = result.status === 0 ? parseAgentOutput(result.stdout) : undefined;
      if (value !== undefined) {
        console.log(`  Hermes ${settings.model}: ${((Date.now() - start) / 1000).toFixed(1)}초`);
        return value;
      }
      const detail = (result.stderr ?? '').trim().split(/\r?\n/).filter(Boolean).at(-1)?.slice(0, 200);
      failures.push(result.status === 0 ? `JSON 객체 없음${detail ? ` (${detail})` : ''}` : `종료 코드 ${result.status ?? result.signal}${detail ? ` (${detail})` : ''}`);
      console.log(`  Hermes 시도 ${attempt}/${attempts} 실패: ${failures.at(-1)}`);
    }
    throw new Error(`Hermes가 ${attempts}회 시도 후에도 JSON 응답을 반환하지 않았습니다: ${failures.join(' / ')}. CLI 설치와 Qwen 접속 설정을 확인하세요.`);
  } finally {
    if (path.dirname(home) === os.tmpdir() && path.basename(home).startsWith('docflow-hermes-')) fs.rmSync(home, { recursive: true, force: true });
  }
}
