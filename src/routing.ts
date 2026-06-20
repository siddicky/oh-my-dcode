/**
 * Model routing — the port of oh-my-claudecode's haiku/sonnet/opus routing.
 *
 * OMC routes work to a model tier by task weight (quick lookups → haiku,
 * standard → sonnet, architecture/deep analysis → opus) and exposes
 * premium/balanced/budget presets. This module reproduces that vocabulary in a
 * dependency-free, fully testable form.
 */

import type { ModelMap, ModelTier, RoutingPreset } from "./types.ts";
import { MODEL_TIERS } from "./types.ts";

/** Default concrete Anthropic model ids for each tier (provider:model form). */
export const DEFAULT_ANTHROPIC_MODELS: ModelMap = {
  haiku: "anthropic:claude-haiku-4-5-20251001",
  sonnet: "anthropic:claude-sonnet-4-6",
  opus: "anthropic:claude-opus-4-8",
};

/**
 * Default model for adversarial agents (critic, code-reviewer,
 * security-reviewer). Routing fault-finding to a different model family than
 * the one that produced the work decorrelates blind spots — the cross-model
 * critique idea behind OMC's multi-provider checks. Override or disable via
 * `OhMyDcodeOptions.adversarialModel`.
 */
export const DEFAULT_ADVERSARIAL_MODEL = "openai:gpt-5.5";

/**
 * Apply the adversarial-model default: an absent option (`undefined`) means
 * "use the built-in default" (`openai:gpt-5.5`); an explicit `null` disables the
 * override so adversarial agents route at their normal tier.
 */
export function effectiveAdversarialModel(
  adversarialModel: string | null | undefined,
): string | null {
  return adversarialModel === undefined
    ? DEFAULT_ADVERSARIAL_MODEL
    : adversarialModel;
}

/**
 * Routing presets, mirroring OMC's compatibility presets. Each preset maps the
 * three tiers to concrete models, trading capability for cost:
 *
 * - `premium`  — never drops below sonnet; deep work runs on opus.
 * - `balanced` — the OMC default: haiku / sonnet / opus by weight.
 * - `budget`   — collapses heavy work down a tier to save tokens.
 */
export const ROUTING_PRESETS: Record<RoutingPreset, ModelMap> = {
  premium: {
    haiku: DEFAULT_ANTHROPIC_MODELS.sonnet,
    sonnet: DEFAULT_ANTHROPIC_MODELS.sonnet,
    opus: DEFAULT_ANTHROPIC_MODELS.opus,
  },
  balanced: { ...DEFAULT_ANTHROPIC_MODELS },
  budget: {
    haiku: DEFAULT_ANTHROPIC_MODELS.haiku,
    sonnet: DEFAULT_ANTHROPIC_MODELS.haiku,
    opus: DEFAULT_ANTHROPIC_MODELS.sonnet,
  },
};

/** Type guard: is `value` one of the named routing presets? */
export function isRoutingPreset(value: unknown): value is RoutingPreset {
  return value === "premium" || value === "balanced" || value === "budget";
}

/**
 * Read tier overrides from the environment. Recognised variables:
 * `OMD_MODEL_HAIKU`, `OMD_MODEL_SONNET`, `OMD_MODEL_OPUS`. Each, when set,
 * replaces the model for that tier (full `provider:model` string).
 */
export function envModelOverrides(
  env: NodeJS.ProcessEnv = process.env,
): Partial<ModelMap> {
  const overrides: Partial<ModelMap> = {};
  for (const tier of MODEL_TIERS) {
    const raw = env[`OMD_MODEL_${tier.toUpperCase()}`];
    if (typeof raw === "string" && raw.trim() !== "") {
      overrides[tier] = raw.trim();
    }
  }
  return overrides;
}

/**
 * Build the effective tier→model map.
 *
 * Layering, lowest to highest precedence:
 *   1. the selected preset (or `balanced` when a partial map is given)
 *   2. an explicit partial map passed as `routing`
 *   3. `models` overrides
 *   4. environment overrides (`OMD_MODEL_*`) — only when `env` is passed
 *
 * The function is hermetic: it does NOT read `process.env` implicitly, so a
 * programmatic caller's `models` are never silently overridden by ambient env.
 * The `OMD_MODEL_*` layer is owned by the config layer ({@link ./config.ts}
 * `parseEnvConfig`), which folds env into `models` before this runs; pass `env`
 * here only if you want this function to apply env directly.
 *
 * Higher layers win per-tier; unspecified tiers fall through.
 */
export function resolveModelMap(opts: {
  routing?: RoutingPreset | Partial<ModelMap>;
  models?: Partial<ModelMap>;
  env?: NodeJS.ProcessEnv;
} = {}): ModelMap {
  const base: ModelMap = isRoutingPreset(opts.routing)
    ? { ...ROUTING_PRESETS[opts.routing] }
    : { ...ROUTING_PRESETS.balanced };

  const partialRouting = isRoutingPreset(opts.routing) ? undefined : opts.routing;

  return {
    ...base,
    ...clean(partialRouting),
    ...clean(opts.models),
    ...clean(opts.env ? envModelOverrides(opts.env) : undefined),
  };
}

/** Resolve a single tier to its concrete `provider:model` string. */
export function resolveModel(
  tier: ModelTier,
  opts: Parameters<typeof resolveModelMap>[0] = {},
): string {
  return resolveModelMap(opts)[tier];
}

/** Drop `undefined` values so partial maps merge cleanly via spread. */
function clean(map: Partial<ModelMap> | undefined): Partial<ModelMap> {
  if (!map) return {};
  const out: Partial<ModelMap> = {};
  for (const tier of MODEL_TIERS) {
    const value = map[tier];
    if (typeof value === "string" && value !== "") out[tier] = value;
  }
  return out;
}
