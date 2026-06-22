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

## Why this exists

The Deep Agents SDK gives you the *scaffolding* for a deep agent — planning,
a virtual filesystem, sub-agents, skills, memory. oh-my-dcode supplies the
*organization* that OMC pioneered on top of that scaffolding:

| oh-my-claudecode concept            | oh-my-dcode implementation                                              |
| ----------------------------------- | ---------------------------------------------------------------------- |
| Specialized agents (≈19)            | A roster of Deep Agents sub-agents (`src/agents.ts`)                    |
| haiku / sonnet / opus model routing | Tiered routing with premium/balanced/budget presets (`src/routing.ts`) |
| Tier-0 workflows (autopilot, ralph, ultrawork, team, ralplan) | Deep Agents skills (`src/skills.ts` → `skills/*/SKILL.md`)              |
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
- **Claude Code subscription (OAuth)** — sign in with a Claude Code / Claude
  Pro/Max subscription and use that token for all `anthropic:*` agents, no API
  key required.

```bash
npm install @langchain/anthropic        # optional peer; only OAuth needs it
omd auth login                          # browser (loopback) sign-in…
omd auth login --no-browser             # …or paste the code (headless/remote)
omd auth status                         # show login + token expiry
omd auth logout                         # remove stored credentials
```

`omd auth login` runs the OAuth (PKCE) flow, then stores the tokens in
`~/.omd/credentials.json` (owner-only, `0600`); the access token is refreshed
automatically before it expires. To use the login for a run, opt in with
`auth: "oauth"` in `.omd/config.json`, `OMD_AUTH=oauth`, or `--auth oauth`.

```bash
unset ANTHROPIC_API_KEY                  # the API rejects both keys at once
OMD_AUTH=oauth omd run "add a /health endpoint and verify it"
```

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
       --yolo   Unattended: grant all permissions (no approval gating) + ~unbounded recursion
```

`omd run --yolo "<task>"` runs fully unattended — it clears any `interruptOn`
approval gating and lifts the recursion limit to effectively unbounded. A given
`--recursion-limit` still takes precedence, so you can cap an otherwise-yolo run.

---

## The roster

18 specialized agents across five lanes. Review, planning, and research agents
are **read-only** so the agent that writes code is never the one that approves
it — OMC's author/review separation.

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
composed end-to-end by `deepship`):

| Workflow    | What it does                                                                      |
| ----------- | -------------------------------------------------------------------------------- |
| `autopilot` | Idea → verified code: expand → design/plan → build → QA → review.                |
| `ralph`     | Persistent verify/fix loop until an independent reviewer confirms the goal.      |
| `ultrawork` | Maximum parallelism: decompose into conflict-free lanes and fan out.             |
| `team`      | Staged pipeline (plan → spec → execute → verify → fix) on a shared task list.    |
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
  "skillDirs": ["./my-skills"],
  "memoryPaths": ["./AGENTS.md"]
}
```

Env overrides: `OMD_AUTH` (`oauth`/`api-key`), `OMD_RECURSION_LIMIT`,
`OMD_MODEL_RETRIES`, `OMD_TOOL_RETRIES` (`0`/`none` disables a retry layer),
`OMD_RUBRIC_MAX_ITERATIONS`, `OMD_RUBRIC_GRADER_TIER`, `OMD_GRADER_TOOLS`,
`OMD_GRADER_SHELL_TOOL`.

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
