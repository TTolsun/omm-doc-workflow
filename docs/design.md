# 문서 디자인 선택

**프로젝트 설정의 `design.preset`을 바꾸고 `design` 명령을 실행하세요.** 문체는 i-have-adhd·fluent-korean을 유지하며, 시각적 형식은 독립적으로 바꿉니다.

```json
{
  "design": {
    "preset": "reading",
    "reference": "DESIGN.md"
  }
}
```

| 선택 | 결과 |
| --- | --- |
| `reading` | Mintlify 중심의 흰 배경에 왼쪽 탐색·본문·오른쪽 목차를 배치하고 코드 근거를 하단에 표시합니다. |
| `architecture` | Together AI·Linear·Warp를 참고한 화면에 구조도와 실제 코드 근거를 배치합니다. |
| `slack` | 짙은 보라색, 크림·라벤더 배경, 둥근 탐색 요소를 적용합니다. |
| `plain` | 같은 문서 구조에 중립적인 회색·남색을 적용합니다. |
| `custom` | `design.stylesheet`에 지정한 프로젝트 CSS를 사용합니다. |
| `design` 생략 | 기존 사이트 디자인을 유지하며 CSS를 생성하지 않습니다. |

```bash
node bin/docflow.mjs design --project /work/camera-hal-docs
node bin/docflow.mjs design --project /work/camera-hal-docs --check
```

`reading`과 `architecture`는 공통 UI 스크립트도 생성합니다. [Jekyll 템플릿](../templates/jekyll/)의 `_layouts/default.html`과 `_config.yml`을 문서 사이트 루트에 적용하고 탐색 메뉴를 설정합니다. 기존 레이아웃을 유지한다면 위 CSS와 함께 `assets/docflow-ui.js`를 모듈 스크립트로 불러오고, `main`과 `nav[aria-label="문서 메뉴"]` 요소를 제공해야 합니다. 다른 프레임워크도 같은 요소와 자산을 연결할 수 있습니다.

```bash
node bin/docflow.mjs inspect --project /work/camera-hal-docs
node bin/docflow.mjs inspect --project /work/camera-hal-docs --check
```

`inspect`는 코드를 읽어 `assets/docflow-evidence.json`에 실제 근거 파일 목록과 검토 상태를 기록합니다. 동기화에 포함되며, 수동으로 검토 기록을 갱신한 뒤에도 다시 실행합니다. CSS 생성과 문서 배치는 코드를 추론하지 않습니다. `projectName`은 화면의 프로젝트 이름이고, `sourceWebUrl`은 선택적인 GitHub 또는 GitHub Enterprise 코드 저장소 URL입니다. 링크는 검토 기준이 일치하고 단일 커밋이 기록된 경우에만 생성합니다.

근거 영역의 `SOURCE FILES`는 중복 없는 근거 파일 수, `REVIEWED`는 검토 날짜, `REVIEWED ITEMS`는 최신 항목 수입니다. LLM 분석 시각이나 정확도 확률로 바꾸어 표시하지 않습니다. 바인딩에 없는 안내 페이지에서는 페이지 상태 대신 프로젝트 전체의 집계임을 명시합니다.

구조도 요소 검색과 근거 파일 검색은 실제 문자열 검색입니다. 자연어 `Ask Architecture`와 질의에 따른 그래프 재구성은 아직 제공하지 않습니다. 질의 API와 권한·근거 검증을 갖춘 뒤 연결하는 [후속 설계 범위](../DESIGN.md)입니다.

## 문서 탐색과 검색을 설정합니다

`reading`에서는 메뉴의 문서 제목과 현재 페이지 목차를 검색합니다. 상단의 문서 찾기 또는 Ctrl/⌘+K로 열고 Escape로 닫습니다. 전체 본문 검색이나 AI 질의 기능은 아닙니다. 이전·다음 링크는 메뉴 순서에서 자동으로 연결합니다.

