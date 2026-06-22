import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isAnthropicSpec,
  stripProvider,
  buildAnthropicChatModel,
} from "../src/anthropic-model.ts";
import { OAUTH_BETA_HEADER } from "../src/auth.ts";

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

test("buildAnthropicChatModel passes the OAuth bearer token and never an api key", async () => {
  // Inject a fake ChatAnthropic via the loader seam so we assert exactly which
  // fields the OAuth construction site passes — independent of the real SDK's
  // credential requirements and without touching process.env.
  let captured: Record<string, unknown> | undefined;
  const fakeModule = {
    ChatAnthropic: class {
      constructor(fields: Record<string, unknown>) {
        captured = fields;
      }
    },
  };

  await buildAnthropicChatModel("claude-opus-4-8", "tok", async () => fakeModule);

  assert.ok(captured, "ChatAnthropic should have been constructed");
  assert.equal(captured.model, "claude-opus-4-8");
  // No api key is passed, so the SDK never sends x-api-key on the OAuth path.
  assert.equal("apiKey" in captured, false);
  assert.equal("anthropicApiKey" in captured, false);

  const clientOptions = captured.clientOptions as {
    authToken?: string;
    defaultHeaders?: Record<string, string>;
  };
  assert.equal(clientOptions.authToken, "tok");
  assert.equal(clientOptions.defaultHeaders?.Authorization, "Bearer tok");
  assert.equal(clientOptions.defaultHeaders?.["anthropic-beta"], OAUTH_BETA_HEADER);
});
