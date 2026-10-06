import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  AGENT_PATH_PATTERNS,
  checkDocs,
  filterFailures,
  toJsonReport,
  toMarkdownReport,
} from "../scripts/check.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "scripts", "docs-reality.mjs");
const ROOT = join(HERE, "..", "..", "..");
const FIXTURE = join(HERE, "fixtures", "stale-sample");

const rootReadme = await readFile(join(ROOT, "README.md"), "utf8");
const skill = await readFile(join(ROOT, "skills", "docs-reality", "SKILL.md"), "utf8");
const toolReadme = await readFile(join(HERE, "..", "README.md"), "utf8");

async function makeRepo(files) {
  const dir = await mkdtemp(join(tmpdir(), "docs-reality-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  return dir;
}

const sortedClasses = (result) => result.findings.map((f) => f.class).sort();

test("fixture docs referencing removed files and commands are detected with provenance", async () => {
  const dir = await makeRepo({
    "README.md": [
      "# Demo",
      "",
      "Run `node scripts/removed.mjs` to start.",
      "",
      "See [gone tool](./tools/gone/README.md) for details.",
      "",
      "Legacy config in `config/removed.json`.",
      "",
      "Run `npm run removed-script` for legacy flow.",
      "",
    ].join("\n"),
    "package.json": JSON.stringify({ name: "demo", scripts: { test: "node --test" } }),
    "scripts/present.mjs": "export const x = 1;\n",
  });
  try {
    const result = await checkDocs(dir, { checkUndocumented: false });
    assert.deepEqual(sortedClasses(result), [
      "broken-command",
      "broken-file-ref",
      "broken-file-ref",
      "ghost-doc",
      "stale-workflow",
    ]);
    const byClass = Object.fromEntries(result.findings.map((f) => [`${f.class}:${f.line}`, f]));
    assert.equal(byClass["broken-command:3"].reference, "node scripts/removed.mjs");
    assert.equal(byClass["broken-file-ref:5"].reference, "./tools/gone/README.md");
    assert.equal(byClass["broken-file-ref:7"].reference, "config/removed.json");
    assert.equal(byClass["stale-workflow:9"].reference, "npm run removed-script");
    for (const finding of result.findings) {
      assert.equal(finding.doc, "README.md");
      assert.ok(finding.excerpt.length > 0, "provenance needs the doc excerpt");
      assert.ok(finding.evidence.method.length > 0, "provenance needs the check method");
      assert.ok(finding.evidence.detail.length > 0, "provenance needs the conflicting evidence");
      assert.ok(finding.suggestion.guidance.length > 0);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a documented CLI flag removed from code is surfaced with evidence", async () => {
  const dir = await makeRepo({
    "README.md": [
      "# Demo",
      "",
      "Run `node scripts/cli.mjs --check` for checks.",
      "",
      "Legacy `node scripts/cli.mjs --old-flag` is gone.",
      "",
    ].join("\n"),
    "package.json": JSON.stringify({ name: "demo", scripts: { test: "node --test" } }),
    "scripts/cli.mjs": 'if (process.argv.includes("--check")) {}\nif (process.argv.includes("--format")) {}\n',
  });
  try {
    const result = await checkDocs(dir, { checkUndocumented: false });
    assert.equal(result.findings.length, 1);
    const [finding] = result.findings;
    assert.equal(finding.class, "stale-flag");
    assert.equal(finding.reference, "--old-flag");
    assert.equal(finding.line, 5);
    assert.equal(finding.evidence.method, "flag-in-file");
    assert.match(finding.evidence.detail, /not found in "scripts\/cli\.mjs"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("valid current references are not rewritten", async () => {
  const dir = await makeRepo({
    "README.md": [
      "# Demo",
      "",
      "Run `node scripts/present.mjs` or `npm run test`.",
      "",
      "See [cli](./scripts/cli.mjs).",
      "",
      "Flags: `node scripts/cli.mjs --check` is supported.",
      "",
      "Config: set `keep_key` in `config/settings.json`.",
      "",
      "Home paths like `~/.codex/agents/*.toml` and `<path-to-project>/app.mjs` are out of scope.",
      "",
    ].join("\n"),
    "package.json": JSON.stringify({ name: "demo", scripts: { test: "node --test" } }),
    "scripts/cli.mjs": 'if (process.argv.includes("--check")) {}\n',
    "scripts/present.mjs": "export const present = true;\n",
    "config/settings.json": JSON.stringify({ keep_key: true }),
  });
  try {
    const result = await checkDocs(dir);
    assert.deepEqual(result.findings, []);
    assert.ok(result.stats.referencesChecked > 0, "the checker must actually verify references");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("proposed corrections are minimal and limited to the affected region", async () => {
  const result = await checkDocs(FIXTURE);
  assert.ok(result.findings.length > 0);
  for (const finding of result.findings) {
    const suggestion = finding.suggestion;
    assert.ok(suggestion.guidance.length > 0 && suggestion.guidance.length < 300);
    if (suggestion.replacementPreview) {
      assert.ok(suggestion.replacementPreview.length < 300);
    }
    if (finding.class === "undocumented") {
      assert.equal(suggestion.action, "document");
      continue;
    }
    assert.equal(suggestion.file, finding.doc);
    assert.equal(suggestion.startLine, finding.line);
    assert.equal(suggestion.endLine, finding.line);
  }
});

test("JSON and Markdown reports are available for CI and human review", async () => {
  const result = await checkDocs(FIXTURE);
  const parsed = JSON.parse(toJsonReport(result));
  assert.equal(parsed.tool, "docs-reality");
  assert.ok(parsed.version.length > 0);
  assert.deepEqual(parsed.scannedDocs, ["README.md"]);
  assert.equal(parsed.findings.length, result.findings.length);
  assert.deepEqual(parsed.stats, result.stats);

  const markdown = toMarkdownReport(result);
  assert.match(markdown, /^# Docs Reality report/m);
  assert.match(markdown, /broken-file-ref/);
  assert.match(markdown, /README\.md:7/);
  assert.match(markdown, /Evidence/);
  assert.match(markdown, /Suggestion/);
  assert.match(markdown, /Rules Forge/);

  const jsonRun = spawnSync(process.execPath, [CLI, "--root", FIXTURE, "--format", "json"], { encoding: "utf8" });
  assert.equal(jsonRun.status, 0);
  assert.equal(JSON.parse(jsonRun.stdout).findings.length, result.findings.length);

  const outDir = await mkdtemp(join(tmpdir(), "docs-reality-out-"));
  try {
    const bothRun = spawnSync(
      process.execPath,
      [CLI, "--root", FIXTURE, "--format", "both", "--out", outDir],
      { encoding: "utf8" },
    );
    assert.equal(bothRun.status, 0);
    const writtenJson = JSON.parse(await readFile(join(outDir, "docs-reality.json"), "utf8"));
    assert.equal(writtenJson.findings.length, result.findings.length);
    assert.match(await readFile(join(outDir, "docs-reality.md"), "utf8"), /^# Docs Reality report/m);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("agent-instruction drift stays with Rules Forge by default", async () => {
  const dir = await makeRepo({
    "README.md": "See [gone](./missing/file.mjs).\n",
    "AGENTS.md": "See [gone](./missing/file.mjs).\n",
    ".agents/notes.md": "See [gone](./missing/other.mjs).\n",
    "package.json": JSON.stringify({ name: "demo", scripts: {} }),
  });
  try {
    const excluded = await checkDocs(dir, { checkUndocumented: false });
    assert.deepEqual(excluded.findings.map((f) => f.doc), ["README.md"]);

    const included = await checkDocs(dir, { checkUndocumented: false, includeAgentFiles: true });
    assert.deepEqual(included.findings.map((f) => f.doc).sort(), ["AGENTS.md", "README.md", ".agents/notes.md"].sort());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  assert.ok(AGENT_PATH_PATTERNS.includes("AGENTS.md"));
  assert.ok(AGENT_PATH_PATTERNS.includes(".agents/**"));
  assert.match(toolReadme, /Rules Forge/);
  assert.match(skill, /Rules Forge/);
});

test("CI mode fails on error classes but supports warning-only and fail-on filters", async () => {
  const dir = await makeRepo({
    "README.md": "See [gone](./missing/file.mjs).\n",
    "package.json": JSON.stringify({ name: "demo", scripts: {} }),
  });
  try {
    const failing = spawnSync(process.execPath, [CLI, "--root", dir, "--check", "--format", "json"], { encoding: "utf8" });
    assert.equal(failing.status, 2);

    const warningOnly = spawnSync(process.execPath, [CLI, "--root", dir, "--check", "--warning-only"], { encoding: "utf8" });
    assert.equal(warningOnly.status, 0);

    const filtered = spawnSync(
      process.execPath,
      [CLI, "--root", dir, "--check", "--fail-on", "undocumented"],
      { encoding: "utf8" },
    );
    assert.equal(filtered.status, 0);

    const result = await checkDocs(dir, { checkUndocumented: false });
    assert.ok(filterFailures(result, {}).length > 0);
    assert.deepEqual(filterFailures(result, { warningOnly: true }), []);
    assert.deepEqual(filterFailures(result, { failOn: ["undocumented"] }), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ghost docs flag removed features; new public behaviour is flagged undocumented", async () => {
  const ghostDir = await makeRepo({
    "README.md": ["# Demo", "", "## Removed Widget", "", "See [old](./tools/old/README.md) and [older](./tools/old/notes.md).", ""].join("\n"),
    "package.json": JSON.stringify({ name: "demo" }),
  });
  const freshDir = await makeRepo({
    "README.md": ["# Demo", "", "Run `npm run test`.", ""].join("\n"),
    "package.json": JSON.stringify({
      name: "demo",
      scripts: { test: "node --test", "brand-new": "node scripts/fresh.mjs" },
    }),
  });
  try {
    const ghost = await checkDocs(ghostDir, { checkUndocumented: false });
    assert.deepEqual(sortedClasses(ghost), ["broken-file-ref", "broken-file-ref", "ghost-doc"]);
    const ghostFinding = ghost.findings.find((f) => f.class === "ghost-doc");
    assert.equal(ghostFinding.line, 3);
    assert.equal(ghostFinding.evidence.method, "section-refs");
    assert.match(ghostFinding.evidence.detail, /2\/2/);
    assert.equal(ghostFinding.suggestion.startLine, 3);

    const fresh = await checkDocs(freshDir);
    assert.equal(fresh.findings.length, 1);
    const [finding] = fresh.findings;
    assert.equal(finding.class, "undocumented");
    assert.equal(finding.reference, "npm run brand-new");
    assert.equal(finding.doc, "package.json");
    assert.equal(finding.evidence.method, "docs-corpus-search");
  } finally {
    await rm(ghostDir, { recursive: true, force: true });
    await rm(freshDir, { recursive: true, force: true });
  }
});

test("stale config keys and packages are detected; current ones pass", async () => {
  const dir = await makeRepo({
    "README.md": [
      "# Demo",
      "",
      "Config: `old_key` replaced `keep_key` in `config/settings.json`.",
      "",
      "Install `npm install ghost-pkg-xyz` for legacy support.",
      "",
    ].join("\n"),
    "package.json": JSON.stringify({ name: "demo", dependencies: { "left-pad": "^1.0.0" } }),
    "config/settings.json": JSON.stringify({ keep_key: true }),
  });
  try {
    const result = await checkDocs(dir, { checkUndocumented: false });
    assert.deepEqual(sortedClasses(result), ["stale-config-key", "stale-package"]);
    const key = result.findings.find((f) => f.class === "stale-config-key");
    assert.equal(key.reference, "old_key");
    assert.equal(key.evidence.method, "config-keys");
    const pkg = result.findings.find((f) => f.class === "stale-package");
    assert.equal(pkg.reference, "ghost-pkg-xyz");
    assert.equal(pkg.evidence.method, "package-json-deps");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("detectors stay silent without repository grounding", async () => {
  const dir = await makeRepo({
    "README.md": "Use `mycli --mystery-flag`.\n",
  });
  try {
    const result = await checkDocs(dir);
    assert.deepEqual(result.findings, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("committed stale-sample fixture reports every detector class", async () => {
  const result = await checkDocs(FIXTURE);
  assert.deepEqual(sortedClasses(result), [
    "broken-command",
    "broken-file-ref",
    "ghost-doc",
    "stale-config-key",
    "stale-flag",
    "stale-package",
    "undocumented",
    "undocumented",
  ]);
  result.findings.forEach((finding, index) => {
    assert.equal(finding.id, `DR-${String(index + 1).padStart(3, "0")}`);
    assert.ok(["error", "info"].includes(finding.severity));
  });
});

test("skill has valid metadata and READMEs list the tool and skill", () => {
  const match = skill.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, "SKILL.md must start with YAML frontmatter");
  const meta = Object.fromEntries(
    match[1].split("\n").map((line) => {
      const i = line.indexOf(":");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }),
  );
  assert.equal(meta.name, "docs-reality");
  assert.match(meta.description, /drift/i);

  assert.match(toolReadme, /docs-reality/);
  assert.match(rootReadme, /\.\/tools\/docs-reality\//);
  assert.match(
    rootReadme,
    /npx skills add WolfMarkTools\/WolfMark-Lab -s docs-reality -y --full-depth/,
  );
});
