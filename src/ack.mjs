import { readState, writeState, readBindings } from './lib.mjs';
import { collectKeys, computeHashes, stateOf } from './model.mjs';

const args = process.argv.slice(2);
const reviewer = args.find(x => x.startsWith('--reviewer='))?.slice(11);
const commit = args.find(x => x.startsWith('--source-commit='))?.slice(16);
const batch = readState('batch.json');
if (!reviewer || !commit || commit !== batch?.headCommit) throw new Error('검토·병합한 batch의 --source-commit=<hash>와 --reviewer=<name>을 지정하세요.');
const bindings = readBindings(), evidence = readState('evidence.json', {entries:{}});
for (const k of collectKeys(bindings)) {
  const current = computeHashes(bindings, k);
  if (!current.exists || current.missingCited?.length || stateOf(current, evidence.entries[k.key]?.accepted) !== 'fresh') throw new Error(`검토가 남아 있습니다: ${k.key}`);
}
writeState('checkpoint.json', { schema: 1, sourceCommit: commit, reviewer, at: new Date().toISOString() });
console.log(`다음 실행 기준을 ${commit}으로 기록했습니다. 이 변경도 문서 저장소에 커밋하세요.`);
