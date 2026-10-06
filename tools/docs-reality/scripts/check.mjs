// Docs Reality — compare user/developer docs against repository facts.
//
// Scans Markdown docs for references to files, commands, flags, config keys,
// packages and workflows, checks each one against repository evidence (file
// existence, package.json, Makefile, literal code search), and proposes
// minimal, region-scoped corrections. Valid references are never rewritten:
// only evidence-backed drift becomes a finding.
//
// Agent-instruction files (AGENTS.md, .agents/, ...) are excluded by default.
// Instruction linting belongs to Rules Forge, not to this tool.

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export const TOOL_NAME = "docs-reality";
export const VERSION = "0.1.0";

export const FINDING_CLASSES = [
  "broken-file-ref",
  "broken-command",
  "stale-flag",
  "stale-config-key",
  "stale-package",
  "stale-workflow",
  "ghost-doc",
  "undocumented",
];

export const DEFAULT_SEVERITY = {
  "broken-file-ref": "error",
  "broken-command": "error",
  "stale-flag": "error",
  "stale-config-key": "error",
  "stale-package": "error",
  "stale-workflow": "error",
  "ghost-doc": "error",
  undocumented: "info",
};

export const DEFAULT_FAIL_ON = FINDING_CLASSES.filter(
  (name) => DEFAULT_SEVERITY[name] === "error",
);

// Agent-instruction paths owned by Rules Forge. Docs Reality skips them by
// default so the two tools never lint the same files.
export const AGENT_PATH_PATTERNS = [
  "AGENTS.md",
  "AGENTS-*.md",
  "**/AGENTS.md",
  "**/AGENTS-*.md",
  ".agents/**",
  ".muse/**",
  ".cursor/**",
  ".codex/**",
  "**/prompts/**",
];

const ALWAYS_SKIP_DIRS = new Set(["node_modules", ".git", ".hg", ".sl"]);
const DOC_EXTS = new Set([".md", ".mdx"]);
const SOURCE_EXTS = new Set([".mjs", ".cjs", ".js", ".ts", ".tsx", ".py", ".sh", ".rb", ".go", ".rs"]);
const PATH_EXTS = new Set([
  ".mjs", ".cjs", ".js", ".ts", ".tsx", ".json", ".md", ".mdx",
  ".toml", ".yaml", ".yml", ".sh", ".py", ".html", ".css",
]);
const MAX_WALK_FILES = 20000;
const MAX_SOURCE_FILES = 2000;
const MAX_SOURCE_BYTES = 200000;

// Universal flags that rarely appear literally in code (framework-provided).
export const DEFAULT_FLAG_ALLOWLIST = ["--help", "--version"];

const NODE_BUILTINS = new Set(
  "assert,buffer,child_process,cluster,crypto,dgram,dns,domain,events,fs,http,http2,https,inspector,module,net,os,path,perf_hooks,process,punycode,querystring,readline,repl,stream,string_decoder,sys,timers,tls,trace_events,tty,url,util,v8,vm,worker_threads,zlib".split(","),
);

const COMMAND_LEADERS = new Set(["node", "npm", "pnpm", "yarn", "bun", "make", "npx"]);
const NPM_SKIP_VERBS = new Set([
  "install", "i", "add", "remove", "rm", "uninstall", "update", "upgrade",
  "init", "login", "logout", "publish", "pack", "link", "unlink", "run",
  "exec", "dlx", "create", "ls", "list", "ci", "audit", "fund", "outdated", "prune",
]);
const NPM_BARE_OK = new Set(["test", "start", "stop", "restart"]);

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRegExp(pattern) {
  let out = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        while (pattern[i + 1] === "*") i++;
        if (pattern[i + 1] === "/") {
          i++;
          out += "(?:.*/)?";
        } else {
          out += ".*";
        }
      } else {
        out += "[^/]*";
      }
    } else if ("+?^${}()|[]\\.".includes(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
  }
  return new RegExp(`${out}$`);
}

function matchesAny(relPosix, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(relPosix));
}

function normalizePosix(path) {
  const absolute = path.startsWith("/");
  const out = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else if (!absolute) out.push("..");
      continue;
    }
    out.push(part);
  }
  return (absolute ? "/" : "") + out.join("/");
}

function extOf(path) {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot < 0 ? "" : base.slice(dot).toLowerCase();
}