Jekyll의 `navigation` 항목에 선택적인 `group`을 넣으면 주제별로 표시합니다. 아래 경로는 실제 페이지를 만든 뒤 연결하세요.

```yaml
navigation:
  - title: 개요
    url: /architecture.html
    group: Architecture
  - title: 디버깅
    url: /debugging.html
    group: Development
```

기본 템플릿은 목차·검색·코드·표·인용문·접을 수 있는 근거를 제공합니다. 탭 실행기는 포함하지 않습니다. 기존 사이트의 탭을 사용한다면 키보드 방향키와 선택 상태를 별도로 확인하세요.

## 이 저장소에서 디자인을 미리 봅니다

```bash
npm ci --ignore-scripts
npm run preview:build
npm run preview
```

`npm run preview`를 실행한 뒤 `http://127.0.0.1:4173`을 엽니다. 미리보기는 저장소의 C++ 예제를 사용하며 모델을 호출하거나 검토 승인을 자동 생성하지 않습니다. Mermaid 렌더링에는 템플릿에 고정한 CDN 버전이 필요합니다. 사내에서 외부 CDN을 사용할 수 없으면 같은 버전을 사내 정적 자산으로 제공하고 import 경로를 바꿉니다.

출력은 바인딩의 사이트 루트 아래 `assets/docflow-design.css`입니다. 사이트 공통 레이아웃에서 이 파일을 불러오면 모든 페이지에 적용됩니다. Jekyll에서는 다음 링크를 기본 레이아웃의 기존 CSS 뒤에 넣습니다.

```html
<link rel="stylesheet" href="{{ '/assets/docflow-design.css' | relative_url }}">
```

전체 동기화에도 디자인 생성이 포함됩니다. 스타일을 바꾸는 작업은 코드·OMM·원고 검토 해시를 변경하지 않습니다. `design`을 생략해도 기존 CSS를 자동 삭제하지는 않으므로 테마 적용을 해제하려면 레이아웃의 링크도 제거합니다.

## 다른 getdesign 형식으로 변경합니다

설치 시 아래 명령을 사용합니다. 정기 동기화 중에는 외부 디자인을 내려받지 않습니다.

```bash
npx getdesign@latest add slack --out designs/slack/DESIGN.md
```

다른 형식을 쓰려면 `slack`을 원하는 이름으로 바꿉니다. 셋업 에이전트가 새 DESIGN.md를 읽고 프로젝트 CSS를 작성한 뒤 `custom`으로 연결합니다. DESIGN.md는 시각적 지침이므로 임의의 템플릿을 설치하는 것만으로 CSS가 자동 구현되지는 않습니다. [getdesign 사용법](https://www.npmjs.com/package/getdesign)을 참고하세요.

```json
{
  "design": {
    "preset": "custom",
    "reference": "designs/team/DESIGN.md",
    "stylesheet": "designs/team/docs.css"
  }
}
```

Slack·plain의 색상만 바꿀 때는 `design.colors`에 `primary`, `ink`, `muted`, `link`, `cream`, `lavender`, `border` 중 필요한 값을 6자리 HEX로 지정합니다. Architecture Intelligence의 화면 스타일을 별도로 수정할 때는 `assets/architecture.css`를 참고한 프로젝트 CSS를 `custom`으로 연결합니다. 테마를 바꾼 뒤 좁은 화면, 표, 코드 블록, 그림 확대, 키보드 초점을 확인합니다.

현재 `DESIGN.md`는 reading 디자인의 기준입니다. 이전 architecture 기준은 `designs/architecture/DESIGN.md`에 보관합니다. getdesign으로 설치한 Mintlify·Vercel·Together AI·Linear·Warp·Slack의 참고 원문은 `designs/`에 보관합니다. GitHub 저장소 README는 GitHub가 정한 스타일로 표시되므로 README에는 실제 미리보기 이미지와 구조 설명을 제공합니다.
