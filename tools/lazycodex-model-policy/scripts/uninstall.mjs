import { readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const HOME = homedir();
const DESTINATION = join(HOME, "plugins", "lazycodex-model-policy");
const MARKETPLACE_PATH = join(HOME, ".agents", "plugins", "marketplace.json");

function removeFromCodex() {
  const result = spawnSync("codex", ["plugin", "remove", "lazycodex-model-policy@personal"], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`codex plugin remove exited with status ${result.status}`);
}

async function removeFromMarketplace() {
  let marketplace;
  try {
    marketplace = JSON.parse(await readFile(MARKETPLACE_PATH, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  marketplace.plugins = (marketplace.plugins ?? []).filter((plugin) => plugin.name !== "lazycodex-model-policy");
  await writeFile(MARKETPLACE_PATH, `${JSON.stringify(marketplace, null, 2)}\n`, "utf8");
}

async function main() {
  removeFromCodex();
  await removeFromMarketplace();
  await rm(DESTINATION, { recursive: true, force: true });
  process.stdout.write("Uninstalled LazyCodex Model Policy. Existing agent TOMLs were left unchanged.\n");
}

main().catch((error) => {
  process.stderr.write(`Uninstall failed: ${error.message}\n`);
  process.exitCode = 1;
});
