---
name: "ultrawork"
description: "Maximum parallelism: decompose the goal into independent units and fan them out across agents at once."
triggers: ["ultrawork", "ulw", "in parallel", "all at once", "fan out"]
---

# ultrawork

Maximize throughput by parallelizing aggressively, driving the fan-out from the
code interpreter (the `eval` tool) so plan, batching, and integration state live
in JS — not in your context window.

1. DECOMPOSE — break the goal into the largest set of mutually independent units
   of work (files, modules, checks, tickets).
2. PARTITION — units that touch the same files must not run concurrently. Group
   the rest into conflict-free lanes.
3. FAN OUT — in a single `eval`, dispatch each lane with the `task()` global and
   await the batch together. Keep batches to about 8 (the runtime caps
   concurrency at 32). Give each `task()` a `responseSchema` so results arrive as
   validated objects, and return only a compact roll-up — intermediate logs and
   failed branches never enter your context.
4. INTEGRATE — apply the returned changes and resolve any merge conflicts. Track
   the lanes with `write_todos`.
5. CLOSE — delegate to `verifier` for one end-to-end check and `code-reviewer`
   for the approval pass.

Inside `eval` the read-only PTC tools (`tools.glob`, `tools.grep`,
`tools.readFile`, `tools.ls`) are available for inspection; mutating tools are
not, so every write goes through `executor` via `task()`. The interpreter has no
imports — inline any helpers you need:

```js
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
```

Prefer one `eval` that fans out over many sequential `task` calls. Log anything
you deliberately left out of scope.
