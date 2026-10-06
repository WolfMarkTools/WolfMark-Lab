#!/usr/bin/env node
// Docs Reality CLI — local drift check with JSON/Markdown reports and CI mode.

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  DEFAULT_FAIL_ON,
  FINDING_CLASSES,
  VERSION,
  checkDocs,
  filterFailures,
  toJsonReport,
  toMarkdownReport,
} from "./check.mjs";

const USAGE = `docs-reality — detect documentation drift against repository reality

Usage:
  node tools/docs-reality/scripts/docs-reality.mjs [options]

Options:
  --root <dir>            Repository root to scan (default: current directory)
  --docs <csv>            Comma-separated doc files or directories (default: all *.md)
  --exclude <csv>         Comma-separated glob excludes (e.g. "drafts/**")
  --config <path>         JSON config file (CLI flags override it)
  --format <name>         json | markdown | both (default: markdown)
  --out <path>            Write report file(s); without it the report goes to stdout.
                          With --format both, --out is a directory receiving
                          docs-reality.json and docs-reality.md.
  --check                 CI mode: exit 2 when fail-class findings exist
  --fail-on <csv>         Finding classes that fail --check
                          (default: ${DEFAULT_FAIL_ON.join(",")})
  --warning-only          Never fail: always exit 0 (overrides --fail-on)
  --include-agent-files   Also scan AGENTS.md / .agents/ / .muse/ etc.
                          (by default these belong to Rules Forge, not Docs Reality)
  --no-undocumented       Skip the undocumented-behaviour detector
  --help, -h              Show this help
  --version               Show the version

Exit codes: 0 ok (or warning-only), 2 drift found in --check mode, 1 usage/IO error.
`;

function parseArgs(argv) {
  const opts = {
    root: process.cwd(),
    rootSpecified: false,
    docs: null,
    exclude: [],
    config: null,
    format: "markdown",
    formatSpecified: false,
    out: null,
    check: false,
    failOn: null,
    warningOnly: false,
    includeAgentFiles: false,
    checkUndocumented: true,
    flagAllowlist: [],
  };
  const takesValue = new Set(["--root", "--docs", "--exclude", "--config", "--format", "--out", "--fail-on"]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(USAGE);
      process.exit(0);
    }
    if (arg === "--version") {
      process.stdout.write(`${VERSION}\n`);
      process.exit(0);
    }
    if (arg === "--check") {
      opts.check = true;
      continue;
    }
    if (arg === "--warning-only") {
      opts.warningOnly = true;
      continue;
    }
    if (arg === "--include-agent-files") {
      opts.includeAgentFiles = true;
      continue;
    }
    if (arg === "--no-undocumented") {
      opts.checkUndocumented = false;
      continue;
    }
    if (takesValue.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`missing value for ${arg}`);
      }
      i++;
      if (arg === "--root") {
        opts.root = value;
        opts.rootSpecified = true;
      }
      else if (arg === "--docs") opts.docs = value.split(",").map((s) => s.trim()).filter(Boolean);
      else if (arg === "--exclude") opts.exclude = value.split(",").map((s) => s.trim()).filter(Boolean);
      else if (arg === "--config") opts.config = value;
      else if (arg === "--format") {
        opts.format = value;
        opts.formatSpecified = true;
      }
      else if (arg === "--out") opts.out = value;
      else if (arg === "--fail-on") opts.failOn = value.split(",").map((s) => s.trim()).filter(Boolean);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return opts;
}

