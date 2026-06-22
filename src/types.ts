/**
 * Core type definitions for oh-my-dcode.
 *
 * These types are intentionally self-contained and do NOT import from
 * `deepagents`. That keeps the orchestration core (routing, roster, prompts,
 * skills, config) typecheckable and unit-testable with zero runtime
 * dependencies. The thin adapter in {@link ./agent.ts} maps these shapes onto
 * the real Deep Agents SDK at runtime via a dynamic import.
 *
 * The shapes below mirror the documented Deep Agents JS options
 * (`createDeepAgent`) and `SubAgent` spec so the mapping is a 1:1 pass-through.
 */

/**
 * Model tiers, mirroring oh-my-claudecode's routing vocabulary.
 *
 * - `haiku`  — quick lookups, mechanical edits, cheap high-volume work
 * - `sonnet` — standard implementation and review work
 * - `opus`   — architecture, deep analysis, planning, adversarial review
 */
export type ModelTier = "haiku" | "sonnet" | "opus";

/** The three tiers, in increasing capability order. */
export const MODEL_TIERS: readonly ModelTier[] = ["haiku", "sonnet", "opus"];

/**
 * A mapping from each tier to a concrete `provider:model` string understood by
 * the Deep Agents SDK (e.g. `anthropic:claude-opus-4-8`).
 */
export type ModelMap = Record<ModelTier, string>;

/**
 * Named routing presets, mirroring OMC's premium/balanced/budget compatibility
 * presets (`docs/agents/model-compatibility.md`).
 */
export type RoutingPreset = "premium" | "balanced" | "budget";

/**
 * The capability lanes an agent in the roster can occupy. These mirror the OMC
 * delegation rules — each lane has a default model tier and a posture
 * (read-only research vs. mutating execution vs. review).
 */
export type AgentLane = "research" | "planning" | "execution" | "review" | "support";

/**
 * A specialized agent in the oh-my-dcode roster — the port of an
 * oh-my-claudecode agent. Resolves to a Deep Agents `SubAgent` via
 * {@link ./agent.ts}.
 */
export interface AgentSpec {
  /** Unique kebab-case identifier used by the `task` tool to delegate. */
  name: string;
  /** One-line description the supervisor uses to choose this agent. */
  description: string;
  /** Capability lane (drives default tier + review discipline). */
  lane: AgentLane;
  /** Model tier this agent runs at by default (overridable via routing). */
  tier: ModelTier;
  /**
   * Whether this agent is read-only (must not mutate the workspace). Review,
   * planning, and research agents are read-only so authoring and review stay
   * in separate lanes — OMC's "never self-approve" discipline.
   */
  readOnly: boolean;
  /**
   * Whether this is an adversarial agent — one whose job is to find faults or
   * refute (critic, code-reviewer, security-reviewer). When an adversarial
   * model is configured, these agents route to it instead of their tier model,
   * so critique comes from a different model family (decorrelated review).
   */
  adversarial?: boolean;
  /** The agent's system prompt (markdown body). */
  systemPrompt: string;
}

/** A filesystem operation a {@link FilesystemPermission} rule can govern. */
export type FilesystemOperation = "read" | "write";

/**
 * A filesystem permission rule, mirroring the Deep Agents SDK shape. Rules are
 * evaluated in declaration order; the first rule whose `operations` includes the
 * requested operation AND whose `paths` glob-matches the target determines the
 * outcome. If no rule matches, access is allowed (permissive default).
 *
 * `paths` must be absolute glob patterns rooted at `/` (no `..` or `~`), and
 * support `**` (any depth), `*` (within one segment), and `{a,b}` braces.
 */
export interface FilesystemPermission {
  /** The operations this rule applies to (`read` and/or `write`). */
  operations: FilesystemOperation[];
  /** Absolute glob patterns this rule matches (must start with `/`). */
  paths: string[];
  /** Whether matching paths are permitted or blocked. Defaults to `allow`. */
  mode?: "allow" | "deny";
}

/**
 * A resolved subagent, ready to hand to the Deep Agents SDK. `model` is the
 * concrete `provider:model` string after routing has been applied.
 */
export interface ResolvedSubagent {
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  /**
   * Filesystem permission rules for this subagent. Present only for read-only
   * roster agents when read-only enforcement is enabled — a deny-write rule that
   * stops the SDK from honoring any `write_file`/`edit_file` call the agent
   * attempts, regardless of what its prompt says. A full replacement of the
   * parent's permissions (the SDK does not merge), so omitting it inherits the
   * supervisor's permissive default.
   */
  permissions?: FilesystemPermission[];
}

