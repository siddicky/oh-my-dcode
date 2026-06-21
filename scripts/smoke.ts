/**
 * Offline smoke test: exercises the whole orchestration core end to end without
 * the `deepagents` SDK or any network/model call. Run with:
 *   node --experimental-strip-types scripts/smoke.ts
 *
 * Prints a human-readable summary and exits non-zero on any inconsistency.
 */

import { buildDeepAgentConfig } from "../src/agent.ts";
import { ROSTER } from "../src/agents.ts";
import { SKILLS } from "../src/skills.ts";
import { resolveModelMap } from "../src/routing.ts";
import { planScaffold } from "../src/scaffold.ts";

let failures = 0;
function check(label: string, ok: boolean): void {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) failures++;
}

console.log("== oh-my-dcode smoke ==\n");

const models = resolveModelMap();
console.log(`Routing (balanced): haiku=${models.haiku} sonnet=${models.sonnet} opus=${models.opus}\n`);

const config = buildDeepAgentConfig({ workdir: "/tmp/demo" });
console.log(`Supervisor model : ${config.model}`);
console.log(`Subagents        : ${config.subagents.length}`);
console.log(`Backend          : ${config.backend.kind} (root ${config.backend.rootDir})`);
console.log(`Skill dirs       : ${config.skills.length}`);
console.log(`Recursion limit  : ${config.recursionLimit}`);
console.log(`Fault tolerance  : ${config.middleware.map((m) => `${m.kind}=${m.maxRetries}`).join(", ")}\n`);

console.log("Roster:");
for (const a of ROSTER) {
  console.log(`  - ${a.name.padEnd(20)} ${a.lane.padEnd(10)} ${a.tier}`);
}
console.log("\nWorkflows:");
for (const s of SKILLS) console.log(`  - ${s.name}: ${s.description}`);

const scaffold = planScaffold();
console.log(`\nScaffold would write ${scaffold.length} files into .deepagents/\n`);

check("supervisor routes to opus", config.model === models.opus);
check("one subagent per roster agent", config.subagents.length === ROSTER.length);
check("every subagent has a provider:model", config.subagents.every((s) => s.model.includes(":")));
check("eight workflows present", SKILLS.length === 8);
check("scaffold covers roster + skills + AGENTS.md", scaffold.length === ROSTER.length + SKILLS.length + 1);
check("budget routing differs from balanced for opus tier", resolveModelMap({ routing: "budget" }).opus !== models.opus);
check("default harness installs model-retry middleware (tool retries opt-in)", config.middleware.length === 1 && config.middleware[0]?.kind === "model-retry");
check("default recursion limit is set", config.recursionLimit > 25);

console.log(`\n${failures === 0 ? "ALL GOOD" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
