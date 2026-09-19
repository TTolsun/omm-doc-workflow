# 공용 엔진 변경·배포 기록

**0.5.0은 hal-camera가 자체 `tools/docgen` 사본에 쌓아 온 개선을 엔진으로 되가져와, 소비 프로젝트가 엔진만 설치해 쓰도록 만든 판입니다.** hal-camera 저장소는 이 버전을 npm 의존성으로 고정하고 설정·어댑터·상태 파일만 남깁니다.

## 0.5.2 · 2026-09-19

0.5.1로 다시 실행한 `docs-sync`는 요소 54개 스캔(5.8분, 반려 0회)과 원고 두 건(`overview`, `module-roles`, 반려 0회)을 통과한 뒤 `runtime-flow`의 근거 요약 6/8에서 `Qwen 응답이 완성되지 않았습니다 (length)`로 실패했습니다. 요약 호출인데 출력이 8,192토큰까지 달린 것입니다. JSON 스키마의 `maxLength`는 Ollama 문법으로 강제되지 않으므로 모델이 요약을 끝맺지 못하면 전체 출력 한도까지 갑니다.

| 항목 | 변경 내용 |
| --- | --- |
| 호출별 출력 상한 | [src/qwen.mjs](../src/qwen.mjs)의 `qwen(prompt, schema, options)`가 `options.numPredict`를 받아 그 호출의 `num_predict`를 전역 상한 아래로 묶습니다. `runAgent`와 워커의 `qwen` 래퍼가 그대로 전달합니다. 근거 요약은 요약 상한 + 64토큰으로 호출합니다. |
| `length` 처리 | 출력 한도에 닿은 응답은 `doneReason = 'length'`를 가진 오류가 됩니다. 근거 요약은 기존의 길이 초과 재시도(짧게 쓰라는 지시 1회)로, 원고 집필과 구조 스캔은 반려 사유로 돌려 재요청합니다. 다른 완성 실패(빈 응답, 오류)는 그대로 실패합니다. |

검증: `npm test` 131개 중 125개 통과. 새 검사는 요약의 `length`가 `num_predict`를 묶은 재시도 한 번으로 회복되는 것, 집필과 스캔의 `length`가 반려 한 번 뒤 통과하는 것입니다. 실제 Qwen 재실행은 hal-camera에서 이 버전으로 다시 합니다.

## 0.5.1 · 2026-09-19

hal-camera에서 0.5.0으로 `docs-sync`를 `force=true`로 실행한 첫 실측(요소 54개 스캔 성공, 필드 44개 수정, 반려 0회, 약 6분)에서 원고 `architecture.md/module-roles`가 "필수 심볼" 사유로 3회 반려되어 전체가 실패했습니다. 재시도 답변이 정확히 1,000토큰에서 끝난 것으로 보아 답변 스키마의 `maxLength: 2500`이 답변을 중간에서 끊었고, 뒤쪽에 나올 심볼이 잘려 다시 반려되는 순환이었습니다.

| 항목 | 변경 내용 |
| --- | --- |
| 답변 상한 | [src/write-evidence.mjs](../src/write-evidence.mjs)의 상한을 `DOCGEN_MAX_ANSWER_CHARS`(기본 6,000자)로 올리고, 상한에 정확히 닿은 답변은 "잘림"으로 구분해 더 짧게 쓰라는 반려 사유를 붙입니다. 상한 아래 답변은 그대로 받아들입니다. |
| 필수 심볼 안내 | 집필 프롬프트의 출력 계약 절에 `must_link` 심볼을 코드에 적힌 그대로 써야 한다는 문장을 넣습니다. 이전에는 brief 본문에만 있었습니다. |

검증: `npm test` 129개 중 123개 통과(6개는 실제 Qwen·Hermes 필요). 새 검사는 상한에 닿은 답변의 반려와 짧은 재답변 수용, 프롬프트의 필수 심볼 문장, 스키마 `maxLength` 반영입니다. 실제 Qwen 재실행은 hal-camera에서 이 버전으로 다시 합니다.

## 0.5.0 · 2026-09-17

hal-camera의 `tools/docgen/*.mjs`에만 있던 기능을 0.4.0의 반려 재요청·문체 검사·diagram 종류 위에 합쳤습니다. 검토 승인과 checkpoint는 변경하지 않습니다. 집필 규칙 원문은 그대로이므로 `styleDir`로 같은 규칙을 쓰던 프로젝트의 해시는 바뀌지 않습니다.

