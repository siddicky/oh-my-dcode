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
  FilesystemPermission,
  InterpreterMiddlewareDescriptor,
  InvokeConfig,
  InvokeInput,
  McpServerSpec,
  MiddlewareDescriptor,
  ModelMap,
  ModelTier,
  OhMyDcodeOptions,
  ResolvedSubagent,
  RubricMiddlewareDescriptor,
} from "./types.ts";
import { composeRoster, resolveAgentModel } from "./agents.ts";
import { resolveModelMap, effectiveAdversarialModel } from "./routing.ts";
import { buildSupervisorPrompt } from "./prompts.ts";
import { loadOptionalModule } from "./load.ts";
import { getValidAccessToken } from "./auth.ts";
import {
  buildAnthropicChatModel,
  isAnthropicSpec,
  stripProvider,
} from "./anthropic-model.ts";

/** Default HITL gating: none. Enable per-tool via `interruptOn` for approvals. */
const DEFAULT_INTERRUPT_ON: Record<string, boolean> = {};

/**
 * Default retry attempts for model calls. Re-issuing a failed model call has no
 * side effects, so this is safe to enable by default and guards against rate
 * limits and transient errors.
 */
export const DEFAULT_MODEL_RETRIES = 2;

/**
 * Default retry attempts for tool calls. Off by default: the built-in tools
 * include non-idempotent operations (`execute`, `write_file`, `delete_file`),
 * and retrying a call that partially applied could repeat side effects. Opt in
 * with `toolRetries` only when your tools are safe to re-run.
 */
export const DEFAULT_TOOL_RETRIES = 0;

/**
 * Default cap on the rubric grader's self-evaluate→revise cycles. Three rounds
 * balance output quality against the cost and latency of re-grading; cheap to
 * tune via `rubricMaxIterations`.
 */
export const DEFAULT_RUBRIC_MAX_ITERATIONS = 3;

/** Default model tier for the rubric grader: cheap, high-volume scoring work. */
export const DEFAULT_RUBRIC_GRADER_TIER: ModelTier = "haiku";

/**
 * The code interpreter is installed by default. It only adds a sandboxed `eval`
 * tool (and the `task()` fan-out global); the supervisor decides whether to use
 * it, so installing it has no cost until a workflow reaches for it.
 */
export const DEFAULT_INTERPRETER_ENABLED = true;

/**
 * Default programmatic-tool-calling (PTC) allowlist for the interpreter sandbox:
 * the read-only filesystem tools. These let `eval` inspect the workspace
 * (locate files, read excerpts, grep) without ever mutating it.
 */
export const DEFAULT_INTERPRETER_PTC: readonly string[] = [
  "ls",
  "read_file",
  "glob",
  "grep",
];

/**
 * Tools that must never be exposed to the interpreter sandbox via PTC. The
 * sandbox runs untrusted, model-authored JavaScript; granting it a mutating or
 * shell tool would let that code write files or run commands directly, bypassing
 * the supervisor and the read-only review lanes. Any tool here is stripped from
 * a caller-supplied {@link OhMyDcodeOptions.interpreterPtc} at resolve time.
 */
export const FORBIDDEN_INTERPRETER_PTC: readonly string[] = [
  "write_file",
  "edit_file",
  "execute",
  "delete_file",
];

/**
 * Sanitize a PTC allowlist: drop any forbidden (mutating/shell) tool and
 * de-duplicate while preserving order. The result is always safe to hand to the
 * interpreter sandbox — read-only by construction, regardless of caller input.
 */
