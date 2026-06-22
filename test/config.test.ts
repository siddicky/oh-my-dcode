import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseFileConfig,
  parseEnvConfig,
  mergeOptions,
  loadConfig,
  CONFIG_RELATIVE_PATH,
} from "../src/config.ts";

test("parseFileConfig keeps valid fields and drops junk", () => {
  const parsed = parseFileConfig({
    routing: "budget",
    backend: "state",
    workdir: "/tmp/x",
    models: { opus: "openai:gpt-5.5", bogus: 1 },
    interruptOn: { execute: true, weird: "no" },
    skillDirs: ["./a", 5, ""],
    memoryPaths: ["./AGENTS.md"],
    unknownKey: "ignored",
  });
  assert.equal(parsed.routing, "budget");
  assert.equal(parsed.backend, "state");
  assert.equal(parsed.workdir, "/tmp/x");
  assert.deepEqual(parsed.models, { opus: "openai:gpt-5.5" });
  assert.deepEqual(parsed.interruptOn, { execute: true });
  assert.deepEqual(parsed.skillDirs, ["./a"]);
  assert.deepEqual(parsed.memoryPaths, ["./AGENTS.md"]);
});

test("parseFileConfig reads harness tuning fields", () => {
  const parsed = parseFileConfig({
    recursionLimit: 200,
    modelRetries: 4,
    toolRetries: 0,
  });
  assert.equal(parsed.recursionLimit, 200);
  assert.equal(parsed.modelRetries, 4);
  assert.equal(parsed.toolRetries, 0);
});

test("parseFileConfig disables retries on null/false and drops bad numbers", () => {
  assert.equal(parseFileConfig({ modelRetries: null }).modelRetries, null);
  assert.equal(parseFileConfig({ toolRetries: false }).toolRetries, null);
  // Non-integer / non-positive recursion limits are dropped, not trusted.
  assert.equal(parseFileConfig({ recursionLimit: 0 }).recursionLimit, undefined);
  assert.equal(parseFileConfig({ recursionLimit: 1.5 }).recursionLimit, undefined);
});

test("parseEnvConfig reads harness tuning vars", () => {
  const env = {
    OMD_RECURSION_LIMIT: "150",
    OMD_MODEL_RETRIES: "3",
    OMD_TOOL_RETRIES: "none",
  } as NodeJS.ProcessEnv;
  const parsed = parseEnvConfig(env);
  assert.equal(parsed.recursionLimit, 150);
  assert.equal(parsed.modelRetries, 3);
  assert.equal(parsed.toolRetries, null); // "none" disables
});

test("parseFileConfig reads rubric self-evaluation fields", () => {
  const parsed = parseFileConfig({
    rubricMaxIterations: 5,
    rubricGraderTier: "sonnet",
    graderTools: false,
    graderShellTool: true,
    graderMcpServers: [
      { name: "playwright", transport: "stdio", command: "npx", args: ["@playwright/mcp"] },
      { name: "remote", transport: "http", url: "http://localhost:9000/mcp" },
      { name: "", transport: "stdio" }, // dropped: empty name
      { transport: "stdio" }, // dropped: no name
      { name: "bad", transport: "carrier-pigeon" }, // dropped: bad transport
    ],
  });
  assert.equal(parsed.rubricMaxIterations, 5);
  assert.equal(parsed.rubricGraderTier, "sonnet");
  assert.equal(parsed.graderTools, false);
  assert.equal(parsed.graderShellTool, true);
  assert.deepEqual(parsed.graderMcpServers, [
    { name: "playwright", transport: "stdio", command: "npx", args: ["@playwright/mcp"] },
    { name: "remote", transport: "http", url: "http://localhost:9000/mcp" },
  ]);
});

test("parseFileConfig disables the rubric grader on null and drops bad tiers", () => {
  assert.equal(parseFileConfig({ rubricMaxIterations: null }).rubricMaxIterations, null);
  assert.equal(parseFileConfig({ rubricGraderTier: "ultra" }).rubricGraderTier, undefined);
});

test("parseFileConfig and parseEnvConfig read enforceReadOnly", () => {
  assert.equal(parseFileConfig({ enforceReadOnly: false }).enforceReadOnly, false);
  assert.equal(parseFileConfig({ enforceReadOnly: true }).enforceReadOnly, true);
  assert.equal(parseFileConfig({}).enforceReadOnly, undefined);
  assert.equal(
    parseEnvConfig({ OMD_ENFORCE_READ_ONLY: "off" } as NodeJS.ProcessEnv).enforceReadOnly,
    false,
  );
});

test("parseFileConfig reads interpreter fields", () => {
  const parsed = parseFileConfig({
    interpreter: false,
    interpreterPtc: ["read_file", "grep", ""],
    interpreterMemoryLimitBytes: 2048,
    interpreterTimeoutMs: 3000,
    interpreterMaxPtcCalls: 32,
    interpreterMaxResultChars: 6000,
  });
  assert.equal(parsed.interpreter, false);
  // Empty entries are dropped; sanitization of mutating tools happens later.
  assert.deepEqual(parsed.interpreterPtc, ["read_file", "grep"]);
  assert.equal(parsed.interpreterMemoryLimitBytes, 2048);
  assert.equal(parsed.interpreterTimeoutMs, 3000);
  assert.equal(parsed.interpreterMaxPtcCalls, 32);
  assert.equal(parsed.interpreterMaxResultChars, 6000);
});

