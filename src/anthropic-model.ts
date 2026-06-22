/**
 * The single construction site for OAuth-authenticated Anthropic models.
 *
 * When a user logs in with a Claude Code subscription ({@link ./auth.ts}), the
 * agent boundary replaces each `anthropic:*` model string with a `ChatAnthropic`
 * instance built here — carrying the OAuth bearer token and beta header, and
 * deliberately *no* api key so `x-api-key` is never sent. Isolating the
 * construction keeps the one uncertain SDK surface (`clientOptions`) in a single
 * place to adjust.
 */

import { loadOptionalModule } from "./load.ts";
import { OAUTH_BETA_HEADER } from "./auth.ts";

/** Minimal shape of the `@langchain/anthropic` surface we use. */
interface AnthropicModule {
  ChatAnthropic: new (fields: Record<string, unknown>) => unknown;
}

/** True when a `provider:model` spec routes to the Anthropic provider. */
export function isAnthropicSpec(spec: string): boolean {
  return spec.split(":")[0] === "anthropic";
}

/** Strip the `provider:` prefix, returning the bare model id. */
export function stripProvider(spec: string): string {
  const idx = spec.indexOf(":");
  return idx === -1 ? spec : spec.slice(idx + 1);
}

/**
 * Build a `ChatAnthropic` instance authenticated by an OAuth bearer token.
 *
 * No `apiKey`/`anthropicApiKey` is set, so the underlying `@anthropic-ai/sdk`
 * client sends no `x-api-key`. `clientOptions.authToken` makes it send
 * `Authorization: Bearer …`; `Authorization` is also set in `defaultHeaders` as
 * a belt-and-braces fallback in case a given SDK version doesn't thread
 * `authToken` through. The `anthropic-beta` header enables OAuth-token
 * inference.
 *
 * @param modelId Bare model id (no `anthropic:` prefix), e.g. `claude-opus-4-8`.
 * @param accessToken OAuth bearer token used for Anthropic requests.
 * @param loadModule Seam for injecting a fake `@langchain/anthropic` in tests;
 *   defaults to the real runtime-only loader.
 */
export async function buildAnthropicChatModel(
  modelId: string,
  accessToken: string,
  loadModule: () => Promise<AnthropicModule> = () =>
    loadOptionalModule<AnthropicModule>(
      "@langchain/anthropic",
      "Claude subscription OAuth requires the '@langchain/anthropic' package. " +
        "Install it with `npm install @langchain/anthropic`.",
    ),
): Promise<unknown> {
  const mod = await loadModule();
  return new mod.ChatAnthropic({
    model: modelId,
    clientOptions: {
      authToken: accessToken,
      defaultHeaders: {
        Authorization: `Bearer ${accessToken}`,
        "anthropic-beta": OAUTH_BETA_HEADER,
      },
    },
  });
}
