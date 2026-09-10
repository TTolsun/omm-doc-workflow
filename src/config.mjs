import fs from 'node:fs';
import path from 'node:path';

export const PROJECT_ROOT = path.resolve(process.env.DOCFLOW_PROJECT_ROOT ?? process.cwd());
export const CONFIG_REL = process.env.DOCFLOW_CONFIG ?? 'docflow.json';
export function within(root, rel) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || rel.includes('\\') || rel.split('/').some(x => !x || x === '..' || x === '.')) {
    throw new Error(`프로젝트 상대 경로가 필요합니다: ${rel}`);
  }
  return path.join(root, ...rel.split('/'));
}
export const CONFIG = JSON.parse(fs.readFileSync(within(PROJECT_ROOT, CONFIG_REL), 'utf8'));
if (CONFIG.version !== 1) throw new Error('docflow.json version must be 1');
for (const name of ['factsAdapter', 'factsRenderer', 'styleDir']) if (CONFIG[name]) within(PROJECT_ROOT, CONFIG[name]);
if (CONFIG.design && !['slack', 'plain', 'custom'].includes(CONFIG.design.preset)) throw new Error('design.preset must be slack, plain or custom');
for (const name of ['reference', 'stylesheet']) if (CONFIG.design?.[name]) within(PROJECT_ROOT, CONFIG.design[name]);
if (CONFIG.design?.preset === 'custom' && !CONFIG.design.stylesheet) throw new Error('custom design requires a stylesheet');
export const SOURCE_ROOT = path.resolve(process.env.DOCFLOW_SOURCE_ROOT ?? path.resolve(PROJECT_ROOT, CONFIG.sourceRoot ?? '.'));
if (!fs.existsSync(SOURCE_ROOT) || !fs.statSync(SOURCE_ROOT).isDirectory()) throw new Error('sourceRoot must be an existing directory');
if (CONFIG.confluence?.enabled && !CONFIG.jira?.enabled) throw new Error('Confluence link ingestion requires Jira to be enabled');
if (CONFIG.jira?.attachments && !['links', 'ignore'].includes(CONFIG.jira.attachments)) throw new Error('jira.attachments must be links or ignore');
export const STATE_REL = CONFIG.stateDir ?? '.docflow/state';
export const OMM_REL = CONFIG.ommDir ?? '.omm';
if (OMM_REL !== '.omm') throw new Error('OMM CLI requires the standard .omm directory');
export const STATE_DIR = within(PROJECT_ROOT, STATE_REL);
export const OMM_DIR = within(PROJECT_ROOT, OMM_REL);
export const BINDINGS_FILE = within(PROJECT_ROOT, CONFIG.bindings ?? 'docs/_bindings.yaml');
export const sourcePath = rel => within(SOURCE_ROOT, rel);
