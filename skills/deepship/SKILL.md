---
name: deepship
description: Full idea-to-shipped pipeline: deep-interview → ralplan → ultragoal → team, run as four gated phases.
triggers: ["deepship", "deep ship", "full pipeline", "idea to shipped", "interview to delivery"]
---

# deepship

Run the full idea-to-shipped pipeline as four gated phases. Do not start a phase
until the previous gate has passed.

1. CLARIFY — run the `deep-interview` workflow to turn the request into a
   crystallized spec (goal, constraints, non-goals, acceptance criteria).
2. PLAN — run the `ralplan` workflow to turn that spec into a ratified,
   adversarially critiqued plan with milestones and gates.
3. EXECUTE — run the `ultragoal` workflow to decompose the plan into durable
   goals and drive each to a verified, reviewed checkpoint.
4. PARALLELIZE — when independent work units materially benefit from it, run the
   `team` workflow for coordinated parallel execution; otherwise stay sequential.

Close with a final `verifier` end-to-end check and a `code-reviewer` approval
pass, then report what shipped with the evidence that it works.
