import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { getCodexHome, loadPolicy } from "./reconcile.mjs";

const ROOT = new URL("../", import.meta.url);
const pluginPath = (relativePath) => new URL(relativePath, ROOT);

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function listPlugins() {
  const result = spawnSync("codex", ["plugin", "list", "--available", "--json"], { encoding: "utf8", stdio: "pipe" });
  if (result.error || result.status !== 0) return null;
  try {
    const data = JSON.parse(result.stdout);
    return [...(data.installed ?? []), ...(data.available ?? [])];
  } catch {
    return null;
  }
}

async function main() {
  let failures = 0;
  process.stdout.write("LazyCodex Model Policy doctor\n\n");

  const codexVersion = spawnSync("codex", ["--version"], { encoding: "utf8", stdio: "pipe" });
  if (!codexVersion.error && codexVersion.status === 0) process.stdout.write("OK   Codex is available\n");
  else process.stdout.write("WARN Codex is not available on PATH\n");

  const plugins = listPlugins();
  const hasLazycodex = plugins?.some((plugin) => /lazycodex|omo/i.test(`${plugin.pluginId} ${plugin.name} ${plugin.marketplaceName}`));
  process.stdout.write(`${hasLazycodex ? "OK  " : "WARN"} LazyCodex/OmO prerequisite ${hasLazycodex ? "is discoverable" : "was not found"}\n`);
  if (!await exists(pluginPath(".codex-plugin/plugin.json"))) {
    process.stdout.write("FAIL Plugin manifest is missing\n");
    failures += 1;
  }
  if (!await exists(pluginPath("hooks/hooks.json"))) {
    process.stdout.write("FAIL Hook configuration is missing\n");
    failures += 1;
  }

  let policy;
  try {
    policy = await loadPolicy();
    process.stdout.write(`OK   Policy loaded with ${Object.keys(policy.agents).length} named agents\n`);
  } catch (error) {
    process.stdout.write(`FAIL ${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  const agentsDir = join(getCodexHome(), "agents");
  if (!await exists(agentsDir)) {
    process.stdout.write(`WARN No agent directory found at ${agentsDir}\n`);
    process.stdout.write("      Install LazyCodex first, then run this doctor again.\n");
    return;
  }

  for (const [agentName, assignment] of Object.entries(policy.agents)) {
    const path = join(agentsDir, `${agentName}.toml`);
    if (!await exists(path)) {
      process.stdout.write(`WARN ${agentName}: not installed\n`);
      continue;
    }
    const text = await readFile(path, "utf8");
    const model = text.match(/^model = "([^"]+)"$/m)?.[1];
    const effort = text.match(/^model_reasoning_effort = "([^"]+)"$/m)?.[1];
    const matches = model === assignment.model && effort === assignment.reasoning_effort;
    process.stdout.write(`${matches ? "OK  " : "DRIFT"} ${agentName}: ${model ?? "missing model"} / ${effort ?? "missing reasoning"}\n`);
    if (!matches) failures += 1;
  }

  const entries = await readdir(agentsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".toml")) continue;
    const agentName = entry.name.slice(0, -5);
    if (agentName in policy.agents) continue;
    const text = await readFile(join(agentsDir, entry.name), "utf8");
    if (text.includes('model = "gpt-5.6-sol"') && text.includes('model_reasoning_effort = "max"')) {
      process.stdout.write(`WARN ${agentName}: matches a configured fallback\n`);
    }
  }

  if (failures > 0) {
    process.stdout.write("\nRun node scripts/reconcile.mjs to apply the policy.\n");
    process.exitCode = 1;
  } else {
    process.stdout.write("\nPolicy doctor passed.\n");
  }
}

main().catch((error) => {
  process.stderr.write(`Doctor failed: ${error.message}\n`);
  process.exitCode = 1;
});