async function loadConfig(opts) {
  if (!opts.config) return opts;
  const raw = await readFile(resolve(opts.config), "utf8");
  const file = JSON.parse(raw);
  const merged = { ...opts };
  if (file.root !== undefined && !opts.rootSpecified) merged.root = file.root;
  if (file.docs !== undefined && opts.docs === null) merged.docs = file.docs;
  if (file.exclude !== undefined && opts.exclude.length === 0) merged.exclude = file.exclude;
  if (file.format !== undefined && !opts.formatSpecified) merged.format = file.format;
  if (file.failOn !== undefined && opts.failOn === null) merged.failOn = file.failOn;
  if (file.warningOnly !== undefined && opts.warningOnly === false) merged.warningOnly = file.warningOnly;
  if (file.includeAgentFiles !== undefined && opts.includeAgentFiles === false) {
    merged.includeAgentFiles = file.includeAgentFiles;
  }
  if (file.checkUndocumented !== undefined && opts.checkUndocumented === true) {
    merged.checkUndocumented = file.checkUndocumented;
  }
  if (file.flagAllowlist !== undefined) merged.flagAllowlist = file.flagAllowlist;
  return merged;
}

async function resolveOutFile(out, fileName) {
  const abs = resolve(out);
  try {
    const info = await stat(abs);
    if (info.isDirectory()) return join(abs, fileName);
    return abs;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    if (out.endsWith("/")) {
      await mkdir(abs, { recursive: true });
      return join(abs, fileName);
    }
    await mkdir(resolve(abs, ".."), { recursive: true });
    return abs;
  }
}

async function main() {
  let opts;
  try {
    opts = await loadConfig(parseArgs(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`docs-reality: ${error.message}\n${USAGE}`);
    process.exitCode = 1;
    return;
  }

  if (!["json", "markdown", "both"].includes(opts.format)) {
    process.stderr.write(`docs-reality: --format must be json, markdown or both\n`);
    process.exitCode = 1;
    return;
  }
  const failOn = opts.failOn ?? DEFAULT_FAIL_ON;
  const unknown = failOn.filter((name) => !FINDING_CLASSES.includes(name));
  if (unknown.length > 0) {
    process.stderr.write(`docs-reality: unknown --fail-on class(es): ${unknown.join(", ")}\n`);
    process.exitCode = 1;
    return;
  }

  let result;
  try {
    result = await checkDocs(opts.root, {
      docs: opts.docs,
      exclude: opts.exclude,
      includeAgentFiles: opts.includeAgentFiles,
      checkUndocumented: opts.checkUndocumented,
      flagAllowlist: opts.flagAllowlist,
    });
  } catch (error) {
    process.stderr.write(`docs-reality: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  const failures = filterFailures(result, { failOn, warningOnly: opts.warningOnly });

  try {
    if (opts.format === "both" && !opts.out) {
      process.stderr.write("docs-reality: --format both requires --out <directory>\n");
      process.exitCode = 1;
      return;
    }
    if (opts.out && opts.format === "both") {
      const dir = resolve(opts.out);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "docs-reality.json"), toJsonReport(result), "utf8");
      await writeFile(join(dir, "docs-reality.md"), toMarkdownReport(result), "utf8");
      process.stdout.write(
        `docs-reality: ${result.findings.length} finding(s) across ${result.stats.docsScanned} doc(s); reports written to ${dir}\n`,
      );
    } else if (opts.out) {
      const fileName = opts.format === "json" ? "docs-reality.json" : "docs-reality.md";
      const target = await resolveOutFile(opts.out, fileName);
      await writeFile(target, opts.format === "json" ? toJsonReport(result) : toMarkdownReport(result), "utf8");
      process.stdout.write(
        `docs-reality: ${result.findings.length} finding(s) across ${result.stats.docsScanned} doc(s); report written to ${target}\n`,
      );
    } else if (opts.format === "json") {
      process.stdout.write(toJsonReport(result));
    } else {
      process.stdout.write(toMarkdownReport(result));
    }
  } catch (error) {
    process.stderr.write(`docs-reality: cannot write report: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  if (opts.check && !opts.warningOnly && failures.length > 0) {
    process.stderr.write(
      `docs-reality: ${failures.length} failing finding(s) [${[...new Set(failures.map((f) => f.class))].join(", ")}]\n`,
    );
    process.exitCode = 2;
  }
}

await main();