/**
 * An orchestration workflow (OMC "skill"/mode): autopilot, ralph, ultrawork,
 * team, ralplan. Shipped both as programmatic metadata and as on-disk
 * `SKILL.md` files the Deep Agents Code CLI can load.
 */
export interface SkillSpec {
  /** Kebab-case skill name (matches its `skills/<name>/SKILL.md` folder). */
  name: string;
  /** One-line description used for skill selection. */
  description: string;
  /** Natural-language phrases that should activate this workflow. */
  triggers: string[];
  /** The full SKILL.md markdown body (front-matter excluded). */
  body: string;
}

/**
 * Plain options object equivalent to what Deep Agents' `createDeepAgent`
 * accepts. Returned by `buildDeepAgentConfig` so the wiring is fully
 * inspectable and testable without constructing a live agent.
 */
export interface DeepAgentConfig {
  /** Main supervisor model (`provider:model`). */
  model: string;
  /** Supervisor system prompt. */
  systemPrompt: string;
  /** Resolved roster, mapped to Deep Agents subagent specs. */
  subagents: ResolvedSubagent[];
  /** Skill source directories passed to the SDK. */
  skills: string[];
  /** Memory source paths (AGENTS.md) passed to the SDK. */
  memory: string[];
  /**
   * Backend descriptor. The adapter turns this into a real backend instance
   * (kept as a descriptor here so the builder stays dependency-free).
   */
  backend: BackendDescriptor;
  /**
   * Tool names that should require human approval (HITL).
   *
   * v0.1 exposes boolean approve-all gating per tool. The underlying SDK also
   * accepts a richer per-tool policy object (allow/edit/reject); to use that,
   * pass it straight to `createDeepAgent` via the SDK rather than this option.
   */
  interruptOn: Record<string, boolean>;
  /**
   * Middleware to install on the harness, as serializable descriptors. The
   * adapter turns each into a real instance — the LangChain retry middleware
   * (`modelRetryMiddleware` / `toolRetryMiddleware`) or Deep Agents'
   * `RubricMiddleware` (the self-evaluating grader loop) — and passes the array
   * to `createDeepAgent`'s `middleware` option. Kept as descriptors here so the
   * builder stays dependency-free and unit-testable.
   */
  middleware: MiddlewareDescriptor[];
  /**
   * Maximum number of steps the agent loop may take before LangGraph aborts
   * with a recursion error. Applied as the default `recursionLimit` in the
   * invoke config (LangGraph's own default of 25 is low for a supervisor that
   * delegates into nested sub-agent loops).
   */
  recursionLimit: number;
}

/**
 * A serializable description of a middleware to install. The adapter resolves
 * each to a concrete middleware instance at the runtime boundary, mirroring how
 * {@link BackendDescriptor} is resolved to a backend. Discriminated on `kind`:
 *
 * - `model-retry` → `modelRetryMiddleware` (retries failed model calls)
 * - `tool-retry`  → `toolRetryMiddleware` (retries failed tool calls)
 * - `interpreter` → `@langchain/quickjs`'s code-interpreter middleware (the
 *   sandboxed `eval` tool + programmatic `task()` fan-out)
 * - `rubric`      → Deep Agents' `RubricMiddleware` (self-evaluating grader loop)
 */
export type MiddlewareDescriptor =
  | RetryMiddlewareDescriptor
  | InterpreterMiddlewareDescriptor
  | RubricMiddlewareDescriptor;

/** A fault-tolerance retry middleware (model- or tool-call retries). */
export interface RetryMiddlewareDescriptor {
  kind: "model-retry" | "tool-retry";
  /** Retry attempts after the initial call (the SDK's `maxRetries` option). */
  maxRetries: number;
}

/**
 * The `@langchain/quickjs` code-interpreter middleware: a sandboxed JavaScript
 * `eval` tool backed by a QuickJS WASM runtime, plus a programmatic `task()`
 * global for fan-out subagent dispatch. Lets a workflow keep plan/loop/batch
 * state in JS and fan subagents out and in, returning only compact results to
 * the supervisor while intermediate logs and failed branches stay out of the
 * model context.
 *
 * The interpreter calls agent tools through a narrow read-only `ptc` allowlist.
 * Mutating tools (`write_file`, `edit_file`, `execute`) are never exposed to the
 * sandbox — {@link OhMyDcodeOptions.interpreterPtc} overrides are sanitized
 * against a forbidden set at resolve time. The numeric fields cap the sandbox's
 * resource use; when omitted, the middleware's own conservative defaults apply
 * (64MB memory, 320KB stack, 5s timeout, 256 PTC calls, 4000 result chars).
 */
