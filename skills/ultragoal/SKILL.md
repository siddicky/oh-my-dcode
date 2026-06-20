---
name: ultragoal
description: Durable multi-goal execution: decompose a ratified plan into ordered goals and drive each to a verified, reviewed checkpoint.
triggers: ["ultragoal", "ultra goal", "multi-goal", "durable goals", "goal ledger"]
---

# ultragoal

Drive a ratified plan to completion as a durable set of goals, each closed only
on verified, reviewed evidence. Use this after `ralplan` (or `deep-interview` →
`ralplan`) has produced an approved plan.

1. DECOMPOSE — delegate to `planner` to turn the plan into an ordered set of
   independent goals (G001, G002, …), each with a concrete pass-gate (a test,
   build result, or observable behavior). Record them with `write_todos`; this
   todo list is the durable goal ledger.
2. EXECUTE SEQUENTIALLY — drive one goal at a time. Assign each to the right
   execution agent (`executor`, `debugger`, `test-engineer`, or `designer`) by
   tier and lane.
3. QUALITY PASS — once the work for a goal lands, delegate to `code-simplifier`
   to strip duplication and AI-slop without changing behavior.
4. CHECKPOINT WITH EVIDENCE — delegate to `verifier` to run the goal's gate and
   report actual output, then to `code-reviewer` (and `security-reviewer` for
   sensitive work) for the approval pass. Mark the goal done only when both pass
   — never self-approve — then advance to the next goal.
5. STEER — when evidence demands it, add, split, or reorder the remaining goals;
   keep the `write_todos` ledger authoritative at all times. Hand off to `team`
   when independent goals can be worked in parallel.

Report the goals completed, each with the evidence that closed it.
