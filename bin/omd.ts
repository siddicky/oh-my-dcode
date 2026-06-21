#!/usr/bin/env -S node --experimental-strip-types
/**
 * omd — the oh-my-dcode CLI.
 *
 * Subcommands that only inspect or scaffold (`agents`, `skills`, `config`,
 * `init`) run with zero third-party dependencies. `run` (the default) builds a
 * live agent and therefore requires the `deepagents` package plus a configured
 * model provider.
 *
 * Runs directly from TypeScript source via Node's native type stripping
 * (Node >= 22.6), so no build step is needed to use it.
 */

import { parseArgs } from "node:util";
import { resolveModelMap, effectiveAdversarialModel } from "../src/routing.ts";
import { ROSTER, resolveAgentModel } from "../src/agents.ts";
import { SKILLS } from "../src/skills.ts";
import { loadConfig } from "../src/config.ts";
import { writeScaffold } from "../src/scaffold.ts";
import { buildDeepAgentConfig } from "../src/agent.ts";
import type { OhMyDcodeOptions } from "../src/types.ts";

const USAGE = `oh-my-dcode (omd) — multi-agent orchestration for Deep Agents Code

Usage:
  omd [run] "<task>"        Orchestrate a task to completion (needs deepagents + API key)
  omd -n "<task>"           Same as run (non-interactive single shot)
  omd init [--force]        Write the OMC roster + workflows into ./.deepagents
  omd agents                List the specialized agent roster and their models
  omd skills                List the orchestration workflows
  omd config                Show the resolved model routing and options
  omd help                  Show this help

Options:
  --routing <preset>        premium | balanced | budget   (default: balanced)
  --backend <kind>          composite | state | filesystem (default: composite)
  --adversarial-model <m>   Model for adversarial agents (critic/reviewers);
                            'none' disables (default: openai:gpt-5.5)
  --workdir <dir>           Working directory the agent operates on
  --recursion-limit <n>     Max agent-loop steps before aborting (default: 100)
  --model-retries <n>       Retries for failed model calls; 0 disables (default: 2)
  --tool-retries <n>        Retries for failed tool calls; opt-in, may repeat
                            side effects (default: 0)
  --rubric "<criteria>"     Pass/fail criteria the agent self-evaluates against,
                            iterating until all pass or the cap is hit (run only)
  --rubric-iterations <n>   Cap on rubric self-evaluation cycles; 0 disables
                            (default: 3)
  --no-grader-tools         Grade from the transcript only — no shell/Playwright/
                            LSP verification tools for the rubric grader
  --yolo                    Unattended run: grant all permissions (no approval
                            gating) and lift the recursion limit to ~unbounded.
                            A given --recursion-limit still wins.
  --force                   For init: overwrite existing files

Environment:
  OMD_ROUTING, OMD_BACKEND, OMD_WORKDIR, OMD_ADVERSARIAL_MODEL
  OMD_MODEL_HAIKU, OMD_MODEL_SONNET, OMD_MODEL_OPUS   (override a tier's model)
  OMD_RECURSION_LIMIT, OMD_MODEL_RETRIES, OMD_TOOL_RETRIES   (harness tuning)
  OMD_RUBRIC_MAX_ITERATIONS, OMD_RUBRIC_GRADER_TIER         (rubric self-eval)
  OMD_GRADER_TOOLS, OMD_GRADER_SHELL_TOOL                   (grader tools)
  ANTHROPIC_API_KEY / OPENAI_API_KEY (or your provider's key)   (required for 'run')
`;

/**
 * Recursion limit applied by `--yolo`: high enough to be effectively unbounded
 * for any real run, without being literally infinite (a finite ceiling still
 * surfaces a runaway loop instead of spinning forever).
 */
const YOLO_RECURSION_LIMIT = 1_000_000;

