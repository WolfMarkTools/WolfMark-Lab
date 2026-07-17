import { readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = dirname(SCRIPT_DIR);
const DEFAULT_CONFIG_PATH = join(PLUGIN_ROOT, "config", "policy.json");

export function getCodexHome() {
  return process.env.CODEX_HOME ?? join(homedir(), ".codex");
}

export async function loadPolicy(configPath = process.env.LAZYCODEX_MODEL_POLICY_CONFIG ?? DEFAULT_CONFIG_PATH) {
  const policy = JSON.parse(await readFile(configPath, "utf8"));
  validatePolicy(policy, configPath);
  return policy;
}

function validatePolicy(policy, configPath) {
  if (policy?.version !== 1 || !policy.agents || typeof policy.agents !== "object") {
    throw new Error(`Invalid LazyCodex policy in ${configPath}: expected version 1 and an agents object`);
  }

  for (const [agentName, assignment] of Object.entries(policy.agents)) {
    if (!assignment || typeof assignment.model !== "string" || typeof assignment.reasoning_effort !== "string") {
      throw new Error(`Invalid assignment for ${agentName} in ${configPath}`);
    }
  }

  for (const fallback of policy.fallbacks ?? []) {
    if (!fallback?.when || !fallback.replace_with) {
      throw new Error(`Invalid fallback in ${configPath}: expected when and replace_with`);
    }
    for (const side of [fallback.when, fallback.replace_with]) {
      if (typeof side.model !== "string" || typeof side.reasoning_effort !== "string") {
        throw new Error(`Invalid fallback assignment in ${configPath}`);
      }
    }
  }
}

function replaceSetting(text, key, value) {
  const pattern = new RegExp(`^${key} = ".*"$`, "m");
  if (!pattern.test(text)) return null;
  return text.replace(pattern, `${key} = "${value}"`);
}

function applyAssignment(text, assignment) {
  const nextModel = replaceSetting(text, "model", assignment.model);
  return nextModel === null ? null : replaceSetting(nextModel, "model_reasoning_effort", assignment.reasoning_effort);
}

async function readAgent(path, agentName) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }

  if (!new RegExp(`^name = "${agentName}"$`, "m").test(text)) {
    throw new Error(`Unexpected agent identity in ${path}`);
  }
  return text;
}

export async function reconcile(policy, codexHome = getCodexHome()) {
  policy ??= await loadPolicy();
  const changed = [];
  const agentsDir = join(codexHome, "agents");

  for (const [agentName, assignment] of Object.entries(policy.agents)) {
    const path = join(agentsDir, `${agentName}.toml`);
    const text = await readAgent(path, agentName);
    if (text === null) continue;

    const next = applyAssignment(text, assignment);
    if (next === null || next === text) continue;
    await writeFile(path, next, "utf8");
    changed.push(agentName);
  }

  let entries;
  try {
    entries = await readdir(agentsDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return changed;
    throw error;
  }

  const managedAgents = new Set(Object.keys(policy.agents));
  for (const fallback of policy.fallbacks ?? []) {
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".toml")) continue;
      const agentName = entry.name.slice(0, -5);
      if (managedAgents.has(agentName)) continue;

      const path = join(agentsDir, entry.name);
      const text = await readFile(path, "utf8");
      const matches = new RegExp(
        `^model = "${fallback.when.model}"$[\\s\\S]*^model_reasoning_effort = "${fallback.when.reasoning_effort}"$`,
        "m",
      ).test(text);
      if (!matches) continue;

      const next = applyAssignment(text, fallback.replace_with);
      if (next === null || next === text) continue;
      await writeFile(path, next, "utf8");
      changed.push(`${agentName} (fallback)`);
    }
  }

  return changed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const changed = await reconcile();
  if (changed.length > 0) process.stdout.write(`Updated LazyCodex model policy: ${changed.join(", ")}\n`);
}
