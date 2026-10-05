# WolfMark Labs

Small, practical tools for making AI-assisted work more controllable.

## Tools

### WolfMarkDown

WolfMarkDown has moved to its dedicated repository: [WolfMarkTools/WolfMarkDown](https://github.com/WolfMarkTools/WolfMarkDown).

### [LazyCodex Model Policy](./tools/lazycodex-model-policy/)

Keep LazyCodex subagents on an explicit model and reasoning policy, even when LazyCodex updates
rewrite its agent configuration.

```bash
node tools/lazycodex-model-policy/scripts/install.mjs
```

The tool is a policy layer, not a replacement for [LazyCodex](https://github.com/code-yeongyu/lazycodex).
LazyCodex must already be installed in Codex.

## Skills

Agent skills installable with [skills.sh](https://skills.sh).

List the available skills without installing:

```bash
npx skills add WolfMarkTools/WolfMark-Lab -l -y --full-depth
```

Install an individual skill (same mechanism for each skill below):

```bash
npx skills add WolfMarkTools/WolfMark-Lab -s <skill-name> -y --full-depth
```

### [Evidence Before Completion](./skills/evidence-before-completion/SKILL.md)

Stop coding agents claiming work is complete, fixed, passing, or ready
without evidence. The skill maps each common completion claim to the minimum
observation that earns it, expires receipts on the next material edit, and
requires final messages to separate verified results from unverified
assumptions, including what to report when full verification is not possible.
Works with any coding agent.

```bash
npx skills add WolfMarkTools/WolfMark-Lab -s evidence-before-completion -y --full-depth
```

### [Respect Explicit Boundaries](./skills/respect-explicit-boundaries/SKILL.md)

Keep explicit user boundaries in force until they are explicitly revoked.
A later ambiguous instruction is never treated as permission to cross an
earlier prohibition: when plausible readings require materially different
levels of authority, the skill requires acting inside the boundary and asking
before any step that would cross it. Covers merging, publishing, deploying,
deleting, spending, and other external-state or approval-gated actions.
Works with any coding agent.

```bash
npx skills add WolfMarkTools/WolfMark-Lab -s respect-explicit-boundaries -y --full-depth
```

### [LazyCodex Model Policy](./tools/lazycodex-model-policy/skills/lazycodex-model-policy/SKILL.md)

Install, inspect, customise, repair, or remove the LazyCodex model and
reasoning policy. Codex-only: [LazyCodex](https://github.com/code-yeongyu/lazycodex)
must already be installed in Codex. Installing the skill this way provides
the skill text; the do-it-for-you hook layer is installed through the Codex
plugin route described in the [tool README](./tools/lazycodex-model-policy/README.md).

```bash
npx skills add WolfMarkTools/WolfMark-Lab -s lazycodex-model-policy -y --full-depth
```

## License

WolfMark Lab is released under the [MIT License](./LICENSE).
