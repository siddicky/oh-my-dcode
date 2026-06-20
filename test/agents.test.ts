import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROSTER,
  getAgent,
  agentsByLane,
  composeRoster,
  assertUniqueNames,
} from "../src/agents.ts";
import type { AgentSpec } from "../src/types.ts";

test("roster has unique, kebab-case names", () => {
  assertUniqueNames([...ROSTER]);
  for (const agent of ROSTER) {
    assert.match(agent.name, /^[a-z][a-z0-9-]*$/, `bad name: ${agent.name}`);
  }
});

test("roster covers every OMC lane", () => {
  const lanes = new Set(ROSTER.map((a) => a.lane));
  for (const lane of ["research", "planning", "execution", "review", "support"]) {
    assert.ok(lanes.has(lane as AgentSpec["lane"]), `missing lane: ${lane}`);
  }
});

test("review, planning, and research agents are read-only (author/review separation)", () => {
  for (const agent of ROSTER) {
    if (["review", "planning", "research"].includes(agent.lane)) {
      assert.equal(agent.readOnly, true, `${agent.name} should be read-only`);
    }
  }
});

test("execution agents are writable", () => {
  const exec = agentsByLane("execution");
  assert.ok(exec.length > 0);
  for (const agent of exec) {
    assert.equal(agent.readOnly, false, `${agent.name} should be writable`);
  }
});

test("the core OMC agents are present", () => {
  for (const name of [
    "explore",
    "architect",
    "planner",
    "executor",
    "code-reviewer",
    "security-reviewer",
    "verifier",
  ]) {
    assert.ok(getAgent(name), `missing agent: ${name}`);
  }
});

test("deep-reasoning agents route to opus", () => {
  for (const name of ["architect", "planner", "critic", "code-reviewer"]) {
    assert.equal(getAgent(name)?.tier, "opus", `${name} should be opus tier`);
  }
});

test("every agent's system prompt is substantive", () => {
  for (const agent of ROSTER) {
    assert.ok(
      agent.systemPrompt.length > 120,
      `${agent.name} prompt too short`,
    );
  }
});

test("read-only agents carry the read-only instruction", () => {
  for (const agent of ROSTER.filter((a) => a.readOnly)) {
    assert.match(agent.systemPrompt, /READ-ONLY/, `${agent.name} missing note`);
  }
});

test("composeRoster appends new agents and overrides by name", () => {
  const custom: AgentSpec = {
    name: "executor",
    description: "custom executor",
    lane: "execution",
    tier: "opus",
    readOnly: false,
    systemPrompt: "custom",
  };
  const extra: AgentSpec = {
    name: "translator",
    description: "translate things",
    lane: "support",
    tier: "haiku",
    readOnly: false,
    systemPrompt: "translate",
  };
  const merged = composeRoster([custom, extra]);
  assert.equal(merged.length, ROSTER.length + 1);
  assert.equal(merged.find((a) => a.name === "executor")?.tier, "opus");
  assert.ok(merged.find((a) => a.name === "translator"));
});

test("assertUniqueNames throws on duplicates", () => {
  const dup: AgentSpec = {
    name: "explore",
    description: "dup",
    lane: "research",
    tier: "haiku",
    readOnly: true,
    systemPrompt: "x",
  };
  assert.throws(() => assertUniqueNames([...ROSTER, dup]), /Duplicate agent name/);
});
