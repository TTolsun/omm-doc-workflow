---
title: 요청 수용 조건
layout: default
---

# 요청 수용 조건

**먼저 RequestQueue.h의 kBufferLimit과 RequestQueue.cpp의 canAccept를 함께 확인하세요.** 이 페이지는 실행기 시험용 예제이며 실제 제품의 HAL 설계 문서가 아닙니다.

<!-- omm:begin id=status -->

| 항목 | 최신성 | 검토 |
| --- | --- | --- |
| 구조 원본 `request-flow` | 검증 정보 없음 | — |
| 원고 `overview` | 검증 정보 없음 | — |

<!-- omm:end id=status -->

## 구조

<!-- omm:begin id=diagram -->

```mermaid
graph LR
    admission-check["요청 수용 조건 확인"]
```

<details class="doc-evidence" markdown="1">
<summary>근거와 검토 정보</summary>

- 근거: `.omm/request-flow/diagram`
- 근거 수준: 코드 확인

</details>

<!-- omm:end id=diagram -->

## 코드 동작

<!-- omm:begin id=overview -->

canAccept는 처리 중인 버퍼 수가 4보다 작을 때 true를 반환합니다. 4 이상이면 false를 반환합니다. 경곗값은 RequestQueue.h의 kBufferLimit에 정의되어 있습니다.

<details class="doc-evidence" markdown="1">
<summary>근거와 검토 정보</summary>

- 근거 파일: `RequestQueue.h`, `RequestQueue.cpp`
- 근거 수준: 코드 확인
- 검토 상태: 검증 정보 없음

</details>

<!-- omm:end id=overview -->

다음으로 처리 중인 버퍼 수가 경곗값과 같을 때의 결과를 확인하세요.