| 항목 | 변경 내용 |
| --- | --- |
| 요소 단위 구조 스캔 | 바인딩 `sources.<관점>.elements`가 요소별 근거를 정하고, [src/model.mjs](../src/model.mjs)의 `collectElements`가 부모 근거 상속·부분집합 검사·존재하지 않는 키 거부를 맡습니다. [src/scan-prompt.mjs](../src/scan-prompt.mjs)는 요소의 필드, 부모 설명(읽기 전용), 그 요소의 근거만 넣어 60,000자 안에서 프롬프트를 만들고, 상태 디렉터리의 `scan.json`이 요소별 근거 해시를 기록해 바뀌지 않은 요소를 건너뜁니다(`--force`는 무시). 반려 재요청, diagram 종류 규칙, `omm validate`는 요소 단위로 그대로 적용됩니다. 관점 전체를 한 프롬프트에 넣던 방식은 hal-camera의 `overall-architecture`(57개 요소)에서 한도를 넘었습니다. |
| 구조화된 원고 집필 | [src/write-evidence.mjs](../src/write-evidence.mjs)가 원고 근거를 인용 파일과 `must_link` 파일로 한정하고(`based_on` 관점의 evidence 전체가 아닙니다), 모델에는 질문별 답변(`answer_N`, 최대 2,500자)과 인용 파일(허용 목록 enum)만 요구합니다. front matter는 프로그램이 조립하며 `decisions`·`verifications`는 기존 원고의 값을 유지합니다. 근거가 한도를 넘으면 문자 오프셋을 표시한 조각으로 나눠 요약한 뒤 요약으로 집필합니다. 조립한 원고는 0.4.0의 계약 검사(`must_link` 포함)와 `manuscript-lint`를 거치고, 조립 실패도 `응답 형식` 반려 사유가 됩니다. |
| Ollama 스트리밍 | [src/qwen.mjs](../src/qwen.mjs)가 `node:http`로 NDJSON 스트림을 읽습니다. 전체 예산 `DOCGEN_LLM_TIMEOUT_MS`(기본 1,800초)와 청크 사이 무응답 한도 `DOCGEN_LLM_IDLE_MS`(기본 120초)를 함께 적용하며, fetch/undici의 300초 헤더 제한에 걸리지 않습니다. 출력 토큰 한도는 `DOCGEN_QWEN_NUM_PREDICT`입니다. |
| `verify` | `--check`·`--accept` 전에 요소 바인딩을 검증하고, 원본이나 인용 파일이 없는 항목은 `--accept`로 지울 수 없습니다. `must_link` 파일은 관점 evidence 밖에 있어도 원고 최신성에 들어가고 `sync`의 코드 사본에도 포함됩니다. |
| 새 명령 | `coverage [--check]`는 프로젝트 `coverageAdapter`가 낸 대상(화면·패키지 등)이 어떤 `elements.*.evidence`에도 없으면 누락으로 판정하고, 바인딩 `coverage.ignore`의 `path`·`reason`으로 제외합니다. `site build|check|serve`는 바인딩 `site.root`의 `_config.yml`과 `_layouts/default.html`로 정적 사이트를 만들며(`marked` 의존성 추가), 매니페스트에 있는 파일만 정리하고 상대 링크·조각·루트 고정 경로를 검사합니다. `check [--ci|--build]`는 디자인 → 근거 표시 → 사실 추출 → 최신성 → 담당 요소 → 생성 → 사이트 순서의 전체 검사이며 CI와 개발자 PC가 같은 진입점을 씁니다. |
| 진입점 | [bin/docflow.mjs](../bin/docflow.mjs)가 `process.argv[1]`을 파일 경로로 넘겨 Windows에서도 각 명령의 `isMain` 판정이 맞습니다. |

0.5.0 검증 결과는 다음과 같습니다.

