// Build a static, explicitly unreviewed design example without any model calls.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
const require = createRequire(import.meta.url);
const MarkdownIt = require(
  process.env.DOCFLOW_MARKDOWN_IT_PATH ?? "markdown-it",
);
const md = new MarkdownIt({ html: true });
const root = path.resolve(import.meta.dirname, "..");
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "docflow-preview-"));
try {
  fs.cpSync(path.join(root, "examples/camera-hal"), stage, {
    recursive: true,
    filter: (file) =>
      ![".docflow", "assets", "node_modules"].includes(path.basename(file)),
  });
  const config = JSON.parse(fs.readFileSync(path.join(stage, "docflow.json")));
  config.projectName = "Camera HAL · 디자인 예제";
  config.sourceRoot = path.join(root, "fixtures/camera-hal");
  config.design = { preset: "reading" };
  fs.writeFileSync(path.join(stage, "docflow.json"), JSON.stringify(config));
  for (const command of [
    "extract",
    "verify",
    "generate",
    "inspect",
    "design",
  ]) {
    const result = spawnSync(
      process.execPath,
      [path.join(root, "bin/docflow.mjs"), command, "--project", stage],
      { encoding: "utf8" },
    );
    if (result.status !== 0) throw Error(result.stdout + result.stderr);
  }
  const escape = (s) =>
    s
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  let template = fs.readFileSync(
    path.join(root, "templates/jekyll/_layouts/default.html"),
    "utf8",
  );
  template = template.replace(
    /{% for item in site.navigation %}[\s\S]*?{% endfor %}/,
    '<a href="./index.html" aria-current="page">아키텍처 예제</a>',
  );
  template = template
    .replaceAll("{{ page.title | escape }}", escape("요청 수용 조건"))
    .replaceAll("{{ site.title | escape }}", escape(config.projectName));
  template = template.replaceAll(
    /{{ '([^']+)' \| relative_url }}/g,
    (_, url) => "." + url,
  );
  const body = md.render(
    fs
      .readFileSync(path.join(stage, "docs/architecture.md"), "utf8")
      .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, ""),
  );
  template = template.replace("{{ content }}", body);
  const output = path.join(root, "docs/preview");
  fs.mkdirSync(path.join(output, "assets"), { recursive: true });
  fs.writeFileSync(path.join(output, "index.html"), template);
  for (const file of [
    "docflow-design.css",
    "docflow-ui.js",
    "docflow-evidence.json",
  ])
    fs.copyFileSync(
      path.join(stage, "docs/assets", file),
      path.join(output, "assets", file),
    );
  // The preview route is index.html; its content is the architecture example.
  const manifestFile = path.join(output, "assets/docflow-evidence.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile));
  manifest.pages["index.html"] = manifest.pages["architecture.html"];
  delete manifest.pages["architecture.html"];
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
  console.log(
    "디자인 미리보기 생성: docs/preview/index.html (모델 호출 및 자동 검토 승인 없음)",
  );
} finally {
  if (
    path.dirname(stage) === os.tmpdir() &&
    path.basename(stage).startsWith("docflow-preview-")
  )
    fs.rmSync(stage, { recursive: true, force: true });
}
