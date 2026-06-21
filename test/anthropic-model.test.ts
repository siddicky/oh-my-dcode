import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isAnthropicSpec,
  stripProvider,
  buildAnthropicChatModel,
} from "../src/anthropic-model.ts";

test("isAnthropicSpec recognizes the anthropic provider only", () => {
  assert.equal(isAnthropicSpec("anthropic:claude-opus-4-8"), true);
  assert.equal(isAnthropicSpec("openai:gpt-5.5"), false);
  assert.equal(isAnthropicSpec("openrouter:anthropic/claude-opus-4-8"), false);
});

test("stripProvider drops the provider prefix", () => {
  assert.equal(stripProvider("anthropic:claude-opus-4-8"), "claude-opus-4-8");
  // Only the first colon is the provider separator.
  assert.equal(stripProvider("openrouter:anthropic/claude-opus-4-8"), "anthropic/claude-opus-4-8");
  assert.equal(stripProvider("bare-model"), "bare-model");
});

test("buildAnthropicChatModel surfaces a clear install hint when @langchain/anthropic is absent", async () => {
  // The package is not installed in this repo's dev deps, so construction must
  // fail with an actionable message rather than an opaque module-not-found.
  await assert.rejects(
    () => buildAnthropicChatModel("claude-opus-4-8", "tok"),
    /@langchain\/anthropic/,
  );
});
