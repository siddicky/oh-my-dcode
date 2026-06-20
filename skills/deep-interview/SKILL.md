---
name: "deep-interview"
description: "Socratic requirements gate: interview the user in rounds, stress-test from multiple angles, and crystallize a spec before any planning."
triggers: ["deep-interview", "deep interview", "clarify requirements", "interview me", "socratic"]
---

# deep-interview

Clarify a vague request into a crystallized spec before any planning or code.
This is a requirements gate — do not design or implement here.

1. SCOPE — delegate to `analyst` to extract the goal, constraints, acceptance
   criteria, and unknowns. For brownfield work, run `explore` first to map the
   relevant existing code so the questions are grounded in reality.
2. INTERVIEW LOOP — ask the user targeted clarifying questions in focused rounds.
   After each answer, re-assess the remaining ambiguity across goal, constraints,
   and acceptance criteria. Keep going until ambiguity is low or the user defers;
   for anything deferred, propose a sensible default and record it as an
   assumption.
3. LATERAL REVIEW PANEL — at each ambiguity milestone, run a read-only panel in
   parallel to challenge the emerging understanding: `architect` (is it
   feasible?), `critic` (the contrarian case), `code-simplifier` (a simpler
   framing), and `explore` / `document-specialist` (what the codebase or docs
   actually say). Fold their findings back into the next round of questions.
4. CRYSTALLIZE — emit one self-contained spec: a one-sentence restated goal,
   constraints, non-goals, acceptance criteria, exposed assumptions, and any open
   questions. This spec is the hand-off to `ralplan`.

Never start designing or writing code from inside this workflow — its output is a
ratified understanding, not a plan.
