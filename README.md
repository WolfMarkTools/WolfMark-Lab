# WolfMark Lab

Small, practical tools for making AI-assisted work more controllable.

## Tools

### [LazyCodex Model Policy](./tools/lazycodex-model-policy/)

Keep LazyCodex subagents on an explicit model and reasoning policy, even when LazyCodex updates
rewrite its agent configuration.

```bash
node tools/lazycodex-model-policy/scripts/install.mjs
```

The tool is a policy layer, not a replacement for [LazyCodex](https://github.com/code-yeongyu/lazycodex).
LazyCodex must already be installed in Codex.
