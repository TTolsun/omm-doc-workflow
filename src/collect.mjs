import fs from 'node:fs';
import { CONFIG, SOURCE_ROOT, STATE_DIR } from './config.mjs';
import { collectChanges } from './changes.mjs';
import { collectExternal } from './external.mjs';
import { writeState, readState, readBindings } from './lib.mjs';
import { collectKeys, evidenceScope } from './model.mjs';
import { selectCommits, selectExternal } from './evidence-scope.mjs';

const batch = process.env.DOCFLOW_CHANGE_FILE
  ? JSON.parse(fs.readFileSync(process.env.DOCFLOW_CHANGE_FILE, 'utf8')) : collectChanges(CONFIG, SOURCE_ROOT, STATE_DIR);
if (batch && !batch.commits.length) {
  console.log('미러 변경 없음: 기존 이슈 근거와 검토 구간을 유지합니다.');
  process.exit(0);
}
const evidence = await collectExternal(CONFIG, batch);
const bindings = readBindings();
const entries = {}, previousScopes = readState('scopes.json', { entries: {} }).entries;
const previousBatch = readState('batch.json');
const references = [];
for (const entry of collectKeys(bindings)) {
  const scope = evidenceScope(bindings, entry);
  const relevant = selectCommits(batch, scope.patterns);
  entries[entry.key] = relevant.length ? relevant : selectCommits({ commits: previousScopes[entry.key] ?? selectCommits(previousBatch, scope.patterns) }, scope.patterns);
  references.push(...scope.references);
}
if (CONFIG.jira?.enabled) {
  const previous = readState('external.json', {issues:[], confluence:[]});
  for (const issue of evidence.issues) {
    const prior = previous.issues.find(x => x.key === issue.key);
    if (issue.state === 'unavailable' && Array.isArray(prior?.confluenceUrls)) issue.confluenceUrls = prior.confluenceUrls;
  }
  const merge = (before, next, key) => [...new Map([...before, ...next].map(x => [x[key], x])).values()].sort((a,b) => String(a[key]).localeCompare(String(b[key])));
  const merged = { issues:merge(previous.issues, evidence.issues, 'key'), confluence:merge(previous.confluence, evidence.confluence, 'url') };
  const retained = selectExternal(merged, [...Object.values(entries).flat(), { issues: batch?.issues ?? [] }], references);
  writeState('external.json', { schema:1, ...retained });
}
if (batch) writeState('batch.json', batch);
writeState('scopes.json', { schema: 1, entries });
console.log(`변경 근거 수집: 커밋 ${batch?.commits.length ?? 0}개, Jira ${evidence.issues.length}개, Confluence ${evidence.confluence.length}개`);