- Windows와 Node 24.18.0에서 `npm test` 128개 중 122개가 통과했고 6개는 실행 조건이 없어 건너뛰었습니다. hal-camera의 sync 검사 65개(스트리밍 재조립, 시간 제한, 요소 스캔 캐시, 형제 요소 격리, 근거 분할 요약과 길이 초과 재시도, 실패 시 원본 보존, 복구·잠금)와 0.4.0의 반려 검사 8개(요소 단위와 조립 계약으로 옮김), 사이트 빌더 검사 9개를 포함합니다. 반려 검사가 아닌 sync 검사는 호출 횟수를 세므로 `DOCFLOW_SCAN_ATTEMPTS`·`DOCFLOW_WRITER_ATTEMPTS`를 1로 고정합니다.
- hal-camera 작업본(관점 3개, 요소 57개, 원고 5건)에서 `check --build`가 6단계를 모두 통과했고, 요소 57개의 스캔 입력이 모두 60,000자 이하였습니다. 실제 Qwen 실행은 이 버전으로 다시 하지 않았습니다.
- Ollama 모의 서버를 `fetch`로 바꿔치기하던 검사는 스트리밍 전송이 `node:http`를 쓰므로 루프백 서버로 바꿨습니다. 이전에는 mock이 걸리지 않아 이 PC의 실제 Ollama에 요청이 갔습니다.

## 0.4.0 · 2026-09-17

이슈 #13(OMM 기반 UML/다이어그램 생성 workflow)을 반영했습니다. 바인딩의 `omm` 원본마다 `diagram_type`을 지정하면 구조 스캔 프롬프트, 응답 검사, 페이지 생성이 그 종류를 따릅니다. 검토 승인과 checkpoint는 변경하지 않으며, `diagram_type`을 생략한 기존 프로젝트의 해시와 동작은 그대로입니다.

| 항목 | 변경 내용 |
| --- | --- |
| `diagram_type` 설정 | `flow`(기본값), `component`, `class`, `sequence`, `state`를 지원합니다. [src/lib.mjs](../src/lib.mjs)의 `readBindings`가 값을 검증하고, [src/model.mjs](../src/model.mjs)는 기본값이 아닌 종류를 `omm:<source>`의 `modelHash`에 넣어 종류를 바꾸면 `원본이 갱신됨`으로 재스캔·재검토 대상이 되게 합니다. |
| 종류별 검사 | OMM 0.2.0의 `omm validate`는 `graph`/`flowchart` 선언을 요구하므로 `flow`·`component`만 CLI에 맡기고, UML 계열은 새 [src/diagram.mjs](../src/diagram.mjs)가 같은 출력 형식으로 검사합니다. 공통 규칙은 첫 줄 선언(`diagram-type`), 괄호 짝, `@참조` 존재이고, 종류별로 메시지·클래스 선언·전이의 존재와 문법 밖의 줄을 오류로 잡습니다. 라벨 없는 상태 전이는 경고입니다. 검사는 형식만 보며 사실 관계는 판단하지 않습니다. |
| 스캔 프롬프트 | [src/sync-worker.mjs](../src/sync-worker.mjs)가 종류별 작성 규칙 한 줄을 프롬프트와 반려 안내에 넣습니다. UML 계열에는 허용 문법과 짧은 문법 예를 함께 줍니다. 실제 4B 모델이 `for slot in slots_`, `++inFlight_` 같은 코드 문장과 `Session-0>Slot` 같은 잘못된 화살표를 그림에 넣는 것을 관찰하고 추가한 것입니다. |
| 생성 | [src/generate.mjs](../src/generate.mjs)는 `field: diagram` 블록의 첫 줄이 설정한 종류와 다르면 페이지를 쓰지 않고 실패합니다. Mermaid 블록은 종류를 그대로 담습니다. |
| 예제 | `fixtures/camera-hal`에 `BufferSlot`과 `CaptureSession`을 추가하고, `examples/camera-hal`에 `session-structure`(class), `request-lifecycle`(sequence), `buffer-ownership`(state) 관점과 페이지 블록을 추가했습니다. 기존 `request-flow`의 근거는 `RequestQueue.*`로 좁혔습니다. `docs/preview`를 다시 생성했으며 `preview.png`는 이전 화면 그대로입니다. |

0.4.0 검증 결과는 다음과 같습니다.

