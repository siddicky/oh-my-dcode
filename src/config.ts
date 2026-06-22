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
import type {
  McpServerSpec,
  ModelMap,
  ModelTier,
  OhMyDcodeOptions,
  RoutingPreset,
} from "./types.ts";
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

/** Validate an auth mode (`oauth`/`api-key`); undefined when unrecognized. */
function parseAuthMode(value: unknown): OhMyDcodeOptions["auth"] | undefined {
  return value === "oauth" || value === "api-key" ? value : undefined;
}

/**
 * Normalize an arbitrary parsed JSON value into a safe partial set of options.
 * Unknown keys are ignored; malformed values are dropped rather than trusted.
 */
export function parseFileConfig(raw: unknown): Partial<OhMyDcodeOptions> {
  if (raw === null || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const out: Partial<OhMyDcodeOptions> = {};

  const auth = parseAuthMode(obj.auth);
  if (auth !== undefined) out.auth = auth;

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

  const recursionLimit = parsePositiveInt(obj.recursionLimit);
  if (recursionLimit !== undefined) out.recursionLimit = recursionLimit;

  const modelRetries = parseRetries(obj.modelRetries);
  if (modelRetries !== undefined) out.modelRetries = modelRetries;

  const toolRetries = parseRetries(obj.toolRetries);
  if (toolRetries !== undefined) out.toolRetries = toolRetries;

  // Rubric self-evaluation: cap follows the same retry semantics (0/null/token
  // disables); grader tier is a model tier; the tool switches are booleans.
  const rubricMaxIterations = parseRetries(obj.rubricMaxIterations);
  if (rubricMaxIterations !== undefined) out.rubricMaxIterations = rubricMaxIterations;

  const rubricGraderTier = parseTier(obj.rubricGraderTier);
  if (rubricGraderTier !== undefined) out.rubricGraderTier = rubricGraderTier;

  if (typeof obj.graderTools === "boolean") out.graderTools = obj.graderTools;
  if (typeof obj.graderShellTool === "boolean") out.graderShellTool = obj.graderShellTool;

  const graderMcpServers = parseMcpServers(obj.graderMcpServers);
  if (graderMcpServers !== undefined) out.graderMcpServers = graderMcpServers;

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

  const auth = parseAuthMode(env.OMD_AUTH);
  if (auth !== undefined) out.auth = auth;

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

  const recursionLimit = parsePositiveInt(env.OMD_RECURSION_LIMIT);
  if (recursionLimit !== undefined) out.recursionLimit = recursionLimit;

  const modelRetries = parseRetries(env.OMD_MODEL_RETRIES);
  if (modelRetries !== undefined) out.modelRetries = modelRetries;

  const toolRetries = parseRetries(env.OMD_TOOL_RETRIES);
  if (toolRetries !== undefined) out.toolRetries = toolRetries;

  const rubricMaxIterations = parseRetries(env.OMD_RUBRIC_MAX_ITERATIONS);
  if (rubricMaxIterations !== undefined) out.rubricMaxIterations = rubricMaxIterations;

  const rubricGraderTier = parseTier(env.OMD_RUBRIC_GRADER_TIER);
  if (rubricGraderTier !== undefined) out.rubricGraderTier = rubricGraderTier;

  const graderTools = parseBoolean(env.OMD_GRADER_TOOLS);
  if (graderTools !== undefined) out.graderTools = graderTools;

  const graderShellTool = parseBoolean(env.OMD_GRADER_SHELL_TOOL);
  if (graderShellTool !== undefined) out.graderShellTool = graderShellTool;

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

/**
 * Parse a strictly positive integer from a number or numeric string (used for
 * `recursionLimit`). Returns `undefined` when absent or invalid.
 */
function parsePositiveInt(value: unknown): number | undefined {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/**
 * Parse a retry count: a non-negative integer enables that many retries; an
 * explicit `null`/`false` or a disable token (`none`/`off`/…) disables retries
 * (returns `null`). Returns `undefined` when absent or invalid (leave default).
 */
function parseRetries(value: unknown): number | null | undefined {
  if (value === null || value === false) return null;
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 ? value : undefined;
  }
  if (typeof value === "string") {
    const raw = value.trim();
    if (DISABLE_TOKENS.has(raw.toLowerCase())) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : undefined;
  }
  return undefined;
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter(
    (v): v is string => typeof v === "string" && v.trim() !== "",
  );
  return out.length > 0 ? out : undefined;
}

/** Validate a model tier (`haiku`/`sonnet`/`opus`); undefined when invalid. */
function parseTier(value: unknown): ModelTier | undefined {
  return typeof value === "string" &&
    (MODEL_TIERS as readonly string[]).includes(value)
    ? (value as ModelTier)
    : undefined;
}

/**
 * Parse a boolean from a real boolean or a common truthy/falsy string
 * (`true`/`false`, `1`/`0`, `yes`/`no`, `on`/`off`). Returns `undefined` when
 * absent or unrecognized, so an unset value leaves the default in place.
 */
function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const raw = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(raw)) return true;
  if (["false", "0", "no", "off"].includes(raw)) return false;
  return undefined;
}

/**
 * Validate an array of MCP server specs from parsed JSON. Each entry needs a
 * non-empty `name` and a `stdio` or `http` transport; malformed entries are
 * dropped. Returns `undefined` when nothing valid is present (leave default).
 */
function parseMcpServers(value: unknown): McpServerSpec[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: McpServerSpec[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    if (typeof o.name !== "string" || o.name.trim() === "") continue;
    if (o.transport !== "stdio" && o.transport !== "http") continue;
    if (o.transport === "http" && (typeof o.url !== "string" || o.url.trim() === "")) continue;
    if (o.transport === "stdio" && (typeof o.command !== "string" || o.command.trim() === "")) continue;
    const spec: McpServerSpec = { name: o.name, transport: o.transport };
    if (typeof o.command === "string") spec.command = o.command;
    if (typeof o.url === "string") spec.url = o.url;
    const args = parseStringArray(o.args);
    if (args) spec.args = args;
    if (o.env !== null && typeof o.env === "object") {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(o.env as Record<string, unknown>)) {
        if (typeof v === "string") env[k] = v;
      }
      if (Object.keys(env).length > 0) spec.env = env;
    }
    out.push(spec);
  }
  return out.length > 0 ? out : undefined;
}
