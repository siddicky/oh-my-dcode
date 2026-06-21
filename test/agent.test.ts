import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDeepAgentConfig,
  resolveSubagents,
  resolveBackendDescriptor,
  resolveMiddlewareDescriptors,
  applyInvokeDefaults,
  bundledSkillsDir,
  DEFAULT_MODEL_RETRIES,
  DEFAULT_TOOL_RETRIES,
  DEFAULT_RUBRIC_MAX_ITERATIONS,
  DEFAULT_GRADER_MCP_SERVERS,
  RUBRIC_GRADER_SYSTEM_PROMPT,
  DEFAULT_RECURSION_LIMIT,
} from "../src/agent.ts";
import { ROSTER } from "../src/agents.ts";
import { resolveModelMap } from "../src/routing.ts";

/** The rubric descriptor `buildDeepAgentConfig` emits by default. */
function defaultRubricDescriptor(
  models = resolveModelMap(),
  overrides: Record<string, unknown> = {},
) {
  return {
    kind: "rubric",
    model: models.haiku,
    systemPrompt: RUBRIC_GRADER_SYSTEM_PROMPT,
    maxIterations: DEFAULT_RUBRIC_MAX_ITERATIONS,
    mcpServers: DEFAULT_GRADER_MCP_SERVERS,
    shellTool: true,
    ...overrides,
  };
}

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

test("default config installs model-retry and the rubric grader (tool retries opt-in)", () => {
  const config = buildDeepAgentConfig();
  // Tool retries are off by default: tool calls may have side effects.
  assert.equal(DEFAULT_TOOL_RETRIES, 0);
  // The rubric grader is installed by default (dormant until a rubric is passed).
  assert.deepEqual(config.middleware, [
    { kind: "model-retry", maxRetries: DEFAULT_MODEL_RETRIES },
    defaultRubricDescriptor(),
  ]);
  assert.equal(config.recursionLimit, DEFAULT_RECURSION_LIMIT);
  // A delegating supervisor needs headroom above LangGraph's default of 25.
  assert.ok(config.recursionLimit > 25);
});

test("retry counts are configurable; tool retries are opt-in", () => {
  const models = resolveModelMap();
  // Model retries default on, tool retries default off; rubric default on.
  assert.deepEqual(resolveMiddlewareDescriptors({ modelRetries: 5 }, models), [
    { kind: "model-retry", maxRetries: 5 },
    defaultRubricDescriptor(models),
  ]);
  // Opting tool retries in adds the second layer.
  assert.deepEqual(resolveMiddlewareDescriptors({ toolRetries: 3 }, models), [
    { kind: "model-retry", maxRetries: DEFAULT_MODEL_RETRIES },
    { kind: "tool-retry", maxRetries: 3 },
    defaultRubricDescriptor(models),
  ]);
  // 0/null disables the model layer too (rubric still present).
  assert.deepEqual(resolveMiddlewareDescriptors({ modelRetries: 0 }, models), [
    defaultRubricDescriptor(models),
  ]);
  assert.deepEqual(resolveMiddlewareDescriptors({ modelRetries: null }, models), [
    defaultRubricDescriptor(models),
  ]);
});

test("the rubric grader is omitted when no model map is supplied", () => {
  // The descriptor needs a concrete grader model, so a bare call emits none.
  assert.deepEqual(resolveMiddlewareDescriptors({ modelRetries: 1 }), [
    { kind: "model-retry", maxRetries: 1 },
  ]);
});

test("rubricMaxIterations 0/null disables the rubric grader entirely", () => {
  const models = resolveModelMap();
  assert.deepEqual(
    resolveMiddlewareDescriptors({ modelRetries: 0, rubricMaxIterations: 0 }, models),
    [],
  );
  assert.deepEqual(
    resolveMiddlewareDescriptors({ modelRetries: 0, rubricMaxIterations: null }, models),
    [],
  );
  assert.ok(
    !buildDeepAgentConfig({ rubricMaxIterations: 0 }).middleware.some(
      (m) => m.kind === "rubric",
    ),
  );
});

test("rubricMaxIterations flows into the grader cap", () => {
  const rubric = buildDeepAgentConfig({ rubricMaxIterations: 7 }).middleware.find(
    (m) => m.kind === "rubric",
  );
  assert.equal(rubric?.kind === "rubric" && rubric.maxIterations, 7);
});

test("rubricGraderTier routes the grader to that tier's model", () => {
  const models = resolveModelMap();
  const rubric = buildDeepAgentConfig({ rubricGraderTier: "sonnet" }).middleware.find(
    (m) => m.kind === "rubric",
  );
  assert.equal(rubric?.kind === "rubric" && rubric.model, models.sonnet);
});

test("graderTools:false strips the grader's MCP servers and shell tool", () => {
  const rubric = buildDeepAgentConfig({ graderTools: false }).middleware.find(
    (m) => m.kind === "rubric",
  );
  assert.ok(rubric?.kind === "rubric");
  assert.deepEqual(rubric.mcpServers, []);
  assert.equal(rubric.shellTool, false);
});

test("graderShellTool and graderMcpServers are configurable", () => {
  const servers = [
    { name: "playwright", transport: "stdio" as const, command: "npx", args: ["@playwright/mcp"] },
  ];
  const rubric = buildDeepAgentConfig({
    graderShellTool: false,
    graderMcpServers: servers,
  }).middleware.find((m) => m.kind === "rubric");
  assert.ok(rubric?.kind === "rubric");
  assert.equal(rubric.shellTool, false);
  assert.deepEqual(rubric.mcpServers, servers);
});

test("recursionLimit option flows into the config", () => {
  assert.equal(buildDeepAgentConfig({ recursionLimit: 250 }).recursionLimit, 250);
});

test("applyInvokeDefaults supplies recursionLimit only when caller omits it", () => {
  assert.deepEqual(applyInvokeDefaults(undefined, 100), { recursionLimit: 100 });
  // Caller's explicit limit wins; configurable/context are preserved.
  assert.deepEqual(
    applyInvokeDefaults(
      { recursionLimit: 10, configurable: { thread_id: "t1" } },
      100,
    ),
    { recursionLimit: 10, configurable: { thread_id: "t1" } },
  );
  assert.deepEqual(
    applyInvokeDefaults({ configurable: { thread_id: "t2" } }, 100),
    { recursionLimit: 100, configurable: { thread_id: "t2" } },
  );
});

test("applyInvokeDefaults normalizes the deprecated threadId alias to thread_id", () => {
  assert.deepEqual(
    applyInvokeDefaults({ configurable: { threadId: "legacy" } }, 100),
    { recursionLimit: 100, configurable: { thread_id: "legacy" } },
  );
  // An explicit snake_case thread_id wins over the deprecated alias.
  assert.deepEqual(
    applyInvokeDefaults(
      { configurable: { thread_id: "canonical", threadId: "legacy" } },
      100,
    ),
    { recursionLimit: 100, configurable: { thread_id: "canonical" } },
  );
});

test("resolveSubagents maps tiers to models", () => {
  const models = resolveModelMap();
  const subs = resolveSubagents(ROSTER, models);
  const writer = subs.find((s) => s.name === "writer");
  assert.equal(writer?.model, models.haiku); // writer is haiku-tier
});
