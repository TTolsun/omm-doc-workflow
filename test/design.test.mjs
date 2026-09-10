import test from "node:test";
import assert from "node:assert/strict";
import { renderDesign } from "../src/design-theme.mjs";
import { makeFixture, runSync } from "./helper.mjs";
import { snapshot, changedFiles } from "../src/transaction.mjs";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

test("design selection changes CSS independently and rejects invalid custom configuration", () => {
  const slack = renderDesign({ preset: "slack" });
  assert.match(slack, /#4a154b/);
  assert.match(renderDesign({ preset: "plain" }), /#243247/);
  assert.equal(
    renderDesign(
      { preset: "custom", stylesheet: "team.css" },
      () => "body{color:navy}\r\n",
    ),
    "body{color:navy}\n",
  );
  assert.throws(
    () =>
      renderDesign({
        preset: "slack",
        colors: { primary: "url(https://example.com)" },
      }),
    /Invalid design color/,
  );
  assert.throws(
    () => renderDesign({ preset: "custom", stylesheet: "team.css" }, () => ""),
    /empty/,
  );
});

test("architecture manifest reports real coverage and distinguishes stale code from review", async (t) => {
  const f = makeFixture();
  t.after(f.cleanup);
  f.put(
    "app/src/main/java/dev/halcamera/Probe.kt",
    "package dev.halcamera\nobject Probe { const val OBSERVE_MS = 10000L }\n",
  );
  const config = JSON.parse(fs.readFileSync(path.join(f.root, "docflow.json")));
  config.design = { preset: "architecture" };
  config.projectName = "Probe";
  f.put("docflow.json", JSON.stringify(config));
  const run = await runSync(f.root, {
    DOCGEN_OLLAMA_URL: "http://127.0.0.1:1",
  });
  assert.equal(run.code, 0, run.out);
  const output = path.join(f.root, "docs/guide/assets/docflow-evidence.json");
  const data = JSON.parse(fs.readFileSync(output));
  assert.equal(data.projectEvidence.files.length, 1);
  assert.equal(data.projectEvidence.status, "fresh");
  assert.equal(data.projectEvidence.reviewedCount, 2);
  assert.equal(data.pages["probe.html"].citationCount, 1);
  assert.equal("confidence" in data.projectEvidence, false);
  assert.equal("analyzedAt" in data.projectEvidence, false);
  f.put(
    "app/src/main/java/dev/halcamera/Probe.kt",
    "package dev.halcamera\nobject Probe { const val OBSERVE_MS = 14000L }\n",
  );
  const checked = spawnSync(
    process.execPath,
    [path.join(f.root, "tools/docgen/inspect.mjs"), "--check"],
    { cwd: f.root, encoding: "utf8" },
  );
  assert.equal(checked.status, 1);
  const updated = spawnSync(
    process.execPath,
    [path.join(f.root, "tools/docgen/inspect.mjs")],
    { cwd: f.root, encoding: "utf8" },
  );
  assert.equal(updated.status, 0, updated.stderr);
  assert.equal(
    JSON.parse(fs.readFileSync(output)).projectEvidence.status,
    "stale",
  );
});

test("design failure preserves source, generated pages and review state", async (t) => {
  const f = makeFixture();
  t.after(f.cleanup);
  // Restore the unchanged source so this test never calls a model.
  f.put(
    "app/src/main/java/dev/halcamera/Probe.kt",
    "package dev.halcamera\nobject Probe { const val OBSERVE_MS = 10000L }\n",
  );
  const config = JSON.parse(fs.readFileSync(path.join(f.root, "docflow.json")));
  config.design = { preset: "custom", stylesheet: "missing.css" };
  f.put("docflow.json", JSON.stringify(config));
  const before = snapshot(f.root);
  const result = await runSync(f.root, {
    DOCGEN_OLLAMA_URL: "http://127.0.0.1:1",
  });
  assert.equal(result.code, 1, result.out);
  assert.deepEqual(changedFiles(before, snapshot(f.root)), []);
  config.design = { preset: "slack" };
  f.put("docflow.json", JSON.stringify(config));
  const success = await runSync(f.root, {
    DOCGEN_OLLAMA_URL: "http://127.0.0.1:1",
  });
  assert.equal(success.code, 0, success.out);
  assert.match(
    fs.readFileSync(
      path.join(f.root, "docs/guide/assets/docflow-design.css"),
      "utf8",
    ),
    /#4a154b/,
  );
});