- Windows와 Node 24.18.0에서 `npm test` 69개 중 66개가 통과했고 3개는 실행 조건이 없어 건너뛰었습니다. 새 검사 5개는 종류별 수용·거부 규칙, 경고가 실패로 이어지지 않는 것, `@참조` 검사, sequence 관점에서 graph 응답을 반려하고 정정 응답을 반영하는 동기화, 종류 불일치 시 `generate` 실패와 잘못된 `diagram_type` 거부, 종류 변경 시 `원본이 갱신됨` 전환과 기본값의 해시 유지를 다룹니다. `npm run preview:build` 결과를 함께 커밋했으며 Mermaid 11이 네 종류를 모두 SVG로 렌더링하는 것을 미리보기 화면에서 확인했습니다.
- 정식 설치한 Hermes 0.21.3과 로컬 Ollama의 `qwen3.5:4b`로 예제 프로젝트 사본에서 `sync --force`를 7회 실행했습니다. 문법 예를 넣기 전 4회는 모두 실패했는데, 2회는 기존 `flow` 스캔에서 Hermes가 JSON 없이 응답을 끝내는 0.3.3에서도 있던 문제이고, 2회는 sequence 그림이 3회 반려 뒤 실패했습니다. 문법 예를 넣은 뒤 3회는 2회 성공, 1회는 sequence 그림이 코드 문장을 계속 넣어 3회 반려 뒤 원본 변경 없이 실패했으며 회당 152~185초가 걸렸습니다. 성공한 실행의 class·state 그림은 코드의 클래스·멤버·상태 전이와 일치했고, sequence 그림은 예제 원본을 유지했습니다. 4B 모델은 sequence 종류에서 가장 자주 반려되므로 실제 프로젝트에서는 `DOCFLOW_SCAN_ATTEMPTS`를 늘리거나 더 큰 모델을 쓰는 것을 검토해야 합니다.
- 실제 Qwen 27B 서버와 사내 Jira·Confluence 실접속은 확인하지 않았습니다.

## 0.3.3 · 2026-09-17

정식 설치한 Hermes 0.21.3과 로컬 Ollama의 `qwen3.5:4b`로 예제 프로젝트의 `sync`를 끝까지 실행하여 실제 원고를 확인했습니다. 파이프라인은 동작했지만 생성 원고에 집필 규칙 위반이 반복되었고, 구조 스캔은 `omm validate`에 자주 걸려 전체 동기화가 실패했습니다. 검토 승인과 checkpoint는 변경하지 않으며, 해시 계산과 Ollama 직접 호출 경로는 바꾸지 않았습니다.

| 관찰한 문제 | 확인 결과와 처리 |
| --- | --- |
| 원고 끝에 붙는 대화체 안내문("다음 단계로 넘어가거나 ... 검토를 요구할 수 있다"), "~한다"·"~없음" 종결, "기존 원고에 따르면" 같은 원고 언급, `**굵은 글씨**` 제목, `##` 제목, 절대 경로와 `file://` 줄 번호 링크, `”}` 같은 JSON 잔여물, `kBuffer Limit`처럼 쪼개진 식별자 | 같은 프롬프트로도 실행마다 결과가 달라 프롬프트 문구만으로는 해결되지 않았습니다. [src/brief.mjs](../src/brief.mjs)에 실제 위반 형태를 잘못된 예와 올바른 예로 넣은 "문체와 출력 범위" 절을 추가하고, [src/manuscript-lint.mjs](../src/manuscript-lint.mjs)가 위 형태를 결정적으로 검사합니다. `sync`는 계약(front matter, `based_on`, `confidence`, 인용 근거, `must_link` 심볼)과 문체 검사를 통과할 때까지 반려 사유를 붙여 다시 요청하고, `DOCFLOW_WRITER_ATTEMPTS`(기본 3회)를 넘기면 원본을 바꾸지 않고 실패합니다. 검사는 사실 관계를 판단하지 않습니다. |
| 식별자 뒤에 한 칸 띄고 붙는 조사("kBufferLimit 은", "true 를") | 관찰한 원고 7편 중 5편에 있었고 반려 사유의 대부분을 차지했습니다. 공백만 지우면 되고 의미가 바뀌지 않으므로 반려하지 않고 정리한 뒤 횟수를 로그에 남깁니다. 코드 블록은 건드리지 않습니다. |
| 원고 전체를 코드 펜스로 감싸거나 앞뒤 공백을 붙여 `front matter가 없습니다`로 실패 | 출력 형식 예시가 펜스 안에 있어 유도된 형태입니다. 프롬프트에 "펜스로 감싸지 않습니다"를 명시하고, 워커는 감싼 펜스와 앞뒤 공백만 벗깁니다. |
| 구조 스캔이 `diagram`을 방향 선언 없이 다시 쓰거나 요소를 `request-flow/admission-check/constraint.md` 같은 파일 경로로 적어 `omm validate`나 형태 검사에 실패 | 사본에 적용해 검증한 뒤 실패하면 그 perspective의 파일을 스냅샷으로 되돌리고 검증 출력을 반려 사유로 붙여 다시 요청합니다. 파일 경로 형태의 요소는 요소 디렉터리로 되돌려 받아들이며 필드는 `field` 값만 봅니다. `DOCFLOW_SCAN_ATTEMPTS`(기본 3회)를 넘기면 실패합니다. 범위 위반은 모델 품질 문제가 아니므로 다시 요청하지 않습니다. |

