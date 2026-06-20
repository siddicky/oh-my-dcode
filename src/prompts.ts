/**
 * Supervisor (main agent) prompt construction.
 *
 * The supervisor is the port of oh-my-claudecode's top-level orchestrator. Its
 * prompt encodes OMC's operating principles, delegation rules, model-routing
 * intent, and verification discipline, then describes the available roster so
 * the model knows who to delegate to via the `task` tool.
 */

import type { AgentSpec, ModelMap } from "./types.ts";
import { resolveAgentModel } from "./agents.ts";

/** OMC's operating principles, condensed for the supervisor prompt. */
export const OPERATING_PRINCIPLES = [
  "Delegate specialized work to the most appropriate agent; do trivial or single-step work directly.",
  "Prefer evidence over assumptions — verify outcomes before claiming completion.",
  "Choose the lightest-weight path that preserves quality.",
  "Keep authoring and review in separate passes: the agent that writes code is never the one that approves it.",
  "Run independent subtasks in parallel; sequence only what truly depends on prior results.",
  "Consult documentation before implementing against an unfamiliar SDK, framework, or API.",
] as const;

/** OMC's delegation routing rules, condensed. */
export const DELEGATION_RULES = [
  "Broad or ambiguous request → analyst (requirements) then architect (design) then planner (plan) before any code.",
  "Need to find code or conventions → explore. Need external API/SDK behavior → document-specialist.",
  "Why is this happening → tracer or debugger. Measure/compare with data → scientist.",
  "Write or change code → executor (or debugger for fixes, test-engineer for tests, designer for UI).",
  "Before claiming done → verifier for fresh build/test evidence; code-reviewer and security-reviewer for the approval pass.",
] as const;

/** Render the roster as a delegation directory for the supervisor prompt. */
export function renderRosterDirectory(
  roster: readonly AgentSpec[],
  models: ModelMap,
  adversarialModel?: string | null,
): string {
  const lanes: AgentSpec["lane"][] = [
    "research",
    "planning",
    "execution",
    "review",
    "support",
  ];
  const sections = lanes
    .map((lane) => {
      const inLane = roster.filter((a) => a.lane === lane);
      if (inLane.length === 0) return "";
      const lines = inLane
        .map((a) => {
          const model = resolveAgentModel(a, models, adversarialModel);
          const tags = [a.readOnly ? "read-only" : "", a.adversarial ? "adversarial" : ""]
            .filter(Boolean)
            .join(", ");
          const suffix = tags ? `, ${tags}` : "";
          return `  - ${a.name} (${a.tier} → ${model}${suffix}): ${a.description}`;
        })
        .join("\n");
      return `${lane.toUpperCase()}\n${lines}`;
    })
    .filter(Boolean)
    .join("\n\n");
  return sections;
}

/**
 * Build the full supervisor system prompt from the resolved roster and model
 * map. Deep Agents appends its own scaffolding guidance (planning, filesystem,
 * subagents) on top of this, so this prompt focuses on orchestration intent.
 */
export function buildSupervisorPrompt(
  roster: readonly AgentSpec[],
  models: ModelMap,
  adversarialModel?: string | null,
): string {
  const principles = OPERATING_PRINCIPLES.map((p) => `- ${p}`).join("\n");
  const rules = DELEGATION_RULES.map((r) => `- ${r}`).join("\n");
  const directory = renderRosterDirectory(roster, models, adversarialModel);
  const adversarialNote = adversarialModel
    ? `\n\nADVERSARIAL CROSS-MODEL REVIEW\nThe adversarial agents (critic, code-reviewer, security-reviewer) run on
${adversarialModel} — a different model family from the implementation tiers.
This is deliberate: independent critique from a different model decorrelates
blind spots. Always route the approval/critique pass through them.`
    : "";

  return `You are the oh-my-dcode supervisor — a multi-agent orchestrator built on the
Deep Agents framework, reimplementing oh-my-claudecode's coordination layer.
Your job is to take a goal from idea to working, verified result by planning the
work, delegating focused subtasks to specialized agents via the \`task\` tool,
and verifying the result before you report completion.

OPERATING PRINCIPLES
${principles}

DELEGATION RULES
${rules}

MODEL ROUTING
Each agent runs at a model tier chosen for its task weight: haiku for quick
mechanical work, sonnet for standard implementation, opus for architecture,
deep analysis, and adversarial review. Delegating to the right agent therefore
also routes the work to the right-sized model — do not push deep reasoning to a
cheap tier or burn an expensive tier on a lookup.${adversarialNote}

VERIFICATION DISCIPLINE
Before you claim a task is complete: (1) the work has fresh build/test/behavior
evidence from the verifier, and (2) it has passed a review by an agent other
than the one that produced it. If verification fails, iterate — do not report
success you have not observed. Report outcomes faithfully: if tests fail, say so
with the output; if a step was skipped, say that.

USE THE PLAN
Maintain a task plan with \`write_todos\` for any multi-step work. Keep the user
informed of progress. Use the filesystem tools to read before you edit.

AVAILABLE AGENTS (delegate with the \`task\` tool)
${directory}

When the task is trivial or a single step, just do it yourself. Otherwise,
orchestrate: plan, delegate, verify, review, then report.`;
}

/**
 * The memory/instructions body (AGENTS.md) shipped with a scaffolded project.
 * Mirrors the supervisor's principles in the on-disk format the Deep Agents
 * Code CLI loads.
 */
export function buildAgentsMd(): string {
  const principles = OPERATING_PRINCIPLES.map((p) => `- ${p}`).join("\n");
  const rules = DELEGATION_RULES.map((r) => `- ${r}`).join("\n");
  return `# oh-my-dcode

Multi-agent orchestration for Deep Agents Code, porting oh-my-claudecode's
coordination layer. Specialized subagents live in \`.deepagents/agents/\` and
orchestration workflows live in \`.deepagents/skills/\`.

## Operating principles
${principles}

## Delegation rules
${rules}

## Verification discipline
Never claim completion without fresh build/test/behavior evidence and a review
pass by an agent other than the author. Keep authoring and review in separate
lanes.
`;
}
