# 공용 엔진 변경·배포 기록

**0.3.2는 로컬 검증을 마친 수정본입니다. 소비 프로젝트 설치와 원격 배포는 수행하지 않았습니다.** 프로젝트에는 별도로 검증한 공용 엔진 버전을 설치해 호출해야 합니다.

## 0.3.2 · 2026-09-16

열린 이슈 #10을 Hermes 0.21.1 소스와 실제 CLI 실행으로 대조했습니다. 검토 승인과 checkpoint는 변경하지 않으며, Ollama 직접 호출 경로는 바꾸지 않았습니다.

| 이슈 | 확인 결과와 처리 |
| --- | --- |
| [#10: Hermes 추론 기본값과 stdout 해석](https://github.com/TTolsun/omm-doc-workflow/issues/10) | 원인을 확인했습니다. Hermes의 `custom` 제공자는 추론 수준이 없으면 요청에 `reasoning_effort`를 넣지 않아 서버 기본값이 적용되고, Qwen3 계열 서버는 기본적으로 추론을 켭니다. 일회성 프로필의 `agent.reasoning_effort: none`과 실행 인수 `--reasoning none`을 함께 지정하여 요청에 `reasoning_effort: "none"`을 보냅니다. Ollama 주소(11434)에서는 Hermes가 `think: false`도 함께 보냅니다. 같은 프로필에서 `auxiliary.title_generation.enabled: false`로 세션 제목용 추가 모델 호출을 껐습니다. stdout 해석은 출력을 끝맺는 JSON 객체, 마지막 코드 펜스, 다른 문장이 뒤따르는 첫 JSON 객체 순으로 찾도록 바꿨고, JSON 객체가 없거나 종료 코드가 0이 아니면 `DOCFLOW_AGENT_ATTEMPTS`(기본 3회)까지 다시 실행합니다. 실행 파일 누락, 안전하지 않은 인수, 시간 초과는 다시 실행하지 않습니다. `doctor`는 `--reasoning` 도움말 표기도 검사합니다. |

Hermes 0.21.1의 커밋 `564aef2946c436500a5e80ee117b66b789b3f99a`에서 `hermes_cli/_parser.py`의 `chat --reasoning`, `hermes_constants.py`의 `resolve_reasoning_config`, `plugins/model-providers/custom/__init__.py`의 `reasoning_effort` 변환, `agent/title_generator.py`의 `auxiliary.title_generation.enabled`를 대조했습니다. `test/hermes-real.test.mjs`는 실제 CLI가 보낸 요청에 `reasoning_effort: "none"`이 있고 세션 제목 요청이 없음을 검사합니다.

0.3.2 검증 결과는 다음과 같습니다.

- Windows와 Node 24.18.0에서 `DOCFLOW_REAL_HERMES_CLI`에 임시 설치한 Hermes 0.21.1을 지정하여 `npm test`를 실행했습니다. 47개 중 45개가 통과했고, 실제 Qwen이 필요한 2개는 실행 조건이 없어 건너뛰었습니다. 수정 전 같은 검사에서 실제 CLI가 보낸 요청에는 `reasoning_effort`가 없었고 세션 제목 요청이 하나 더 있었습니다.
- 로컬 Ollama 0.34.0의 `qwen3.5:4b`에 `/v1/chat/completions`를 직접 호출하여 비교했습니다. 추론 인수가 없으면 출력 549토큰에 35.9초가 걸렸고 추론 내용이 포함됐습니다. `reasoning_effort: "none"`은 출력 6토큰에 0.4초였습니다. `/v1`에 `think: false`만 보내면 무시되어 추론이 유지됐습니다.
- 같은 Ollama와 Hermes로 13,345자 프롬프트를 실행했습니다. 수정 전 코드는 286.4초 뒤 `Unexpected non-whitespace character after JSON`으로 실패했고, 수정 후 코드는 36.3초에 11개 함수 요약 JSON을 반환했습니다. 4B 모델의 로컬 결과이므로 이슈의 27B 모델 소요 시간과 같지 않습니다.
- 모의 실행 파일로 안내 문구 뒤의 JSON, JSON 뒤의 설명 문장, 빈 응답 재시도, 종료 코드 1 재시도, 재시도 소진, 시간 초과 즉시 실패, `DOCFLOW_AGENT_ATTEMPTS=1`을 검사했습니다. 예제의 `doctor`, `sync --dry-run`, `generate --check`와 `git diff --check`도 통과했습니다. 실제 Qwen 27B 서버와 사내 서비스 실접속은 확인하지 않았습니다.

적용 시 확인할 사항은 다음과 같습니다. `DOCGEN_LLM_TIMEOUT_MS`는 실행 1회마다 적용되므로 최대 대기 시간은 `DOCFLOW_AGENT_ATTEMPTS`와의 곱에 가까울 수 있습니다. 시간 초과 자체는 다시 실행하지 않습니다. 설치된 Hermes가 `chat --reasoning`을 지원하지 않으면 `doctor`와 `sync`가 실패하므로 0.21.1 이상으로 맞춰야 합니다.

## 0.3.1 · 2026-09-11

열린 이슈 #2~#6을 코드와 테스트로 대조했습니다. 아래 변경은 검토 승인과 checkpoint를 자동으로 갱신하지 않습니다. PR #9의 reading 디자인과 0.3.0을 포함한 최신 `main`에 통합했으며, 기존 디자인 변경을 보존합니다.

| 이슈 | 확인 결과와 처리 |
| --- | --- |
| [#2: 무관한 커밋으로 전체 재스캔](https://github.com/TTolsun/omm-doc-workflow/issues/2) | 전체 배치가 모든 키의 해시에 들어가는 문제를 확인했습니다. 해시와 프롬프트에 같은 키별 필터를 적용했습니다. 커밋별 변경 경로와 이슈, 연결된 Confluence 페이지를 추적하며 원고가 직접 인용한 코드·외부 근거도 포함합니다. `scopes.json`에 마지막 관련 근거를 보관하여 다음 무관한 배치와 `ack` 이후에도 최신성을 유지합니다. 외부 근거는 현재 배치·키별 근거·명시적 인용이 필요로 하는 항목만 보존합니다. |
| [#3: Hermes 입력과 파일 도구](https://github.com/TTolsun/omm-doc-workflow/issues/3) | Hermes의 입력 제한 누락과 프롬프트 모순을 확인했습니다. 모델 호출 전 공통 문자 수 검사를 추가했고 Hermes는 JSON 출력 계약을 더한 입력도 검사합니다. 제공된 코드만 사용하도록 집필 규칙을 맞췄습니다. 기본 도구가 활성화되지 않도록 `file` 집합을 명시한 뒤 일회성 프로필에서 비활성화합니다. |
| [#4: 프로젝트 전용 값](https://github.com/TTolsun/omm-doc-workflow/issues/4) | HALCamera 설치 경로, 임시 경로 접두어, 특정 설치 위치 안내, CSWPR 기본값, 모델 이름의 Qwen 문자열 제한을 제거했습니다. 앱 버전 표시는 프로젝트 `factsRenderer.renderStatus`에서 선택적으로 제공합니다. 설정된 Qwen 모델은 유지하며 다른 모델로 대체하지 않습니다. |
| [#5: CLI와 예제 생성 결과](https://github.com/TTolsun/omm-doc-workflow/issues/5) | 테스트의 실제 CLI 진입점 공백과 예제의 `generate --check` 실패를 확인했습니다. `--project`, `--source`, 상대 `--config`, 기본 작업 디렉터리, 잘못된 명령·인수를 검사합니다. 절대 `--config`는 기존 프로젝트 상대 경로 계약에 따라 거부합니다. 예제의 생성 블록을 반영했으며 검토 승인은 추가하지 않았습니다. |
| [#6: 작은 개선 제안](https://github.com/TTolsun/omm-doc-workflow/issues/6) | 일반 프로젝트의 스냅샷을 문서 입력으로 좁혔습니다. 사용자 모듈의 상대 import가 있는 프로젝트는 호환성을 위해 전체 복사를 유지합니다. Windows Hermes 실행 파일과 `.cmd` 탐색을 공통화했고 `doctor`에 실제 오류 코드를 표시합니다. `ack`는 working-tree 모드에서 전용 안내를 제공합니다. 스타일 원문 축약은 저장소의 원문 전체 적용 규칙과 충돌하므로 채택하지 않았습니다. |

Hermes 도구 비활성화 방식은 [공식 설정 문서](https://hermes-agent.nousresearch.com/docs/user-guide/configuration/)와 [검증한 CLI 구현](https://github.com/NousResearch/hermes-agent/blob/564aef2946c436500a5e80ee117b66b789b3f99a/hermes_cli/cli_agent_setup_mixin.py)을 대조했습니다. Hermes 0.21.1의 같은 커밋을 임시 환경에 설치하고 실제 CLI가 로컬 모의 API에 보낸 요청을 관찰하여, `file` 집합을 선택한 뒤 비활성화했을 때 도구 목록이 없음을 확인했습니다. 재현 절차는 `test/hermes-real.test.mjs`에 포함합니다.

## PR #8 리뷰 반영

- 기존 이슈에 `confluenceUrls`가 없으면 연결 관계가 불명확하므로 기존 Confluence 페이지를 보수적으로 보존합니다. `record-missing`으로 이슈 조회가 실패해도 이전 링크 목록이 있으면 유지합니다. 이후 링크 정보가 확보되면 불필요한 페이지를 다시 정리합니다.
- Ollama는 기본값까지 적용한 유효 모델 이름을 계산한 뒤 환경변수와 비교합니다. `agent.model`이 없고 환경변수가 기본 모델과 같은 경우와 같은 프로세스의 반복 호출을 검사합니다.
- 상대 Hermes 실행 경로는 호출 작업 디렉터리를 기준으로 해석합니다. 동기화는 문서 프로젝트에서 절대 경로로 고정한 뒤 스테이지에 전달하므로, 실행 파일이 스테이지 복사 범위 밖에 있어도 사용할 수 있습니다.
- Hermes 설정 우선순위 지적은 실제 CLI와 로컬 모의 API를 연결한 검사로 확인했습니다. 기본 도구를 다시 활성화할 수 있는 옵션 생략 대신, 실제로 도구 목록이 비어 있음을 확인한 기존 방식을 유지합니다.

## 검증 결과

- Windows와 Node 24.18.0에서 `DOCFLOW_REAL_HERMES_CLI`에 임시 설치본을 지정하여 `npm test`를 실행했습니다. 46개 중 44개가 통과했고, 실제 Qwen이 필요한 2개는 실행 조건이 없어 건너뛰었습니다. Hermes 경로를 지정하지 않는 기본 실행에서는 실제 Hermes 검사도 건너뜁니다.
- 임시 프로젝트에서 모의 모델을 통한 실행·원고 생성·반영을 확인했습니다. HTTP 오류, 시간 초과, 잘못된 응답, 허용 범위 밖 수정, 중간 반영 실패, 중단 후 복구, 동시 수정 시 원본 보존 검사도 통과했습니다.
- 예제의 `sync --dry-run`과 `generate --check`가 통과했습니다. `npm run preview:build` 결과는 기존 미리보기와 같았습니다. `git diff --check`도 통과했습니다.
- 모의 Hermes 실행 파일과 Windows `.cmd`를 이용한 `doctor` 검사는 통과했습니다. 기본 환경에서는 Hermes 실행 파일을 찾지 못해 `ENOENT`가 발생했지만, 임시 설치한 실제 Hermes 경로를 지정한 예제 `doctor`는 통과했습니다. 사용자 환경에 Hermes를 전역 설치하지 않았으며, 실제 Qwen·사내 Jira·Confluence 연결은 확인하지 않았습니다.

## 적용 시 확인할 사항

기존 전체 배치 해시에서 키별 해시로 전환하면 한 번 재검토가 필요할 수 있습니다. Jira를 활성화한 프로젝트는 `projectKey`와 첫 캡처 그룹이 숫자인 `issuePattern`을 명시해야 합니다. `DOCGEN_QWEN_MODEL`이 지정되어 있으면 `agent.model`과 같아야 합니다. 앱 버전 표시에 의존하던 프로젝트는 선택적인 `factsRenderer.renderStatus`를 연결해야 합니다.

상태 디렉터리의 `scopes.json`도 다른 근거 상태 파일과 함께 보존해야 합니다. 자동 실행은 검토 승인이나 문서 반영 완료를 대신하지 않습니다. 다음으로 [프로젝트 설정](configuration.md)에서 변경된 계약과 실제 연결 조건을 확인하세요.