test("parseFileConfig handles the interpreter PTC-call limit edges", () => {
  // null/disable lifts the cap; 0 is invalid (the middleware needs >= 1).
  assert.equal(parseFileConfig({ interpreterMaxPtcCalls: null }).interpreterMaxPtcCalls, null);
  assert.equal(parseFileConfig({ interpreterMaxPtcCalls: "off" }).interpreterMaxPtcCalls, null);
  assert.equal(parseFileConfig({ interpreterMaxPtcCalls: 0 }).interpreterMaxPtcCalls, undefined);
});

test("parseEnvConfig reads interpreter vars", () => {
  const env = {
    OMD_INTERPRETER: "off",
    OMD_INTERPRETER_PTC: "read_file, grep , ls",
    OMD_INTERPRETER_TIMEOUT_MS: "4500",
    OMD_INTERPRETER_MAX_PTC_CALLS: "64",
  } as NodeJS.ProcessEnv;
  const parsed = parseEnvConfig(env);
  assert.equal(parsed.interpreter, false);
  assert.deepEqual(parsed.interpreterPtc, ["read_file", "grep", "ls"]);
  assert.equal(parsed.interpreterTimeoutMs, 4500);
  assert.equal(parsed.interpreterMaxPtcCalls, 64);
});

test("parseEnvConfig reads rubric self-evaluation vars", () => {
  const env = {
    OMD_RUBRIC_MAX_ITERATIONS: "4",
    OMD_RUBRIC_GRADER_TIER: "opus",
    OMD_GRADER_TOOLS: "false",
    OMD_GRADER_SHELL_TOOL: "1",
  } as NodeJS.ProcessEnv;
  const parsed = parseEnvConfig(env);
  assert.equal(parsed.rubricMaxIterations, 4);
  assert.equal(parsed.rubricGraderTier, "opus");
  assert.equal(parsed.graderTools, false);
  assert.equal(parsed.graderShellTool, true);
});

test("parseFileConfig reads the auth mode and drops junk", () => {
  assert.equal(parseFileConfig({ auth: "oauth" }).auth, "oauth");
  assert.equal(parseFileConfig({ auth: "api-key" }).auth, "api-key");
  assert.equal(parseFileConfig({ auth: "subscription" }).auth, undefined);
  assert.equal(parseFileConfig({}).auth, undefined);
});

test("parseEnvConfig reads OMD_AUTH", () => {
  assert.equal(parseEnvConfig({ OMD_AUTH: "oauth" } as NodeJS.ProcessEnv).auth, "oauth");
  assert.equal(parseEnvConfig({ OMD_AUTH: "nope" } as NodeJS.ProcessEnv).auth, undefined);
});

test("parseFileConfig accepts a partial routing map", () => {
  const parsed = parseFileConfig({ routing: { sonnet: "p:s" } });
  assert.deepEqual(parsed.routing, { sonnet: "p:s" });
});

test("parseFileConfig tolerates non-objects", () => {
  assert.deepEqual(parseFileConfig(null), {});
  assert.deepEqual(parseFileConfig("nope"), {});
  assert.deepEqual(parseFileConfig(42), {});
});

test("parseEnvConfig reads OMD_* variables", () => {
  const env = {
    OMD_ROUTING: "premium",
    OMD_BACKEND: "filesystem",
    OMD_WORKDIR: "/work",
    OMD_MODEL_HAIKU: "p:h",
  } as NodeJS.ProcessEnv;
  const parsed = parseEnvConfig(env);
  assert.equal(parsed.routing, "premium");
  assert.equal(parsed.backend, "filesystem");
  assert.equal(parsed.workdir, "/work");
  assert.deepEqual(parsed.models, { haiku: "p:h" });
});

test("parseEnvConfig ignores invalid enum values", () => {
  const env = { OMD_ROUTING: "turbo", OMD_BACKEND: "cloud" } as NodeJS.ProcessEnv;
  assert.deepEqual(parseEnvConfig(env), {});
});

test("mergeOptions merges model maps tier-by-tier", () => {
  const merged = mergeOptions(
    { models: { haiku: "a", sonnet: "b" } },
    { models: { sonnet: "c" } },
  );
  assert.deepEqual(merged.models, { haiku: "a", sonnet: "c" });
});

test("loadConfig returns {} when no file and no env", () => {
  const dir = mkdtempSync(join(tmpdir(), "omd-cfg-"));
  try {
    assert.deepEqual(loadConfig(dir, {} as NodeJS.ProcessEnv), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadConfig reads the file and layers env on top", () => {
  const dir = mkdtempSync(join(tmpdir(), "omd-cfg-"));
  try {
    mkdirSync(join(dir, ".omd"), { recursive: true });
    writeFileSync(
      join(dir, CONFIG_RELATIVE_PATH),
      JSON.stringify({ routing: "budget", backend: "state" }),
    );
    const env = { OMD_BACKEND: "filesystem" } as NodeJS.ProcessEnv;
    const cfg = loadConfig(dir, env);
    assert.equal(cfg.routing, "budget");
    assert.equal(cfg.backend, "filesystem"); // env wins
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadConfig throws a clear error on malformed JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "omd-cfg-"));
  try {
    mkdirSync(join(dir, ".omd"), { recursive: true });
    writeFileSync(join(dir, CONFIG_RELATIVE_PATH), "{ not json");
    assert.throws(() => loadConfig(dir, {} as NodeJS.ProcessEnv), /Invalid JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