function optionsFromFlags(
  values: Record<string, unknown>,
  cwd: string,
): OhMyDcodeOptions {
  const fromConfig = loadConfig(cwd);
  const options: OhMyDcodeOptions = { ...fromConfig };
  if (typeof values.routing === "string") {
    options.routing = values.routing as OhMyDcodeOptions["routing"];
  }
  if (typeof values.backend === "string") {
    options.backend = values.backend as OhMyDcodeOptions["backend"];
  }
  if (typeof values["adversarial-model"] === "string") {
    const raw = values["adversarial-model"].trim();
    options.adversarialModel = /^(none|off|false|disable)$/i.test(raw) ? null : raw;
  }
  if (typeof values.workdir === "string") {
    options.workdir = values.workdir;
  }
  if (typeof values["recursion-limit"] === "string") {
    const n = Number(values["recursion-limit"]);
    if (Number.isInteger(n) && n > 0) options.recursionLimit = n;
  }
  if (typeof values["model-retries"] === "string") {
    const n = Number(values["model-retries"]);
    if (Number.isInteger(n) && n >= 0) options.modelRetries = n;
  }
  if (typeof values["tool-retries"] === "string") {
    const n = Number(values["tool-retries"]);
    if (Number.isInteger(n) && n >= 0) options.toolRetries = n;
  }
  if (typeof values["rubric-iterations"] === "string") {
    const n = Number(values["rubric-iterations"]);
    if (Number.isInteger(n) && n >= 0) options.rubricMaxIterations = n;
  }
  if (values["no-grader-tools"]) options.graderTools = false;
  // --yolo: run fully unattended — grant all permissions (no approval gating)
  // and lift the recursion limit to effectively unbounded. An explicit
  // --recursion-limit still wins so it can be dialed back down.
  if (values.yolo) {
    options.interruptOn = {};
    if (typeof values["recursion-limit"] !== "string") {
      options.recursionLimit = YOLO_RECURSION_LIMIT;
    }
  }
  return options;
}

function cmdAgents(options: OhMyDcodeOptions): void {
  const models = resolveModelMap({
    routing: options.routing,
    models: options.models,
  });
  const adversarialModel = effectiveAdversarialModel(options.adversarialModel);
  console.log(`oh-my-dcode roster (${ROSTER.length} agents)\n`);
  for (const agent of ROSTER) {
    const tags = [agent.readOnly ? "read-only" : "", agent.adversarial ? "adversarial" : ""]
      .filter(Boolean)
      .join(", ");
    const tagStr = tags ? ` [${tags}]` : "";
    const model = resolveAgentModel(agent, models, adversarialModel);
    console.log(`  ${agent.name.padEnd(20)} ${agent.lane.padEnd(10)} ${agent.tier.padEnd(7)} ${model}${tagStr}`);
    console.log(`  ${" ".repeat(20)} ${agent.description}\n`);
  }
}

function cmdSkills(): void {
  console.log(`oh-my-dcode workflows (${SKILLS.length})\n`);
  for (const skill of SKILLS) {
    console.log(`  ${skill.name.padEnd(12)} ${skill.description}`);
    console.log(`  ${" ".repeat(12)} triggers: ${skill.triggers.join(", ")}\n`);
  }
}

function cmdConfig(options: OhMyDcodeOptions): void {
  const config = buildDeepAgentConfig(options);
  const models = resolveModelMap({
    routing: options.routing,
    models: options.models,
  });
  const adversarialModel = effectiveAdversarialModel(options.adversarialModel);
  console.log("Resolved model routing:");
  console.log(`  haiku  -> ${models.haiku}`);
  console.log(`  sonnet -> ${models.sonnet}`);
  console.log(`  opus   -> ${models.opus}`);
  console.log(`  adversarial (critic/reviewers) -> ${adversarialModel ?? "(disabled — route at tier)"}`);
  console.log(`\nSupervisor model: ${config.model}`);
  console.log(`Backend: ${config.backend.kind}` + (config.backend.rootDir ? ` (root: ${config.backend.rootDir})` : ""));
  console.log(`Subagents: ${config.subagents.length}`);
  console.log(`Skill dirs: ${config.skills.join(", ")}`);
  console.log(`Recursion limit: ${config.recursionLimit}`);
  const retries = config.middleware
    .map((m) => (m.kind === "rubric" ? "" : `${m.kind}=${m.maxRetries}`))
    .filter(Boolean)
    .join(", ");
  console.log(`Fault tolerance: ${retries || "(disabled)"}`);
  const rubric = config.middleware.find((m) => m.kind === "rubric");
  if (rubric) {
    const toolNames = [
      rubric.shellTool ? "shell" : "",
      ...rubric.mcpServers.map((s) => s.name),
    ].filter(Boolean);
    console.log(
      `Rubric self-eval: max ${rubric.maxIterations} iters, grader ${rubric.model}, ` +
        `tools ${toolNames.length ? toolNames.join("+") : "(none)"}`,
    );
  } else {
    console.log("Rubric self-eval: (disabled)");
  }
  const gated = Object.entries(config.interruptOn)
    .filter(([, on]) => on)
    .map(([tool]) => tool);
  console.log(
    `Approvals: ${gated.length ? `gate ${gated.join(", ")}` : "all permitted (no approval gating)"}`,
  );
}

