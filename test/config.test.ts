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
