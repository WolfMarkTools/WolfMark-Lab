---
name: docs-reality
description: Use when documentation may have drifted from the code, before trusting README or docs references to commands, files, flags, config keys, packages, or workflows, and after removing or renaming public behaviour.
---

# Docs Reality

Docs drift. Check them against the repository before trusting them, and fix
drift with minimal, evidence-backed edits — never broad rewrites.

## 1. Run the checker, read the evidence

From the repository root:

```bash
node tools/docs-reality/scripts/docs-reality.mjs --format markdown
```

For CI or scripts, use the JSON report:

```bash
node tools/docs-reality/scripts/docs-reality.mjs --format json --check
```

Every finding carries provenance: the doc file and line, the exact excerpt,
and the repository evidence that conflicts with it (missing file, absent
npm script, flag not found in the documented command target, unknown config
key or package). Trust a finding only through its evidence. A claim without
repository grounding is not a finding — do not act on it.

## 2. Fix minimally, one region at a time

Each finding proposes a correction scoped to a single line or section:

- Update the stale reference to the real file, command, flag, key, package,
  or workflow — or delete the line when the behaviour is genuinely gone.
- Touch only the affected region. Do not reword surrounding prose, reformat
  the file, or "improve" valid references nearby.
- A valid current reference is never rewritten for style. If the checker is
  silent about a line, leave that line alone.

Ghost documentation — a section whose every reference points at removed
behaviour — is flagged as one `ghost-doc` finding: remove or rewrite the
whole section rather than patching its lines one by one.

Undocumented behaviour (`undocumented`, info severity) points the other way:
a script, binary, or make target exists but no doc mentions it. Document it
briefly or confirm it is not public.

## 3. Respect the Rules Forge boundary

Docs Reality covers user and developer documentation: READMEs, guides,
`docs/`, CLI help, config examples. It excludes agent-instruction files by
default — `AGENTS.md`, `.agents/`, `.muse/`, `.cursor/`, `.codex/`,
`prompts/` — because instruction drift belongs to Rules Forge.

- Do not use Docs Reality findings to rewrite agent instructions.
- Do not use Rules Forge to lint user docs.
- Only pass `--include-agent-files` when explicitly asked to audit both, and
  say so in the report.

## 4. Verify and report

After editing, re-run the checker and confirm the finding count drops to
zero (or to the accepted baseline). Report per finding: what was stale, what
evidence proved it, and the exact lines changed. Name anything left
unverified and the command that would close the gap.

The work is done when every error-class finding is fixed or explicitly
accepted, every edit is limited to its finding's region, and no valid
reference was touched.
