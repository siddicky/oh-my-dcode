/**
 * Generate the bundled `skills/<name>/SKILL.md` files from the canonical specs
 * in `src/skills.ts`. Run with: `node --experimental-strip-types scripts/gen-skills.ts`
 *
 * The committed files are the bytes the Deep Agents SDK and the `dcode` CLI
 * load; `test/skills.test.ts` asserts they stay in sync with the specs.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SKILLS, renderSkillMarkdown } from "../src/skills.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillsDir = join(root, "skills");

for (const skill of SKILLS) {
  const dir = join(skillsDir, skill.name);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "SKILL.md");
  writeFileSync(file, renderSkillMarkdown(skill), "utf8");
  console.log(`wrote ${file}`);
}

console.log(`\nGenerated ${SKILLS.length} skill file(s).`);
