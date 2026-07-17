# LazyCodex Model Policy

> Make LazyCodex spawn the models you chose — and keep that choice after updates.

[Install](#install) · [Customise](#customise) · [How-it-works](#how-it-works) · [Doctor](#doctor)

## What this is

This is a small policy layer for [LazyCodex](https://github.com/code-yeongyu/lazycodex). It controls
only two things for LazyCodex subagents:

- which model is spawned;
- which reasoning level is used.

It does not provide the LazyCodex harness, workflows, skills, agent roles, or spawning behavior.
[LazyCodex is a prerequisite](https://lazycodex.ai/docs), and should be installed and working in
Codex first. LazyCodex is a light Codex port of the OmO agent harness for complex codebases; its
[official source is on GitHub](https://github.com/code-yeongyu/lazycodex).

## Why it exists

LazyCodex creates and updates agent configuration, but gives users limited ergonomic control over
the model and reasoning level assigned to each role. The shipped policy is an opinionated example
based on a capability-conscious setup. Some defaults are intentionally high, and may be too slow
or expensive for your work. Edit the JSON if you want a cheaper or faster policy.

The important part is persistence: a `PreToolUse` hook runs immediately before LazyCodex spawns a
subagent and reconciles the active agent TOMLs from your policy. A future LazyCodex update can
rewrite those files, but the next spawn repairs them before the child starts.

Already-running subagents are not changed. The policy applies to the next spawn.

## Install

### From the GitHub marketplace

```bash
codex plugin marketplace add WolfMarkTools/WolfMark-Lab
codex plugin add lazycodex-model-policy --marketplace wolfmark-lab
```

### From a checkout

```bash
git clone https://github.com/WolfMarkTools/WolfMark-Lab.git
cd WolfMark-Lab
node tools/lazycodex-model-policy/scripts/install.mjs
```

The installer copies the utility into `~/plugins`, registers the personal marketplace entry, and
installs the plugin through Codex. Start a new Codex task after installation so the hook and skill
are loaded.

If you are already in this repository, you can simply ask Codex:

> Install the LazyCodex Model Policy from this repository using its shipped defaults.

## Customise

Edit [`config/policy.json`](./config/policy.json). It is deliberately ordinary JSON: each named
agent has a `model` and `reasoning_effort`, and optional fallbacks repair unmanaged TOMLs.

For example, this changes the gate reviewer to Terra / XHigh:

```json
"lazycodex-gate-reviewer": {
  "model": "gpt-5.6-terra",
  "reasoning_effort": "xhigh"
}
```

Install a custom file from a checkout:

```bash
node tools/lazycodex-model-policy/scripts/install.mjs \
  --policy /absolute/path/to/policy.json
```

Or ask Codex:

> Set the LazyCodex executor to Luna / High, keep reviewers on Terra / XHigh, validate the policy,
> and install it.

The included Codex skill explains this flow and is available after the plugin is installed.

## Shipped example defaults

These are defaults, not requirements. Adjust them for your cost, latency, and quality needs.

| Agent group | Model / reasoning | Intent |
| --- | --- | --- |
| Executor, QA executor | Luna / High | Capable everyday implementation and validation |
| Worker low | Luna / Medium | Straightforward parallel work |
| Worker medium | Luna / High | Moderate implementation |
| Worker high | Sol / High | Harder worker tasks, capped below Sol / Max |
| Explorer, librarian | Luna / Low | Fast orientation and retrieval |
| Code and fidelity reviewers | Terra / XHigh | Deep correctness and fidelity checks |
| Gate reviewer | Terra / XHigh | Final cross-check before approval |
| Metis | Terra / High | Synthesis and delegation judgment |
| Momus | Terra / Ultra | Adversarial review |
| Plan | Terra / Max | Highest-complexity planning |

The example includes a fallback that converts an unmanaged Sol / Max assignment to Terra / Max.
This is a safety choice in the example policy; users can edit the fallback to suit their own rules.

## How it works

```text
LazyCodex update
       │
       ▼
agent TOMLs may drift
       │
       ▼
PreToolUse: spawn_agent
       │
       ▼
reconcile.mjs reads config/policy.json
       │
       ▼
active TOMLs are repaired before the child starts
```

There is no model-routing framework here. The hook is one small reconciliation step at the spawn
boundary, and the policy is one editable data file.

## Doctor and removal

Check the installation without changing anything:

```bash
node tools/lazycodex-model-policy/scripts/doctor.mjs
```

Remove the utility and its marketplace entry:

```bash
node tools/lazycodex-model-policy/scripts/uninstall.mjs
```

Uninstall deliberately leaves existing LazyCodex agent TOMLs unchanged.

## Requirements

- [Codex](https://github.com/openai/codex) installed and logged in;
- [LazyCodex](https://github.com/code-yeongyu/lazycodex) installed in Codex;
- Node.js on PATH.

## License

[MIT](./LICENSE)
