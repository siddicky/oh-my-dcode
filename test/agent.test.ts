import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDeepAgentConfig,
  resolveSubagents,
  resolveBackendDescriptor,
  bundledSkillsDir,
} from "../src/agent.ts";
import { ROSTER } from "../src/agents.ts";
import { resolveModelMap } from "../src/routing.ts";

test("buildDeepAgentConfig routes the supervisor to the opus tier", () => {
  const config = buildDeepAgentConfig();
  assert.equal(config.model, resolveModelMap().opus);
});

test("buildDeepAgentConfig resolves one subagent per roster agent with a model", () => {
  const config = buildDeepAgentConfig();
  assert.equal(config.subagents.length, ROSTER.length);
  for (const sub of config.subagents) {
    assert.ok(sub.name && sub.description && sub.systemPrompt);
    assert.match(sub.model, /:/); // provider:model form
  }
});

test("routing flows through to subagent models", () => {
  const balanced = buildDeepAgentConfig({ routing: "balanced" });
  const budget = buildDeepAgentConfig({ routing: "budget" });
  const architectBalanced = balanced.subagents.find((s) => s.name === "architect");
  const architectBudget = budget.subagents.find((s) => s.name === "architect");
  // architect is opus-tier: balanced -> opus model, budget -> sonnet model
  assert.equal(architectBalanced?.model, resolveModelMap({ routing: "balanced" }).opus);
  assert.equal(architectBudget?.model, resolveModelMap({ routing: "budget" }).opus);
  assert.notEqual(architectBalanced?.model, architectBudget?.model);
});

test("default backend is composite-filesystem over the workdir", () => {
  const config = buildDeepAgentConfig({ workdir: "/proj" });
  assert.equal(config.backend.kind, "composite-filesystem");
  assert.equal(config.backend.rootDir, "/proj");
  assert.equal(config.backend.virtualMode, true);
  assert.equal(config.backend.mount, "/workspace/");
});

test("backend choices map to descriptors", () => {
  assert.equal(
    resolveBackendDescriptor({ backend: "state" }, "/p").kind,
    "state",
  );
  const fs = resolveBackendDescriptor({ backend: "filesystem" }, "/p");
  assert.equal(fs.kind, "filesystem");
  assert.equal(fs.rootDir, "/p");
});

test("bundled skills dir is included and points at skills/", () => {
  const config = buildDeepAgentConfig();
  assert.ok(config.skills.length >= 1);
  assert.match(config.skills[0]!, /skills$/);
  assert.match(bundledSkillsDir(), /skills$/);
});

test("extra skill dirs and memory paths flow through", () => {
  const config = buildDeepAgentConfig({
    skillDirs: ["/extra/skills"],
    memoryPaths: ["/proj/AGENTS.md"],
  });
  assert.ok(config.skills.includes("/extra/skills"));
  assert.deepEqual(config.memory, ["/proj/AGENTS.md"]);
});

test("extraAgents override the roster size sanely", () => {
  const config = buildDeepAgentConfig({
    extraAgents: [
      {
        name: "translator",
        description: "translate",
        lane: "support",
        tier: "haiku",
        readOnly: false,
        systemPrompt: "translate things accurately",
      },
    ],
  });
  assert.equal(config.subagents.length, ROSTER.length + 1);
  assert.ok(config.subagents.find((s) => s.name === "translator"));
});

test("interruptOn defaults to empty and is overridable", () => {
  assert.deepEqual(buildDeepAgentConfig().interruptOn, {});
  assert.deepEqual(
    buildDeepAgentConfig({ interruptOn: { execute: true } }).interruptOn,
    { execute: true },
  );
});

test("buildDeepAgentConfig is hermetic: ambient OMD_MODEL_* never clobbers explicit models", () => {
  const prev = process.env.OMD_MODEL_OPUS;
  process.env.OMD_MODEL_OPUS = "anthropic:claude-from-env";
  try {
    const config = buildDeepAgentConfig({ models: { opus: "openai:explicit" } });
    // The explicit programmatic override wins; ambient env is ignored here.
    assert.equal(config.model, "openai:explicit");
  } finally {
    if (prev === undefined) delete process.env.OMD_MODEL_OPUS;
    else process.env.OMD_MODEL_OPUS = prev;
  }
});

test("resolveSubagents maps tiers to models", () => {
  const models = resolveModelMap();
  const subs = resolveSubagents(ROSTER, models);
  const writer = subs.find((s) => s.name === "writer");
  assert.equal(writer?.model, models.haiku); // writer is haiku-tier
});
