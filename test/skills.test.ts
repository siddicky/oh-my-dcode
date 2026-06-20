import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SKILLS, getSkill, renderSkillMarkdown } from "../src/skills.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("the five OMC Tier-0 workflows are present", () => {
  for (const name of ["autopilot", "ralph", "ultrawork", "team", "ralplan"]) {
    assert.ok(getSkill(name), `missing workflow: ${name}`);
  }
});

test("the gajae-code pipeline workflows are present", () => {
  for (const name of ["deep-interview", "ultragoal", "deepship"]) {
    assert.ok(getSkill(name), `missing workflow: ${name}`);
  }
});

test("each skill has triggers and a substantive body", () => {
  for (const skill of SKILLS) {
    assert.ok(skill.triggers.length > 0, `${skill.name} has no triggers`);
    assert.ok(skill.body.length > 200, `${skill.name} body too short`);
  }
});

test("rendered skill markdown carries valid front-matter", () => {
  for (const skill of SKILLS) {
    const md = renderSkillMarkdown(skill);
    assert.match(md, /^---\n/);
    assert.ok(md.includes(`name: ${skill.name}`));
    assert.ok(md.includes(`description: ${skill.description}`));
    assert.ok(md.includes("triggers: ["));
  }
});

test("bundled skills/<name>/SKILL.md files are in sync with the specs", () => {
  // Guards against drift between src/skills.ts and the generated files that
  // the Deep Agents SDK and the dcode CLI actually load.
  for (const skill of SKILLS) {
    const file = join(root, "skills", skill.name, "SKILL.md");
    const onDisk = readFileSync(file, "utf8");
    assert.equal(
      onDisk,
      renderSkillMarkdown(skill),
      `${skill.name}/SKILL.md is stale — run \`npm run -s gen:skills\``,
    );
  }
});

test("skill bodies reference roster agents by name", () => {
  // Workflows orchestrate the roster; their bodies should name real agents.
  const autopilot = getSkill("autopilot");
  assert.ok(autopilot);
  for (const name of ["analyst", "architect", "planner", "verifier", "code-reviewer"]) {
    assert.ok(autopilot.body.includes(name), `autopilot should mention ${name}`);
  }
});

test("deep-interview and ultragoal bodies reference roster agents", () => {
  const deepInterview = getSkill("deep-interview");
  assert.ok(deepInterview);
  for (const name of ["analyst", "explore", "architect", "critic", "code-simplifier"]) {
    assert.ok(deepInterview.body.includes(name), `deep-interview should mention ${name}`);
  }

  const ultragoal = getSkill("ultragoal");
  assert.ok(ultragoal);
  for (const name of ["planner", "verifier", "code-reviewer", "code-simplifier"]) {
    assert.ok(ultragoal.body.includes(name), `ultragoal should mention ${name}`);
  }
});

test("deepship chains the four pipeline phases by name", () => {
  const deepship = getSkill("deepship");
  assert.ok(deepship);
  for (const phase of ["deep-interview", "ralplan", "ultragoal", "team"]) {
    assert.ok(deepship.body.includes(phase), `deepship should chain ${phase}`);
  }
});
