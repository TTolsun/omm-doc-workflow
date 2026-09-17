// site.mjs 검사. 임시 프로젝트에서 빌드·정리·검사·링크 규칙을 확인합니다. 저장소의 guide/ 와 docs/ 는 건드리지 않습니다.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { build, check, gfmHeadingId, loadSite, renderSite, rewriteMarkdownLink, MANIFEST_NAME } from "../src/site.mjs";

const LAYOUT = `<!-- 템플릿 설명 -->
<!doctype html>
<html lang="{{ lang }}"><head><title>{{ title }} · {{ site_title }}</title>
<link rel="stylesheet" href="{{ root }}assets/site.css"></head>
<body><nav>{{ nav }}</nav><main id="main-content" class="{{ main_class }}">{{ page_label }}{{ content }}</main></body></html>
`;
const CONFIG = `title: 검사 사이트
description: 설명
lang: ko
output: docs
page_label: HAL CAMERA / Design Documentation
exclude:
  - _bindings.yaml
  - AGENTS.md
nav:
  - path: guide.html
    label: 가이드
`;

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hal-site-"));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const put = (rel, text) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  put("guide/_config.yml", CONFIG);
  put("guide/_layouts/default.html", LAYOUT);
  put("guide/assets/site.css", "body{}\n");
  put("guide/_bindings.yaml", "version: 2\n");
  put("guide/AGENTS.md", "# 지침\n");
  put("guide/_content/guide/x.md", "원고\n");
  put("guide/index.md", "---\ntitle: 홈\nhome: true\n---\n<a href=\"guide.html#둘째-절-hal\">가이드</a>\n");
  put("guide/guide.md", "---\ntitle: 가이드\n---\n# 첫째 절\n\n[결정](_inputs/decisions.md#d-001-결정) [외부](https://example.com/a.md)\n\n<details class=\"doc-evidence\" markdown=\"1\">\n<summary>근거</summary>\n\n- 항목\n\n</details>\n\n## 둘째 절 (HAL)\n\n## 둘째 절 (HAL)\n");
  put("guide/_inputs/decisions.md", "---\ntitle: 결정\n---\n## D-001 결정\n\n[가이드](../guide.md#첫째-절)\n");
  put("guide/_inputs/device-verification.yaml", "records: []\n");
  // docs/ 에 이미 있는 다른 문서. 빌더가 절대 지우거나 덮어쓰면 안 됩니다.
  put("docs/design/DESIGN.md", "# 설계\n");
  return { root, put, site: () => loadSite(root) };
}

const readOut = (root, rel) => fs.readFileSync(path.join(root, "docs", rel), "utf8");

test("heading ids follow the kramdown GFM rule used by the old Jekyll site", () => {
  assert.equal(gfmHeadingId("앱과 프레임워크(HAL)을 구분하세요"), "앱과-프레임워크hal을-구분하세요");
  assert.equal(gfmHeadingId("D-001: Camera2 엔진과 CameraX 엔진을 모두 유지합니다."), "d-001-camera2-엔진과-camerax-엔진을-모두-유지합니다");
  assert.equal(gfmHeadingId("앱과 프레임워크·HAL을 구분하세요"), "앱과-프레임워크hal을-구분하세요");
});

test("relative .md links become .html; external, root and fragment links stay", () => {
  assert.equal(rewriteMarkdownLink("architecture.md#주요-실행-흐름"), "architecture.html#주요-실행-흐름");
  assert.equal(rewriteMarkdownLink("../guide.md"), "../guide.html");
  assert.equal(rewriteMarkdownLink("https://example.com/a.md"), "https://example.com/a.md");
  assert.equal(rewriteMarkdownLink("#절"), "#절");
  assert.equal(rewriteMarkdownLink("/root.md"), "/root.md");
});

test("build writes pages, copied inputs, assets, .nojekyll and a manifest with relative paths only", async (t) => {
  const f = fixture(t);
  const result = await build(f.site());
  assert.deepEqual(Object.keys(JSON.parse(readOut(f.root, MANIFEST_NAME)).files).sort(), [
    ".nojekyll", "_inputs/decisions.html", "_inputs/device-verification.yaml", "assets/site.css", "guide.html", "index.html",
  ]);
  assert.equal(result.written, 7);
  const guide = readOut(f.root, "guide.html");
  assert.ok(!guide.includes("템플릿 설명"), "레이아웃 앞의 설명 주석은 출력하지 않습니다");
  assert.ok(guide.startsWith("<!doctype html>"));
  assert.ok(guide.includes('<a href="_inputs/decisions.html#d-001-결정">결정</a>'));
  assert.ok(guide.includes('<a href="https://example.com/a.md">외부</a>'));
  assert.ok(guide.includes('<details class="doc-evidence">') && !guide.includes('markdown="1"'));
  assert.ok(guide.includes("<li>항목</li>"), "details 안의 목록도 Markdown 으로 파싱합니다");
  assert.ok(guide.includes('<h2 id="둘째-절-hal">') && guide.includes('<h2 id="둘째-절-hal-1">'), "중복 헤딩은 -1 을 붙입니다");
  assert.ok(guide.includes('href="./assets/site.css"') && guide.includes('<a href="./guide.html" aria-current="page">가이드</a>'));
  assert.ok(guide.includes('class="document"') && guide.includes("page-label\">HAL CAMERA / Design Documentation<"));
  const nested = readOut(f.root, "_inputs/decisions.html");
  assert.ok(nested.includes('href="../assets/site.css"') && nested.includes('<a href="../guide.html">가이드</a>'));
  assert.ok(nested.includes('<a href="../guide.html#첫째-절">가이드</a>'));
  const index = readOut(f.root, "index.html");
  assert.ok(index.includes('class="home"') && !index.includes("page-label"));
  assert.equal(readOut(f.root, ".nojekyll"), "");
  assert.ok(!fs.existsSync(path.join(f.root, "docs/AGENTS.md")) && !fs.existsSync(path.join(f.root, "docs/_content")) && !fs.existsSync(path.join(f.root, "docs/_bindings.yaml")));
  assert.equal(fs.readFileSync(path.join(f.root, "docs/design/DESIGN.md"), "utf8"), "# 설계\n");
  assert.deepEqual(await check(f.site()), []);
});

