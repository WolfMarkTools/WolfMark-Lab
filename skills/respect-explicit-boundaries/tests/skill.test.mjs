import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../..", import.meta.url);
const skill = await readFile(new URL("skills/respect-explicit-boundaries/SKILL.md", root), "utf8");
const readme = await readFile(new URL("README.md", root), "utf8");
const existing = await readFile(new URL("skills/evidence-before-completion/SKILL.md", root), "utf8");

const frontmatter = (text) => {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, "SKILL.md must start with YAML frontmatter");
  return Object.fromEntries(
    match[1].split("\n").map((line) => {
      const i = line.indexOf(":");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }),
  );
};

test("skill has valid name/description metadata for skills.sh discovery", () => {
  const meta = frontmatter(skill);
  assert.equal(meta.name, "respect-explicit-boundaries");
  assert.ok(meta.description.length > 0, "description must be non-empty");
  assert.match(meta.description, /merg|publish|deploy|delet|spend|approval/i);
});

test("existing public skill remains intact and installable", () => {
  const meta = frontmatter(existing);
  assert.equal(meta.name, "evidence-before-completion");
  assert.ok(meta.description.length > 0);
});

test("motivating case: ambiguous 'on main' is not permission to merge", () => {
  assert.match(skill, /do not merge/i);
  assert.match(skill, /on `main`|on main/i);
  assert.match(skill, /not .*revocation|never permission|must \*\*not\*\* be interpreted/i);
});

test("ambiguous escalation requires asking, not silently choosing higher authority", () => {
  assert.match(skill, /higher-authority/i);
  assert.match(skill, /ask/i);
  assert.match(skill, /explicit/i);
});

test("behaviour generalises beyond Git to other external-state actions", () => {
  for (const action of ["publish", "deploy", "delet", "spend"]) {
    assert.match(skill, new RegExp(action, "i"), `skill must cover ${action}`);
  }
});

test("README lists the skill with the common install method", () => {
  assert.match(readme, /respect-explicit-boundaries/);
  assert.match(
    readme,
    /npx skills add WolfMarkTools\/WolfMark-Lab -s respect-explicit-boundaries -y --full-depth/,
  );
});
