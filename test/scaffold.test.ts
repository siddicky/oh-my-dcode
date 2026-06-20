import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  planScaffold,
  writeScaffold,
  renderAgentMarkdown,
} from "../src/scaffold.ts";
import { ROSTER } from "../src/agents.ts";
import { SKILLS } from "../src/skills.ts";

test("planScaffold emits AGENTS.md, one file per agent, one per skill", () => {
  const entries = planScaffold();
  // 1 root AGENTS.md + roster + skills
  assert.equal(entries.length, 1 + ROSTER.length + SKILLS.length);
  assert.ok(entries.some((e) => e.path === join(".deepagents", "AGENTS.md")));
  for (const agent of ROSTER) {
    const p = join(".deepagents", "agents", agent.name, "AGENTS.md");
    assert.ok(entries.some((e) => e.path === p), `missing ${p}`);
  }
  for (const skill of SKILLS) {
    const p = join(".deepagents", "skills", skill.name, "SKILL.md");
    assert.ok(entries.some((e) => e.path === p), `missing ${p}`);
  }
});

test("agent markdown carries name/description/model front-matter", () => {
  const agent = ROSTER[0]!;
  const md = renderAgentMarkdown(agent, "anthropic:claude-opus-4-8");
  assert.match(md, /^---\n/);
  assert.ok(md.includes(`name: ${agent.name}`));
  assert.ok(md.includes("model: anthropic:claude-opus-4-8"));
});

test("scaffold model reflects the routing preset", () => {
  const entries = planScaffold({ routing: "budget" });
  const architect = entries.find((e) =>
    e.path.endsWith(join("agents", "architect", "AGENTS.md")),
  );
  assert.ok(architect);
  // architect is opus-tier; under budget that resolves to the sonnet model.
  assert.match(architect.content, /model: anthropic:claude-sonnet-4-6/);
});

test("writeScaffold writes files to disk, then skips existing ones", () => {
  const dir = mkdtempSync(join(tmpdir(), "omd-scaffold-"));
  try {
    const first = writeScaffold(dir, {});
    assert.equal(first.skipped.length, 0);
    assert.ok(first.written.length > 0);
    assert.ok(existsSync(join(dir, ".deepagents", "AGENTS.md")));
    assert.ok(
      existsSync(join(dir, ".deepagents", "agents", "executor", "AGENTS.md")),
    );
    assert.ok(
      existsSync(join(dir, ".deepagents", "skills", "autopilot", "SKILL.md")),
    );

    // Second run without force: everything already exists -> all skipped.
    const second = writeScaffold(dir, {});
    assert.equal(second.written.length, 0);
    assert.equal(second.skipped.length, first.written.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeScaffold force overwrites existing files", () => {
  const dir = mkdtempSync(join(tmpdir(), "omd-scaffold-"));
  try {
    const target = join(dir, ".deepagents", "AGENTS.md");
    mkdirSync(join(dir, ".deepagents"), { recursive: true });
    writeFileSync(target, "OLD");
    const result = writeScaffold(dir, {}, { force: true });
    assert.ok(result.written.includes(join(".deepagents", "AGENTS.md")));
    assert.notEqual(readFileSync(target, "utf8"), "OLD");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
