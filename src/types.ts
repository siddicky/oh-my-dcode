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

/**
 * A resolved subagent, ready to hand to the Deep Agents SDK. `model` is the
 * concrete `provider:model` string after routing has been applied.
 */
export interface ResolvedSubagent {
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
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
   * Fault-tolerance middleware to install on the harness, as serializable
   * descriptors. The adapter turns each into a real LangChain middleware
   * instance (`modelRetryMiddleware` / `toolRetryMiddleware`) and passes the
   * array to `createDeepAgent`'s `middleware` option. Kept as descriptors here
   * so the builder stays dependency-free and unit-testable.
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
 * A serializable description of a fault-tolerance middleware to install. The
 * adapter resolves each to a concrete LangChain middleware at the runtime
 * boundary, mirroring how {@link BackendDescriptor} is resolved to a backend.
 *
 * - `model-retry` → `modelRetryMiddleware` (retries failed model calls)
 * - `tool-retry`  → `toolRetryMiddleware` (retries failed tool calls)
 */
export interface MiddlewareDescriptor {
  kind: "model-retry" | "tool-retry";
  /** Retry attempts after the initial call (the SDK's `maxRetries` option). */
  maxRetries: number;
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
