import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ANTHROPIC_MODELS,
  ROUTING_PRESETS,
  isRoutingPreset,
  envModelOverrides,
  resolveModelMap,
  resolveModel,
} from "../src/routing.ts";

test("balanced preset is the OMC default tier mapping", () => {
  assert.deepEqual(ROUTING_PRESETS.balanced, DEFAULT_ANTHROPIC_MODELS);
});

test("premium never drops below sonnet, budget collapses heavy work down", () => {
  assert.equal(ROUTING_PRESETS.premium.haiku, DEFAULT_ANTHROPIC_MODELS.sonnet);
  assert.equal(ROUTING_PRESETS.premium.opus, DEFAULT_ANTHROPIC_MODELS.opus);
  assert.equal(ROUTING_PRESETS.budget.sonnet, DEFAULT_ANTHROPIC_MODELS.haiku);
  assert.equal(ROUTING_PRESETS.budget.opus, DEFAULT_ANTHROPIC_MODELS.sonnet);
});

test("isRoutingPreset accepts known presets and rejects others", () => {
  assert.ok(isRoutingPreset("premium"));
  assert.ok(isRoutingPreset("balanced"));
  assert.ok(isRoutingPreset("budget"));
  assert.ok(!isRoutingPreset("turbo"));
  assert.ok(!isRoutingPreset(undefined));
  assert.ok(!isRoutingPreset({ haiku: "x" }));
});

test("resolveModelMap defaults to balanced", () => {
  assert.deepEqual(resolveModelMap(), DEFAULT_ANTHROPIC_MODELS);
});

test("resolveModelMap selects a named preset", () => {
  assert.deepEqual(resolveModelMap({ routing: "budget" }), ROUTING_PRESETS.budget);
});

test("a partial routing map merges over balanced", () => {
  const map = resolveModelMap({ routing: { opus: "openai:gpt-5.5" } });
  assert.equal(map.opus, "openai:gpt-5.5");
  assert.equal(map.sonnet, DEFAULT_ANTHROPIC_MODELS.sonnet);
});

test("models overrides win over the routing preset", () => {
  const map = resolveModelMap({
    routing: "premium",
    models: { haiku: "ollama:devstral-2" },
  });
  assert.equal(map.haiku, "ollama:devstral-2");
  assert.equal(map.opus, ROUTING_PRESETS.premium.opus);
});

test("env overrides win over everything and ignore blanks", () => {
  const env = {
    OMD_MODEL_OPUS: "anthropic:claude-opus-next",
    OMD_MODEL_SONNET: "   ",
  } as NodeJS.ProcessEnv;
  const map = resolveModelMap({ routing: "balanced", env });
  assert.equal(map.opus, "anthropic:claude-opus-next");
  assert.equal(map.sonnet, DEFAULT_ANTHROPIC_MODELS.sonnet);
});

test("envModelOverrides reads only the three tier variables", () => {
  const env = {
    OMD_MODEL_HAIKU: "p:h",
    OMD_MODEL_SONNET: "p:s",
    OMD_MODEL_OPUS: "p:o",
    OMD_MODEL_OTHER: "ignored",
  } as NodeJS.ProcessEnv;
  assert.deepEqual(envModelOverrides(env), {
    haiku: "p:h",
    sonnet: "p:s",
    opus: "p:o",
  });
});

test("resolveModel returns a single tier's model", () => {
  assert.equal(resolveModel("opus"), DEFAULT_ANTHROPIC_MODELS.opus);
  assert.equal(
    resolveModel("haiku", { routing: "premium" }),
    ROUTING_PRESETS.premium.haiku,
  );
});
