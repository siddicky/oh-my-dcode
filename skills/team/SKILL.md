---
name: "team"
description: "Staged pipeline of coordinated agents: plan → spec → execute → verify → fix, on a shared task list."
triggers: ["team", "pipeline", "coordinate agents", "staged"]
---

# team

Run a coordinated multi-agent pipeline on a shared task list, driving the
dependency-aware execute/verify fan-out from the code interpreter (the `eval`
tool) so the schedule and per-task state stay in JS rather than your context.

1. PLAN — `architect` + `planner` produce the design and the milestone plan;
   `critic` validates it.
2. SPEC — turn each milestone into a precise, self-contained task with a
   pass-gate and an explicit list of task ids it depends on. Record them with
   `write_todos`; this is the authoritative ledger.
3. EXECUTE & VERIFY — in `eval`, walk the dependency graph in waves: each wave is
   the set of tasks whose dependencies are all done. Dispatch a wave with
   `task()` to the right execution agent (`executor`, `debugger`,
   `test-engineer`, `designer`), then dispatch `verifier` on each result against
   its gate. Carry only `{ id, ok }` forward to schedule the next wave.
4. FIX — route any failed task back to execution and re-verify it in the next
   wave. Close the loop with `code-reviewer` (and `security-reviewer` for
   sensitive changes).

Use a `responseSchema` on every `task()` so results are validated objects, and
return only the wave summary. Mutating tools are unavailable inside `eval`, so
all writes happen through the dispatched agents:

```js
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
```

Keep the task list authoritative: every unit of work is a tracked task with a
clear owner lane, declared dependencies, and an explicit gate.
