// Build a presentation manifest from measured source coverage and review records.
// This step reads code. The page/CSS renderers do not infer code facts.
import fs from "node:fs";
import path from "node:path";
import { CONFIG, sourcePath } from "./config.mjs";
import { readBindings, readState, repoPath, globFiles } from "./lib.mjs";
import {
  collectKeys,
  computeHashes,
  stateOf,
  readContentBlock,
  citedFiles,
} from "./model.mjs";

if (CONFIG.design?.preset === "architecture") {
  const bindings = readBindings();
  const evidence = readState("evidence.json", { entries: {} }).entries;
  const keys = collectKeys(bindings);
  const entries = keys.map((key) => {
    const current = computeHashes(bindings, key);
    const accepted = evidence[key.key]?.accepted;
    return {
      key: key.key,
      state:
        !current.exists || current.missingCited?.length
          ? "missing"
          : stateOf(current, accepted),
      reviewedAt: accepted?.at ?? null,
      reviewedCommit: accepted?.commit ?? null,
      reviewer: accepted?.reviewer ?? null,
    };
  });
  const sourceGroups = Object.entries(bindings.sources)
    .filter(([, s]) => s.kind === "omm")
    .map(([id, s]) => ({
      id,
      patterns: s.evidence ?? [],
      files: globFiles(s.evidence ?? []),
    }));
  const summarize = (chosenKeys, sourceIds, citations) => {
    const reviews = entries.filter((x) => chosenKeys.includes(x.key));
    const groups = sourceGroups.filter((x) => sourceIds.includes(x.id));
    const files = [
      ...new Set([
        ...groups.flatMap((g) => g.files),
        ...citations.filter((rel) => fs.existsSync(sourcePath(rel))),
      ]),
    ].sort();
    const commits = [
      ...new Set(reviews.map((r) => r.reviewedCommit).filter(Boolean)),
    ].sort();
    const dates = reviews
      .map((r) => r.reviewedAt)
      .filter(Boolean)
      .sort();
    return {
      files,
      sourceGroups: groups.map(({ files, ...g }) => ({
        ...g,
        fileCount: files.length,
      })),
      reviews,
      reviewedCount: reviews.filter((r) => r.state === "fresh").length,
      reviewCount: reviews.length,
      status:
        reviews.length && reviews.every((r) => r.state === "fresh")
          ? "fresh"
          : reviews.some((r) => r.state === "missing")
            ? "missing"
            : reviews.some((r) => r.state === "stale")
              ? "stale"
              : "unreviewed",
      reviewedAt: dates.at(-1) ?? null,
      reviewedCommits: commits,
      citationCount: new Set(citations).size,
    };
  };
  const pageRecords = {};
  for (const [page, def] of Object.entries(bindings.pages)) {
    const sourceIds = [
      ...new Set(
        def.blocks.flatMap((b) => [
          ...(b.based_on ?? []),
          ...(b.source && bindings.sources[b.source]?.kind === "omm"
            ? [b.source]
            : []),
        ]),
      ),
    ];
    const pageKeys = keys.filter(
      (k) =>
        (k.kind === "content" && k.page === page) ||
        (k.kind === "omm" && sourceIds.includes(k.source)),
    );
    const citations = pageKeys
      .filter((k) => k.kind === "content")
      .flatMap((k) =>
        citedFiles(readContentBlock(bindings, k.page, k.block)?.meta),
      );
    pageRecords[page.replace(/\.md$/, ".html")] = summarize(
      pageKeys.map((k) => k.key),
      sourceIds,
      citations,
    );
  }
  const allCitations = keys
    .filter((k) => k.kind === "content")
    .flatMap((k) =>
      citedFiles(readContentBlock(bindings, k.page, k.block)?.meta),
    );
  const batch = readState("batch.json");
  let sourceWebUrl = null;
  if (CONFIG.sourceWebUrl) {
    const url = new URL(CONFIG.sourceWebUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("sourceWebUrl must be an HTTPS repository URL");
    sourceWebUrl = url.href.replace(/\/$/, "");
  }
  const manifest = {
    schema: 1,
    project: CONFIG.projectName ?? "Architecture Intelligence",
    sourceWebUrl,
    projectEvidence: summarize(
      keys.map((k) => k.key),
      sourceGroups.map((s) => s.id),
      allCitations,
    ),
    pages: pageRecords,
    changes: batch
      ? {
          baseCommit: batch.baseCommit,
          headCommit: batch.headCommit,
          files: batch.changedFiles,
        }
      : null,
  };
  const output = JSON.stringify(manifest, null, 2) + "\n";
  const target = repoPath(
    bindings.site.root,
    "assets",
    "docflow-evidence.json",
  );
  if (process.argv.includes("--check")) {
    if (
      !fs.existsSync(target) ||
      fs.readFileSync(target, "utf8").replaceAll("\r\n", "\n") !== output
    )
      throw new Error("코드 근거 표시 정보가 다릅니다. inspect를 실행하세요.");
    console.log("코드 근거 표시 정보 일치");
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, output);
    console.log(
      `코드 근거 표시 정보: ${manifest.projectEvidence.files.length}개 파일`,
    );
  }
}
