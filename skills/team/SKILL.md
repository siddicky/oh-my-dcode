---
name: team
description: Staged pipeline of coordinated agents: plan → spec → execute → verify → fix, on a shared task list.
triggers: ["team", "pipeline", "coordinate agents", "staged"]
---

# team

Run a coordinated multi-agent pipeline on a shared task list.

1. PLAN — `architect` + `planner` produce the design and the milestone plan;
   `critic` validates it.
2. SPEC — turn each milestone into a precise, self-contained task with a
   pass-gate. Record them with `write_todos`.
3. EXECUTE — assign tasks to execution agents (`executor`, `debugger`,
   `test-engineer`, `designer`) by tier and lane. Run independent tasks in
   parallel; respect declared dependencies.
4. VERIFY — `verifier` checks each completed task against its gate.
5. FIX — route failures back to execution, then re-verify. Close the loop with
   `code-reviewer` (and `security-reviewer` for sensitive changes).

Keep the task list authoritative: every unit of work is a tracked task with a
clear owner lane and an explicit gate.
