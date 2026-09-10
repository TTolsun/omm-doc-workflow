import fs from 'node:fs';
import { spawnHermes } from './hermes-cli.mjs';
import { CONFIG, SOURCE_ROOT, PROJECT_ROOT, BINDINGS_FILE } from './config.mjs';
import { ommCli } from './omm-cli.mjs';
import { readBindings, globFiles } from './lib.mjs';

console.log(`문서 프로젝트: ${PROJECT_ROOT}\n코드 저장소: ${SOURCE_ROOT}\n에이전트: ${CONFIG.agent?.kind ?? 'hermes'}\n모델: ${CONFIG.agent?.model ?? '설정 필요'}`);
if (!fs.existsSync(SOURCE_ROOT) || !fs.existsSync(BINDINGS_FILE)) throw new Error('코드 또는 바인딩 경로가 없습니다.');
const cli = ommCli();
if (!fs.existsSync(cli)) throw new Error('OMM 0.2.0을 설치하거나 DOCGEN_OMM_CLI를 설정하세요.');
if ((CONFIG.agent?.kind ?? 'hermes') === 'hermes') {
  const result = spawnHermes(['chat', '--help'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  if (result.status !== 0) throw new Error(`Hermes CLI 실행 실패: ${result.error?.code ?? result.status ?? result.signal}. 설치 경로 또는 DOCFLOW_HERMES_CLI를 확인하세요.`);
  if (!result.stdout.includes('--query-file')) throw new Error('Hermes CLI의 --query-file 지원 여부를 확인하세요.');
  console.log('Hermes CLI 계약 확인 완료. 실제 모델 연결은 sync에서 확인합니다.');
}
for (const [name, source] of Object.entries(readBindings().sources)) {
  if (source.kind === 'omm') console.log(`${name}: ${globFiles(source.evidence ?? []).length}개 코드 근거 파일`);
}
