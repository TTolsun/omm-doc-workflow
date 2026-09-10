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

예제 모델 ID와 URL은 설치된 서버의 값으로 바꿔야 합니다. `agent.kind=ollama`는 현재 앱과 로컬 시험에 사용하는 직접 호출 방식입니다. 이 경우 URL은 `/v1` 없는 Ollama 루프백 주소입니다. `hermes`는 지정한 OpenAI 호환 Qwen 서버를 사용하는 일회성 프로필로 실행합니다.

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
| `factsRenderer` | 추출된 사실을 표로 배치하는 프로젝트 모듈 경로입니다. |
| `sourceInputs` | 사실 추출기가 추가로 읽는 코드 파일 글롭입니다. |
| `styleDir` | 프로젝트가 보관하는 공통 집필 규칙 경로입니다. 생략하면 시스템 기본 규칙을 사용합니다. |
| `design` | Slack·plain·custom 시각적 형식을 선택합니다. [디자인 안내](design.md)를 참고하세요. |
| `DOCFLOW_HERMES_CLI` | Hermes 실행 파일의 위치입니다. |
| `DOCGEN_OMM_CLI` | 고정한 OMM CLI 모듈의 위치입니다. |
| `DOCGEN_LLM_TIMEOUT_MS` | 모델 호출 제한 시간이며 기본 300초입니다. |
| `DOCGEN_MAX_PROMPT_CHARS` | 직접 Ollama 호출의 입력 제한이며 기본 60,000자입니다. |
| `DOCGEN_QWEN_CONTEXT` | 직접 Ollama 호출의 컨텍스트이며 기본 32,768토큰입니다. |

OMM 경로는 `.omm`을 사용합니다. 상태·바인딩·스타일·프로젝트 모듈 경로는 문서 프로젝트 안에 있어야 합니다. 배포와 원격 Git 쓰기는 공용 CLI가 수행하지 않으며 프로젝트 CI에서 연결합니다.
