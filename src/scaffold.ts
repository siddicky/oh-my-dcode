/**
 * Project scaffolding.
 *
 * Materializes the oh-my-dcode roster and workflows as on-disk files in the
 * layout the Deep Agents Code CLI (`dcode`) reads:
 *
 *   .deepagents/AGENTS.md                       — project instructions
 *   .deepagents/agents/<name>/AGENTS.md         — one per roster agent
 *   .deepagents/skills/<name>/SKILL.md          — one per workflow
 *
 * This is the bridge that lets the plain `dcode` CLI run with oh-my-claudecode's
 * orchestration layer, without using the SDK directly.
 *
 * {@link planScaffold} computes the files (pure, testable); {@link writeScaffold}
 * commits them to disk.
 */

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type { AgentSpec, OhMyDcodeOptions } from "./types.ts";
import { composeRoster, resolveAgentModel } from "./agents.ts";
import { resolveModelMap, effectiveAdversarialModel } from "./routing.ts";
import { SKILLS, renderSkillMarkdown } from "./skills.ts";
import { buildAgentsMd } from "./prompts.ts";

/** A single file to write, with a package-root-relative path. */
export interface ScaffoldEntry {
  /** POSIX-style relative path under the target directory. */
  path: string;
  /** Full file contents. */
  content: string;
}

/** Render a roster agent to a Deep Agents Code `AGENTS.md` subagent file. */
export function renderAgentMarkdown(spec: AgentSpec, model: string): string {
  return `---
name: ${spec.name}
description: ${spec.description}
model: ${model}
---

${spec.systemPrompt.trim()}
`;
}

/**
 * Compute every file the scaffold would write, as relative paths. Pure: no disk
 * access, so it can be asserted directly in tests.
 */
export function planScaffold(options: OhMyDcodeOptions = {}): ScaffoldEntry[] {
  const models = resolveModelMap({
    routing: options.routing,
    models: options.models,
  });
  const adversarialModel = effectiveAdversarialModel(options.adversarialModel);
  const roster = composeRoster(options.extraAgents ?? []);
  const entries: ScaffoldEntry[] = [];

  entries.push({
    path: join(".deepagents", "AGENTS.md"),
    content: buildAgentsMd(),
  });

  for (const agent of roster) {
    entries.push({
      path: join(".deepagents", "agents", agent.name, "AGENTS.md"),
      content: renderAgentMarkdown(
        agent,
        resolveAgentModel(agent, models, adversarialModel),
      ),
    });
  }

  for (const skill of SKILLS) {
    entries.push({
      path: join(".deepagents", "skills", skill.name, "SKILL.md"),
      content: renderSkillMarkdown(skill),
    });
  }

  return entries;
}

/** Result of a scaffold write: which files were written vs. skipped. */
export interface ScaffoldResult {
  written: string[];
  skipped: string[];
}

/**
 * Write the scaffold into `targetDir`. By default existing files are left
 * untouched (reported as skipped); pass `force` to overwrite.
 */
export function writeScaffold(
  targetDir: string,
  options: OhMyDcodeOptions = {},
  { force = false }: { force?: boolean } = {},
): ScaffoldResult {
  const entries = planScaffold(options);
  const written: string[] = [];
  const skipped: string[] = [];

  for (const entry of entries) {
    const abs = join(targetDir, entry.path);
    if (!force && existsSync(abs)) {
      skipped.push(entry.path);
      continue;
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, entry.content, "utf8");
    written.push(entry.path);
  }

  return { written, skipped };
}