test("two renders of the same input are byte-identical", async (t) => {
  const f = fixture(t);
  const a = await renderSite(f.site());
  const b = await renderSite(f.site());
  assert.deepEqual([...a.keys()], [...b.keys()]);
  for (const [rel, buffer] of a) assert.ok(buffer.equals(b.get(rel)), rel);
});

test("check accepts CRLF copies of the output and reports edited or stale files", async (t) => {
  const f = fixture(t);
  await build(f.site());
  const page = path.join(f.root, "docs/guide.html");
  fs.writeFileSync(page, fs.readFileSync(page, "utf8").replace(/\n/g, "\r\n"));
  assert.deepEqual(await check(f.site()), [], "autocrlf 작업본의 CRLF 는 차이가 아닙니다");
  fs.writeFileSync(page, fs.readFileSync(page, "utf8") + "<!-- 손으로 고침 -->");
  assert.deepEqual(await check(f.site()), ["다름: guide.html"]);
  await build(f.site());
  fs.rmSync(path.join(f.root, "guide/_inputs/decisions.md"));
  f.put("guide/guide.md", "---\ntitle: 가이드\n---\n# 첫째 절\n\n## 둘째 절 (HAL)\n");
  assert.deepEqual((await check(f.site())).sort(), ["낡은 산출물: _inputs/decisions.html", "다름: .site-manifest.json", "다름: guide.html"]);
});

test("rebuild removes only files from the previous manifest and keeps foreign files", async (t) => {
  const f = fixture(t);
  await build(f.site());
  fs.rmSync(path.join(f.root, "guide/_inputs"), { recursive: true });
  f.put("guide/guide.md", "---\ntitle: 가이드\n---\n# 첫째 절\n\n## 둘째 절 (HAL)\n");
  f.put("docs/notes/keep.md", "보존\n");
  const result = await build(f.site());
  assert.equal(result.removed, 2);
  assert.ok(!fs.existsSync(path.join(f.root, "docs/_inputs")), "빈 산출물 디렉터리는 정리합니다");
  assert.equal(fs.readFileSync(path.join(f.root, "docs/notes/keep.md"), "utf8"), "보존\n");
  assert.equal(fs.readFileSync(path.join(f.root, "docs/design/DESIGN.md"), "utf8"), "# 설계\n");
});

test("build refuses to overwrite a file it did not generate unless forced", async (t) => {
  const f = fixture(t);
  f.put("docs/guide.html", "<p>사람이 둔 파일</p>\n");
  await assert.rejects(build(f.site()), /만들지 않은 파일과 겹칩니다[\s\S]*guide\.html/);
  assert.equal(readOut(f.root, "guide.html"), "<p>사람이 둔 파일</p>\n");
  await build(f.site(), { force: true });
  assert.ok(readOut(f.root, "guide.html").startsWith("<!doctype html>"));
});

test("links that would break under a different site prefix or point nowhere fail the build", async (t) => {
  const f = fixture(t);
  f.put("guide/bad.md", "---\ntitle: 나쁨\n---\n[루트](/index.html) [없음](missing.md) [조각](guide.md#없는-절) ![바깥](../design/x.png) [도메인](https://ttolsun.github.io/hal-camera/)\n");
  await assert.rejects(renderSite(f.site()), (error) => {
    for (const expected of ["루트 고정 경로 /index.html", "없는 대상 missing.html", "없는 조각 #없는-절", "산출물 밖을 가리키는 링크 ../design/x.png", "배포 도메인에 고정된 URL https://ttolsun.github.io/hal-camera/"]) {
      assert.match(error.message, new RegExp(expected.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")));
    }
    return true;
  });
  fs.rmSync(path.join(f.root, "guide/bad.md"));
  await build(f.site());
});

test("output must be a subdirectory of the project", (t) => {
  const f = fixture(t);
  f.put("guide/_config.yml", CONFIG.replace("output: docs", "output: ../outside"));
  assert.throws(() => f.site(), /저장소 안의 하위 디렉터리/);
  f.put("guide/_config.yml", CONFIG.replace("output: docs", "output: ."));
  assert.throws(() => f.site(), /저장소 안의 하위 디렉터리/);
});
