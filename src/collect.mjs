import fs from 'node:fs';
import { CONFIG, SOURCE_ROOT, STATE_DIR } from './config.mjs';
import { collectChanges } from './changes.mjs';
import { collectExternal } from './external.mjs';
import { writeState, readState } from './lib.mjs';

const batch = process.env.DOCFLOW_CHANGE_FILE
  ? JSON.parse(fs.readFileSync(process.env.DOCFLOW_CHANGE_FILE, 'utf8')) : collectChanges(CONFIG, SOURCE_ROOT, STATE_DIR);
if (batch && !batch.commits.length) {
  console.log('미러 변경 없음: 기존 이슈 근거와 검토 구간을 유지합니다.');
  process.exit(0);
}
if (batch) writeState('batch.json', batch);
const evidence = await collectExternal(CONFIG, batch);
if (CONFIG.jira?.enabled) {
  const previous = readState('external.json', {issues:[], confluence:[]});
  const merge = (before, next, key) => [...new Map([...before, ...next].map(x => [x[key], x])).values()].sort((a,b) => String(a[key]).localeCompare(String(b[key])));
  writeState('external.json', { schema:1, issues:merge(previous.issues, evidence.issues, 'key'), confluence:merge(previous.confluence, evidence.confluence, 'url') });
}
console.log(`변경 근거 수집: 커밋 ${batch?.commits.length ?? 0}개, Jira ${evidence.issues.length}개, Confluence ${evidence.confluence.length}개`);
