#!/usr/bin/env node
// 정적 사이트 빌더. 바인딩의 site.root(예: guide/) 에 있는 Markdown 원고를 _config.yml 의 output(예: docs/) 에 HTML 로 만듭니다.
//
// Jekyll 을 대체합니다. GitHub Pages 는 "Deploy from a branch → main → /docs" 로
// 설정하고, output/.nojekyll 로 GitHub 측 빌드를 끕니다. 사내 GitHub 미러도 같은
// 설정만으로 같은 산출물을 제공합니다. 빌드에 필요한 것은 Node 24 와 이 엔진의
// 의존성(Markdown 파서 marked) 뿐입니다.
//
// 명령
//   docflow site build           site.root → output 에 씁니다. 매니페스트에 있는 이전 산출물만 정리합니다.
//   docflow site check           디스크의 output 이 지금 빌드한 결과와 같은지 검사합니다. 다르면 종료 코드 1.
//   docflow site serve [--port N] [--base /repo-name/]
//                                output 을 하위 경로 아래에서 미리 봅니다. 배포 URL 의 하위 경로 차이를 확인합니다.
//
// _config.yml 키
//   title, description, lang   레이아웃 변수. 페이지 front matter 의 title·description 이 우선합니다.
//   output                     산출물 디렉터리. 프로젝트 안의 하위 디렉터리여야 합니다.
//   exclude                    배포하지 않을 파일 이름 목록. 밑줄로 시작하는 디렉터리와 점 파일은 항상 제외합니다.
//   nav                        상단 메뉴 [{ path, label }]. 페이지 깊이에 맞춰 상대 경로로 바꿉니다.
//   page_label                 홈이 아닌 페이지 상단의 표지 문구. 없으면 표지를 만들지 않습니다.
//
// 규칙
//   - 출력은 결정론적입니다. 시각이나 환경 정보를 넣지 않고 줄바꿈은 LF 입니다.
//   - 내부 링크는 모두 상대 경로입니다. `/` 로 시작하는 경로와 배포 도메인에 고정된 URL 은 오류입니다.
//     공개 GitHub(https://<user>.github.io/<repo>/)와 사내 GitHub 의 하위 경로가 달라도 같은 산출물이 동작해야 합니다.
//   - output 에는 다른 문서도 있을 수 있으므로 매니페스트(output/.site-manifest.json)에 기록된 파일만 지우거나 덮어씁니다.
//     매니페스트에 없는 기존 파일과 겹치면 빌드를 중단합니다.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import { parseYaml } from "./yaml-lite.mjs";

export const MANIFEST_NAME = ".site-manifest.json";
const LEADING_COMMENT = /^\s*<!--[\s\S]*?-->\s*\n/;

export function loadSite(root, sourceDir = "guide") {
  const source = path.join(root, sourceDir);
  const config = parseYaml(read(path.join(source, "_config.yml")));
  if (!config?.output) throw new Error("_config.yml 에 output 이 없습니다");
  const outputDir = path.resolve(root, config.output);
  if (outputDir === path.resolve(root) || !outputDir.startsWith(path.resolve(root) + path.sep)) {
    throw new Error(`output 은 저장소 안의 하위 디렉터리여야 합니다: ${config.output}`);
  }
  return { root, source, config, outputDir, exclude: new Set(config.exclude ?? []), nav: config.nav ?? [] };
}

