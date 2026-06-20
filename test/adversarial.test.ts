import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  ROSTER,
  isAdversarial,
  resolveAgentModel,
  getAgent,
} from "../src/agents.ts";
import {
  DEFAULT_ADVERSARIAL_MODEL,
  effectiveAdversarialModel,
  resolveModelMap,
} from "../src/routing.ts";
import { buildDeepAgentConfig } from "../src/agent.ts";
import { buildSupervisorPrompt } from "../src/prompts.ts";
import { planScaffold } from "../src/scaffold.ts";
import { parseFileConfig, parseEnvConfig } from "../src/config.ts";

const ADVERSARIAL = ["critic", "code-reviewer", "security-reviewer"];
const models = resolveModelMap();

test("the default adversarial model is OpenAI gpt-5.5", () => {
  assert.equal(DEFAULT_ADVERSARIAL_MODEL, "openai:gpt-5.5");
});

test("exactly the fault-finding agents are marked adversarial", () => {
  const flagged = ROSTER.filter(isAdversarial).map((a) => a.name).sort();
  assert.deepEqual(flagged, [...ADVERSARIAL].sort());
});

test("adversarial agents are read-only review agents", () => {
  for (const name of ADVERSARIAL) {
    const agent = getAgent(name)!;
    assert.equal(agent.lane, "review");
    assert.equal(agent.readOnly, true);
  }
});

test("resolveAgentModel overrides only adversarial agents", () => {
  const critic = getAgent("critic")!;
  const executor = getAgent("executor")!;
  assert.equal(resolveAgentModel(critic, models, "openai:gpt-5.5"), "openai:gpt-5.5");
  assert.equal(resolveAgentModel(executor, models, "openai:gpt-5.5"), models.sonnet);
});

test("resolveAgentModel with null/undefined leaves adversarial agents on tier", () => {
  const critic = getAgent("critic")!;
  assert.equal(resolveAgentModel(critic, models, null), models.opus);
  assert.equal(resolveAgentModel(critic, models, undefined), models.opus);
});

test("effectiveAdversarialModel: absent -> default, null -> disabled", () => {
  assert.equal(effectiveAdversarialModel(undefined), "openai:gpt-5.5");
  assert.equal(effectiveAdversarialModel(null), null);
  assert.equal(effectiveAdversarialModel("openai:gpt-6"), "openai:gpt-6");
});

test("buildDeepAgentConfig routes adversarial agents to gpt-5.5 by default", () => {
  const config = buildDeepAgentConfig();
  for (const name of ADVERSARIAL) {
    const sub = config.subagents.find((s) => s.name === name);
    assert.equal(sub?.model, "openai:gpt-5.5", `${name} should be on gpt-5.5`);
  }
  // Non-adversarial opus agent stays on the Anthropic opus model.
  assert.equal(
    config.subagents.find((s) => s.name === "architect")?.model,
    models.opus,
  );
});

test("adversarialModel can be overridden and disabled", () => {
  const overridden = buildDeepAgentConfig({ adversarialModel: "openai:gpt-6" });
  assert.equal(
    overridden.subagents.find((s) => s.name === "critic")?.model,
    "openai:gpt-6",
  );

  const disabled = buildDeepAgentConfig({ adversarialModel: null });
  assert.equal(
    disabled.subagents.find((s) => s.name === "critic")?.model,
    models.opus, // back to its opus tier
  );
});

test("adversarial routing respects the routing preset when disabled", () => {
  const budgetDisabled = buildDeepAgentConfig({
    routing: "budget",
    adversarialModel: null,
  });
  // critic is opus-tier; budget maps opus -> sonnet model
  assert.equal(
    budgetDisabled.subagents.find((s) => s.name === "critic")?.model,
    resolveModelMap({ routing: "budget" }).opus,
  );
});

test("supervisor prompt explains cross-model review when enabled", () => {
  const withAdv = buildSupervisorPrompt(ROSTER, models, "openai:gpt-5.5");
  assert.match(withAdv, /ADVERSARIAL CROSS-MODEL REVIEW/);
  assert.match(withAdv, /openai:gpt-5\.5/);

  const without = buildSupervisorPrompt(ROSTER, models, null);
  assert.ok(!without.includes("ADVERSARIAL CROSS-MODEL REVIEW"));
});

test("scaffold writes gpt-5.5 into adversarial agents' frontmatter", () => {
  const entries = planScaffold();
  const critic = entries.find((e) =>
    e.path.endsWith(join("agents", "critic", "AGENTS.md")),
  );
  assert.match(critic!.content, /model: openai:gpt-5\.5/);
  // executor (non-adversarial) keeps its tier model
  const executor = entries.find((e) =>
    e.path.endsWith(join("agents", "executor", "AGENTS.md")),
  );
  assert.match(executor!.content, /model: anthropic:claude-sonnet-4-6/);
});

test("config parses adversarialModel from file and env (incl. disable)", () => {
  assert.equal(parseFileConfig({ adversarialModel: "openai:gpt-6" }).adversarialModel, "openai:gpt-6");
  assert.equal(parseFileConfig({ adversarialModel: null }).adversarialModel, null);
  assert.equal(parseFileConfig({ adversarialModel: false }).adversarialModel, null);

  assert.equal(
    parseEnvConfig({ OMD_ADVERSARIAL_MODEL: "openai:gpt-6" } as NodeJS.ProcessEnv).adversarialModel,
    "openai:gpt-6",
  );
  assert.equal(
    parseEnvConfig({ OMD_ADVERSARIAL_MODEL: "none" } as NodeJS.ProcessEnv).adversarialModel,
    null,
  );
});
