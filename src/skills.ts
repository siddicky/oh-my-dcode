/**
 * Orchestration workflows ("skills" / modes) ported from oh-my-claudecode.
 *
 * These are the Tier-0 workflows — autopilot, ralph, ultrawork, team, ralplan —
 * expressed as Deep Agents skills. {@link SKILLS} is the single source of
 * truth; the on-disk `skills/<name>/SKILL.md` files (loaded by the Deep Agents
 * SDK and the dcode CLI) are generated from it via `scripts/gen-skills.ts`, and
 * a test asserts the two never drift.
 */

import type { SkillSpec } from "./types.ts";
import { yamlString } from "./yaml.ts";

export const SKILLS: readonly SkillSpec[] = [
  {
    name: "autopilot",
    description:
      "Full autonomous execution from idea to verified working code: expand → plan → build → QA → review.",
    triggers: ["autopilot", "build me", "make me", "full auto", "handle it all"],
    body: `Run the complete lifecycle autonomously, one phase at a time. Do not start a
phase until the previous one is done.

1. EXPAND — delegate to \`analyst\` to extract requirements, constraints, and
   edge cases. If the request is too vague to expand, ask one round of
   clarifying questions first.
2. DESIGN & PLAN — delegate to \`architect\` for a technical design, then
   \`planner\` for an ordered, milestone-based plan. Have \`critic\` stress-test
   the plan and fold in its blockers.
3. EXECUTE — work the plan with \`write_todos\`. Delegate each milestone to
   \`executor\` (or \`debugger\` / \`test-engineer\` / \`designer\` as appropriate).
   Run independent milestones in parallel.
4. QA — delegate to \`verifier\` to build, lint, and test. Fix failures and
   repeat, up to 5 cycles. If the same error persists 3 times, stop and report
   the fundamental issue.
5. REVIEW — delegate in parallel to \`code-reviewer\` and \`security-reviewer\`.
   All blockers and majors must be fixed and re-reviewed before completion.

Report what was built with the evidence that it works.`,
  },
  {
    name: "ralph",
    description:
      "Persistent verify/fix loop: keep iterating on a single goal until a reviewer confirms it is done.",
    triggers: ["ralph", "keep going until", "loop until done", "persist until"],
    body: `Drive one goal to completion through a self-correcting loop. The loop only
stops when an independent reviewer confirms the goal is met.

1. Establish a concrete pass-gate for the goal (a test, build result, or
   observable behavior). If none exists, delegate to \`planner\` to define one.
2. Attempt the work via the appropriate execution agent.
3. Delegate to \`verifier\` to run the gate and report actual output.
4. If the gate fails, diagnose (\`debugger\`/\`tracer\` if the cause is unclear)
   and iterate from step 2.
5. When the gate passes, delegate to \`code-reviewer\` for the approval pass.
   If rejected, fold in the findings and loop again.

Never self-approve. Stop only on a confirmed pass or a genuine blocker you
cannot resolve — and report that blocker plainly.`,
  },
  {
    name: "ultrawork",
    description:
      "Maximum parallelism: decompose the goal into independent units and fan them out across agents at once.",
    triggers: ["ultrawork", "ulw", "in parallel", "all at once", "fan out"],
    body: `Maximize throughput by parallelizing aggressively, driving the fan-out from the
code interpreter (the \`eval\` tool) so plan, batching, and integration state live
in JS — not in your context window.

1. DECOMPOSE — break the goal into the largest set of mutually independent units
   of work (files, modules, checks, tickets).
2. PARTITION — units that touch the same files must not run concurrently. Group
   the rest into conflict-free lanes.
3. FAN OUT — in a single \`eval\`, dispatch each lane with the \`task()\` global and
   await the batch together. Keep batches to about 8 (the runtime caps
   concurrency at 32). Give each \`task()\` a \`responseSchema\` so results arrive as
   validated objects, and return only a compact roll-up — intermediate logs and
   failed branches never enter your context.
4. INTEGRATE — apply the returned changes and resolve any merge conflicts. Track
   the lanes with \`write_todos\`.
5. CLOSE — delegate to \`verifier\` for one end-to-end check and \`code-reviewer\`
   for the approval pass.

Inside \`eval\` the read-only PTC tools (\`tools.glob\`, \`tools.grep\`,
\`tools.readFile\`, \`tools.ls\`) are available for inspection; mutating tools are
not, so every write goes through \`executor\` via \`task()\`. The interpreter has no
imports — inline any helpers you need:

\`\`\`js
const chunk = (xs, n) => xs.reduce((acc, x, i) => {
  if (i % n === 0) acc.push([]);
  acc[acc.length - 1].push(x);
  return acc;
}, []);
const uniqueBy = (xs, key) => {
  const seen = new Set();
  return xs.filter((x) => (seen.has(key(x)) ? false : seen.add(key(x))));
};

const units = [ /* the conflict-free lanes decided above */ ];
const results = [];
for (const batch of chunk(units, 8)) {
  const out = await Promise.all(batch.map((u) => task({
    description: 'Implement ' + u.summary + ' in ' + u.files.join(', '),
    subagentType: 'executor',
    responseSchema: {
      type: 'object',
      properties: {
        unit: { type: 'string' },
        ok: { type: 'boolean' },
        changed: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' },
      },
      required: ['unit', 'ok'],
    },
  })));
  results.push(...out);
}
// Hand back only the compact summary.
uniqueBy(results, (r) => r.unit).map((r) => ({ unit: r.unit, ok: r.ok, changed: r.changed }));
\`\`\`

Prefer one \`eval\` that fans out over many sequential \`task\` calls. Log anything
you deliberately left out of scope.`,
  },
  {
    name: "team",
    description:
      "Staged pipeline of coordinated agents: plan → spec → execute → verify → fix, on a shared task list.",
    triggers: ["team", "pipeline", "coordinate agents", "staged"],
    body: `Run a coordinated multi-agent pipeline on a shared task list, driving the
dependency-aware execute/verify fan-out from the code interpreter (the \`eval\`
tool) so the schedule and per-task state stay in JS rather than your context.

1. PLAN — \`architect\` + \`planner\` produce the design and the milestone plan;
   \`critic\` validates it.
2. SPEC — turn each milestone into a precise, self-contained task with a
   pass-gate and an explicit list of task ids it depends on. Record them with
   \`write_todos\`; this is the authoritative ledger.
3. EXECUTE & VERIFY — in \`eval\`, walk the dependency graph in waves: each wave is
   the set of tasks whose dependencies are all done. Dispatch a wave with
   \`task()\` to the right execution agent (\`executor\`, \`debugger\`,
   \`test-engineer\`, \`designer\`), then dispatch \`verifier\` on each result against
   its gate. Carry only \`{ id, ok }\` forward to schedule the next wave.
4. FIX — route any failed task back to execution and re-verify it in the next
   wave. Close the loop with \`code-reviewer\` (and \`security-reviewer\` for
   sensitive changes).

Use a \`responseSchema\` on every \`task()\` so results are validated objects, and
return only the wave summary. Mutating tools are unavailable inside \`eval\`, so
all writes happen through the dispatched agents:

\`\`\`js
const tasks = [ /* { id, summary, agent, gate, deps: [] } from the spec */ ];
const done = new Set();
const summary = [];
const ready = () => tasks.filter((t) => !done.has(t.id) && t.deps.every((d) => done.has(d)));

let wave;
while ((wave = ready()).length > 0) {
  const built = await Promise.all(wave.map((t) => task({
    description: t.summary,
    subagentType: t.agent,
    responseSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, changed: { type: 'array', items: { type: 'string' } } },
      required: ['id'],
    },
  })));
  const checked = await Promise.all(wave.map((t) => task({
    description: 'Verify task ' + t.id + ' against its gate: ' + t.gate,
    subagentType: 'verifier',
    responseSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, ok: { type: 'boolean' }, evidence: { type: 'string' } },
      required: ['id', 'ok'],
    },
  })));
  for (const c of checked) {
    if (c.ok) done.add(c.id);
    summary.push({ id: c.id, ok: c.ok });
  }
  // Stop scheduling if a wave made no progress (a failing/blocked task).
  if (!checked.some((c) => c.ok)) break;
}
summary;
\`\`\`

Keep the task list authoritative: every unit of work is a tracked task with a
clear owner lane, declared dependencies, and an explicit gate.`,
  },
  {
    name: "ralplan",
    description:
      "Consensus planning gate: produce a plan, stress-test it from multiple perspectives, and converge before building.",
    triggers: ["ralplan", "plan this", "consensus plan", "plan first"],
    body: `Produce a high-confidence plan before any code is written. This is a planning
gate, not an execution mode.

1. Have \`analyst\` crisp up the requirements and unknowns.
2. Have \`architect\` propose a design and \`planner\` turn it into an ordered,
   gated plan.
3. Have \`critic\` adversarially review the plan — where it breaks, what it
   assumes, the cheaper/safer alternative. Optionally get a second perspective
   from \`security-reviewer\` for sensitive work.
4. Fold the critique back into the plan and repeat until the critic returns no
   blockers (consensus reached).
5. Emit the final plan with its milestones and gates. Hand off to \`autopilot\`,
   \`team\`, or \`ultrawork\` for execution.

Do not begin implementation from inside this workflow — its output is a
ratified plan.`,
  },
  {
    name: "deep-interview",
    description:
      "Socratic requirements gate: interview the user in rounds, stress-test from multiple angles, and crystallize a spec before any planning.",
    triggers: ["deep-interview", "deep interview", "clarify requirements", "interview me", "socratic"],
    body: `Clarify a vague request into a crystallized spec before any planning or code.
This is a requirements gate — do not design or implement here.

1. SCOPE — delegate to \`analyst\` to extract the goal, constraints, acceptance
   criteria, and unknowns. For brownfield work, run \`explore\` first to map the
   relevant existing code so the questions are grounded in reality.
2. INTERVIEW LOOP — ask the user targeted clarifying questions in focused rounds.
   After each answer, re-assess the remaining ambiguity across goal, constraints,
   and acceptance criteria. Keep going until ambiguity is low or the user defers;
   for anything deferred, propose a sensible default and record it as an
   assumption.
3. LATERAL REVIEW PANEL — at each ambiguity milestone, run a read-only panel in
   parallel to challenge the emerging understanding: \`architect\` (is it
   feasible?), \`critic\` (the contrarian case), \`code-simplifier\` (a simpler
   framing), and \`explore\` / \`document-specialist\` (what the codebase or docs
   actually say). Fold their findings back into the next round of questions.
4. CRYSTALLIZE — emit one self-contained spec: a one-sentence restated goal,
   constraints, non-goals, acceptance criteria, exposed assumptions, and any open
   questions. This spec is the hand-off to \`ralplan\`.

Never start designing or writing code from inside this workflow — its output is a
ratified understanding, not a plan.`,
  },
  {
    name: "ultragoal",
    description:
      "Durable multi-goal execution: decompose a ratified plan into ordered goals and drive each to an all-pass checkpoint via rubric self-evaluation.",
    triggers: ["ultragoal", "ultra goal", "multi-goal", "durable goals", "goal ledger"],
    body: `Drive a ratified plan to completion as a durable set of goals, each closed only
when it satisfies every criterion of its rubric. Use this after \`ralplan\` (or
\`deep-interview\` → \`ralplan\`) has produced an approved plan. Closing is handled
by the native rubric self-evaluation loop, not a manual review hand-off.

1. DECOMPOSE — delegate to \`planner\` to turn the plan into an ordered set of
   independent goals (G001, G002, …). Record them with \`write_todos\`; this todo
   list is the durable goal ledger.
2. DEFINE THE RUBRIC — for each goal, write its pass-gate as a rubric: crisp,
   independently checkable criteria. Cover what a \`verifier\` would confirm
   (build, lint, and tests pass with shown output), what a \`code-reviewer\` would
   raise (no blockers or majors, scope honored), and any observable behavior
   (the page renders / endpoint responds, no new type or diagnostic errors).
3. EXECUTE — assign each goal to the right execution agent (\`executor\`,
   \`debugger\`, \`test-engineer\`, or \`designer\`) by tier and lane. When goals are
   independent, fan them out from the code interpreter in a single \`eval\` with
   the \`task()\` global (batches of about 8), carrying only each goal's id and
   status back; drive dependent goals one at a time.
4. SELF-EVALUATE & ITERATE — close the goal by supplying its rubric as the run's
   \`rubric\`. The rubric grader scores every criterion — running the build/tests
   with its shell tool, driving the UI with Playwright, and querying diagnostics
   over LSP — injects targeted per-criterion feedback on any FAIL, and iterates
   until all criteria pass or the iteration cap is hit. Mark the goal done only
   on an all-pass grade; if the cap is reached short of passing, report the
   failing criteria plainly rather than claiming success.
5. QUALITY PASS — once a goal passes, delegate to \`code-simplifier\` to strip
   duplication and AI-slop without changing behavior.
6. STEER — when evidence demands it, add, split, or reorder the remaining goals;
   keep the \`write_todos\` ledger authoritative at all times. Hand off to \`team\`
   when independent goals can be worked in parallel.

Report the goals completed, each with the rubric evidence that closed it.`,
  },
  {
    name: "deepship",
    description:
      "Full idea-to-shipped pipeline: deep-interview → ralplan → ultragoal → team, run as four gated phases.",
    triggers: ["deepship", "deep ship", "full pipeline", "idea to shipped", "interview to delivery"],
    body: `Run the full idea-to-shipped pipeline as four gated phases. Do not start a phase
until the previous gate has passed.

1. CLARIFY — run the \`deep-interview\` workflow to turn the request into a
   crystallized spec (goal, constraints, non-goals, acceptance criteria).
2. PLAN — run the \`ralplan\` workflow to turn that spec into a ratified,
   adversarially critiqued plan with milestones and gates.
3. EXECUTE — run the \`ultragoal\` workflow to decompose the plan into durable
   goals and drive each to a verified, reviewed checkpoint.
4. PARALLELIZE — when independent work units materially benefit from it, run the
   \`team\` workflow for coordinated parallel execution; otherwise stay sequential.

Close with a final \`verifier\` end-to-end check and a \`code-reviewer\` approval
pass, then report what shipped with the evidence that it works.`,
  },
];

/** Look up a skill spec by name. */
export function getSkill(name: string): SkillSpec | undefined {
  return SKILLS.find((s) => s.name === name);
}

/**
 * Render a skill spec to its canonical `SKILL.md` content: YAML front-matter
 * (name, description, triggers) followed by the markdown body. This is the
 * exact bytes written to disk, so the drift test can compare directly.
 */
export function renderSkillMarkdown(spec: SkillSpec): string {
  const triggers = spec.triggers.map((t) => JSON.stringify(t)).join(", ");
  return `---
name: ${yamlString(spec.name)}
description: ${yamlString(spec.description)}
triggers: [${triggers}]
---

# ${spec.name}

${spec.body.trim()}
`;
}