// --- 빌드 (메모리) -----------------------------------------------------------
// 출력 경로 → 내용(Buffer) 맵을 만듭니다. 디스크에는 쓰지 않으므로 check 도 같은 함수를 씁니다.
export async function renderSite(site) {
  const { Marked } = await loadMarked();
  const layout = read(path.join(site.source, "_layouts", "default.html")).replace(LEADING_COMMENT, "");
  const files = new Map();
  const pageIds = new Map(); // 출력 경로 → 헤딩 id 집합 (링크 검사용)

  const pages = [];
  for (const name of fs.readdirSync(site.source).sort()) {
    if (site.exclude.has(name) || name.startsWith("_") || name.startsWith(".")) continue;
    const full = path.join(site.source, name);
    if (fs.statSync(full).isDirectory()) {
      if (name === "assets") for (const rel of walk(full)) files.set(`assets/${rel}`, fs.readFileSync(path.join(full, rel)));
      continue;
    }
    if (name.endsWith(".md")) pages.push({ rel: name, file: full });
  }
  // _inputs 는 사람이 읽을 수 있도록 함께 배포합니다. Markdown 은 페이지로, 나머지는 그대로 복사합니다.
  const inputs = path.join(site.source, "_inputs");
  if (fs.existsSync(inputs)) {
    for (const rel of walk(inputs)) {
      if (rel.endsWith(".md")) pages.push({ rel: `_inputs/${rel}`, file: path.join(inputs, rel) });
      else files.set(`_inputs/${rel}`, fs.readFileSync(path.join(inputs, rel)));
    }
  }

  for (const page of pages) {
    const outRel = page.rel.replace(/\.md$/, ".html");
    const { meta, body } = splitFrontMatter(read(page.file));
    const depth = outRel.split("/").length - 1;
    const rootPrefix = depth === 0 ? "./" : "../".repeat(depth);
    const ids = new Set();
    const html = renderMarkdown(Marked, body, ids);
    const vars = {
      lang: site.config.lang ?? "ko",
      title: escapeHtml(meta.title ?? site.config.title ?? ""),
      site_title: escapeHtml(site.config.title ?? ""),
      description: escapeHtml(meta.description ?? site.config.description ?? ""),
      root: rootPrefix,
      nav: site.nav.map(item => `<a href="${rootPrefix}${item.path}"${item.path === outRel ? ' aria-current="page"' : ""}>${escapeHtml(item.label)}</a>`).join("\n      "),
      main_class: meta.home ? "home" : "document",
      page_label: meta.home || !site.config.page_label ? "" : `<p class="eyebrow page-label">${escapeHtml(site.config.page_label)}</p>`,
      content: html,
    };
    const rendered = layout.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) => {
      if (!(key in vars)) throw new Error(`레이아웃의 알 수 없는 자리: ${m}`);
      return vars[key];
    });
    // 레이아웃과 원고의 HTML 에 직접 쓴 id (main-content, hero-title 등) 도 조각 링크 대상입니다.
    for (const m of rendered.matchAll(/\sid="([^"]+)"/g)) ids.add(m[1]);
    files.set(outRel, Buffer.from(rendered, "utf8"));
    pageIds.set(outRel, ids);
  }

  files.set(".nojekyll", Buffer.alloc(0));
  const problems = checkLinks(files, pageIds);
  if (problems.length) throw new Error("링크 검사 실패:\n  " + problems.join("\n  "));
  const manifest = { version: 1, files: {} };
  for (const rel of [...files.keys()].sort()) manifest.files[rel] = sha256(files.get(rel));
  files.set(MANIFEST_NAME, Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8"));
  return files;
}

// --- Markdown ----------------------------------------------------------------
async function loadMarked() {
  try {
    return await import("marked");
  } catch {
    throw new Error("marked 를 찾을 수 없습니다. 엔진 디렉터리에서 `npm ci --ignore-scripts` 를 실행하세요.");
  }
}

function renderMarkdown(Marked, source, ids) {
  // kramdown 의 markdown="1" 속성은 CommonMark 에서 필요 없습니다. 속성만 제거하고 내용은 그대로 파싱합니다.
  const text = source.replace(/\s+markdown="1"/g, "");
  const renderer = {
    heading({ tokens, depth }) {
      const inner = this.parser.parseInline(tokens);
      const id = uniqueId(gfmHeadingId(this.parser.parseInline(tokens, this.parser.textRenderer)), ids);
      return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
    },
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      const attr = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${escapeHtml(rewriteMarkdownLink(href))}"${attr}>${text}</a>`;
    },
  };
  const instance = new Marked({ gfm: true });
  instance.use({ renderer });
  return instance.parse(text, { async: false });
}

