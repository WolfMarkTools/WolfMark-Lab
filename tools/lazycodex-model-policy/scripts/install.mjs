import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadPolicy } from "./reconcile.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = dirname(SCRIPT_DIR);
const HOME = homedir();
const DESTINATION = join(HOME, "plugins", "lazycodex-model-policy");
const MARKETPLACE_PATH = join(HOME, ".agents", "plugins", "marketplace.json");

function printHelp() {
  process.stdout.write(`Install LazyCodex Model Policy\n\nUsage: node scripts/install.mjs [--policy path/to/policy.json]\n\nCopies this utility to ~/plugins, registers it in the personal Codex marketplace, and installs it.\nUse --policy to install a customised policy file instead of the shipped example.\n`);
}

function parseArgs(args) {
  if (args.includes("--help")) return { help: true };
  const policyIndex = args.indexOf("--policy");
  if (policyIndex === -1) return {};
  const policyPath = args[policyIndex + 1];
  if (!policyPath || args.length !== 2) throw new Error("--policy requires the only additional argument, a JSON file path");
  return { policyPath: resolve(policyPath) };
}

async function updateMarketplace() {
  await mkdir(dirname(MARKETPLACE_PATH), { recursive: true });
  let marketplace = { name: "personal", interface: { displayName: "Personal" }, plugins: [] };
  try {
    marketplace = JSON.parse(await readFile(MARKETPLACE_PATH, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
  const entry = {
    name: "lazycodex-model-policy",
    source: { source: "local", path: "./plugins/lazycodex-model-policy" },
    policy: { installation: "INSTALLED_BY_DEFAULT", authentication: "ON_INSTALL" },
    category: "Productivity",
  };
  const index = plugins.findIndex((plugin) => plugin.name === entry.name);
  if (index === -1) plugins.push(entry);
  else plugins[index] = { ...plugins[index], ...entry };
  marketplace.plugins = plugins;
  await writeFile(MARKETPLACE_PATH, `${JSON.stringify(marketplace, null, 2)}\n`, "utf8");
}

function installWithCodex() {
  const result = spawnSync("codex", ["plugin", "add", "lazycodex-model-policy@personal"], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`codex plugin add exited with status ${result.status}`);
}

function reconcileNow() {
  const result = spawnSync(process.execPath, [join(DESTINATION, "scripts", "reconcile.mjs")], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`reconcile.mjs exited with status ${result.status}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return printHelp();
  if (options.policyPath) await loadPolicy(options.policyPath);

  if (resolve(SOURCE_ROOT) !== resolve(DESTINATION)) {
    await cp(SOURCE_ROOT, DESTINATION, { recursive: true, force: true });
  }
  await mkdir(process.env.CODEX_HOME ?? join(HOME, ".codex"), { recursive: true });
  if (options.policyPath) {
    await cp(options.policyPath, join(DESTINATION, "config", "policy.json"), { force: true });
  }
  await updateMarketplace();
  installWithCodex();
  reconcileNow();
  process.stdout.write("Installed LazyCodex Model Policy. Start a new Codex task to load the updated hook and skill.\n");
}

main().catch((error) => {
  process.stderr.write(`Install failed: ${error.message}\n`);
  process.exitCode = 1;
});
