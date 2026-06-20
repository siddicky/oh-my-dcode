---
name: ultrawork
description: Maximum parallelism: decompose the goal into independent units and fan them out across agents at once.
triggers: ["ultrawork", "ulw", "in parallel", "all at once", "fan out"]
---

# ultrawork

Maximize throughput by parallelizing aggressively.

1. Decompose the goal into the largest set of mutually independent units of
   work (files, modules, checks, tickets).
2. Identify conflicts — units that touch the same files must not run
   concurrently. Group the rest into conflict-free lanes.
3. Dispatch each lane to a tier-appropriate agent in a single batch so they run
   concurrently. Track them with `write_todos`.
4. As results return, integrate them and resolve any merge conflicts.
5. Once integrated, delegate to `verifier` for a single end-to-end check and
   `code-reviewer` for the approval pass.

Prefer parallel `task` dispatches over sequential ones whenever the work is
independent. Log anything you deliberately left out of scope.