// kramdown GFM 파서와 같은 규칙: 소문자화, 단어 문자·공백·하이픈만 남기고 공백은 하이픈으로.
export function gfmHeadingId(text) {
  return text.toLowerCase().replace(/&[a-z]+;|&#\d+;/g, "").replace(/[^\p{L}\p{M}\p{N}_\- \t]/gu, "").replace(/[ \t]/g, "-");
}

function uniqueId(base, ids) {
  let id = base;
  for (let n = 1; ids.has(id); n += 1) id = `${base}-${n}`;
  ids.add(id);
  return id;
}

// 상대 링크의 .md 를 .html 로 바꿉니다 (jekyll-relative-links 와 같은 동작). 외부 URL 과 조각 링크는 그대로 둡니다.
export function rewriteMarkdownLink(href) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#") || href.startsWith("/")) return href;
  return href.replace(/\.md(?=$|[#?])/, ".html");
}

function splitFrontMatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: text };
  return { meta: parseYaml(m[1]) ?? {}, body: text.slice(m[0].length) };
}

// --- 링크 검사 -----------------------------------------------------------------
// 생성된 HTML 의 href/src 가 산출물 안에서 해석되는지, 도메인이나 루트에 고정되지 않았는지 봅니다.
export function checkLinks(files, pageIds) {
  const problems = [];
  for (const [rel, buffer] of files) {
    if (!rel.endsWith(".html")) continue;
    const html = buffer.toString("utf8");
    const dir = path.posix.dirname(rel);
    for (const m of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
      const value = m[1];
      if (/^(https?:|mailto:|data:)/i.test(value)) {
        if (/github\.io/i.test(value)) problems.push(`${rel}: 배포 도메인에 고정된 URL ${value}`);
        continue;
      }
      if (value.startsWith("/")) { problems.push(`${rel}: 루트 고정 경로 ${value} (하위 경로 배포에서 깨집니다)`); continue; }
      const [pathPart, fragment] = value.split("#");
      const targetRel = pathPart ? path.posix.normalize(path.posix.join(dir, pathPart)) : rel;
      if (targetRel.startsWith("..")) { problems.push(`${rel}: 산출물 밖을 가리키는 링크 ${value}`); continue; }
      if (!files.has(targetRel)) { problems.push(`${rel}: 없는 대상 ${value}`); continue; }
      if (fragment !== undefined && pageIds.has(targetRel) && !pageIds.get(targetRel).has(decodeURIComponent(fragment))) {
        problems.push(`${rel}: ${targetRel} 에 없는 조각 #${fragment}`);
      }
    }
  }
  return problems;
}

// --- 디스크 반영과 검사 ----------------------------------------------------------
export function readManifest(outputDir) {
  const file = path.join(outputDir, MANIFEST_NAME);
  if (!fs.existsSync(file)) return { version: 1, files: {} };
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export async function build(site, { force = false } = {}) {
  const files = await renderSite(site);
  const previous = new Set(Object.keys(readManifest(site.outputDir).files ?? {}));
  // 매니페스트에 없는 파일은 이 빌더가 만든 것이 아니므로 덮어쓰지 않습니다.
  const collisions = [...files.keys()].filter(rel => rel !== MANIFEST_NAME && !previous.has(rel) && fs.existsSync(path.join(site.outputDir, rel)));
  if (collisions.length && !force) {
    throw new Error(`이 빌더가 만들지 않은 파일과 겹칩니다 (--force 로 덮어쓸 수 있습니다):\n  ${collisions.join("\n  ")}`);
  }
  let written = 0;
  for (const [rel, buffer] of files) {
    const target = path.join(site.outputDir, rel);
    if (fs.existsSync(target) && normalize(fs.readFileSync(target)).equals(normalize(buffer))) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buffer);
    written += 1;
  }
  let removed = 0;
  for (const rel of previous) {
    if (files.has(rel)) continue;
    const target = path.join(site.outputDir, rel);
    if (fs.existsSync(target)) { fs.rmSync(target); removed += 1; }
    pruneEmptyDirs(path.dirname(target), site.outputDir);
  }
  return { total: files.size, written, removed };
}

export async function check(site) {
  const files = await renderSite(site);
  const problems = [];
  for (const [rel, buffer] of files) {
    const target = path.join(site.outputDir, rel);
    if (!fs.existsSync(target)) problems.push(`없음: ${rel}`);
    else if (!normalize(fs.readFileSync(target)).equals(normalize(buffer))) problems.push(`다름: ${rel}`);
  }
  for (const rel of Object.keys(readManifest(site.outputDir).files ?? {})) {
    if (!files.has(rel) && fs.existsSync(path.join(site.outputDir, rel))) problems.push(`낡은 산출물: ${rel}`);
  }
  return problems;
}

// --- 미리보기 -----------------------------------------------------------------
export function serve(site, { port = 4000, base = "/" } = {}) {
  // Git Bash 는 `/hal-camera/` 같은 인자를 Windows 경로로 바꾸므로 `--base hal-camera` 처럼 슬래시 없이도 받습니다.
  const segment = base.replace(/^[/\\]+|[/\\]+$/g, "");
  const prefix = segment ? `/${segment}/` : "/";
  const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".yaml": "text/yaml; charset=utf-8", ".md": "text/markdown; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp" };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (prefix !== "/" && url.pathname + "/" === prefix) { res.writeHead(302, { Location: prefix }); return res.end(); }
    if (!url.pathname.startsWith(prefix)) { res.writeHead(404); return res.end(`이 미리보기는 ${prefix} 아래에서만 응답합니다`); }
    let rel = decodeURIComponent(url.pathname.slice(prefix.length));
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    const file = path.join(site.outputDir, rel);
    if (!file.startsWith(site.outputDir + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  server.listen(port, "127.0.0.1", () => console.log(`미리보기: http://127.0.0.1:${port}${prefix}  (Ctrl+C 로 종료)`));
  return server;
}

// --- 유틸리티 ------------------------------------------------------------------
const read = file => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const sha256 = buffer => crypto.createHash("sha256").update(normalize(buffer)).digest("hex");
const escapeHtml = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// Windows 작업본은 autocrlf 로 CRLF 가 될 수 있으므로 비교와 해시는 LF 기준입니다.
function normalize(buffer) {
  const text = buffer.toString("utf8");
  return text.includes("\r\n") ? Buffer.from(text.replace(/\r\n/g, "\n"), "utf8") : buffer;
}
function walk(dir, prefix = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}
function pruneEmptyDirs(dir, stop) {
  while (dir.startsWith(stop + path.sep) && fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
    fs.rmdirSync(dir);
    dir = path.dirname(dir);
  }
}

// --- CLI ---------------------------------------------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const [command = "build", ...args] = process.argv.slice(2);
  const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
  try {
    // 원본 디렉터리는 바인딩의 site.root, 산출물은 그 안 _config.yml 의 output 입니다.
    const { PROJECT_ROOT } = await import("./config.mjs");
    const { readBindings } = await import("./lib.mjs");
    const site = loadSite(PROJECT_ROOT, readBindings().site.root);
    if (command === "build") {
      const result = await build(site, { force: args.includes("--force") });
      console.log(`사이트 빌드 완료: ${site.config.output}/ 파일 ${result.total}개 (새로 씀 ${result.written}, 정리 ${result.removed})`);
    } else if (command === "check") {
      const problems = await check(site);
      if (problems.length) {
        console.error(`사이트 산출물 불일치 ${problems.length}건:\n  ${problems.join("\n  ")}\n'docflow site build' 를 실행해 반영한 뒤 커밋하세요.`);
        process.exit(1);
      }
      console.log(`사이트 산출물 일치: ${site.config.output}/`);
    } else if (command === "serve") {
      serve(site, { port: Number(option("--port", 4000)), base: option("--base", "/") });
    } else {
      console.error(`알 수 없는 명령: ${command} (build | check | serve)`);
      process.exit(2);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
