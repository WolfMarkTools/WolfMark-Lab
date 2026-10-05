# Stale Sample

A deliberately stale fixture repo for Docs Reality.

## Removed Widget

See [old tool](./tools/old-widget/README.md) and run `node scripts/removed.mjs`.

## Current Widget

See [cli](./scripts/cli.mjs) and run `node scripts/present.mjs` or `npm run test`.

Flags: `node scripts/cli.mjs --check` works, but `node scripts/cli.mjs --old-flag` was removed.

Config: set `keep_key` in `config/settings.json`; `old_key` no longer exists.

Install: `npm install left-pad` works; `npm install ghost-pkg-xyz` is stale.
