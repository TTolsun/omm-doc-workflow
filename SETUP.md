# AI 에이전트에게 셋업 맡기기

**아래 요청을 Claude나 Hermes에 전달하세요.** 이 안내는 설치를 맡은 에이전트용입니다. 정기 문서 실행은 프로젝트에 설정한 Hermes·Qwen이 담당합니다.

```text
이 저장소의 AGENTS.md와 SETUP.md를 읽고 코드 문서화 시스템을 셋업해 주세요.
코드와 문서 저장소를 분리할 수 있게 구성하고, 문서 실행은 Hermes + 사내 Qwen을 사용합니다.
미러링 성공 후 변경 커밋과 CSWPR 이슈를 근거로 문서를 갱신하려고 합니다.
필요한 경로와 필수 접속 정보만 질문하고, 선택 기능은 설정으로 켜고 끌 수 있게 해 주세요.
정상 실행과 실패 복구를 검사하고, 실제로 검증하지 못한 연결은 구분해 보고해 주세요.
```

## 1. 실행 환경을 확인합니다

Node 24 이상, Git, OMM 0.2.0이 필요합니다. Hermes 실행을 선택하면 `hermes chat --help`에서 `--query-file` 지원 여부를 확인합니다. Hermes는 사용자 환경에 설치된 것을 사용하며, 공용 실행기가 다른 에이전트를 몰래 설치하지 않습니다.

```bash
node --version
git --version
npm ci --ignore-scripts
npm test
```

Google Drive 같은 가상 파일 시스템에서 npm 설치 파일이 비어 있으면 일반 로컬 디스크에 의존성을 설치하고 `DOCGEN_OMM_CLI`에 `oh-my-mermaid/dist/cli.js`의 경로를 지정합니다.

## 2. 프로젝트 설정을 만듭니다

`examples/camera-hal`을 문서 프로젝트의 시작점으로 사용합니다. 예제의 Kotlin 앱 의존성은 없으며, 제공된 C++ 파일은 작동 확인용 가상 코드입니다. 실제 회사 코드가 아닙니다.

| 필수 확인 | 결정할 값 |
| --- | --- |
| 코드 작업본 | 미러링이 끝난 Camera HAL 저장소 경로 |
| 문서 프로젝트 | `.omm`, 원고, 생성 페이지, 검토 상태를 저장할 경로 |
| Qwen 접속 | 모델 ID, 사내 OpenAI 호환 API URL, 필요한 인증 환경변수 |
| 변경 방식 | 작업본 비교 또는 커밋 구간 처리 |
| 최초 구간 | 커밋 방식이면 `changes.initialCommit`의 실제 커밋 해시 |

Jira와 Confluence는 선택 사항입니다. 사용한다면 Jira URL·인증 방식·Problem/Cause/Solution 필드 매핑과 Confluence URL·권한을 확인합니다. 실제 필드 ID는 회사마다 다르므로 예제 번호를 추정해 넣지 않습니다.

인증 값은 환경변수로 전달합니다. `DOCFLOW_MODEL_API_KEY`, `DOCFLOW_JIRA_TOKEN`, `DOCFLOW_CONFLUENCE_TOKEN`이 기본 이름입니다. Basic 인증이 필요하면 사용자 환경변수도 지정합니다. 설정 파일에는 토큰 값 대신 환경변수 이름을 씁니다.

## 3. 목차와 코드 범위를 정합니다

바인딩에서 구조 관점과 근거 파일 글롭을 지정합니다. Camera HAL에서는 요청 처리, 버퍼 소유권, 결과 콜백처럼 팀이 실제로 변경하는 단위로 나눕니다. Android 소스 트리 전체를 하나의 프롬프트에 넣지 않습니다.

입력이 모델 한도를 넘으면 실행은 중단됩니다. 해당 관점의 근거를 좁히거나 별도 문서 프로젝트·관점으로 나눈 뒤 다시 검사합니다. 코드의 중요한 조건을 제거해 크기만 맞추지 않습니다.

문체는 `style/README.md`와 두 규칙 원문을 사용합니다. 프로젝트 규칙을 추가하더라도 근거 구분과 한국어 완성 문장 원칙을 유지합니다.

시각적 형식은 기본 Architecture Intelligence 예제를 사용합니다. `DESIGN.md`를 읽고 [디자인 설정](docs/design.md)에 따라 `templates/jekyll`의 레이아웃과 생성 CSS·JS를 연결합니다. 코드 근거 표시는 `inspect`로 생성합니다. 다른 형식은 `design.preset`과 프로젝트 CSS로 연결하며, 디자인 선택은 문체·근거 검증과 별도로 유지합니다. 소비 프로젝트의 적용은 해당 프로젝트를 수정하도록 요청받았을 때 진행합니다.

## 4. 실제 연결을 검사합니다

```bash
node bin/docflow.mjs doctor --project /work/camera-hal-docs --source /work/camera-hal
node bin/docflow.mjs sync --project /work/camera-hal-docs --source /work/camera-hal --dry-run
node bin/docflow.mjs sync --project /work/camera-hal-docs --source /work/camera-hal
```

첫 실제 실행은 작은 코드 범위로 진행합니다. 코드와 문서 출력이 별도 경로인지, OMM과 원고가 Qwen을 통해 작성됐는지, Jira 필드와 Confluence 출처가 맞는지 확인합니다. 그림은 현재 링크만 수집하므로 내용까지 분석했다고 보고하지 않습니다.

Hermes의 자체 컨텍스트 요구와 Qwen 서버의 실제 컨텍스트 설정도 확인합니다. CLI 계약과 사내 API 응답을 확인하는 일은 모의 서버 테스트로 대신할 수 없습니다. [Hermes 제공자 설정](https://hermes-agent.nousresearch.com/docs/integrations/providers)과 [CLI 안내](https://hermes-agent.nousresearch.com/docs/reference/cli-commands)를 참고하세요.

## 5. 리뷰와 정기 실행을 연결합니다

생성 결과를 코드와 대조하고 출처를 확인한 다음 검토를 기록합니다. 생성 페이지를 다시 만들고 프로젝트가 정한 리뷰·반영 절차를 완료합니다.

```bash
node bin/docflow.mjs verify --project /work/camera-hal-docs --accept --reviewer=reviewer-name
node bin/docflow.mjs generate --project /work/camera-hal-docs
# 문서 변경을 검토하고 반영한 뒤 실행합니다.
node bin/docflow.mjs ack --project /work/camera-hal-docs --source-commit=FULL_COMMIT_HASH --reviewer=reviewer-name
```

`checkpoint.json` 변경도 문서 저장소에 기록합니다. 문서 반영 전에 checkpoint를 넘기지 않습니다. 기존 17:00 미러링의 성공 후 단계에서 같은 `sync` 명령을 호출합니다. 미러링 실패 시에는 문서 작업을 시작하지 않습니다.

셋업 결과에는 정상 실행, 오류 주입·복구, 실제 연동 여부, 배포 위치, 다음 실행 기준 커밋을 기록합니다. 연결 정보를 받지 못한 선택 기능은 비활성 상태로 명시합니다.
