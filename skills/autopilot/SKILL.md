---
name: autopilot
description: Full autonomous execution from idea to verified working code: expand → plan → build → QA → review.
triggers: ["autopilot", "build me", "make me", "full auto", "handle it all"]
---

# autopilot

Run the complete lifecycle autonomously, one phase at a time. Do not start a
phase until the previous one is done.

1. EXPAND — delegate to `analyst` to extract requirements, constraints, and
   edge cases. If the request is too vague to expand, ask one round of
   clarifying questions first.
2. DESIGN & PLAN — delegate to `architect` for a technical design, then
   `planner` for an ordered, milestone-based plan. Have `critic` stress-test
   the plan and fold in its blockers.
3. EXECUTE — work the plan with `write_todos`. Delegate each milestone to
   `executor` (or `debugger` / `test-engineer` / `designer` as appropriate).
   Run independent milestones in parallel.
4. QA — delegate to `verifier` to build, lint, and test. Fix failures and
   repeat, up to 5 cycles. If the same error persists 3 times, stop and report
   the fundamental issue.
5. REVIEW — delegate in parallel to `code-reviewer` and `security-reviewer`.
   All blockers and majors must be fixed and re-reviewed before completion.

Report what was built with the evidence that it works.
