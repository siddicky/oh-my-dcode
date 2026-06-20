/**
 * Configuration loading for oh-my-dcode.
 *
 * Resolves user options from three layers (lowest to highest precedence):
 *   1. built-in defaults
 *   2. a project config file at `.omd/config.json`
 *   3. environment variables (`OMD_*`)
 *
 * Parsing is split from disk I/O so the merge logic is unit-testable without a
 * filesystem: {@link parseFileConfig} normalizes an already-parsed object, and
 * {@link loadConfig} layers the file and environment on top.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelMap, OhMyDcodeOptions, RoutingPreset } from "./types.ts";
import { MODEL_TIERS } from "./types.ts";
import { isRoutingPreset } from "./routing.ts";

/** The default config-file location, relative to the working directory. */
export const CONFIG_RELATIVE_PATH = join(".omd", "config.json");

const BACKEND_KINDS = ["composite", "state", "filesystem"] as const;
type BackendKind = (typeof BACKEND_KINDS)[number];

/** Values that disable the adversarial-model override (route at normal tier). */
const DISABLE_TOKENS = new Set(["", "none", "off", "false", "disable"]);

function isBackendKind(value: unknown): value is BackendKind {
  return (
    value === "composite" || value === "state" || value === "filesystem"
  );
}

/**
 * Normalize an arbitrary parsed JSON value into a safe partial set of options.
 * Unknown keys are ignored; malformed values are dropped rather than trusted.
 */
export function parseFileConfig(raw: unknown): Partial<OhMyDcodeOptions> {
  if (raw === null || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const out: Partial<OhMyDcodeOptions> = {};

  if (isRoutingPreset(obj.routing)) {
    out.routing = obj.routing as RoutingPreset;
  } else {
    const map = parseModelMap(obj.routing);
    if (map) out.routing = map;
  }

  const models = parseModelMap(obj.models);
  if (models) out.models = models;

  // adversarialModel: a string sets the model; null/false disables the override.
  if (typeof obj.adversarialModel === "string" && obj.adversarialModel.trim() !== "") {
    out.adversarialModel = obj.adversarialModel.trim();
  } else if (obj.adversarialModel === null || obj.adversarialModel === false) {
    out.adversarialModel = null;
  }

  if (typeof obj.workdir === "string" && obj.workdir.trim() !== "") {
    out.workdir = obj.workdir;
  }

  if (isBackendKind(obj.backend)) out.backend = obj.backend;

  const interruptOn = parseBooleanMap(obj.interruptOn);
  if (interruptOn) out.interruptOn = interruptOn;

  const skillDirs = parseStringArray(obj.skillDirs);
  if (skillDirs) out.skillDirs = skillDirs;

  const memoryPaths = parseStringArray(obj.memoryPaths);
  if (memoryPaths) out.memoryPaths = memoryPaths;

  return out;
}

/** Pull option overrides from environment variables (`OMD_*`). */
export function parseEnvConfig(
  env: NodeJS.ProcessEnv = process.env,
): Partial<OhMyDcodeOptions> {
  const out: Partial<OhMyDcodeOptions> = {};

  if (isRoutingPreset(env.OMD_ROUTING)) {
    out.routing = env.OMD_ROUTING as RoutingPreset;
  }
  if (isBackendKind(env.OMD_BACKEND)) out.backend = env.OMD_BACKEND;
  if (typeof env.OMD_WORKDIR === "string" && env.OMD_WORKDIR.trim() !== "") {
    out.workdir = env.OMD_WORKDIR;
  }

  // OMD_ADVERSARIAL_MODEL: a model id, or one of none/off/false/"" to disable.
  if (typeof env.OMD_ADVERSARIAL_MODEL === "string") {
    const raw = env.OMD_ADVERSARIAL_MODEL.trim();
    out.adversarialModel = DISABLE_TOKENS.has(raw.toLowerCase()) ? null : raw;
  }

  // Per-tier model overrides also surface here so `models` reflects them.
  const models: Partial<ModelMap> = {};
  for (const tier of MODEL_TIERS) {
    const value = env[`OMD_MODEL_${tier.toUpperCase()}`];
    if (typeof value === "string" && value.trim() !== "") {
      models[tier] = value.trim();
    }
  }
  if (Object.keys(models).length > 0) out.models = models;

  return out;
}

/**
 * Merge two partial option sets, with `over` winning per key. Model maps are
 * merged at the tier level rather than replaced wholesale.
 */
export function mergeOptions(
  base: Partial<OhMyDcodeOptions>,
  over: Partial<OhMyDcodeOptions>,
): Partial<OhMyDcodeOptions> {
  const merged: Partial<OhMyDcodeOptions> = { ...base, ...over };

  // Merge `models` tier-by-tier so an override of one tier keeps the others.
  if (base.models || over.models) {
    merged.models = { ...base.models, ...over.models };
  }
  // `routing`, when both are partial maps, also merges tier-by-tier.
  if (
    base.routing &&
    over.routing &&
    typeof base.routing === "object" &&
    typeof over.routing === "object"
  ) {
    merged.routing = { ...base.routing, ...over.routing };
  }
  if (base.interruptOn || over.interruptOn) {
    merged.interruptOn = { ...base.interruptOn, ...over.interruptOn };
  }
  return merged;
}

/**
 * Load and resolve options for a working directory: read `.omd/config.json`
 * (if present) and layer environment overrides on top. Missing file is not an
 * error; a malformed file throws with a clear message.
 */
export function loadConfig(
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): Partial<OhMyDcodeOptions> {
  const filePath = join(cwd, CONFIG_RELATIVE_PATH);
  let fileConfig: Partial<OhMyDcodeOptions> = {};

  let text: string | undefined;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  if (text !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(
        `Invalid JSON in ${filePath}: ${(err as Error).message}`,
      );
    }
    fileConfig = parseFileConfig(parsed);
  }

  return mergeOptions(fileConfig, parseEnvConfig(env));
}

// ---- small validators -------------------------------------------------------

function parseModelMap(value: unknown): Partial<ModelMap> | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  const out: Partial<ModelMap> = {};
  for (const tier of MODEL_TIERS) {
    const v = obj[tier];
    if (typeof v === "string" && v.trim() !== "") out[tier] = v.trim();
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseBooleanMap(
  value: unknown,
): Record<string, boolean> | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  const out: Record<string, boolean> = {};
  for (const [key, v] of Object.entries(obj)) {
    if (typeof v === "boolean") out[key] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter(
    (v): v is string => typeof v === "string" && v.trim() !== "",
  );
  return out.length > 0 ? out : undefined;
}
