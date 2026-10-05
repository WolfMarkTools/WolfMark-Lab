# Docs Reality

> Compare documented commands, files, flags, config keys, packages and
> workflows against repository reality — and propose minimal corrections.

Docs Reality is a lightweight, agent-assisted documentation drift checker:
a local CLI plus an [Agent Skill](../../skills/docs-reality/SKILL.md), with an
optional CI check. It has zero dependencies and needs no MCP server.

## Quick start

No install step. From a WolfMark-Lab checkout:

```bash
node tools/docs-reality/scripts/docs-reality.mjs --format markdown
```

Point it at another repo with `--root`, or scope it to specific docs:

```bash
node tools/docs-reality/scripts/docs-reality.mjs --root <path-to-project> --docs README.md,docs
```

A deliberately stale example lives in
[`tests/fixtures/stale-sample/`](./tests/fixtures/stale-sample/):

```bash
node tools/docs-reality/scripts/docs-reality.mjs --root tools/docs-reality/tests/fixtures/stale-sample
```

## What it checks

| Class | What it means | Authority (evidence) |
| --- | --- | --- |
| `broken-file-ref` | A linked or code-quoted path does not exist | File existence |
| `broken-command` | A documented `node <file>` target does not exist | File existence |
| `stale-flag` | A flag shown with `node <file>` is absent from that file | Literal search in the command target |
| `stale-config-key` | A documented config key is absent from repo JSON | Keys of all repo `*.json` files |
| `stale-package` | A documented install/require is not a declared dependency | `package.json` dependencies |
| `stale-workflow` | A documented `npm run <script>` / `make <target>` does not exist | `package.json` scripts / `Makefile` |
| `ghost-doc` | Every file/command reference under one heading is broken | Aggregate of the above |
| `undocumented` | A script, binary or make target is never mentioned in docs | Docs-corpus search (info severity) |

Every finding records provenance: doc file, line, excerpt, heading, the
conflicting reference, and the repository evidence. A claim without
repository grounding is never emitted — detectors with no authority (no
`package.json`, no JSON config, no Makefile, unresolvable command target)
stay silent instead of guessing.

Valid references are never rewritten. The checker proposes corrections only
for drift, each scoped to the affected line or section.

## Reports

- `--format markdown` (default): human-readable report on stdout.
- `--format json`: machine-readable report on stdout, for CI review.
- `--format both --out <dir>`: writes `docs-reality.json` and
  `docs-reality.md` into `<dir>` for CI artefacts and human review.
- `--out <path>` with a single format writes that report to a file.

## CI usage

Fail the build on drift:

```bash
node tools/docs-reality/scripts/docs-reality.mjs --check --format json --out reports/
```

Start warning-only while a backlog is triaged:

```bash
node tools/docs-reality/scripts/docs-reality.mjs --check --warning-only
```

Fail only on selected classes:

```bash
node tools/docs-reality/scripts/docs-reality.mjs --check --fail-on broken-file-ref,broken-command
```

Exit codes: `0` clean (or warning-only), `2` drift found in `--check` mode,
`1` usage or IO error. A JSON config file
([example](./config/example-config.json)) can carry the same settings via
`--config`; CLI flags override it.

## Minimal corrections

Each finding's `suggestion` names one file and one line range — usually a
single line — with guidance such as "remove this line" or "did you mean"
hints drawn from existing repo files. Ghost sections get one section-level
suggestion instead of per-line patches. The CLI never edits your docs; apply
the suggestions by hand or through the Agent Skill, then re-run to confirm
the count drops.

## Boundary with Rules Forge

Docs Reality and Rules Forge split documentation drift by audience so the
two tools never lint the same files:

| | Docs Reality (this tool) | Rules Forge |
| --- | --- | --- |
| Owns | User/developer docs: READMEs, guides, `docs/`, CLI help, config examples | Agent instructions: `AGENTS.md`, `.agents/`, `.muse/`, `.cursor/`, `.codex/`, `prompts/` |
| Detects | Broken/stale references against repo facts | Stale or contradictory agent instructions |
| Default | Excludes instruction paths | Excludes user docs |

`--include-agent-files` overrides the exclusion when an explicit audit of
both is wanted.

## Limitations

- Flags are checked only when documented alongside a resolvable
  `node <file>` invocation (or an `npm run <script>` whose body runs one) on
  the same line; bare flag mentions and other runtimes are out of scope.
- Home-directory paths (`~`, `$HOME`), globs (`*`) and placeholders (`<...>`, `...`) are
  not treated as file references: they cannot be resolved against the repo.
- Single-segment filenames in prose (`` `policy.json` `` with no directory)
  are not treated as file references; links always are.
- `npx <tool>` one-shot invocations are not package-checked: they usually
  are not declared dependencies, so there is no grounding.
- Markdown links, code spans and commands are parsed heuristically; unusual
  formatting may be missed rather than misflagged (precision over recall).

## Requirements

- Node.js on PATH. No packages to install, no network, no MCP.

## License

[MIT](../../LICENSE)
