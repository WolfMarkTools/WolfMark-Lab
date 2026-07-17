import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadPolicy, reconcile } from "../scripts/reconcile.mjs";

const agent = (name, model, effort) => `name = "${name}"\nmodel = "${model}"\nmodel_reasoning_effort = "${effort}"\n`;

test("reconcile repairs named agents and configured fallbacks idempotently", async () => {
  const codexHome = await mkdtemp(join(tmpdir(), "lazycodex-policy-"));
  const agentsDir = join(codexHome, "agents");
  await mkdir(agentsDir);
  await writeFile(join(agentsDir, "lazycodex-gate-reviewer.toml"), agent("lazycodex-gate-reviewer", "gpt-5.6-sol", "high"));
  await writeFile(join(agentsDir, "custom-worker.toml"), agent("custom-worker", "gpt-5.6-sol", "max"));

  try {
    const policy = await loadPolicy();
    const changed = await reconcile(policy, codexHome);
    assert.deepEqual(changed.sort(), ["custom-worker (fallback)", "lazycodex-gate-reviewer"].sort());
    assert.match(await readFile(join(agentsDir, "lazycodex-gate-reviewer.toml"), "utf8"), /model = "gpt-5.6-terra"[\s\S]*model_reasoning_effort = "xhigh"/);
    assert.match(await readFile(join(agentsDir, "custom-worker.toml"), "utf8"), /model = "gpt-5.6-terra"[\s\S]*model_reasoning_effort = "max"/);
    assert.deepEqual(await reconcile(policy, codexHome), []);
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
});

test("shipped policy preserves the example gate reviewer assignment", async () => {
  const policy = await loadPolicy();
  assert.deepEqual(policy.agents["lazycodex-gate-reviewer"], {
    model: "gpt-5.6-terra",
    reasoning_effort: "xhigh",
  });
});
