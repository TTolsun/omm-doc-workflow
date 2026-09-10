# 프로젝트 설정

**프로젝트의 `docflow.json`을 먼저 작성하세요.** 코드 저장소 경로는 `sourceRoot` 또는 실행 시 `--source`로 지정합니다. 상대 경로의 기준은 문서 프로젝트입니다.

```json
{
  "version": 1,
  "sourceRoot": "../camera-hal",
  "bindings": "docs/_bindings.yaml",
  "stateDir": ".docflow/state",
  "agent": {
    "kind": "hermes",
    "model": "Qwen/Qwen3-Coder",
    "baseUrl": "http://127.0.0.1:8000/v1",
    "contextLength": 65536
  },
  "changes": { "mode": "working-tree" },
  "jira": { "enabled": false },
  "confluence": { "enabled": false }
}
```

예제 모델 ID와 URL은 설치된 서버의 값으로 바꿔야 합니다. `agent.kind=ollama`는 로컬 시험에 사용하는 직접 호출 방식입니다. 이 경우 URL은 `/v1` 없는 Ollama 루프백 주소입니다. `hermes`는 지정한 OpenAI 호환 서버를 사용하는 일회성 프로필로 실행합니다. 모델 별칭에 `qwen`이라는 문자열이 없어도 `agent.model`에 지정한 값을 그대로 사용하며, 사용자가 지정한 Qwen을 다른 모델로 대체하지 않습니다. `DOCGEN_QWEN_MODEL`을 함께 설정했다면 `agent.model`과 같아야 합니다.

Hermes에는 명시적으로 `file` 도구 집합을 선택한 뒤 일회성 프로필의 `agent.disabled_toolsets: [file]`로 비활성화합니다. 도구 집합 옵션을 생략하면 기본 도구가 활성화될 수 있으므로 생략하지 않습니다. 설치된 Hermes가 이 비활성화 설정과 `--query-file`을 지원해야 합니다. Windows의 `.cmd` 실행 파일도 탐색하며 실행 경로를 `DOCFLOW_HERMES_CLI`로 지정할 수 있습니다. `.cmd` 경로와 인수에 셸 확장 문자가 있으면 실행을 거부합니다. `doctor`는 CLI 실행과 도움말을 검사하며 실제 모델 연결과 도구 비활성화 동작까지 보증하지 않습니다.

## 커밋과 CSWPR 이슈

```json
{
  "changes": {
    "mode": "commits",
    "initialCommit": "검증한_최초_커밋_해시",
    "maxCommits": 100
  },
  "jira": {
    "enabled": true,
    "baseUrl": "https://jira.example.internal",
    "apiVersion": 2,
    "tokenEnv": "DOCFLOW_JIRA_TOKEN",
    "projectKey": "CSWPR",
    "attachments": "links",
    "issuePattern": "\\bCSWPR[- ]?(\\d+)\\b",
    "failurePolicy": "fail"
  },
  "confluence": {
    "enabled": true,
    "baseUrl": "https://confluence.example.internal",
    "tokenEnv": "DOCFLOW_CONFLUENCE_TOKEN"
  }
}
```

위 주소는 설명용입니다. 실행 전에 실제 사내 주소로 바꿉니다. `initialCommit`은 최초 실행에만 사용하며, 이후 `ack`로 기록한 `checkpoint.json`을 기준으로 합니다. 기준 커밋이 현재 미러 이력의 조상이 아니면 중단합니다.

Jira를 활성화하면 `projectKey`와 `issuePattern`을 모두 지정해야 합니다. 패턴의 첫 캡처 그룹은 숫자로 된 이슈 번호입니다. Jira가 비활성화되어 있으면 커밋 메시지에서 이슈 번호를 추출하지 않습니다. `ack`는 커밋 모드에서만 사용합니다.

각 검증 키에는 관련 파일을 바꾼 커밋과 해당 커밋이 언급한 Jira 이슈, 연결된 Confluence 페이지만 제공합니다. 원고의 `sources`와 `references`도 이 범위에 포함합니다. 삭제된 파일도 경로 패턴으로 판단하며, 병합 커밋은 첫 부모와 비교합니다. 커밋별 파일 정보가 없는 이전 배치는 배치 전체의 파일 목록으로 보수적으로 판정합니다.

