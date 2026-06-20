---
name: "ralph"
description: "Persistent verify/fix loop: keep iterating on a single goal until a reviewer confirms it is done."
triggers: ["ralph", "keep going until", "loop until done", "persist until"]
---

# ralph

Drive one goal to completion through a self-correcting loop. The loop only
stops when an independent reviewer confirms the goal is met.

1. Establish a concrete pass-gate for the goal (a test, build result, or
   observable behavior). If none exists, delegate to `planner` to define one.
2. Attempt the work via the appropriate execution agent.
3. Delegate to `verifier` to run the gate and report actual output.
4. If the gate fails, diagnose (`debugger`/`tracer` if the cause is unclear)
   and iterate from step 2.
5. When the gate passes, delegate to `code-reviewer` for the approval pass.
   If rejected, fold in the findings and loop again.

Never self-approve. Stop only on a confirmed pass or a genuine blocker you
cannot resolve — and report that blocker plainly.
