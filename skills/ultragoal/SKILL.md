---
name: "ultragoal"
description: "Durable multi-goal execution: decompose a ratified plan into ordered goals and drive each to an all-pass checkpoint via rubric self-evaluation."
triggers: ["ultragoal", "ultra goal", "multi-goal", "durable goals", "goal ledger"]
---

# ultragoal

Drive a ratified plan to completion as a durable set of goals, each closed only
when it satisfies every criterion of its rubric. Use this after `ralplan` (or
`deep-interview` → `ralplan`) has produced an approved plan. Closing is handled
by the native rubric self-evaluation loop, not a manual review hand-off.

1. DECOMPOSE — delegate to `planner` to turn the plan into an ordered set of
   independent goals (G001, G002, …). Record them with `write_todos`; this todo
   list is the durable goal ledger.
2. DEFINE THE RUBRIC — for each goal, write its pass-gate as a rubric: crisp,
   independently checkable criteria. Cover what a `verifier` would confirm
   (build, lint, and tests pass with shown output), what a `code-reviewer` would
   raise (no blockers or majors, scope honored), and any observable behavior
   (the page renders / endpoint responds, no new type or diagnostic errors).
3. EXECUTE — drive one goal at a time. Assign each to the right execution agent
   (`executor`, `debugger`, `test-engineer`, or `designer`) by tier and lane.
4. SELF-EVALUATE & ITERATE — close the goal by supplying its rubric as the run's
   `rubric`. The rubric grader scores every criterion — running the build/tests
   with its shell tool, driving the UI with Playwright, and querying diagnostics
   over LSP — injects targeted per-criterion feedback on any FAIL, and iterates
   until all criteria pass or the iteration cap is hit. Mark the goal done only
   on an all-pass grade; if the cap is reached short of passing, report the
   failing criteria plainly rather than claiming success.
5. QUALITY PASS — once a goal passes, delegate to `code-simplifier` to strip
   duplication and AI-slop without changing behavior.
6. STEER — when evidence demands it, add, split, or reorder the remaining goals;
   keep the `write_todos` ledger authoritative at all times. Hand off to `team`
   when independent goals can be worked in parallel.

Report the goals completed, each with the rubric evidence that closed it.