머지 전 코드 리뷰에서 다음을 추가로 고쳤습니다. 닫히지 않은 front matter나 YAML 오류가 재요청 루프를 빠져나가 전체 동기화를 실패시키던 것을 반려 사유로 바꿨습니다. 요소의 파일 이름이 `field`와 다른 필드를 가리키면 조용히 다른 필드에 쓰지 않고 반려합니다. `updates` 항목이 객체가 아니어도 반려합니다. OMM CLI의 시간 초과·실행 오류는 모델 반려로 다시 요청하지 않으며 `DOCGEN_OMM_TIMEOUT_MS`로 제한 시간을 조정합니다. 반려 문구로 `DOCGEN_MAX_PROMPT_CHARS`를 넘기지 않도록 규칙별 요약으로 줄입니다. 펜스 정보 문자열의 대소문자, 인라인 코드 안의 `\n`, 굵은 식별자 뒤의 조사, 닫는 괄호·따옴표 안에서 끝나는 문장, "위 내용은" 같은 일반 문장의 오탐을 바로잡았습니다. `normalizeText`는 설정을 읽지 않는 `src/text.mjs`로 옮기고 `lib.mjs`에서 다시 내보냅니다.

0.3.3 검증 결과는 다음과 같습니다.

- Windows와 Node 24.18.0에서 `npm test` 64개 중 61개가 통과했고 3개는 실행 조건이 없어 건너뛰었습니다. 새 검사는 검사기 규칙과 펜스 해제, 조사 정리, 원고 반려 후 정정 수용, YAML 오류 반려, 프롬프트 한도 축약, 반려 횟수 소진 시 무변경 실패, 구조 반려 후 복원과 정정 수용, 요소·필드 불일치와 비객체 항목 반려, OMM 시간 초과의 즉시 실패를 다룹니다. `npm run preview:build` 결과는 변경이 없습니다.
- 공식 설치 스크립트로 `%LOCALAPPDATA%\hermes`에 설치한 Hermes 0.21.3(2026.9.14, Python 3.11.16)으로 `doctor`와 `test/hermes-real.test.mjs`가 통과했습니다. 0.21.1에서 확인한 `--query-file`, `--reasoning`, 도구 비활성화 계약이 0.21.3에서도 유지됩니다.
- 같은 Hermes와 Ollama의 `qwen3.5:4b`로 예제 프로젝트 사본에서 `sync --force`를 실행했습니다. 수정 전에는 원고 단계가 통과해도 위 위반이 남았고, 구조 스캔 실패로 동기화가 8회 중 3회 실패했습니다. 수정 후 5회 실행은 4회 성공, 1회는 구조 스캔이 3회 반려 뒤 원본 변경 없이 실패했으며 회당 59~101초가 걸렸습니다. 리뷰 반영 후 3회 실행은 모두 성공했습니다. 통과한 원고에는 위 형식 위반이 없었습니다. 4B 모델은 `inline constexpr`을 "인라인 콘서스"로 옮기는 등 사실 오류를 여전히 내므로, 검토 승인 전 사람의 대조는 그대로 필요합니다.
- 실제 Qwen 27B 서버와 사내 Jira·Confluence 실접속은 확인하지 않았습니다.

적용 시 확인할 사항은 다음과 같습니다. 반려 재요청은 모델 호출마다 `DOCGEN_LLM_TIMEOUT_MS`가 적용되므로 최대 대기 시간은 `DOCFLOW_SCAN_ATTEMPTS`·`DOCFLOW_WRITER_ATTEMPTS`·`DOCFLOW_AGENT_ATTEMPTS`의 곱에 가까울 수 있습니다. 검사기는 한국어 합니다체와 조사 규칙을 전제하므로 다른 언어의 원고에는 맞지 않습니다. `brief.mjs`의 프롬프트 문구는 `modelHash`에 들어가지 않으므로 이 변경만으로 기존 원고가 재검토 대상이 되지는 않습니다.

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