async function walkFiles(rootAbs, { exclude = [] } = {}) {
  const found = [];
  const stack = [""];
  while (stack.length > 0 && found.length < MAX_WALK_FILES) {
    const rel = stack.pop();
    let entries;
    try {
      entries = await readdir(join(rootAbs, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (ALWAYS_SKIP_DIRS.has(entry.name)) continue;
        if (matchesAny(child, exclude) || matchesAny(`${child}/`, exclude)) continue;
        stack.push(child);
      } else if (entry.isFile()) {
        if (matchesAny(child, exclude)) continue;
        found.push(child);
      }
    }
  }
  return found.sort();
}

function effectiveExcludes(exclude, includeAgentFiles) {
  return includeAgentFiles ? [...exclude] : [...exclude, ...AGENT_PATH_PATTERNS];
}

export async function listDocFiles(rootAbs, { docs = null, exclude = [], includeAgentFiles = false } = {}) {
  const patterns = effectiveExcludes(exclude, includeAgentFiles);
  if (docs && docs.length > 0) {
    const selected = [];
    for (const entry of docs) {
      const clean = entry.replace(/\/+$/, "");
      const full = resolve(rootAbs, clean);
      let isDir = false;
      try {
        const stat = await readdir(full, { withFileTypes: true });
        if (stat) isDir = true;
      } catch (error) {
        if (error?.code !== "ENOTDIR") throw new Error(`doc not found: ${entry}`);
      }
      if (isDir) {
        const rel = clean === "" || clean === "." ? "" : clean;
        const stack = [rel];
        while (stack.length > 0) {
          const current = stack.pop();
          let entries;
          try {
            entries = await readdir(join(rootAbs, current), { withFileTypes: true });
          } catch {
            continue;
          }
          for (const e of entries) {
            const child = current ? `${current}/${e.name}` : e.name;
            if (e.isDirectory()) {
              if (ALWAYS_SKIP_DIRS.has(e.name)) continue;
              stack.push(child);
            } else if (e.isFile() && DOC_EXTS.has(extOf(child)) && !matchesAny(child, patterns)) {
              selected.push(child);
            }
          }
        }
      } else {
        const rel = normalizePosix(clean);
        if (matchesAny(rel, patterns)) continue;
        try {
          await readFile(join(rootAbs, rel), "utf8");
        } catch {
          throw new Error(`doc not found: ${entry}`);
        }
        selected.push(rel);
      }
    }
    return [...new Set(selected)].sort();
  }
  const all = await walkFiles(rootAbs, { exclude: patterns });
  return all.filter((rel) => DOC_EXTS.has(extOf(rel)));
}

function collectJsonKeys(value, prefix, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const key of Object.keys(value)) {
    keys.add(key);
    keys.add(prefix ? `${prefix}.${key}` : key);
    collectJsonKeys(value[key], prefix ? `${prefix}.${key}` : key, keys);
  }
}

function parseMakefileTargets(text) {
  const targets = new Set();
  for (const line of text.split("\n")) {
    const match = line.match(/^([A-Za-z0-9_.\-/%]+)\s*:(?![=])/);
    if (match && !match[1].startsWith(".")) targets.add(match[1]);
  }
  return targets;
}