export function sanitizePtc(ptc: readonly string[]): string[] {
  const forbidden = new Set<string>(FORBIDDEN_INTERPRETER_PTC);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of ptc) {
    if (forbidden.has(name) || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * System prompt for the rubric grader sub-agent. Encodes the "never
 * self-approve" discipline as grading rigor: score each criterion independently,
 * verify with tools rather than trusting the transcript, and only pass when
 * every criterion holds.
 */
export const RUBRIC_GRADER_SYSTEM_PROMPT = `You are a strict output grader. You are given a rubric of pass/fail criteria and
the agent's latest output. Score every criterion independently as PASS or FAIL
with a one-line justification grounded in concrete evidence.

Verify, do not trust. When a criterion is checkable, use your tools to confirm it
empirically rather than believing the transcript: run the build, tests, or lint
with the shell tool; drive the page with the Playwright tools; query diagnostics,
definitions, and references with the language-server (LSP) tools. Do not award
partial credit and do not approve work the output does not actually demonstrate.

For every FAIL, emit a specific, actionable instruction describing exactly what
must change to pass. Return an overall PASS only when every criterion passes.`;

/**
 * Default MCP servers the rubric grader connects for verification tools:
 * Playwright for browser automation and a language server for code intelligence.
 * Both launch on demand via `npx` (no hard dependency). The LSP entry is a
 * sensible default — override `graderMcpServers` to point at a project- or
 * language-specific server.
 */
export const DEFAULT_GRADER_MCP_SERVERS: McpServerSpec[] = [
  {
    name: "playwright",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@playwright/mcp@latest"],
  },
  {
    name: "lsp",
    transport: "stdio",
    command: "npx",
    args: ["-y", "mcp-language-server@latest"],
  },
];

/**
 * Default agent-loop step bound. LangGraph's own default is 25, which a
 * delegating supervisor (each `task` call drives a nested sub-agent loop)
 * exhausts quickly; 100 leaves comfortable headroom for real orchestration.
 */
export const DEFAULT_RECURSION_LIMIT = 100;

/**
 * Identity line the Anthropic OAuth inference endpoint requires as the first
 * block of the system prompt when authenticating with a Claude Code / Claude
 * Pro/Max subscription token. Prepended to every prompt that reaches an
 * OAuth-authenticated Anthropic model; harmless and unused under API-key auth.
 */
export const CLAUDE_CODE_IDENTITY =
  "You are Claude Code, Anthropic's official CLI for Claude.";

/** Prepend the Claude Code identity as the first block of a system prompt. */
export function withClaudeCodeIdentity(prompt: string): string {
  return `${CLAUDE_CODE_IDENTITY}\n\n${prompt}`;
}

/** Absolute path to the bundled `skills/` directory shipped with the package. */
export function bundledSkillsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // `here` is <pkg>/src in dev (ts) and <pkg>/dist after build; both sit one
  // level below the package root, where `skills/` lives.
  return join(here, "..", "skills");
}

/** Read-only enforcement is on by default — author/review separation is a core
 * OMC discipline, and the deny-write rule is harmless to agents that never write. */
export const DEFAULT_ENFORCE_READ_ONLY = true;

/**
 * The permission rule that makes a subagent read-only at the SDK level: deny
 * every write operation, on every path. Reads fall through to the permissive
 * default. `/**` is safe on all shipped (non-sandbox) backends; an
 * execution-capable backend would require rescoping to a route prefix.
 *
 * Returns a fresh array each call so callers never share a mutable reference.
 */
export function readOnlyPermissions(): FilesystemPermission[] {
  return [{ operations: ["write"], paths: ["/**"], mode: "deny" }];
}

/**
 * Resolve the roster to Deep Agents subagent specs with concrete models. When
 * `enforceReadOnly` is set (the default), each read-only roster agent also gets
 * a deny-write permission rule so the SDK — not just the prompt — keeps it from
 * mutating the workspace.
 */
export function resolveSubagents(
  roster: readonly AgentSpec[],
  models: ModelMap,
  adversarialModel?: string | null,
  enforceReadOnly: boolean = DEFAULT_ENFORCE_READ_ONLY,
): ResolvedSubagent[] {
  return roster.map((agent) => {
    const sub: ResolvedSubagent = {
      name: agent.name,
      description: agent.description,
      systemPrompt: agent.systemPrompt,
      model: resolveAgentModel(agent, models, adversarialModel),
    };
    if (enforceReadOnly && agent.readOnly) {
      sub.permissions = readOnlyPermissions();
    }
    return sub;
  });
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
 * Resolve the middleware to install, as descriptors.
 *
 * Retry and rubric caps follow the adversarial-model convention: an absent
 * option (`undefined`) means "use the default"; an explicit `null` or `0`
 * disables that layer. A retry descriptor is emitted only for a positive count.
 *
 * The rubric descriptor needs a concrete grader model, so it is emitted only
 * when a resolved {@link ModelMap} is supplied. Callers that build the full
 * config (`buildDeepAgentConfig`) always pass one; bare callers that omit it
 * simply get no rubric layer.
 */
export function resolveMiddlewareDescriptors(
  options: OhMyDcodeOptions = {},
  models?: ModelMap,
): MiddlewareDescriptor[] {
  const descriptors: MiddlewareDescriptor[] = [];
  const modelRetries =
    options.modelRetries === undefined
      ? DEFAULT_MODEL_RETRIES
      : options.modelRetries;
  const toolRetries =
    options.toolRetries === undefined
      ? DEFAULT_TOOL_RETRIES
      : options.toolRetries;
  const rubricMaxIterations =
    options.rubricMaxIterations === undefined
      ? DEFAULT_RUBRIC_MAX_ITERATIONS
      : options.rubricMaxIterations;

  if (modelRetries != null && modelRetries > 0) {
    descriptors.push({ kind: "model-retry", maxRetries: modelRetries });
  }
  if (toolRetries != null && toolRetries > 0) {
    descriptors.push({ kind: "tool-retry", maxRetries: toolRetries });
  }
  if (options.interpreter ?? DEFAULT_INTERPRETER_ENABLED) {
    descriptors.push(buildInterpreterDescriptor(options));
  }
  if (rubricMaxIterations != null && rubricMaxIterations > 0 && models) {
    const tier = options.rubricGraderTier ?? DEFAULT_RUBRIC_GRADER_TIER;
    const toolsOff = options.graderTools === false;
    descriptors.push({
      kind: "rubric",
      model: models[tier],
      systemPrompt: RUBRIC_GRADER_SYSTEM_PROMPT,
      maxIterations: rubricMaxIterations,
      mcpServers: toolsOff
        ? []
        : (options.graderMcpServers ?? DEFAULT_GRADER_MCP_SERVERS),
      shellTool: toolsOff ? false : (options.graderShellTool ?? true),
    });
  }
  return descriptors;
}

/**
 * Build the interpreter middleware descriptor from options. The PTC allowlist is
 * always sanitized to a read-only set; the numeric caps are included only when
 * the caller supplied them, so an unconfigured interpreter falls through to the
 * middleware's own conservative defaults (and the descriptor stays minimal and
 * easy to assert on).
 */
export function buildInterpreterDescriptor(
  options: OhMyDcodeOptions = {},
): InterpreterMiddlewareDescriptor {
  const descriptor: InterpreterMiddlewareDescriptor = {
    kind: "interpreter",
    ptc: sanitizePtc(options.interpreterPtc ?? DEFAULT_INTERPRETER_PTC),
    // The whole point of the interpreter here is programmatic fan-out, so the
    // `task()` global is always on.
    subagents: true,
  };
  if (options.interpreterMemoryLimitBytes !== undefined) {
    descriptor.memoryLimitBytes = options.interpreterMemoryLimitBytes;
  }
  if (options.interpreterTimeoutMs !== undefined) {
    descriptor.executionTimeoutMs = options.interpreterTimeoutMs;
  }
  if (options.interpreterMaxPtcCalls !== undefined) {
    descriptor.maxPtcCalls = options.interpreterMaxPtcCalls;
  }
  if (options.interpreterMaxResultChars !== undefined) {
    descriptor.maxResultChars = options.interpreterMaxResultChars;
  }
  return descriptor;
}

/**
 * Merge harness defaults into a per-call invoke config: supply `recursionLimit`
 * when the caller omitted one, and normalize a deprecated camelCase `threadId`
 * to the snake_case `thread_id` LangGraph actually reads (an explicit
 * `thread_id` wins). Everything else the caller passed is left untouched. Pure,
 * so the wrapper is testable without a live agent.
 */
export function applyInvokeDefaults(
  config: InvokeConfig | undefined,
  recursionLimit: number,
): InvokeConfig {
  const out: InvokeConfig = {
    ...config,
    recursionLimit: config?.recursionLimit ?? recursionLimit,
  };

  const configurable = config?.configurable;
  if (configurable?.threadId !== undefined) {
    const { threadId, ...rest } = configurable;
    out.configurable = { ...rest, thread_id: rest.thread_id ?? threadId };
  }
  return out;
}

/**
 * Under OAuth, default the adversarial reviewers (critic, code-reviewer,
 * security-reviewer) to Claude so a Claude subscription alone is sufficient.
 *
 * Only applies when OAuth is active, the caller has not set an adversarial model
 * explicitly (`adversarialModel === undefined`), and no `OPENAI_API_KEY` is
 * present — then it sets `adversarialModel` to `null`, which routes adversarial
 * agents at their normal (Anthropic) tier instead of the `openai:gpt-5.5`
 * default. An explicit `adversarialModel` or a present `OPENAI_API_KEY` is left
 * untouched. Returns the options unchanged in every other case.
 */
export function applyOauthAdversarialDefault(
  options: OhMyDcodeOptions,
  env: NodeJS.ProcessEnv = process.env,
): OhMyDcodeOptions {
  if (
    options.auth === "oauth" &&
    options.adversarialModel === undefined &&
    !env.OPENAI_API_KEY
  ) {
    return { ...options, adversarialModel: null };
  }
  return options;
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
    subagents: resolveSubagents(
      roster,
      models,
      adversarialModel,
      options.enforceReadOnly ?? DEFAULT_ENFORCE_READ_ONLY,
    ),
    skills,
    memory: options.memoryPaths ?? [],
    backend: resolveBackendDescriptor(options, workdir),
    interruptOn: options.interruptOn ?? DEFAULT_INTERRUPT_ON,
    middleware: resolveMiddlewareDescriptors(options, models),
    recursionLimit: options.recursionLimit ?? DEFAULT_RECURSION_LIMIT,
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
  /** Self-evaluating grader loop (the rubric middleware). */
  RubricMiddleware: new (opts: {
    // A `provider:model` string under API-key auth, or a pre-built model
    // instance when the grader runs against an OAuth-authenticated Anthropic
    // model.
    model: string | unknown;
    systemPrompt: string;
    maxIterations: number;
    tools?: unknown[];
  }) => unknown;
}

/** Minimal shape of a constructed Deep Agents agent. */
export interface DeepAgent {
  invoke: (
    input: InvokeInput,
    config?: InvokeConfig,
  ) => Promise<{ messages: Array<{ content?: unknown }> }>;
}

/** The two fault-tolerance middleware factories we use from `langchain`. */
interface MiddlewareModule {
  modelRetryMiddleware: (opts: { maxRetries?: number }) => unknown;
  toolRetryMiddleware: (opts: { maxRetries?: number }) => unknown;
}

/** Minimal shape of the `@langchain/quickjs` code-interpreter factory. */
interface InterpreterModule {
  createCodeInterpreterMiddleware: (opts?: {
    ptc?: string[];
    memoryLimitBytes?: number;
    maxStackSizeBytes?: number;
    executionTimeoutMs?: number;
    maxPtcCalls?: number | null;
    maxResultChars?: number;
    toolName?: string;
    captureConsole?: boolean;
    subagents?: boolean;
    systemPrompt?: string | null;
  }) => unknown;
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

/**
 * Load the LangChain retry middleware. `modelRetryMiddleware` and
 * `toolRetryMiddleware` are named exports of the `langchain` package root (the
 * package that `deepagents` is built on), so they resolve whenever the SDK is
 * installed. (langchain 1.x does not expose a `langchain/middleware` subpath.)
 */
async function loadMiddleware(): Promise<MiddlewareModule> {
  const moduleName = "langchain";
  try {
    return (await import(moduleName)) as unknown as MiddlewareModule;
  } catch (err) {
    throw new Error(
      "oh-my-dcode's fault-tolerance middleware requires the 'langchain' " +
        "package (a peer of 'deepagents'). Install it, or disable retries with " +
        "`{ modelRetries: 0, toolRetries: 0 }`. " +
        `Underlying error: ${String(err)}`,
    );
  }
}

/**
 * Load the `@langchain/quickjs` code-interpreter package. It is a hard
 * dependency of oh-my-dcode (the interpreter is on by default), but loaded
 * lazily here at the runtime boundary so the SDK-free orchestration core stays
 * importable and unit-testable without the WASM runtime present.
 */
async function loadInterpreter(): Promise<InterpreterModule> {
  const moduleName = "@langchain/quickjs";
  try {
    return (await import(moduleName)) as unknown as InterpreterModule;
  } catch (err) {
    throw new Error(
      "oh-my-dcode's code interpreter requires the '@langchain/quickjs' " +
        "package. Install it, or disable the interpreter with " +
        "`{ interpreter: false }` (or --no-interpreter). " +
        `Underlying error: ${String(err)}`,
    );
  }
}

/** Minimal shape of an `@langchain/mcp-adapters` client. */
interface McpClient {
  getTools: () => Promise<unknown[]>;
  close?: () => Promise<void>;
}

/** Minimal shape of the `@langchain/mcp-adapters` module we use. */
interface McpAdaptersModule {
  MultiServerMCPClient: new (config: Record<string, unknown>) => McpClient;
}

/** Minimal shape of the `@langchain/core/tools` `tool` factory. */
interface ToolsModule {
  tool: (
    fn: (input: { command: string }) => Promise<string>,
    config: { name: string; description: string; schema: unknown },
  ) => unknown;
}

/** Minimal shape of the `zod` surface used to schema the shell tool. */
interface ZodModule {
  z: {
    object: (shape: Record<string, unknown>) => unknown;
    string: () => { describe: (d: string) => unknown };
  };
}

/**
 * Build a shell tool the grader can use to run build/test/lint commands and
 * report their exit code and output, so rubric criteria are verified
 * empirically rather than from the transcript.
 */
async function buildShellTool(): Promise<unknown> {
  const { tool } = await loadOptionalModule<ToolsModule>(
    "@langchain/core/tools",
    "The rubric grader's shell tool requires '@langchain/core' (a peer of 'langchain').",
  );
  const { z } = await loadOptionalModule<ZodModule>(
    "zod",
    "The rubric grader's shell tool requires 'zod' (a peer of 'langchain').",
  );
  const { promisify } = await import("node:util");
  const { exec } = await import("node:child_process");
  const execAsync = promisify(exec);

  return tool(
    async ({ command }) => {
      try {
        const { stdout, stderr } = await execAsync(command, {
          timeout: 600_000,
          maxBuffer: 16 * 1024 * 1024,
        });
        return JSON.stringify({ exitCode: 0, stdout, stderr });
      } catch (err) {
        const e = err as {
          code?: number;
          stdout?: string;
          stderr?: string;
          message?: string;
        };
        return JSON.stringify({
          exitCode: typeof e.code === "number" ? e.code : 1,
          stdout: e.stdout ?? "",
          stderr: e.stderr ?? e.message ?? "",
        });
      }
    },
    {
      name: "shell",
      description:
        "Run a shell command (build, tests, lint, …) and return its exit code, " +
        "stdout, and stderr. Use to verify rubric criteria empirically.",
      schema: z.object({
        command: z.string().describe("The shell command to execute."),
      }),
    },
  );
}

/**
 * Assemble the grader's verification tools from a rubric descriptor: tools
 * exposed by the configured MCP servers (e.g. Playwright, LSP), plus an optional
 * shell tool. Returns an empty array when the grader is configured tool-less.
 */
async function buildGraderTools(
  descriptor: RubricMiddlewareDescriptor,
): Promise<unknown[]> {
  const tools: unknown[] = [];

  if (descriptor.mcpServers.length > 0) {
    const { MultiServerMCPClient } = await loadOptionalModule<McpAdaptersModule>(
      "@langchain/mcp-adapters",
      "The rubric grader's MCP tools require the '@langchain/mcp-adapters' package. " +
        "Install it, or disable grader tools with `{ graderTools: false }`.",
    );
    const servers: Record<string, unknown> = {};
    for (const s of descriptor.mcpServers) {
      if (s.transport === "http") {
        if (!s.url) continue;
        servers[s.name] = { transport: "http", url: s.url };
      } else {
        if (!s.command) continue;
        servers[s.name] = { transport: "stdio", command: s.command, args: s.args ?? [], env: s.env };
      }
    }
    // The subprocess-backed client stays alive for the process lifetime; for a
    // single-shot run its servers exit with the parent. A long-lived library
    // caller that needs deterministic teardown should close it (follow-up).
    const client = new MultiServerMCPClient({ mcpServers: servers });
    tools.push(...(await client.getTools()));
  }

  if (descriptor.shellTool) {
    tools.push(await buildShellTool());
  }

  return tools;
}

/** Turn middleware descriptors into concrete middleware instances. */
async function instantiateMiddleware(
  descriptors: readonly MiddlewareDescriptor[],
  dap: DeepAgentsModule,
  oauth?: OAuthContext,
): Promise<unknown[]> {
  if (descriptors.length === 0) return [];
  // `langchain/middleware` is only needed when a retry layer is requested.
  let lc: MiddlewareModule | undefined;
  const out: unknown[] = [];
  for (const d of descriptors) {
    if (d.kind === "rubric") {
      const tools = await buildGraderTools(d);
      // Under OAuth, swap the grader's Anthropic model for an authenticated
      // instance and prepend the Claude Code identity to its prompt.
      const model = oauth ? await oauth.resolveModel(d.model) : d.model;
      const systemPrompt = oauth
        ? oauth.identityFor(d.systemPrompt, d.model)
        : d.systemPrompt;
      out.push(
        new dap.RubricMiddleware({
          model,
          systemPrompt,
          maxIterations: d.maxIterations,
          tools: tools.length > 0 ? tools : undefined,
        }),
      );
    } else if (d.kind === "interpreter") {
      const qjs = await loadInterpreter();
      out.push(
        qjs.createCodeInterpreterMiddleware({
          ptc: d.ptc,
          memoryLimitBytes: d.memoryLimitBytes,
          maxStackSizeBytes: d.maxStackSizeBytes,
          executionTimeoutMs: d.executionTimeoutMs,
          maxPtcCalls: d.maxPtcCalls,
          maxResultChars: d.maxResultChars,
          toolName: d.toolName,
          captureConsole: d.captureConsole,
          subagents: d.subagents,
        }),
      );
    } else {
      lc ??= await loadMiddleware();
      out.push(
        d.kind === "model-retry"
          ? lc.modelRetryMiddleware({ maxRetries: d.maxRetries })
          : lc.toolRetryMiddleware({ maxRetries: d.maxRetries }),
      );
    }
  }
  return out;
}

/**
 * Wrap an agent so `invoke` injects the harness's default `recursionLimit` when
 * the caller omits one. Other methods (stream, etc.) are preserved by mutating
 * the live agent in place rather than proxying a narrow surface.
 */
function withInvokeDefaults(agent: DeepAgent, recursionLimit: number): DeepAgent {
  const invoke = agent.invoke.bind(agent);
  return Object.assign(agent, {
    invoke: (input: InvokeInput, config?: InvokeConfig) =>
      invoke(input, applyInvokeDefaults(config, recursionLimit)),
  });
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
 * The OAuth wiring used by {@link createOhMyDcode} to convert `anthropic:*`
 * model strings into authenticated `ChatAnthropic` instances and to satisfy the
 * inference endpoint's system-prompt requirement. Non-Anthropic specs pass
 * through untouched so they keep using their own provider env-var keys.
 */
interface OAuthContext {
  /** Spec → authenticated instance for Anthropic; the spec string otherwise. */
  resolveModel(spec: string): Promise<unknown>;
  /** Prepend the Claude Code identity when the spec routes to Anthropic. */
  identityFor(prompt: string, spec: string): string;
}

/**
 * Resolve OAuth credentials and build an {@link OAuthContext}, or return `null`
 * when OAuth is not requested. Throws a clear, actionable error when OAuth is
 * requested but no login is present. Instances are cached by bare model id so a
 * routing map that reuses a model builds it once.
 */
async function buildOAuthContext(
  options: OhMyDcodeOptions,
): Promise<OAuthContext | null> {
  if (options.auth !== "oauth") return null;
  const token = await getValidAccessToken();
  if (!token) {
    throw new Error(
      'auth: "oauth" is set but no credentials were found — neither an ' +
        "`omd auth login` nor the official Claude Code CLI's credentials " +
        "(checked CLAUDE_CODE_OAUTH_TOKEN, ~/.claude/.credentials.json, and the " +
        "macOS keychain). Log into Claude Code or run `omd auth login` (or unset " +
        "auth to use ANTHROPIC_API_KEY). Set OMD_DISCOVER=off to disable reuse.",
    );
  }
  const cache = new Map<string, unknown>();
  return {
    async resolveModel(spec: string): Promise<unknown> {
      if (!isAnthropicSpec(spec)) return spec;
      const id = stripProvider(spec);
      let model = cache.get(id);
      if (!model) {
        model = await buildAnthropicChatModel(id, token);
        cache.set(id, model);
      }
      return model;
    },
    identityFor(prompt: string, spec: string): string {
      return isAnthropicSpec(spec) ? withClaudeCodeIdentity(prompt) : prompt;
    },
  };
}

/**
 * Build a live oh-my-dcode agent on top of the Deep Agents SDK. Requires the
 * `deepagents` package and a configured model provider — either `ANTHROPIC_API_KEY`
 * (default) or a Claude Code subscription login via `omd auth login` with
 * `auth: "oauth"`.
 */
export async function createOhMyDcode(
  options: OhMyDcodeOptions = {},
): Promise<DeepAgent> {
  const resolved = applyOauthAdversarialDefault(options);
  const config = buildDeepAgentConfig(resolved);
  const dap = await loadDeepAgents();
  const backend = instantiateBackend(dap, config.backend);
  const oauth = await buildOAuthContext(resolved);
  const middleware = await instantiateMiddleware(config.middleware, dap, oauth ?? undefined);

  // Under OAuth, replace `anthropic:*` specs with authenticated model instances
  // and prepend the Claude Code identity to each Anthropic agent's prompt. Other
  // providers keep their string specs (and their own env-var keys).
  const model = oauth ? await oauth.resolveModel(config.model) : config.model;
  const systemPrompt = oauth
    ? oauth.identityFor(config.systemPrompt, config.model)
    : config.systemPrompt;
  const subagents = oauth
    ? await Promise.all(
        config.subagents.map(async (s) => ({
          ...s,
          model: await oauth.resolveModel(s.model),
          systemPrompt: oauth.identityFor(s.systemPrompt, s.model),
        })),
      )
    : config.subagents;

  const agent = dap.createDeepAgent({
    model,
    systemPrompt,
    subagents,
    skills: config.skills,
    memory: config.memory,
    backend,
    interruptOn: config.interruptOn,
    middleware,
  });

  return withInvokeDefaults(agent, config.recursionLimit);
}
