---
name: ralplan
description: Consensus planning gate: produce a plan, stress-test it from multiple perspectives, and converge before building.
triggers: ["ralplan", "plan this", "consensus plan", "plan first"]
---

# ralplan

Produce a high-confidence plan before any code is written. This is a planning
gate, not an execution mode.

1. Have `analyst` crisp up the requirements and unknowns.
2. Have `architect` propose a design and `planner` turn it into an ordered,
   gated plan.
3. Have `critic` adversarially review the plan — where it breaks, what it
   assumes, the cheaper/safer alternative. Optionally get a second perspective
   from `security-reviewer` for sensitive work.
4. Fold the critique back into the plan and repeat until the critic returns no
   blockers (consensus reached).
5. Emit the final plan with its milestones and gates. Hand off to `autopilot`,
   `team`, or `ultrawork` for execution.

Do not begin implementation from inside this workflow — its output is a
ratified plan.
