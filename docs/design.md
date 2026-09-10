# 문서 디자인 선택

**프로젝트 설정의 `design.preset`을 바꾸고 `design` 명령을 실행하세요.** 문체는 i-have-adhd·fluent-korean을 유지하며, 시각적 형식은 독립적으로 바꿉니다.

```json
{
  "design": {
    "preset": "slack",
    "reference": "DESIGN.md"
  }
}
```

| 선택 | 결과 |
| --- | --- |
| `slack` | 짙은 보라색, 크림·라벤더 배경, 둥근 탐색 요소를 적용합니다. |
| `plain` | 같은 문서 구조에 중립적인 회색·남색을 적용합니다. |
| `custom` | `design.stylesheet`에 지정한 프로젝트 CSS를 사용합니다. |
| `design` 생략 | 기존 사이트 디자인을 유지하며 CSS를 생성하지 않습니다. |

```bash
node bin/docflow.mjs design --project /work/camera-hal-docs
node bin/docflow.mjs design --project /work/camera-hal-docs --check
```

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

기본 테마의 색상만 바꿀 때는 `design.colors`에 `primary`, `ink`, `muted`, `link`, `cream`, `lavender`, `border` 중 필요한 값을 6자리 HEX로 지정합니다. 테마를 바꾼 뒤 좁은 화면, 표, 코드 블록, 그림 확대, 키보드 초점을 확인합니다.

이 저장소의 DESIGN.md는 `npx getdesign@latest add slack`으로 설치한 참고 자료입니다. GitHub 저장소 README는 GitHub가 정한 스타일로 표시되므로 CSS 테마는 배포된 문서 사이트에 적용됩니다. README에는 제목·표·Mermaid 그림으로 같은 정보 우선순위를 유지합니다.
