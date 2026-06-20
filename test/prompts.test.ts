import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OPERATING_PRINCIPLES,
  DELEGATION_RULES,
  renderRosterDirectory,
  buildSupervisorPrompt,
  buildAgentsMd,
} from "../src/prompts.ts";
import { ROSTER } from "../src/agents.ts";
import { resolveModelMap } from "../src/routing.ts";

const models = resolveModelMap();

test("supervisor prompt encodes principles, rules, and discipline", () => {
  const prompt = buildSupervisorPrompt(ROSTER, models);
  assert.match(prompt, /OPERATING PRINCIPLES/);
  assert.match(prompt, /DELEGATION RULES/);
  assert.match(prompt, /VERIFICATION DISCIPLINE/);
  assert.match(prompt, /never the one that approves it/);
  for (const principle of OPERATING_PRINCIPLES) {
    assert.ok(prompt.includes(principle), "missing a principle");
  }
  for (const rule of DELEGATION_RULES) {
    assert.ok(prompt.includes(rule), "missing a delegation rule");
  }
});

test("supervisor prompt lists every agent with its resolved model", () => {
  const prompt = buildSupervisorPrompt(ROSTER, models);
  for (const agent of ROSTER) {
    assert.ok(prompt.includes(agent.name), `missing ${agent.name}`);
  }
  assert.ok(prompt.includes(models.opus), "missing opus model id");
});

test("roster directory groups by lane and marks read-only agents", () => {
  const directory = renderRosterDirectory(ROSTER, models);
  assert.match(directory, /RESEARCH/);
  assert.match(directory, /EXECUTION/);
  assert.match(directory, /REVIEW/);
  assert.match(directory, /read-only/);
});

test("AGENTS.md memory body restates the discipline", () => {
  const md = buildAgentsMd();
  assert.match(md, /# oh-my-dcode/);
  assert.match(md, /Operating principles/);
  assert.match(md, /Delegation rules/);
  assert.match(md, /Verification discipline/);
});
