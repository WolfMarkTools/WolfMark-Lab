---
name: lazycodex-model-policy
description: Install, inspect, or customise the LazyCodex model and reasoning policy.
---

# LazyCodex Model Policy

Use this skill when the user asks to install, inspect, customise, repair, or remove the
LazyCodex Model Policy utility.

## Scope

This utility is only the policy layer. It controls the model and reasoning level written to
LazyCodex subagent TOMLs immediately before a spawn. LazyCodex itself is a prerequisite and
provides the harness, roles, workflows, hooks, and subagent spawning behavior.

## Install

From the repository checkout, run:

```bash
node tools/lazycodex-model-policy/scripts/install.mjs
```

For a custom policy file:

```bash
node tools/lazycodex-model-policy/scripts/install.mjs --policy /absolute/path/to/policy.json
```

After installation, tell the user to start a new Codex task so the updated plugin is loaded.

## Customise

Read `tools/lazycodex-model-policy/config/policy.json` and explain the current role assignments.
When the user requests a change, edit only that JSON policy, validate it, and run the installer.
Keep the policy deliberately small. Do not add new routing layers or rewrite LazyCodex.

## Inspect and repair

Run:

```bash
node tools/lazycodex-model-policy/scripts/doctor.mjs
```

If the doctor reports drift, run `node tools/lazycodex-model-policy/scripts/reconcile.mjs`.
Do not edit `~/.codex/agents/*.toml` by hand unless the user explicitly asks for a one-off
diagnostic change.

## Remove

Run:

```bash
node tools/lazycodex-model-policy/scripts/uninstall.mjs
```

The uninstall script removes this utility and its marketplace entry but deliberately leaves
existing agent TOMLs unchanged.