export interface InterpreterMiddlewareDescriptor {
  kind: "interpreter";
  /**
   * Read-only tool names the sandbox may call through programmatic tool calling
   * (PTC). Sanitized to exclude any mutating tool — see
   * {@link OhMyDcodeOptions.interpreterPtc}.
   */
  ptc: string[];
  /** Sandbox heap cap in bytes (the middleware default is 64MB). */
  memoryLimitBytes?: number;
  /** Sandbox stack cap in bytes (the middleware default is 320KB). */
  maxStackSizeBytes?: number;
  /** Per-`eval` wall-clock timeout in ms (the middleware default is 5000). */
  executionTimeoutMs?: number;
  /**
   * Max `tools.*` bridge calls per `eval` (the middleware default is 256).
   * `null` disables the limit entirely — unsafe, raises DoS risk.
   */
  maxPtcCalls?: number | null;
  /** Max characters retained from a single `eval`'s result/console output. */
  maxResultChars?: number;
  /** Name of the tool exposed to the model (the middleware default is `eval`). */
  toolName?: string;
  /** Buffer and emit `console.*` output alongside the result (default true). */
  captureConsole?: boolean;
  /** Install the `task()` global for programmatic subagent fan-out (default true). */
  subagents?: boolean;
}

/**
 * Deep Agents' native `RubricMiddleware`: a self-evaluating grader loop. The
 * agent grades its own output against an invoke-time `rubric` string (per
 * criterion) and iterates until every criterion passes or `maxIterations` is
 * hit. The grader runs as a sub-agent with its own model, system prompt, and
 * tools. Installed by default but dormant — it only engages when a `rubric` is
 * supplied at invoke time (see {@link InvokeInput}).
 */
export interface RubricMiddlewareDescriptor {
  kind: "rubric";
  /** Concrete `provider:model` for the grader sub-agent (resolved from routing). */
  model: string;
  /** Grader system prompt: how to score per-criterion and emit fix feedback. */
  systemPrompt: string;
  /** Max self-evaluate→revise cycles before accepting the current output. */
  maxIterations: number;
  /**
   * MCP servers whose tools the grader may call to verify criteria empirically
   * (e.g. Playwright for browser checks, an LSP server for diagnostics). The
   * runtime boundary loads these via `@langchain/mcp-adapters`. Empty disables
   * MCP-backed grading tools.
   */
  mcpServers: McpServerSpec[];
  /**
   * When true, the grader also gets a shell tool to run build/test/lint
   * commands for verification. Off means pure-LLM + MCP grading only.
   */
  shellTool: boolean;
}

/**
 * A serializable description of an MCP server to connect for the rubric
 * grader's tools. Resolved to a live connection at the runtime boundary by
 * `@langchain/mcp-adapters` (`MultiServerMCPClient`). Kept dependency-free here
 * so the builder stays pure and inspectable.
 */
export interface McpServerSpec {
  /** Stable identifier for the server (namespaces its tools). */
  name: string;
  /** Connection transport: a spawned stdio subprocess or a remote HTTP server. */
  transport: "stdio" | "http";
  /** For `stdio`: the executable to launch (e.g. `npx`). */
  command?: string;
  /** For `stdio`: arguments to the command. */
  args?: string[];
  /** For `http`: the server URL. */
  url?: string;
  /** Extra environment variables for a spawned `stdio` server. */
  env?: Record<string, string>;
}

/**
 * The input object accepted by a live agent's `invoke`. Mirrors the Deep Agents
 * shape: the conversation `messages` plus an optional `rubric` of pass/fail
 * criteria the {@link RubricMiddlewareDescriptor} grader evaluates output
 * against. When `rubric` is absent the grader stays dormant.
 */
export interface InvokeInput {
  messages: Array<{ role: string; content: string }>;
  /** Pass/fail criteria the rubric grader evaluates the output against. */
  rubric?: string;
}

