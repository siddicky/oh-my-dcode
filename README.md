# oh-my-dcode

**[oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode)'s multi-agent
orchestration layer, ported to [LangChain Deep Agents](https://docs.langchain.com/oss/javascript/deepagents/code/overview)
(Deep Agents Code) for TypeScript.**

oh-my-claudecode (OMC) turns Claude Code into a coordinated team of specialized
agents — a supervisor that plans, delegates to focused sub-agents, routes each
sub-task to a right-sized model, and verifies the result before claiming it is
done. oh-my-dcode brings that same coordination layer to the **Deep Agents**
framework, so you get it on top of *any* tool-calling model (Anthropic, OpenAI,
Google, OpenRouter, Fireworks, Ollama, …) — both as a TypeScript SDK and as a
drop-in for the `dcode` CLI.

```
        ┌──────────────────────────── supervisor (opus tier) ────────────────────────────┐
        │  operating principles · delegation rules · model routing · verification gate     │
        └───────────────┬───────────────┬───────────────┬───────────────┬─────────────────┘
            task tool ▼               ▼               ▼               ▼
        research          planning          execution           review
        explore           analyst           executor            code-reviewer
        document-spec.    architect         debugger            security-reviewer
        tracer            planner            test-engineer       critic
        scientist                            designer            verifier
                                             code-simplifier
        support: writer · git-master
```

---

## Highlights

- **Dynamic, interpreter-driven workflows** — the fan-out workflows (`ultrawork`,
  `team`, `ultragoal`) orchestrate through Deep Agents' **code interpreter**
  (`@langchain/quickjs`): a sandboxed `eval` tool plus a `task()` fan-out global.
  A workflow keeps its plan/batch/schedule state in JS, fans subagents out and
  in, validates their typed results, and returns only a compact roll-up — so
  intermediate logs and failed branches never enter the supervisor's context.
  On by default; read-only by construction. See [Code interpreter](#code-interpreter).
- **Claude Code OAuth** — authenticate Anthropic models with a **Claude Code /
  Claude Pro/Max subscription** instead of an `ANTHROPIC_API_KEY`. If you're
  already logged into the Claude Code CLI, `omd` **auto-discovers and reuses**
  those credentials (env token → keychain/file) — no separate `omd auth login`
  needed — and the whole roster runs on your subscription (adversarial reviewers
  auto-route to Claude when no OpenAI key is present). See [Authentication](#authentication).
- **SDK-level read-only enforcement** — review, planning, and research agents are
  sandboxed with a deny-write filesystem rule, so the SDK rejects any write they
  attempt — author/review separation that prompt discipline can't break. See
  [Read-only enforcement](#read-only-enforcement).
- **Tiered model routing** — haiku/sonnet/opus by task weight, with
  premium/balanced/budget presets and per-tier overrides.
- **Adversarial cross-model review** — critic and reviewers default to a
  different model family for decorrelated critique.
- **Rubric self-evaluation** — an optional grader loop that verifies pass/fail
  criteria empirically (shell, Playwright, LSP) and iterates until they pass.

---

## Why this exists

The Deep Agents SDK gives you the *scaffolding* for a deep agent — planning,
a virtual filesystem, sub-agents, skills, memory. oh-my-dcode supplies the
*organization* that OMC pioneered on top of that scaffolding:

| oh-my-claudecode concept            | oh-my-dcode implementation                                              |
| ----------------------------------- | ---------------------------------------------------------------------- |
| Specialized agents (≈19)            | A roster of Deep Agents sub-agents (`src/agents.ts`)                    |
| haiku / sonnet / opus model routing | Tiered routing with premium/balanced/budget presets (`src/routing.ts`) |
| Tier-0 workflows (autopilot, ralph, ultrawork, team, ralplan) | Deep Agents skills (`src/skills.ts` → `skills/*/SKILL.md`); the fan-out ones run as **dynamic, interpreter-driven** workflows |
| Claude subscription auth                                       | **Claude Code OAuth** — run Anthropic models on a Claude Pro/Max login (`src/auth.ts`) |
| Author/review separation, "never self-approve" | Review/planning/research agents are **read-only**; verify-before-done gate baked into the supervisor prompt |
| Multi-model cross-check (ccg)       | Adversarial agents (critic, reviewers) default to a **different model family** (`openai:gpt-5.5`) for decorrelated critique |
| Delegation + verification discipline | Supervisor system prompt (`src/prompts.ts`)                            |
| `.omc/` project layout, skills      | `.deepagents/` scaffold via `omd init` (`src/scaffold.ts`)             |

---

## Install

```bash
npm install oh-my-dcode        # library + the `omd` CLI
# the runtime SDK (peer): if not already present
npm install deepagents
# the code interpreter (on by default) — installed automatically as a dependency,
# but listed here for clarity; loaded lazily so the core stays SDK-free
npm install @langchain/quickjs
```

Set a provider key for the model you route to (Anthropic by default):

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

…or sign in with a **Claude Code / Claude Pro/Max subscription** instead of an
API key (see [Authentication](#authentication)):

```bash
npm install @langchain/anthropic   # required for OAuth
omd auth login                     # sign in via your browser
export OMD_AUTH=oauth              # use the subscription token for runs
```

Requires **Node ≥ 22.6** (the `omd` CLI and tests run TypeScript directly via
Node's native type stripping — no build step needed to use them).

## Authentication

Anthropic model calls authenticate one of two ways:

- **API key** (default) — `ANTHROPIC_API_KEY`, as above.
- **Claude Code subscription (OAuth)** — use a Claude Code / Claude Pro/Max
  subscription token for all `anthropic:*` agents, no API key required.

**Already logged into the Claude Code CLI?** You don't need a separate login —
`omd` discovers and reuses Claude Code's own credentials automatically. Just opt
into OAuth and go:

```bash
npm install @langchain/anthropic        # optional peer; only OAuth needs it
unset ANTHROPIC_API_KEY                  # the API rejects an api key + bearer together
OMD_AUTH=oauth omd run "add a /health endpoint and verify it"
omd auth status                         # shows which credential source is in use
```

Discovery precedence (read-only — `omd` **never writes** Claude Code's stores):

1. `CLAUDE_CODE_OAUTH_TOKEN` environment variable.
2. The Claude Code CLI's primary store — the **macOS keychain**
   (`Claude Code-credentials`) on macOS, or `~/.claude/.credentials.json`
   (mode `0600`) on Linux/Windows — with the other as fallback.
3. `omd`'s own store at `~/.omd/credentials.json`, written by `omd auth login`.

When a discovered token is near expiry, `omd` refreshes it (via Claude Code's
refresh token) and persists the result to **its own** `~/.omd/credentials.json`,
leaving Claude Code's keychain/file untouched. Set `OMD_DISCOVER=off` to disable
reuse and require an explicit `omd auth login`.

**Need a separate/isolated token?** Run the OAuth (PKCE) flow yourself:

```bash
omd auth login                          # browser (loopback) sign-in…
omd auth login --no-browser             # …or paste the code (headless/remote)
omd auth logout                         # remove omd's stored credentials
```

To use OAuth for a run, opt in with `auth: "oauth"` in `.omd/config.json`,
`OMD_AUTH=oauth`, or `--auth oauth`.

Notes:
- **Unset `ANTHROPIC_API_KEY`** when using OAuth — sending both an api key and a
  bearer token is rejected by the API.
- Only `anthropic:*` models use the subscription token. Other providers (e.g.
  the default `openai:gpt-5.5` adversarial reviewers) keep using their own
  env-var keys. With **no `OPENAI_API_KEY` set**, the adversarial reviewers
  auto-route to Claude, so a Claude subscription alone is enough; set
  `OPENAI_API_KEY` (or `--adversarial-model`) to keep cross-model review.
- This uses the same OAuth client and Claude Code system-prompt identity that
  the inference endpoint requires — an interop requirement, not configurable.
- The OAuth endpoints are overridable for forward-compat via `OMD_OAUTH_CLIENT_ID`,
  `OMD_OAUTH_TOKEN_URL`, and `OMD_OAUTH_AUTHORIZE_URL`.

---

## Use it as a library

```ts
import { createOhMyDcode } from "oh-my-dcode";

// Build a supervisor wired to the full OMC roster, balanced routing,
// operating on the current directory.
const agent = await createOhMyDcode({
  routing: "balanced",          // "premium" | "balanced" | "budget" | {tier: model}
  backend: "composite",         // real files on disk, agent internals in ephemeral state
  workdir: process.cwd(),
});

const result = await agent.invoke({
  messages: [{ role: "user", content: "Add a /health endpoint with a test, then verify it." }],
});

console.log(result.messages.at(-1)?.content);
```

The supervisor plans the work, delegates (`architect` to design, `executor` to
implement, `test-engineer` for the test, `verifier` to run it, `code-reviewer`
for the approval pass), and only reports done once it has been verified and
reviewed by an agent other than the author.

### Inspect the wiring without the SDK

`buildDeepAgentConfig` is pure — it returns exactly what would be handed to
`createDeepAgent`, with routing resolved and the roster mapped to sub-agents.
Great for tests and debugging:

```ts
import { buildDeepAgentConfig } from "oh-my-dcode";

const cfg = buildDeepAgentConfig({ routing: "budget" });
cfg.model;            // "anthropic:claude-sonnet-4-6"  (opus tier, budget preset)
cfg.subagents.length; // 18
cfg.subagents.find(s => s.name === "architect")?.model; // budget-tier model
```

---

## Use it with the `dcode` CLI

`omd init` writes the OMC roster and workflows into `.deepagents/` in the exact
layout the [Deep Agents Code CLI](https://docs.langchain.com/oss/javascript/deepagents/code/overview)
reads, so plain `dcode` runs with the full orchestration layer:

```bash
omd init                 # writes ./.deepagents/{AGENTS.md,agents/*,skills/*}
dcode                    # now has the OMC sub-agents + workflows available
```

```
.deepagents/
├── AGENTS.md                       # supervisor instructions (principles, delegation, verification)
├── agents/
│   ├── architect/AGENTS.md         # one sub-agent per roster member (with model frontmatter)
│   ├── executor/AGENTS.md
│   └── … (18 total)
└── skills/
    ├── autopilot/SKILL.md          # one per workflow
    ├── ralph/SKILL.md
    └── … (8 total)
```

---

## The `omd` CLI

```
omd [run] "<task>"     Orchestrate a task to completion (needs deepagents + API key)
omd -n "<task>"        Single-shot, non-interactive
omd auth <login|logout|status>   Sign in with a Claude Code subscription (OAuth)
omd init [--force]     Write the OMC roster + workflows into ./.deepagents
omd agents             List the specialized roster and their resolved models
omd skills             List the orchestration workflows
omd config             Show the resolved model routing and backend
omd help               Usage

Flags: --routing <premium|balanced|budget>  --backend <composite|state|filesystem>  --workdir <dir>
       --auth <oauth|api-key>    Anthropic auth: Claude subscription (oauth) or ANTHROPIC_API_KEY
       --no-browser              For auth login: paste the code instead of using a loopback server
       --recursion-limit <n>  --model-retries <n>  --tool-retries <n>
       --rubric "<criteria>"  Self-evaluate against these pass/fail criteria, iterating to pass-or-cap
       --rubric-iterations <n>   Cap on rubric self-evaluation cycles (default 3; 0 disables)
       --no-grader-tools         Grade from the transcript only (no shell/Playwright/LSP tools)
       --no-interpreter          Disable the code interpreter (eval tool + task() fan-out); on by default
       --no-enforce-read-only    Don't sandbox read-only agents at the SDK level; on by default
       --yolo   Unattended: grant all permissions (no approval gating) + ~unbounded recursion
```

`omd run --yolo "<task>"` runs fully unattended — it clears any `interruptOn`
approval gating and lifts the recursion limit to effectively unbounded. A given
`--recursion-limit` still takes precedence, so you can cap an otherwise-yolo run.

---

## The roster

18 specialized agents across five lanes. Review, planning, and research agents
are **read-only** so the agent that writes code is never the one that approves
it — OMC's author/review separation. Read-only is enforced at the **SDK level**,
not just in prompts: each read-only agent carries a deny-write filesystem
permission rule, so the SDK rejects any `write_file`/`edit_file` it attempts (see
[Read-only enforcement](#read-only-enforcement)).

| Lane          | Agents                                                        | Default tier |
| ------------- | ------------------------------------------------------------- | ------------ |
| **research**  | explore · document-specialist · tracer · scientist            | sonnet/opus  |
| **planning**  | analyst · architect · planner                                 | opus         |
| **execution** | executor · debugger · test-engineer · designer · code-simplifier | sonnet     |
| **review**    | code-reviewer · security-reviewer · critic · verifier         | opus/sonnet  |
| **support**   | writer · git-master                                           | haiku/sonnet |

The three adversarial reviewers (critic, code-reviewer, security-reviewer)
route to `openai:gpt-5.5` by default — see [Adversarial cross-model review](#adversarial-cross-model-review).
Add or override agents per build with `extraAgents` (matching names replace the
built-in).

---

## Workflows

Shipped as Deep Agents skills the supervisor can invoke. Each describes how to
drive the roster for that mode — the five OMC Tier-0 workflows plus the
gajae-code pipeline (`deep-interview` → `ralplan` → `ultragoal` → `team`,
composed end-to-end by `deepship`). The fan-out workflows (`ultrawork`, `team`,
and `ultragoal`'s independent goals) drive their batching from the
[code interpreter](#code-interpreter) — keeping plan, schedule, and integration
state in JS and returning only compact results to the supervisor:

| Workflow    | What it does                                                                      |
| ----------- | -------------------------------------------------------------------------------- |
| `autopilot` | Idea → verified code: expand → design/plan → build → QA → review.                |
| `ralph`     | Persistent verify/fix loop until an independent reviewer confirms the goal.      |
| `ultrawork` | Maximum parallelism: decompose into conflict-free lanes and fan out via the interpreter. |
| `team`      | Staged pipeline (plan → spec → execute → verify → fix), scheduled wave-by-wave via the interpreter. |
| `ralplan`   | Consensus planning gate: plan, adversarially critique, converge — then hand off. |
| `deep-interview` | Socratic requirements gate: interview in rounds, lateral-review panel, crystallize a spec. |
| `ultragoal` | Durable multi-goal execution: decompose into ordered goals, each closed when it satisfies its rubric via the self-evaluation grader loop. |
| `deepship`  | Full idea-to-shipped pipeline chaining `deep-interview` → `ralplan` → `ultragoal` → `team`. |

---

## Model routing

OMC's haiku/sonnet/opus routing, by task weight:

| Tier     | Used for                                          | Balanced default                     |
| -------- | ------------------------------------------------- | ------------------------------------ |
| `haiku`  | quick lookups, mechanical edits, docs             | `anthropic:claude-haiku-4-5-20251001`|
| `sonnet` | standard implementation and verification          | `anthropic:claude-sonnet-4-6`        |
| `opus`   | architecture, deep analysis, adversarial review   | `anthropic:claude-opus-4-8`          |

**Presets:** `premium` (never below sonnet), `balanced` (default), `budget`
(collapses heavy work down a tier).

**Override** any tier — pick a different provider entirely:

```ts
createOhMyDcode({ routing: { opus: "openai:gpt-5.5", sonnet: "openai:gpt-5.4" } });
```

```bash
OMD_MODEL_OPUS=openrouter:anthropic/claude-opus-4-8 omd config
```

Precedence (low → high): preset → partial routing map → `models` → `OMD_MODEL_*`
env vars. The `OMD_MODEL_*` env layer is applied by the config loader (the `omd`
CLI and `loadConfig`); `buildDeepAgentConfig`/`resolveModelMap` themselves stay
hermetic and never read `process.env` implicitly, so a programmatic `models`
override is never silently clobbered by ambient env.

### Adversarial cross-model review

The three adversarial agents — **critic, code-reviewer, security-reviewer** —
route to a **different model family** than the implementation tiers by default:
`openai:gpt-5.5`. Having a different model do the fault-finding decorrelates
blind spots — a model rarely catches the mistakes it is itself prone to. This is
the same intuition behind OMC's `ccg` multi-model cross-check.

```bash
omd agents
#  critic            review  opus  openai:gpt-5.5 [read-only, adversarial]
#  code-reviewer     review  opus  openai:gpt-5.5 [read-only, adversarial]
#  security-reviewer review  opus  openai:gpt-5.5 [read-only, adversarial]
#  executor          execution sonnet anthropic:claude-sonnet-4-6
```

Override or disable it:

```ts
createOhMyDcode({ adversarialModel: "openai:gpt-6" });  // a different adversary
createOhMyDcode({ adversarialModel: null });            // disable → route at opus tier
```

```bash
omd config --adversarial-model none      # disable
OMD_ADVERSARIAL_MODEL=openai:gpt-6 omd config
```

> The default routes adversarial review to OpenAI, so a `run` needs
> `OPENAI_API_KEY` in addition to your implementation provider's key (or set
> `adversarialModel` to a model on the same provider, or `null`).

---

## Backends

| `backend`     | Behavior                                                                            |
| ------------- | ----------------------------------------------------------------------------------- |
| `composite` (default) | Project files on real disk under `/workspace/`; agent internals kept in ephemeral state (the [recommended](https://docs.langchain.com/oss/javascript/deepagents/backends) pattern). |
| `filesystem`  | Everything on real disk under `workdir` (virtual-mode sandboxed).                    |
| `state`       | Fully virtual, no disk writes — good for dry runs and tests.                         |

### Human-in-the-loop

Gate sensitive tools behind approval. Tool names are the Deep Agents built-ins
(`execute`, `write_file`, `delete_file`, …):

```ts
createOhMyDcode({ interruptOn: { execute: true, write_file: true, delete_file: true } });
```

### Fault tolerance & the agent loop

The harness installs LangChain's **model** retry middleware by default so
transient model failures (rate limits, flaky network) don't sink a run, and
raises the agent-loop step bound above LangGraph's low default of 25 — a
delegating supervisor spends steps fast because every `task` call drives a
nested sub-agent loop.

**Tool** retries are **off by default**: the built-in tools include
non-idempotent operations (`execute`, `write_file`, `delete_file`), so retrying
a partially-applied call could repeat side effects. Opt in only when the tools
in play are safe to re-run.

```ts
createOhMyDcode({
  modelRetries: 2,        // retries for failed model calls (default 2; 0/null disables)
  toolRetries: 0,         // retries for failed tool calls  (default 0; opt-in)
  recursionLimit: 100,    // max agent-loop steps before LangGraph aborts
});
```

`recursionLimit` is applied as the default invoke-time limit; a per-call
`recursionLimit` in the invoke config still wins. The retry layers map directly
to `modelRetryMiddleware` / `toolRetryMiddleware` passed to `createDeepAgent`'s
`middleware` option.

### Rubric self-evaluation

The harness also installs Deep Agents' native **`RubricMiddleware`** by default —
a self-evaluating grader loop. It stays **dormant** until you pass a `rubric`
(pass/fail criteria) at invoke time; then a grader sub-agent scores the output
against every criterion, injects targeted per-criterion feedback on any failure,
and the agent revises until all criteria pass or the `rubricMaxIterations` cap is
hit. This is how the `ultragoal` workflow closes each goal.

```ts
const agent = await createOhMyDcode({
  rubricMaxIterations: 3,    // grader cap (default 3; 0/null disables the middleware)
  rubricGraderTier: "haiku", // grader model tier (default haiku — cheap scoring)
  graderTools: true,         // give the grader verification tools (default true)
  graderShellTool: true,     // a shell tool for build/test/lint (default true)
  // graderMcpServers defaults to Playwright + an LSP server (launched via npx);
  // override to point at project- or language-specific MCP servers.
});

const result = await agent.invoke({
  messages: [{ role: "user", content: "Add a /health endpoint." }],
  rubric: [
    "- `npm test` passes",
    "- GET /health returns 200 with `{ status: 'ok' }`",
    "- No new type errors (LSP diagnostics clean)",
  ].join("\n"),
});
```

The grader verifies criteria empirically with its tools — running the build and
tests over a **shell** tool, driving the UI with **Playwright**, and querying
diagnostics over an **LSP** server — rather than trusting the transcript. The
grader tools are loaded via [`@langchain/mcp-adapters`](https://github.com/langchain-ai/langchain-mcp-adapters);
set `graderTools: false` for pure-LLM grading with no shell or MCP servers.

### Code interpreter

The harness installs [`@langchain/quickjs`](https://www.npmjs.com/package/@langchain/quickjs)'s
**code interpreter** by default: a sandboxed JavaScript `eval` tool backed by a
QuickJS WASM runtime, plus a programmatic `task()` global for fan-out subagent
dispatch. This is what the fan-out workflows reach for — a workflow keeps its
plan/loop/batch state in JS, fans subagents out and in, validates their typed
results, and returns only a compact roll-up, so intermediate logs and failed
branches never enter the supervisor's context.

It is **read-only by construction**. The sandbox can only call agent tools
through a narrow programmatic-tool-calling (PTC) allowlist that defaults to the
read-only filesystem tools (`ls`, `read_file`, `glob`, `grep`). Mutating tools
(`write_file`, `edit_file`, `execute`, `delete_file`) are **never** exposed — any
allowlist you supply is sanitized against that forbidden set — so code in the
sandbox can inspect the workspace but every write must go back through the
supervisor or a delegated execution agent.

```ts
createOhMyDcode({
  interpreter: true,            // master switch (default true; false omits the eval tool)
  interpreterPtc: ["read_file", "glob", "grep"], // read-only allowlist (sanitized)
  interpreterTimeoutMs: 5000,   // per-eval wall-clock cap (middleware default 5s)
  interpreterMaxPtcCalls: 256,  // tools.* calls per eval (default 256; null lifts it — unsafe)
  interpreterMemoryLimitBytes: 67108864, // sandbox heap cap (middleware default 64MB)
});
```

`@langchain/quickjs` is a hard dependency but loaded lazily at the runtime
boundary, so the SDK-free orchestration core stays importable without the WASM
runtime present.

### Read-only enforcement

The read-only roster agents (research, planning, review) are sandboxed at the
**SDK level** by default: each is given a deny-write filesystem permission rule
(`{ operations: ["write"], paths: ["/**"], mode: "deny" }`), so the SDK rejects
any `write_file`/`edit_file` the agent attempts — prompt discipline alone no
longer has to hold the line. Authoring agents keep the permissive default.

```ts
createOhMyDcode({ enforceReadOnly: true }); // default; false → prompt-only read-only
```

Filesystem permissions don't cover the `execute` (shell) tool, but on the shipped
backends (`state` / `filesystem` / `composite`) `execute` has no shell to run, so
read-only is fully enforced. If you supply your own execution-capable (sandbox)
backend, restrict `execute` separately.

---

## Configuration

Drop a `.omd/config.json` in your project (env vars override it):

```json
{
  "auth": "api-key",
  "routing": "balanced",
  "backend": "composite",
  "models": { "opus": "anthropic:claude-opus-4-8" },
  "interruptOn": { "execute": true },
  "recursionLimit": 100,
  "modelRetries": 2,
  "toolRetries": 0,
  "rubricMaxIterations": 3,
  "rubricGraderTier": "haiku",
  "graderTools": true,
  "graderShellTool": true,
  "interpreter": true,
  "interpreterPtc": ["ls", "read_file", "glob", "grep"],
  "enforceReadOnly": true,
  "skillDirs": ["./my-skills"],
  "memoryPaths": ["./AGENTS.md"]
}
```

Env overrides: `OMD_AUTH` (`oauth`/`api-key`), `OMD_RECURSION_LIMIT`,
`OMD_MODEL_RETRIES`, `OMD_TOOL_RETRIES` (`0`/`none` disables a retry layer),
`OMD_RUBRIC_MAX_ITERATIONS`, `OMD_RUBRIC_GRADER_TIER`, `OMD_GRADER_TOOLS`,
`OMD_GRADER_SHELL_TOOL`, `OMD_INTERPRETER`, `OMD_INTERPRETER_PTC` (comma-separated),
`OMD_INTERPRETER_TIMEOUT_MS`, `OMD_INTERPRETER_MAX_PTC_CALLS`,
`OMD_ENFORCE_READ_ONLY`.

---

## Development

```bash
npm install          # deepagents + typescript + @types/node
npm test             # zero-dependency node:test suite (runs TS directly)
npm run smoke        # offline end-to-end sanity check (no SDK/model needed)
npm run typecheck    # tsc --noEmit
npm run build        # tsc → dist/
npm run gen:skills   # regenerate skills/*/SKILL.md from src/skills.ts
```

The orchestration core (`routing`, `agents`, `prompts`, `skills`, `config`,
`scaffold`, and `buildDeepAgentConfig`) has **no runtime dependency** on the
`deepagents` SDK — the SDK is only touched at the `createOhMyDcode` boundary via
a dynamic import. That keeps the core typecheckable and fully unit-testable
offline; the bundled `SKILL.md` files are generated from `src/skills.ts` and a
test guards against drift.

---

## License

MIT. oh-my-dcode is an independent reimplementation inspired by
[oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode) (MIT, by
Yeachan Heo) and built on [Deep Agents](https://docs.langchain.com/oss/javascript/deepagents/overview).
Not affiliated with or endorsed by either project.
