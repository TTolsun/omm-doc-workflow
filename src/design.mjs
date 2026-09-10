import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "./config.mjs";
import { readBindings, repoPath } from "./lib.mjs";
import { renderDesign } from "./design-theme.mjs";

if (CONFIG.design) {
  const css = renderDesign(CONFIG.design, (rel) =>
    fs.readFileSync(
      ["@architecture.css", "@reading.css"].includes(rel)
        ? path.join(import.meta.dirname, "../assets", rel.slice(1))
        : repoPath(rel),
      "utf8",
    ),
  ).replaceAll("\r\n", "\n");
  const target = repoPath(
    readBindings().site.root,
    "assets",
    "docflow-design.css",
  );
  const files = [[target, css]];
  if (["reading", "architecture"].includes(CONFIG.design.preset))
    files.push([
      repoPath(readBindings().site.root, "assets", "docflow-ui.js"),
      fs
        .readFileSync(
          path.join(import.meta.dirname, "../assets/architecture.js"),
          "utf8",
        )
        .replaceAll("\r\n", "\n"),
    ]);
  if (process.argv.includes("--check")) {
    if (
      files.some(
        ([file, text]) =>
          !fs.existsSync(file) ||
          fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n") !== text,
      )
    )
      throw new Error(
        "디자인 생성 결과가 다릅니다. design 명령으로 갱신하세요.",
      );
    console.log("디자인 생성 결과 일치");
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    for (const [file, text] of files) fs.writeFileSync(file, text);
    console.log(`문서 디자인 적용: ${CONFIG.design.preset}`);
  }
} else console.log("디자인 설정 없음: 기존 사이트 디자인을 유지합니다.");