/**
 * The runtime invoke config accepted by a live agent, mirroring LangChain /
 * LangGraph's shape. Note `thread_id` is snake_case — that is the key the
 * checkpointer reads; a camelCase `threadId` is silently ignored.
 */
export interface InvokeConfig {
  /**
   * Per-thread scoping for checkpointed conversation history. `thread_id`
   * (snake_case) is the key LangGraph reads. `threadId` is accepted as a
   * deprecated alias for back-compat with pre-0.2 callers and is normalized to
   * `thread_id` at invoke time; prefer `thread_id` in new code.
   */
  configurable?: {
    thread_id?: string;
    /** @deprecated Use `thread_id`; this camelCase alias is normalized for you. */
    threadId?: string;
  } & Record<string, unknown>;
  /** Max agent-loop steps before LangGraph throws (LangGraph default: 25). */
  recursionLimit?: number;
  /** Per-run context data made available to tools and middleware. */
  context?: Record<string, unknown>;
}

/**
 * A serializable description of the filesystem backend to construct. The
 * adapter resolves this to a concrete Deep Agents backend instance.
 */
export interface BackendDescriptor {
  kind: "composite-filesystem" | "filesystem" | "state";
  /** Root directory for filesystem-backed kinds. */
  rootDir?: string;
  /** When true, sandbox + normalize paths under rootDir (recommended). */
  virtualMode?: boolean;
  /**
   * For `composite-filesystem`: the mount point under which the real project
   * is exposed, with agent internals kept in ephemeral state storage.
   */
  mount?: string;
}