export async function collectRepoFacts(rootAbs, { exclude = [], includeAgentFiles = false } = {}) {
  const patterns = effectiveExcludes(exclude, includeAgentFiles);
  const allFiles = await walkFiles(rootAbs, { exclude: patterns });
  const files = new Set(allFiles);
  const dirs = new Set();
  for (const rel of allFiles) {
    let dir = dirname(rel);
    while (dir && dir !== "." && dir !== "/") {
      dirs.add(dir);
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  let packageJson = null;
  let packageJsonPath = null;
  for (const candidate of ["package.json"]) {
    if (!files.has(candidate)) continue;
    try {
      packageJson = JSON.parse(await readFile(join(rootAbs, candidate), "utf8"));
      packageJsonPath = candidate;
    } catch {
      packageJson = null;
    }
  }
  const scripts = packageJson && typeof packageJson.scripts === "object" && packageJson.scripts
    ? packageJson.scripts
    : {};
  const binNames = [];
  if (packageJson) {
    if (typeof packageJson.bin === "string") {
      binNames.push(packageJson.bin.slice(packageJson.bin.lastIndexOf("/") + 1));
    } else if (packageJson.bin && typeof packageJson.bin === "object") {
      binNames.push(...Object.keys(packageJson.bin));
    }
  }
  const dependencies = packageJson
    ? {
        ...(packageJson.dependencies ?? {}),
        ...(packageJson.devDependencies ?? {}),
        ...(packageJson.peerDependencies ?? {}),
        ...(packageJson.optionalDependencies ?? {}),
      }
    : null;

  let makefilePath = null;
  let makeTargets = new Set();
  for (const candidate of ["Makefile", "makefile", "GNUmakefile"]) {
    if (!files.has(candidate)) continue;
    try {
      makeTargets = parseMakefileTargets(await readFile(join(rootAbs, candidate), "utf8"));
      makefilePath = candidate;
    } catch {
      makeTargets = new Set();
    }
    break;
  }

  const sourceFiles = allFiles.filter((rel) => SOURCE_EXTS.has(extOf(rel))).slice(0, MAX_SOURCE_FILES);
  const sourceTexts = new Map();
  for (const rel of sourceFiles) {
    try {
      const text = await readFile(join(rootAbs, rel), "utf8");
      if (text.length <= MAX_SOURCE_BYTES) sourceTexts.set(rel, text);
    } catch {
      // Unreadable source files simply provide no evidence.
    }
  }

  const configKeys = new Set();
  const configKeySources = [];
  for (const rel of allFiles) {
    if (extOf(rel) !== ".json" || rel.endsWith("package-lock.json")) continue;
    try {
      const data = JSON.parse(await readFile(join(rootAbs, rel), "utf8"));
      const before = configKeys.size;
      collectJsonKeys(data, "", configKeys);
      if (configKeys.size > before || before === 0) configKeySources.push(rel);
    } catch {
      // Invalid JSON provides no key evidence.
    }
  }

  return {
    files,
    dirs,
    packageJson,
    packageJsonPath,
    scripts,
    binNames,
    dependencies,
    makefilePath,
    makeTargets,
    sourceFiles,
    sourceTexts,
    configKeys,
    configKeySources: configKeySources.sort(),
  };
}

function resolveRefCandidates(ref, docRel, { rootFallback = true } = {}) {
  const cleaned = ref.trim().split("#")[0].split("?")[0].trim();
  if (!cleaned) return [];
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(cleaned)) return [];
  if (cleaned.startsWith("/")) {
    const cand = normalizePosix(cleaned);
    return cand === "" ? [] : [cand.replace(/^\/+/, "")];
  }
  const docDir = dirname(docRel);
  const prefix = docDir === "." ? "" : `${docDir}/`;
  const candidates = [];
  if (prefix) candidates.push(normalizePosix(prefix + cleaned));
  if (rootFallback || !prefix) candidates.push(normalizePosix(cleaned));
  return [...new Set(candidates)].filter((c) => c !== "" && !c.startsWith(".."));
}

function existsInRepo(candidate, facts) {
  return facts.files.has(candidate) || facts.dirs.has(candidate);
}

function isPathLike(token) {
  const clean = token.trim().replace(/^['"(<]+|['">).,;:!?]+$/g, "");
  if (!clean || clean.includes("://") || clean.startsWith("#") || clean.startsWith("-") || clean.startsWith("$") || clean.startsWith("~")) {
    return null;
  }
  if (clean.includes("*") || clean.includes("<") || clean.includes(">") || clean.includes("...")) {
    return null;
  }
  const base = clean.replace(/\/+$/, "");
  if (!base.includes("/") && !base.startsWith("./") && !base.startsWith("../")) return null;
  if (clean.endsWith("/")) return clean;
  const name = base.slice(base.lastIndexOf("/") + 1);
  if (!name.includes(".")) return null;
  if (!PATH_EXTS.has(extOf(base))) return null;
  return clean;
}

function isCommandSpan(span) {
  return /^\s*(node|npm|pnpm|yarn|bun|make|npx)\s+/.test(span);
}

function cleanToken(token) {
  return token.replace(/^['"(<]+|['">).,;:!?]+$/g, "");
}

// Parse `node ...` invocations on one line. Returns each invocation's target
// file token (when one resolves lexically) plus app flags after the file.
// Node runtime flags before the file (e.g. --test, --check) are skipped:
// they belong to Node, not to the documented program.
function parseNodeInvocations(line) {
  const invocations = [];
  for (const match of line.matchAll(/(?:^|[`'"\s(;]|&&|\|\|)node\s+([^`'"|&;\n]*)/g)) {
    const rest = match[1].trim();
    if (!rest) continue;
    const tokens = rest.split(/\s+/).map(cleanToken).filter(Boolean);
    let fileToken = null;
    const appFlags = [];
    const nodeFlags = [];
    let sawFile = false;
    for (const token of tokens) {
      if (!sawFile && token.startsWith("-")) {
        if (/^--[A-Za-z][A-Za-z0-9-]*$/.test(token)) nodeFlags.push(token);
        continue;
      }
      if (!sawFile) {
        sawFile = true;
        fileToken = token;
        continue;
      }
      if (/^--[A-Za-z][A-Za-z0-9-]*$/.test(token)) appFlags.push(token);
    }
    invocations.push({ fileToken, appFlags, nodeFlags });
  }
  return invocations;
}

function parseNpmInvocations(line) {
  const found = [];
  const pattern = /(?:^|[`'"\s(;]|&&|\|\|)(npm|pnpm|yarn|bun)\s+(?:(run)\s+)?([A-Za-z0-9_:\-.]+)/g;
  for (const match of line.matchAll(pattern)) {
    const manager = match[1];
    const hasRun = Boolean(match[2]);
    const name = match[3];
    if (NPM_SKIP_VERBS.has(name)) continue;
    if (manager === "npm" && !hasRun && !NPM_BARE_OK.has(name)) continue;
    found.push({ manager, name });
  }
  return found;
}

function parseMakeInvocations(line) {
  const found = [];
  for (const match of line.matchAll(/(?:^|[`'"\s(;]|&&|\|\|)make\s+([A-Za-z0-9_.\-/]+)/g)) {
    const name = match[1];
    if (name.startsWith("-") || name.includes("=")) continue;
    found.push(name);
  }
  return found;
}

function packageRoot(spec) {
  const noVersion = spec.split("@").length > 1 && !spec.startsWith("@")
    ? spec.slice(0, spec.lastIndexOf("@"))
    : spec;
  const cleaned = noVersion || spec;
  if (cleaned.startsWith("@")) {
    const parts = cleaned.split("/");
    if (parts.length < 2) return cleaned;
    const name = parts[1].split("@")[0];
    return name ? `${parts[0]}/${name}` : cleaned;
  }
  return cleaned.split("/")[0];
}

function containsWord(corpus, name) {
  return new RegExp(`(^|[^A-Za-z0-9_.:/-])${escapeRegExp(name)}([^A-Za-z0-9_.:/-]|$)`).test(corpus);
}

export async function checkDocs(rootInput, options = {}) {
  const {
    docs = null,
    exclude = [],
    includeAgentFiles = false,
    checkUndocumented = true,
    flagAllowlist = [],
  } = options;
  const rootAbs = resolve(rootInput);
  const docFiles = await listDocFiles(rootAbs, { docs, exclude, includeAgentFiles });
  const facts = await collectRepoFacts(rootAbs, { exclude, includeAgentFiles });
  const allowlist = new Set([...DEFAULT_FLAG_ALLOWLIST, ...flagAllowlist]);

  const findings = [];
  const sectionStats = new Map();
  let linesScanned = 0;
  let referencesChecked = 0;

  const sectionOf = (doc, heading, headingLine) => {
    const key = `${doc}\u0000${headingLine}\u0000${heading}`;
    let entry = sectionStats.get(key);
    if (!entry) {
      entry = { doc, heading, headingLine, total: 0, broken: 0, refs: [], firstBrokenLine: null };
      sectionStats.set(key, entry);
    }
    return entry;
  };

  const addFinding = ({ name, doc, line, heading, reference, excerpt, evidence, suggestion }) => {
    referencesChecked += 1;
    findings.push({
      id: "",
      class: name,
      severity: DEFAULT_SEVERITY[name],
      doc,
      line,
      heading,
      reference,
      excerpt,
      evidence,
      suggestion,
    });
  };

  const markValid = (count = 1) => {
    referencesChecked += count;
  };

  const sameBasename = (ref, limit = 3) => {
    const base = ref.slice(ref.lastIndexOf("/") + 1).replace(/\/+$/, "");
    if (!base) return [];
    return [...facts.files].filter((f) => f.endsWith(`/${base}`) || f === base).sort().slice(0, limit);
  };

  for (const doc of docFiles) {
    const text = await readFile(join(rootAbs, doc), "utf8");
    const lines = text.split("\n");
    linesScanned += lines.length;
    let heading = "(top)";
    let headingLine = 1;
    const seenFlags = new Set();
    const seenKeys = new Set();
    const seenPackages = new Set();

    lines.forEach((line, index) => {
      const lineNo = index + 1;
      const excerpt = line.trim().slice(0, 200);
      const headingMatch = line.match(/^#{1,6}\s+(\S.*)$/);
      if (headingMatch) {
        heading = headingMatch[1].trim().slice(0, 120);
        headingLine = lineNo;
      }
      const section = sectionOf(doc, heading, headingLine);

      const reportBrokenSectionRef = (entry, ref) => {
        entry.total += 1;
        entry.broken += 1;
        entry.refs.push(ref);
        if (entry.firstBrokenLine === null) entry.firstBrokenLine = lineNo;
      };

      // D1a. Markdown link targets are explicit references: check existence.
      const seenLinkTargets = new Set();
      for (const match of line.matchAll(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const target = match[2].split("#")[0].split("?")[0].trim();
        if (!target || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target) || seenLinkTargets.has(target)) continue;
        seenLinkTargets.add(target);
        const candidates = resolveRefCandidates(target, doc, { rootFallback: false });
        const hit = candidates.find((c) => existsInRepo(c, facts));
        if (hit) {
          section.total += 1;
          markValid();
          continue;
        }
        reportBrokenSectionRef(section, target);
        const hints = sameBasename(target);
        addFinding({
          name: "broken-file-ref",
          doc,
          line: lineNo,
          heading,
          reference: target,
          excerpt,
          evidence: {
            method: "fs-exists",
            detail: candidates.length > 0
              ? `checked ${candidates.map((c) => `"${c}"`).join(", ")} — all missing`
              : `"${target}" escapes the repository root`,
          },
          suggestion: {
            action: "edit-line",
            file: doc,
            startLine: lineNo,
            endLine: lineNo,
            guidance: "Update the link to an existing file, or remove this line.",
            replacementPreview: hints.length > 0
              ? `Did you mean: ${hints.join(", ")}?`
              : `Remove line ${lineNo} or fix the target "${target}".`,
          },
        });
      }

      // D1b. Path-like inline code spans (single-segment names are out of scope).
      const seenPaths = new Set();
      for (const match of line.matchAll(/`([^`\n]+)`/g)) {
        const span = match[1];
        if (isCommandSpan(span)) continue;
        const parts = span.includes(" ") ? span.split(/\s+/) : [span];
        for (const part of parts) {
          const pathLike = isPathLike(part);
          if (!pathLike || seenPaths.has(pathLike)) continue;
          seenPaths.add(pathLike);
          const candidates = resolveRefCandidates(pathLike, doc);
          const hit = candidates.find((c) => existsInRepo(c, facts));
          if (hit) {
            section.total += 1;
            markValid();
            continue;
          }
          reportBrokenSectionRef(section, pathLike);
          const hints = sameBasename(pathLike);
          addFinding({
            name: "broken-file-ref",
            doc,
            line: lineNo,
            heading,
            reference: pathLike,
            excerpt,
            evidence: {
              method: "fs-exists",
              detail: candidates.length > 0
                ? `checked ${candidates.map((c) => `"${c}"`).join(", ")} — all missing`
                : `"${pathLike}" escapes the repository root`,
            },
            suggestion: {
              action: "edit-line",
              file: doc,
              startLine: lineNo,
              endLine: lineNo,
              guidance: "Update the path to an existing file, or remove this line.",
              replacementPreview: hints.length > 0
                ? `Did you mean: ${hints.join(", ")}?`
                : `Remove line ${lineNo} or fix the path "${pathLike}".`,
            },
          });
        }
      }

      // D2a. `node <file>` invocations: the file must exist.
      const nodeFilesOnLine = [];
      for (const invocation of parseNodeInvocations(line)) {
        const token = invocation.fileToken;
        if (!token || token.startsWith("-")) continue;
        // Bare names like `node foo` (no path, no known extension) are out of scope.
        if (!token.includes("/") && !PATH_EXTS.has(extOf(token))) continue;
        const candidates = resolveRefCandidates(token, doc);
        const hit = candidates.find((c) => existsInRepo(c, facts));
        if (hit) {
          section.total += 1;
          markValid();
          nodeFilesOnLine.push(hit);
          continue;
        }
        reportBrokenSectionRef(section, `node ${token}`);
        const hints = sameBasename(token);
        addFinding({
          name: "broken-command",
          doc,
          line: lineNo,
          heading,
          reference: `node ${token}`,
          excerpt,
          evidence: {
            method: "fs-exists",
            detail: candidates.length > 0
              ? `documented command target missing: checked ${candidates.map((c) => `"${c}"`).join(", ")}`
              : `documented command target "${token}" escapes the repository root`,
          },
          suggestion: {
            action: "edit-line",
            file: doc,
            startLine: lineNo,
            endLine: lineNo,
            guidance: "Point the command at an existing script, or remove this line.",
            replacementPreview: hints.length > 0
              ? `Did you mean: ${hints.map((h) => `node ${h}`).join(", ")}?`
              : `Remove line ${lineNo} or fix "node ${token}".`,
          },
        });
      }

      // D2b. Package-manager scripts must exist in package.json scripts.
      const npmFilesOnLine = [];
      for (const { name } of parseNpmInvocations(line)) {
        if (!facts.packageJson) continue;
        if (Object.hasOwn(facts.scripts, name)) {
          section.total += 1;
          markValid();
          const body = String(facts.scripts[name] ?? "");
          const bodyMatch = body.match(/node\s+([^\s"'|&;]+)/);
          if (bodyMatch) {
            const cands = resolveRefCandidates(cleanToken(bodyMatch[1]), "package.json");
            const hit = cands.find((c) => existsInRepo(c, facts));
            if (hit) npmFilesOnLine.push(hit);
          }
          continue;
        }
        reportBrokenSectionRef(section, `npm run ${name}`);
        const available = Object.keys(facts.scripts).slice(0, 10);
        addFinding({
          name: "stale-workflow",
          doc,
          line: lineNo,
          heading,
          reference: `npm run ${name}`,
          excerpt,
          evidence: {
            method: "package-json-scripts",
            detail: `"${name}" not found in ${facts.packageJsonPath} scripts${
              available.length > 0 ? ` (available: ${available.join(", ")})` : " (no scripts defined)"
            }`,
          },
          suggestion: {
            action: "edit-line",
            file: doc,
            startLine: lineNo,
            endLine: lineNo,
            guidance: available.length > 0
              ? `Use one of the available scripts, or remove this line.`
              : "Remove this line or restore the script.",
            replacementPreview: available.length > 0
              ? `Available scripts: ${available.join(", ")}.`
              : `Remove line ${lineNo} or restore "${name}" in ${facts.packageJsonPath}.`,
          },
        });
      }

      // D2c. `make <target>` must exist when a Makefile is present.
      for (const target of parseMakeInvocations(line)) {
        if (!facts.makefilePath) continue;
        if (facts.makeTargets.has(target)) {
          section.total += 1;
          markValid();
          continue;
        }
        reportBrokenSectionRef(section, `make ${target}`);
        const available = [...facts.makeTargets].slice(0, 10);
        addFinding({
          name: "stale-workflow",
          doc,
          line: lineNo,
          heading,
          reference: `make ${target}`,
          excerpt,
          evidence: {
            method: "makefile-targets",
            detail: `target "${target}" not found in ${facts.makefilePath}${
              available.length > 0 ? ` (available: ${available.join(", ")})` : ""
            }`,
          },
          suggestion: {
            action: "edit-line",
            file: doc,
            startLine: lineNo,
            endLine: lineNo,
            guidance: "Use an existing make target, or remove this line.",
            replacementPreview: available.length > 0
              ? `Available targets: ${available.join(", ")}.`
              : `Remove line ${lineNo} or restore "${target}" in ${facts.makefilePath}.`,
          },
        });
      }

      // D3. Flags documented alongside a resolvable `node <file>` (or an
      // `npm run <script>` whose body runs such a file) must appear in it.
      const authorityFiles = [...new Set([...nodeFilesOnLine, ...npmFilesOnLine])];
      const loadedAuthority = authorityFiles.filter((rel) => facts.sourceTexts.has(rel));
      if (authorityFiles.length > 0 && loadedAuthority.length > 0) {
        const nodeInvocations = parseNodeInvocations(line);
        const appFlagSet = new Set(nodeInvocations.flatMap((inv) => inv.appFlags));
        const runtimeFlagSet = new Set(nodeInvocations.flatMap((inv) => inv.nodeFlags ?? []));
        const flagMatches = [...line.replace(/https?:\/\/\S+/g, "").matchAll(/--[A-Za-z][A-Za-z0-9-]*/g)]
          .map((m) => m[0])
          .filter((flag) => !runtimeFlagSet.has(flag) || appFlagSet.has(flag));
        for (const invocation of nodeInvocations) {
          for (const flag of invocation.appFlags) {
            if (!flagMatches.includes(flag)) flagMatches.push(flag);
          }
        }
        for (const flag of [...new Set(flagMatches)]) {
          if (allowlist.has(flag)) continue;
          const key = `${flag}`;
          if (seenFlags.has(key)) {
            continue;
          }
          const foundIn = loadedAuthority.filter((rel) => (facts.sourceTexts.get(rel) ?? "").includes(flag));
          if (foundIn.length > 0) {
            seenFlags.add(key);
            markValid();
            continue;
          }
          if (loadedAuthority.length < authorityFiles.length) {
            continue;
          }
          seenFlags.add(key);
          addFinding({
            name: "stale-flag",
            doc,
            line: lineNo,
            heading,
            reference: flag,
            excerpt,
            evidence: {
              method: "flag-in-file",
              detail: `"${flag}" from this line was not found in ${loadedAuthority.map((f) => `"${f}"`).join(", ")} (the documented command target${loadedAuthority.length > 1 ? "s" : ""})`,
            },
            suggestion: {
              action: "edit-line",
              file: doc,
              startLine: lineNo,
              endLine: lineNo,
              guidance: `Remove "${flag}" from this line, or restore the flag in ${loadedAuthority.join(", ")}.`,
              replacementPreview: `Remove "${flag}" from line ${lineNo} or restore it in ${loadedAuthority.join(", ")}.`,
            },
          });
        }
      }

      // D4. Config keys mentioned beside config-ish words must exist in JSON.
      if (facts.configKeys.size > 0 && /config|policy|option|setting|key|json|toml|yaml/i.test(line)) {
        for (const match of line.matchAll(/`([^`\n]+)`/g)) {
          const token = match[1].trim();
          if (seenKeys.has(token)) continue;
          if (token.includes(" ") || token.includes("/") || token.includes("://")) continue;
          if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(token)) continue;
          if (!/^[A-Za-z_][A-Za-z0-9_.-]{2,}$/.test(token)) continue;
          if (!token.includes("_") && !token.includes(".")) continue;
          if (PATH_EXTS.has(extOf(token))) continue;
          seenKeys.add(token);
          if (facts.configKeys.has(token)) {
            markValid();
            continue;
          }
          addFinding({
            name: "stale-config-key",
            doc,
            line: lineNo,
            heading,
            reference: token,
            excerpt,
            evidence: {
              method: "config-keys",
              detail: `"${token}" not found among ${facts.configKeys.size} keys from ${facts.configKeySources.length} JSON file(s): ${facts.configKeySources.slice(0, 5).join(", ") || "(none)"}`,
            },
            suggestion: {
              action: "edit-line",
              file: doc,
              startLine: lineNo,
              endLine: lineNo,
              guidance: `Remove "${token}" from this line, or restore the key in config.`,
              replacementPreview: `Remove "${token}" from line ${lineNo} or restore it in ${facts.configKeySources.slice(0, 3).join(", ") || "config"}.`,
            },
          });
        }
      }

      // D5. Installed or imported packages must be declared dependencies.
      if (facts.dependencies) {
        const candidates = new Set();
        for (const match of line.matchAll(/(?:npm|pnpm|bun)\s+(?:install|i|add)\s+([^`'"|&;\n]+)/g)) {
          for (const raw of match[1].split(/\s+/)) {
            const token = cleanToken(raw);
            if (!token || token.startsWith("-") || token.startsWith(".") || token.startsWith("/")) continue;
            if (token.includes("://")) continue;
            candidates.add(packageRoot(token));
          }
        }
        for (const match of line.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) candidates.add(match[1].trim());
        for (const match of line.matchAll(/\bfrom\s+["']([^"']+)["']/g)) candidates.add(match[1].trim());
        for (const match of line.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) candidates.add(match[1].trim());
        for (let spec of candidates) {
          spec = spec.trim();
          if (!spec || spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("node:")) continue;
          const root = packageRoot(spec);
          if (!root || NODE_BUILTINS.has(root)) continue;
          if (seenPackages.has(root)) continue;
          seenPackages.add(root);
          if (Object.hasOwn(facts.dependencies, root)) {
            markValid();
            continue;
          }
          addFinding({
            name: "stale-package",
            doc,
            line: lineNo,
            heading,
            reference: root,
            excerpt,
            evidence: {
              method: "package-json-deps",
              detail: `"${root}" not found in ${facts.packageJsonPath} dependencies/devDependencies/peerDependencies`,
            },
            suggestion: {
              action: "edit-line",
              file: doc,
              startLine: lineNo,
              endLine: lineNo,
              guidance: `Remove the reference to "${root}" from this line, or add it to ${facts.packageJsonPath}.`,
              replacementPreview: `Remove "${root}" from line ${lineNo} or declare it in ${facts.packageJsonPath}.`,
            },
          });
        }
      }
    });
  }

  // D7. Ghost docs: a section whose every file/command reference is broken.
  const ghostEntries = [...sectionStats.values()]
    .filter((entry) => entry.total >= 2 && entry.broken === entry.total)
    .sort((a, b) => (a.doc < b.doc ? -1 : a.doc > b.doc ? 1 : a.headingLine - b.headingLine));
  for (const entry of ghostEntries) {
    const shown = entry.refs.slice(0, 5).map((r) => `"${r}"`).join(", ");
    findings.push({
      id: "",
      class: "ghost-doc",
      severity: DEFAULT_SEVERITY["ghost-doc"],
      doc: entry.doc,
      line: entry.heading === "(top)" ? (entry.firstBrokenLine ?? 1) : entry.headingLine,
      heading: entry.heading,
      reference: entry.heading === "(top)" ? "(top of file)" : entry.heading,
      excerpt: `All ${entry.total} file/command references in this section are broken: ${shown}${entry.refs.length > 5 ? ", …" : ""}`.slice(0, 200),
      evidence: {
        method: "section-refs",
        detail: `${entry.broken}/${entry.total} file/command references under "${entry.heading}" in ${entry.doc} are broken (${entry.refs.map((r) => `"${r}"`).join(", ")})`,
      },
      suggestion: {
        action: "review-section",
        file: entry.doc,
        startLine: entry.heading === "(top)" ? (entry.firstBrokenLine ?? 1) : entry.headingLine,
        endLine: entry.heading === "(top)" ? (entry.firstBrokenLine ?? 1) : entry.headingLine,
        guidance: `Section "${entry.heading}" only documents removed behaviour. Remove or rewrite the section.`,
        replacementPreview: `Remove or rewrite the "${entry.heading}" section in ${entry.doc}.`,
      },
    });
  }

  // D6. Undocumented public behaviour: scripts, bins and make targets that
  // exist in the repo but are never mentioned in any scanned doc.
  if (checkUndocumented) {
    const corpusParts = [];
    for (const doc of docFiles) {
      corpusParts.push(await readFile(join(rootAbs, doc), "utf8"));
    }
    const corpus = corpusParts.join("\n");
    const undocumented = [];
    if (facts.packageJson) {
      for (const name of Object.keys(facts.scripts).sort()) {
        if (!containsWord(corpus, name)) {
          undocumented.push({
            reference: `npm run ${name}`,
            source: facts.packageJsonPath,
            excerpt: `"${name}": "${String(facts.scripts[name]).slice(0, 120)}"`,
            detail: `"${name}" is defined in ${facts.packageJsonPath} scripts but mentioned in 0 of ${docFiles.length} scanned doc(s)`,
          });
        } else {
          markValid();
        }
      }
      for (const name of [...facts.binNames].sort()) {
        if (name && !containsWord(corpus, name)) {
          undocumented.push({
            reference: name,
            source: facts.packageJsonPath,
            excerpt: `bin: ${name}`,
            detail: `bin "${name}" is declared in ${facts.packageJsonPath} but mentioned in 0 of ${docFiles.length} scanned doc(s)`,
          });
        } else if (name) {
          markValid();
        }
      }
    }
    if (facts.makefilePath) {
      for (const name of [...facts.makeTargets].sort()) {
        if (!containsWord(corpus, name)) {
          undocumented.push({
            reference: `make ${name}`,
            source: facts.makefilePath,
            excerpt: `${name}:`,
            detail: `target "${name}" is defined in ${facts.makefilePath} but mentioned in 0 of ${docFiles.length} scanned doc(s)`,
          });
        } else {
          markValid();
        }
      }
    }
    for (const item of undocumented) {
      findings.push({
        id: "",
        class: "undocumented",
        severity: DEFAULT_SEVERITY.undocumented,
        doc: item.source,
        line: null,
        heading: "(repository fact)",
        reference: item.reference,
        excerpt: item.excerpt.slice(0, 200),
        evidence: { method: "docs-corpus-search", detail: item.detail },
        suggestion: {
          action: "document",
          file: null,
          startLine: null,
          endLine: null,
          guidance: `Document "${item.reference}" in the user docs, or remove it if it is not public.`,
          replacementPreview: `Add a short section for "${item.reference}" to ${docFiles[0] ?? "README.md"}.`,
        },
      });
    }
  }

  findings.forEach((finding, index) => {
    finding.id = `DR-${String(index + 1).padStart(3, "0")}`;
  });

  const findingsByClass = {};
  const findingsBySeverity = {};
  for (const finding of findings) {
    findingsByClass[finding.class] = (findingsByClass[finding.class] ?? 0) + 1;
    findingsBySeverity[finding.severity] = (findingsBySeverity[finding.severity] ?? 0) + 1;
  }

  return {
    tool: TOOL_NAME,
    version: VERSION,
    root: rootAbs,
    scannedDocs: docFiles,
    stats: {
      docsScanned: docFiles.length,
      linesScanned,
      referencesChecked,
      findingsByClass,
      findingsBySeverity,
    },
    findings,
  };
}

export function filterFailures(result, { failOn = DEFAULT_FAIL_ON, warningOnly = false } = {}) {
  if (warningOnly) return [];
  const wanted = new Set(failOn);
  return result.findings.filter((finding) => wanted.has(finding.class));
}

export function toJsonReport(result) {
  return `${JSON.stringify(
    {
      tool: result.tool,
      version: result.version,
      root: result.root,
      scannedDocs: result.scannedDocs,
      stats: result.stats,
      findings: result.findings,
    },
    null,
    2,
  )}\n`;
}

export function toMarkdownReport(result) {
  const lines = [];
  lines.push("# Docs Reality report");
  lines.push("");
  lines.push(`- Root: \`${result.root}\``);
  lines.push(`- Docs scanned: ${result.stats.docsScanned}${result.scannedDocs.length > 0 ? ` (${result.scannedDocs.join(", ")})` : ""}`);
  lines.push(`- References checked: ${result.stats.referencesChecked}`);
  const errors = result.stats.findingsBySeverity.error ?? 0;
  const infos = result.stats.findingsBySeverity.info ?? 0;
  lines.push(`- Findings: ${result.findings.length} (${errors} error, ${infos} info)`);
  lines.push("");
  if (result.findings.length === 0) {
    lines.push(`No drift found. ${result.stats.referencesChecked} reference(s) verified and left untouched — valid references are never rewritten.`);
    lines.push("");
  } else {
    lines.push("## Findings");
    lines.push("");
    for (const finding of result.findings) {
      const where = finding.line === null ? `\`${finding.doc}\` (repository fact)` : `\`${finding.doc}:${finding.line}\``;
      lines.push(`### ${finding.id} \`${finding.class}\` · ${finding.severity} — ${finding.reference}`);
      lines.push("");
      lines.push(`- Location: ${where} under "${finding.heading}"`);
      lines.push(`- Excerpt: \`${finding.excerpt.replace(/`/g, "'")}\``);
      lines.push(`- Evidence (${finding.evidence.method}): ${finding.evidence.detail}`);
      const suggestion = finding.suggestion;
      if (suggestion.startLine !== null && suggestion.startLine !== undefined) {
        lines.push(`- Suggestion (lines ${suggestion.startLine}–${suggestion.endLine} of \`${suggestion.file}\`): ${suggestion.guidance} ${suggestion.replacementPreview ?? ""}`.trim());
      } else {
        lines.push(`- Suggestion: ${suggestion.guidance} ${suggestion.replacementPreview ?? ""}`.trim());
      }
      lines.push("");
    }
  }
  lines.push("## Boundary note");
  lines.push("");
  lines.push("Agent-instruction files (AGENTS.md, .agents/, .muse/, .cursor/, .codex/, prompts/) are excluded by default. Instruction drift belongs to Rules Forge; Docs Reality covers user/developer documentation only. Pass --include-agent-files to override.");
  lines.push("");
  return `${lines.join("\n")}`;
}