`scopes.json`에는 키별로 마지막 관련 배치의 커밋 근거를 유지합니다. 무관한 다음 배치 때문에 기존 근거가 사라져 검토 상태가 바뀌는 일을 막기 위한 상태입니다. `external.json`에는 현재 배치, 유지한 키별 근거, 원고의 명시적 인용이 참조하는 항목만 남깁니다. 이 정리는 커밋이 있는 배치를 수집할 때 실행됩니다. 기존 전체 배치 해시에서 전환할 때는 한 번 재검토가 필요할 수 있으며, 실행기가 검토 승인이나 checkpoint를 자동 변경하지 않습니다.

Problem·Cause·Solution이 Jira 설명의 제목이면 자동으로 구분합니다. 별도 사용자 필드라면 `jira.fields`에 실제 필드 ID를 지정합니다.

```json
{
  "fields": {
    "Problem": "customfield_실제번호",
    "Cause": "customfield_실제번호",
    "Solution": "customfield_실제번호"
  }
}
```

필드가 없으면 빈 내용을 만들어 넣지 않고 `null`로 남깁니다. 기본 `failurePolicy=fail`은 연동 실패 시 전체 동기화를 중단합니다. `record-missing`을 명시하면 접근하지 못한 근거를 미확인 상태로 기록합니다. 확인하지 못한 근거 ID를 원고가 인용하면 생성 검사가 실패합니다.

Confluence는 지정한 서버와 같은 origin의 링크만 수집합니다. `pageId`, `/pages/숫자/`, `/display/공간/제목` 형식을 처리하며 특정할 수 없는 URL은 미확인으로 남깁니다. 리다이렉트를 자동으로 따라가지 않습니다.

## 실행과 출력

| 설정 또는 환경변수 | 역할 |
| --- | --- |
| `factsAdapter` | 프로젝트의 결정론적 사실 추출 모듈 경로입니다. |
| `factsRenderer` | `renderFact(block, context)`로 사실을 배치하는 프로젝트 모듈 경로입니다. 선택적인 `renderStatus(context)`는 최신성 표 앞에 앱 버전 같은 프로젝트별 설명을 반환합니다. |
| `sourceInputs` | 사실 추출기가 추가로 읽는 코드 파일 글롭입니다. |
| `styleDir` | 프로젝트가 보관하는 공통 집필 규칙 경로입니다. 생략하면 시스템 기본 규칙을 사용합니다. |
| `design` | Slack·plain·custom 시각적 형식을 선택합니다. [디자인 안내](design.md)를 참고하세요. |
| `DOCFLOW_HERMES_CLI` | Hermes 실행 파일의 위치입니다. |
| `DOCGEN_OMM_CLI` | 고정한 OMM CLI 모듈의 위치입니다. |
| `DOCGEN_LLM_TIMEOUT_MS` | 모델 호출 제한 시간이며 기본 300초입니다. |
| `DOCGEN_MAX_PROMPT_CHARS` | Hermes와 Ollama의 프롬프트 문자 수 제한이며 기본 60,000자입니다. Hermes는 추가한 JSON 출력 계약까지 검사합니다. 모델의 토큰 한도와는 별개입니다. |
| `DOCGEN_QWEN_CONTEXT` | 직접 Ollama 호출의 컨텍스트이며 기본 32,768토큰입니다. |

OMM 경로는 `.omm`을 사용합니다. 상태·바인딩·스타일·프로젝트 모듈 경로는 문서 프로젝트 안에 있어야 합니다. 배포와 원격 Git 쓰기는 공용 CLI가 수행하지 않으며 프로젝트 CI에서 연결합니다.

일반 프로젝트의 동기화 사본은 `.omm`, 사이트 루트, 상태, 설정·바인딩, 지정한 스타일·디자인 입력으로 한정합니다. 코드 근거는 별도 사본에 제공합니다. `factsAdapter` 또는 `factsRenderer`가 있는 프로젝트는 모듈의 상대 import를 보존하기 위해 기존처럼 프로젝트 전체를 복사합니다. 공통 집필 규칙 원문은 요약하거나 잘라 보내지 않습니다. 입력 한도를 넘으면 근거 범위를 나누어야 합니다.

다음으로 [셋업 절차](../SETUP.md)에 따라 실제 연결과 실패 복구를 확인하세요.