function cmdInit(options: OhMyDcodeOptions, cwd: string, force: boolean): void {
  const result = writeScaffold(cwd, options, { force });
  console.log(`Scaffolded oh-my-dcode into ${cwd}/.deepagents`);
  for (const path of result.written) console.log(`  + ${path}`);
  for (const path of result.skipped) console.log(`  = ${path} (exists; use --force to overwrite)`);
  console.log(`\n${result.written.length} written, ${result.skipped.length} skipped.`);
  console.log("Run the Deep Agents Code CLI (dcode) in this directory to use them.");
}

async function cmdRun(
  task: string,
  options: OhMyDcodeOptions,
  rubric?: string,
): Promise<void> {
  if (!task.trim()) {
    console.error("No task provided. Usage: omd run \"<task>\"");
    process.exitCode = 1;
    return;
  }
  // Imported lazily so inspect/scaffold commands never require the SDK.
  const { createOhMyDcode } = await import("../src/agent.ts");
  const agent = await createOhMyDcode(options);
  const result = await agent.invoke({
    messages: [{ role: "user", content: task }],
    // When provided, the rubric engages the self-evaluation grader loop.
    ...(rubric ? { rubric } : {}),
  });
  const messages = result.messages ?? [];
  const last = messages[messages.length - 1];
  if (last && last.content != null) {
    console.log(typeof last.content === "string" ? last.content : JSON.stringify(last.content, null, 2));
  } else {
    console.error("omd: run completed but produced no output message.");
  }
}

async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      routing: { type: "string" },
      backend: { type: "string" },
      "adversarial-model": { type: "string" },
      workdir: { type: "string" },
      "recursion-limit": { type: "string" },
      "model-retries": { type: "string" },
      "tool-retries": { type: "string" },
      rubric: { type: "string" },
      "rubric-iterations": { type: "string" },
      "no-grader-tools": { type: "boolean", default: false },
      yolo: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      "non-interactive": { type: "boolean", short: "n", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  const cwd = typeof values.workdir === "string" ? values.workdir : process.cwd();
  const options = optionsFromFlags(values, cwd);
  const rubric = typeof values.rubric === "string" ? values.rubric : undefined;

  const [command, ...rest] = positionals;

  if (values.help || command === "help") {
    console.log(USAGE);
    return;
  }

  switch (command) {
    case "agents":
      return cmdAgents(options);
    case "skills":
      return cmdSkills();
    case "config":
      return cmdConfig(options);
    case "init":
      return cmdInit(options, cwd, Boolean(values.force));
    case "run":
      return cmdRun(rest.join(" "), options, rubric);
    case undefined:
      if (values["non-interactive"]) {
        console.error("No task provided. Usage: omd -n \"<task>\"");
        process.exitCode = 1;
        return;
      }
      console.log(USAGE);
      return;
    default:
      // Treat a bare `omd "<task>"` (no known subcommand) as a run.
      return cmdRun([command, ...rest].join(" "), options, rubric);
  }
}

main(process.argv.slice(2)).catch((err) => {
  console.error(`omd: ${(err as Error).message}`);
  process.exitCode = 1;
});
