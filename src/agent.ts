/**
 * The Deep Agents adapter.
 *
 * {@link buildDeepAgentConfig} is pure: it resolves routing, composes the
 * roster, builds the supervisor prompt, and returns a plain object equivalent
 * to what `createDeepAgent` expects — fully inspectable and unit-testable with
 * no dependency on the `deepagents` package.
 *
 * {@link createOhMyDcode} is the thin runtime boundary: it calls the builder,
 * then dynamically imports `deepagents` to construct the live agent and its
 * filesystem backend. The dynamic import keeps the rest of the library usable
 * (and testable) without the heavy SDK installed.
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type {
  AgentSpec,
  BackendDescriptor,
  DeepAgentConfig,
  ModelMap,
  OhMyDcodeOptions,
  ResolvedSubagent,
} from "./types.ts";
import { composeRoster, resolveAgentModel } from "./agents.ts";
import { resolveModelMap, effectiveAdversarialModel } from "./routing.ts";
import { buildSupervisorPrompt } from "./prompts.ts";

/** Default HITL gating: none. Enable per-tool via `interruptOn` for approvals. */
const DEFAULT_INTERRUPT_ON: Record<string, boolean> = {};

/** Absolute path to the bundled `skills/` directory shipped with the package. */
export function bundledSkillsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // `here` is <pkg>/src in dev (ts) and <pkg>/dist after build; both sit one
  // level below the package root, where `skills/` lives.
  return join(here, "..", "skills");
}

/** Resolve the roster to Deep Agents subagent specs with concrete models. */
export function resolveSubagents(
  roster: readonly AgentSpec[],
  models: ModelMap,
  adversarialModel?: string | null,
): ResolvedSubagent[] {
  return roster.map((agent) => ({
    name: agent.name,
    description: agent.description,
    systemPrompt: agent.systemPrompt,
    model: resolveAgentModel(agent, models, adversarialModel),
  }));
}

/** Translate the high-level backend choice into a serializable descriptor. */
export function resolveBackendDescriptor(
  options: OhMyDcodeOptions,
  workdir: string,
): BackendDescriptor {
  switch (options.backend ?? "composite") {
    case "state":
      return { kind: "state" };
    case "filesystem":
      return { kind: "filesystem", rootDir: workdir, virtualMode: true };
    case "composite":
    // `default` also guards untrusted values that slipped past `isBackendKind`.
    default:
      return {
        kind: "composite-filesystem",
        rootDir: workdir,
        virtualMode: true,
        mount: "/workspace/",
      };
  }
}

/**
 * Pure builder: produce the full configuration for a Deep Agents agent from
 * oh-my-dcode options. No side effects, no SDK import — ideal for tests.
 */
export function buildDeepAgentConfig(
  options: OhMyDcodeOptions = {},
): DeepAgentConfig {
  const models = resolveModelMap({
    routing: options.routing,
    models: options.models,
  });
  const roster = composeRoster(options.extraAgents ?? []);
  const workdir = options.workdir ?? process.cwd();
  const adversarialModel = effectiveAdversarialModel(options.adversarialModel);

  const skills = [
    options.bundledSkillsDir ?? bundledSkillsDir(),
    ...(options.skillDirs ?? []),
  ];

  return {
    // The supervisor orchestrates — route it to the opus tier.
    model: models.opus,
    systemPrompt: buildSupervisorPrompt(roster, models, adversarialModel),
    subagents: resolveSubagents(roster, models, adversarialModel),
    skills,
    memory: options.memoryPaths ?? [],
    backend: resolveBackendDescriptor(options, workdir),
    interruptOn: options.interruptOn ?? DEFAULT_INTERRUPT_ON,
  };
}

// ---- runtime boundary (requires `deepagents`) -------------------------------

/** Minimal shape of the bits of the `deepagents` module we use. */
interface DeepAgentsModule {
  createDeepAgent: (config: Record<string, unknown>) => DeepAgent;
  StateBackend: new () => unknown;
  FilesystemBackend: new (opts: {
    rootDir: string;
    virtualMode?: boolean;
  }) => unknown;
  CompositeBackend: new (
    base: unknown,
    routes: Record<string, unknown>,
  ) => unknown;
}

/** Minimal shape of a constructed Deep Agents agent. */
export interface DeepAgent {
  invoke: (
    input: { messages: Array<{ role: string; content: string }> },
    config?: { configurable?: { threadId?: string } },
  ) => Promise<{ messages: Array<{ content?: unknown }> }>;
}

/** Load the `deepagents` SDK, with a clear error if it is not installed. */
async function loadDeepAgents(): Promise<DeepAgentsModule> {
  const moduleName = "deepagents";
  try {
    // Non-literal specifier: typed as `any`, so the core typechecks without
    // the SDK present. Cast to the minimal surface we rely on.
    return (await import(moduleName)) as unknown as DeepAgentsModule;
  } catch (err) {
    throw new Error(
      "oh-my-dcode requires the 'deepagents' package at runtime. " +
        "Install it with `npm install deepagents`. " +
        `Underlying error: ${(err as Error).message}`,
    );
  }
}

/** Construct the concrete backend instance from its descriptor. */
function instantiateBackend(
  dap: DeepAgentsModule,
  descriptor: BackendDescriptor,
): unknown {
  switch (descriptor.kind) {
    case "state":
      return new dap.StateBackend();
    case "filesystem":
      return new dap.FilesystemBackend({
        rootDir: descriptor.rootDir ?? process.cwd(),
        virtualMode: descriptor.virtualMode ?? true,
      });
    case "composite-filesystem":
      return new dap.CompositeBackend(new dap.StateBackend(), {
        [descriptor.mount ?? "/workspace/"]: new dap.FilesystemBackend({
          rootDir: descriptor.rootDir ?? process.cwd(),
          virtualMode: descriptor.virtualMode ?? true,
        }),
      });
    default: {
      // Exhaustiveness guard: a new BackendDescriptor.kind must be handled here
      // rather than silently returning undefined to createDeepAgent.
      const unreachable: never = descriptor.kind;
      throw new Error(`Unknown backend kind: ${String(unreachable)}`);
    }
  }
}

/**
 * Build a live oh-my-dcode agent on top of the Deep Agents SDK. Requires the
 * `deepagents` package and a configured model provider (e.g. `ANTHROPIC_API_KEY`).
 */
export async function createOhMyDcode(
  options: OhMyDcodeOptions = {},
): Promise<DeepAgent> {
  const config = buildDeepAgentConfig(options);
  const dap = await loadDeepAgents();
  const backend = instantiateBackend(dap, config.backend);

  return dap.createDeepAgent({
    model: config.model,
    systemPrompt: config.systemPrompt,
    subagents: config.subagents,
    skills: config.skills,
    memory: config.memory,
    backend,
    interruptOn: config.interruptOn,
  });
}