/** User-facing options for building an oh-my-dcode agent. */
export interface OhMyDcodeOptions {
  /**
   * How to authenticate Anthropic model calls.
   *
   * - `"api-key"` (default; also when omitted) — use `ANTHROPIC_API_KEY`, the
   *   existing behavior.
   * - `"oauth"` — use a Claude Code / Claude Pro/Max subscription token obtained
   *   via `omd auth login`. Only `anthropic:*` models are affected; non-Anthropic
   *   models (e.g. `openai:*` adversarial reviewers) always use their own
   *   provider env-var keys. A string enum leaves room for future auth modes.
   */
  auth?: "oauth" | "api-key";
  /**
   * Routing preset or an explicit tier→model map. Defaults to `"balanced"`.
   * A partial map is merged over the preset's defaults.
   */
  routing?: RoutingPreset | Partial<ModelMap>;
  /**
   * Per-tier model overrides (`provider:model` strings) layered over the
   * routing preset — e.g. `{ opus: "openai:gpt-5.5" }`. Wins over `routing`.
   */
  models?: Partial<ModelMap>;
  /**
   * Model that adversarial agents (critic, code-reviewer, security-reviewer)
   * route to, overriding their tier model. Defaults to `openai:gpt-5.5` so
   * critique comes from a different model family. Set to `null` to disable the
   * override and route adversarial agents at their normal tier instead.
   */
  adversarialModel?: string | null;
  /** Working directory the agent operates on. Defaults to `process.cwd()`. */
  workdir?: string;
  /**
   * Backend strategy. `"composite"` (default) writes project files to disk but
   * keeps agent internals in ephemeral state; `"state"` is a fully virtual
   * sandbox (no disk writes); `"filesystem"` writes everything to disk.
   */
  backend?: "composite" | "state" | "filesystem";
  /** Extra agent specs to append to (or override) the built-in roster. */
  extraAgents?: AgentSpec[];
  /** Tool names to gate behind human approval. Defaults to destructive ops. */
  interruptOn?: Record<string, boolean>;
  /**
   * Retry attempts for failed model calls (rate limits, transient errors),
   * installed via `modelRetryMiddleware`. Defaults to `2`. Set to `0` or `null`
   * to disable model retries.
   */
  modelRetries?: number | null;
  /**
   * Retry attempts for failed tool calls, installed via `toolRetryMiddleware`.
   * Defaults to `0` (disabled): the built-in tools include non-idempotent
   * operations (`execute`, `write_file`, `delete_file`), so retrying a
   * partially-applied call could repeat side effects. Opt in (e.g. `2`) only
   * when the tools in play are safe to re-run.
   */
  toolRetries?: number | null;
  /**
   * Maximum self-evaluation iterations for the rubric grader (Deep Agents'
   * `RubricMiddleware`). The agent re-grades its output against the invoke-time
   * `rubric` and revises until all criteria pass or this cap is hit. Defaults to
   * `3`. Set to `0` or `null` to disable rubric self-evaluation entirely (no
   * rubric middleware installed). The middleware is dormant unless a `rubric` is
   * passed at invoke time, so installing it by default is harmless.
   */
  rubricMaxIterations?: number | null;
  /**
   * Model tier for the rubric grader sub-agent. Defaults to `"haiku"` — grading
   * is cheap, high-volume, per-criterion scoring work. Raise it for stricter
   * evaluation.
   */
  rubricGraderTier?: ModelTier;
  /**
   * Master switch for the grader's verification tools. Defaults to `true`: the
   * grader gets a shell tool plus the configured MCP servers (Playwright, LSP)
   * so it can check criteria empirically. Set to `false` for pure-LLM grading
   * from the transcript only (no shell, no MCP).
   */
  graderTools?: boolean;
  /**
   * Whether the grader gets a shell tool to run build/test/lint commands for
   * verification. Defaults to `true`. Ignored when {@link graderTools} is
   * `false`.
   */
  graderShellTool?: boolean;
  /**
   * MCP servers whose tools the grader may call to verify criteria (browser
   * automation, language-server diagnostics, …). Defaults to a Playwright
   * server plus a documented LSP server; override to point at project- or
   * language-specific servers. Ignored when {@link graderTools} is `false`.
   */
  graderMcpServers?: McpServerSpec[];
  /**
   * Enforce each read-only roster agent's read-only posture at the SDK level,
   * not just in its prompt. Defaults to `true`: every agent whose spec is
   * `readOnly` is given a deny-write filesystem permission rule, so the SDK
   * rejects any `write_file`/`edit_file` it attempts. This keeps OMC's
   * author/review separation honest — a review, planning, or research agent
   * cannot mutate the workspace even if it tries. Set to `false` to fall back to
   * prompt-only read-only discipline.
   *
   * Note: filesystem permissions do not cover the `execute` (shell) tool. On the
   * shipped backends (state / filesystem / composite-filesystem) `execute` has
   * no shell to run, so read-only is fully enforced; if you supply your own
   * execution-capable (sandbox) backend, restrict `execute` separately.
   */
  enforceReadOnly?: boolean;
  /**
   * Master switch for the code interpreter (the `@langchain/quickjs` sandboxed
   * `eval` tool plus the programmatic `task()` fan-out global). Defaults to
   * `true` — the interpreter is on by default so workflows can drive
   * plan/loop/batch state in JS and fan subagents out and in without leaking
   * intermediate context. Set to `false` to omit the middleware entirely (no
   * `eval` tool; subagent dispatch goes through the normal `task` tool path).
   */
  interpreter?: boolean;
  /**
   * Read-only tool names the interpreter sandbox may call via programmatic tool
   * calling (PTC). Defaults to `["ls", "read_file", "glob", "grep"]`. Any
   * mutating tool (`write_file`, `edit_file`, `execute`, `delete_file`) is
   * stripped at resolve time — the sandbox is read-only by construction, so a
   * write must go back through the supervisor or a delegated execution agent.
   */
  interpreterPtc?: string[];
  /** Interpreter sandbox heap cap in bytes. Defaults to the middleware's 64MB. */
  interpreterMemoryLimitBytes?: number;
  /** Interpreter per-`eval` timeout in ms. Defaults to the middleware's 5000. */
  interpreterTimeoutMs?: number;
  /**
   * Max `tools.*` bridge calls per `eval`. Defaults to the middleware's 256.
   * `null` disables the limit entirely (unsafe — raises DoS risk).
   */
  interpreterMaxPtcCalls?: number | null;
  /** Max characters retained per `eval` result. Defaults to the middleware's 4000. */
  interpreterMaxResultChars?: number;
  /**
   * Maximum agent-loop steps before LangGraph aborts the run. Defaults to a
   * value tuned for a delegating supervisor (LangGraph's own default of 25 is
   * easily exhausted by nested sub-agent loops). Applied as the invoke-time
   * `recursionLimit`; a per-call `recursionLimit` still wins.
   */
  recursionLimit?: number;
  /** Additional skill directories to load alongside the bundled OMC skills. */
  skillDirs?: string[];
  /** Additional memory (AGENTS.md) paths to load. */
  memoryPaths?: string[];
  /** Override the bundled skills directory (mainly for tests). */
  bundledSkillsDir?: string;
}
