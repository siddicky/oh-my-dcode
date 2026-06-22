import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";
import {
  generatePkce,
  generateState,
  buildAuthorizeUrl,
  refreshTokens,
  writeCredentials,
  readCredentials,
  clearCredentials,
  credentialsPath,
  getValidAccessToken,
  status,
  readClaudeCodeFileCredentials,
  readClaudeCodeEnvCredentials,
  readClaudeCodeKeychainCredentials,
  discoverClaudeCodeCredentials,
  OAUTH_CLIENT_ID,
  OAUTH_SCOPES,
  type StoredCredentials,
} from "../src/auth.ts";

/** base64url without padding, matching the module's internal encoder. */
function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * A temp-dir env that redirects the credential store. Discovery of the Claude
 * Code CLI's credentials is disabled (`OMD_DISCOVER=off`) so these store-focused
 * tests stay hermetic regardless of the host's real `~/.claude` login/keychain.
 */
function tempEnv(): { env: NodeJS.ProcessEnv; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "omd-auth-"));
  return {
    env: {
      OMD_CREDENTIALS_PATH: join(dir, "credentials.json"),
      OMD_DISCOVER: "off",
    } as NodeJS.ProcessEnv,
    dir,
  };
}

/**
 * A temp-dir env with discovery enabled: both the omd store and the Claude Code
 * file are redirected into the temp dir, and there is no ambient
 * `CLAUDE_CODE_OAUTH_TOKEN`, so discovery is fully controlled by the test.
 */
function discoveryEnv(): { env: NodeJS.ProcessEnv; dir: string; claudePath: string } {
  const dir = mkdtempSync(join(tmpdir(), "omd-disc-"));
  const claudePath = join(dir, "claude-credentials.json");
  return {
    env: {
      OMD_CREDENTIALS_PATH: join(dir, "credentials.json"),
      OMD_CLAUDE_CREDENTIALS_PATH: claudePath,
    } as NodeJS.ProcessEnv,
    dir,
    claudePath,
  };
}

/** A Claude Code `{ claudeAiOauth: {...} }` credentials blob (their on-disk shape). */
function claudeBlob(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    claudeAiOauth: {
      accessToken: "cc-access",
      refreshToken: "cc-refresh",
      expiresAt: Date.now() + 3_600_000,
      scopes: ["user:inference", "user:profile"],
      subscriptionType: "max",
      ...over,
    },
  });
}

function sampleCreds(over: Partial<StoredCredentials> = {}): StoredCredentials {
  const now = Date.now();
  return {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    expiresAt: now + 3_600_000,
    scope: OAUTH_SCOPES,
    obtainedAt: now,
    ...over,
  };
}

test("generatePkce produces a base64url verifier and matching S256 challenge", () => {
  const { verifier, challenge } = generatePkce();
  assert.match(verifier, /^[A-Za-z0-9_-]+$/);
  assert.match(challenge, /^[A-Za-z0-9_-]+$/);
  const expected = base64url(createHash("sha256").update(verifier).digest());
  assert.equal(challenge, expected);
});

test("generateState is random and url-safe", () => {
  assert.notEqual(generateState(), generateState());
  assert.match(generateState(), /^[A-Za-z0-9_-]+$/);
});

test("buildAuthorizeUrl carries the PKCE + client parameters", () => {
  const url = new URL(buildAuthorizeUrl("chal", "st8", "http://localhost:1234/callback"));
  assert.equal(url.origin + url.pathname, "https://claude.ai/oauth/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), OAUTH_CLIENT_ID);
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:1234/callback");
  assert.equal(url.searchParams.get("scope"), OAUTH_SCOPES);
  assert.equal(url.searchParams.get("code_challenge"), "chal");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("state"), "st8");
});

test("credential store round-trips and writes an owner-only (0600) file", () => {
  const { env, dir } = tempEnv();
  try {
    const creds = sampleCreds();
    writeCredentials(creds, env);
    assert.deepEqual(readCredentials(env), creds);
    const mode = statSync(credentialsPath(env)).mode & 0o777;
    assert.equal(mode, 0o600);
    clearCredentials(env);
    assert.equal(readCredentials(env), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readCredentials returns null for a missing or malformed file", () => {
  const { env, dir } = tempEnv();
  try {
    assert.equal(readCredentials(env), null); // missing
    writeFileSyncRaw(env, "{ not json");
    assert.equal(readCredentials(env), null); // malformed
    writeFileSyncRaw(env, JSON.stringify({ accessToken: "x" })); // wrong shape
    assert.equal(readCredentials(env), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getValidAccessToken returns null when not logged in", async () => {
  const { env, dir } = tempEnv();
  try {
    assert.equal(await getValidAccessToken({ env }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getValidAccessToken returns a fresh token without refreshing", async () => {
  const { env, dir } = tempEnv();
  try {
    writeCredentials(sampleCreds(), env);
    let refreshed = false;
    const token = await getValidAccessToken({
      env,
      refresh: async () => {
        refreshed = true;
        return sampleCreds();
      },
    });
    assert.equal(token, "access-1");
    assert.equal(refreshed, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getValidAccessToken refreshes and persists when near expiry", async () => {
  const { env, dir } = tempEnv();
  try {
    writeCredentials(sampleCreds({ expiresAt: Date.now() - 1 }), env);
    const next = sampleCreds({ accessToken: "access-2", refreshToken: "refresh-2", expiresAt: Date.now() + 3_600_000 });
    const token = await getValidAccessToken({
      env,
      refresh: async (rt) => {
        assert.equal(rt, "refresh-1");
        return next;
      },
    });
    assert.equal(token, "access-2");
    // The refreshed credential set is persisted for next time.
    assert.deepEqual(readCredentials(env), next);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("status reports logged-in and expiry", async () => {
  const { env, dir } = tempEnv();
  try {
    assert.deepEqual(await status(env), { loggedIn: false });
    writeCredentials(sampleCreds({ expiresAt: Date.now() - 1 }), env);
    const s = await status(env);
    assert.equal(s.loggedIn, true);
    assert.equal(s.expired, true);
    assert.equal(s.scope, OAUTH_SCOPES);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- Claude Code credential discovery ---------------------------------------

test("readClaudeCodeFileCredentials maps the claudeAiOauth blob into StoredCredentials", () => {
  const { env, dir, claudePath } = discoveryEnv();
  try {
    const now = 1_000_000;
    writeFileSync(claudePath, claudeBlob({ expiresAt: 5_000_000 }));
    const creds = readClaudeCodeFileCredentials(env, now);
    assert.ok(creds);
    assert.equal(creds.accessToken, "cc-access");
    assert.equal(creds.refreshToken, "cc-refresh");
    assert.equal(creds.expiresAt, 5_000_000); // absolute epoch ms, preserved
    assert.equal(creds.scope, "user:inference user:profile"); // scopes[] joined
    assert.equal(creds.obtainedAt, now); // synthesized
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readClaudeCodeFileCredentials returns null for missing or malformed files", () => {
  const { env, dir, claudePath } = discoveryEnv();
  try {
    assert.equal(readClaudeCodeFileCredentials(env), null); // missing
    writeFileSync(claudePath, "{ not json");
    assert.equal(readClaudeCodeFileCredentials(env), null); // malformed
    writeFileSync(claudePath, JSON.stringify({ claudeAiOauth: {} })); // no accessToken
    assert.equal(readClaudeCodeFileCredentials(env), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readClaudeCodeEnvCredentials reads CLAUDE_CODE_OAUTH_TOKEN as a non-refreshable cred", () => {
  const now = 42;
  const creds = readClaudeCodeEnvCredentials(
    { CLAUDE_CODE_OAUTH_TOKEN: "  sk-ant-oat01-xyz  " } as NodeJS.ProcessEnv,
    now,
  );
  assert.ok(creds);
  assert.equal(creds.accessToken, "sk-ant-oat01-xyz"); // trimmed
  assert.equal(creds.refreshToken, ""); // sentinel: cannot refresh
  assert.equal(creds.obtainedAt, now);
  assert.equal(readClaudeCodeEnvCredentials({} as NodeJS.ProcessEnv), null);
});

test("readClaudeCodeKeychainCredentials uses the injected seam and degrades on failure", () => {
  const ok = readClaudeCodeKeychainCredentials({
    env: {} as NodeJS.ProcessEnv,
    platform: "darwin",
    keychain: () => claudeBlob({ accessToken: "kc-access" }),
  });
  assert.equal(ok?.accessToken, "kc-access");

  // A throwing keychain command degrades to null (never throws).
  assert.equal(
    readClaudeCodeKeychainCredentials({
      platform: "darwin",
      keychain: () => {
        throw new Error("security: not found");
      },
    }),
    null,
  );

  // Non-darwin with no seam: never shells out, returns null.
  assert.equal(
    readClaudeCodeKeychainCredentials({ env: {} as NodeJS.ProcessEnv, platform: "linux" }),
    null,
  );
});

test("discoverClaudeCodeCredentials precedence: env wins; platform store ordering", () => {
  const { env, dir, claudePath } = discoveryEnv();
  try {
    writeFileSync(claudePath, claudeBlob({ accessToken: "file-access" }));
    const keychain = () => claudeBlob({ accessToken: "kc-access" });

    // Env var beats both file and keychain.
    const fromEnv = discoverClaudeCodeCredentials({
      env: { ...env, CLAUDE_CODE_OAUTH_TOKEN: "env-access" } as NodeJS.ProcessEnv,
      keychain,
      platform: "darwin",
    });
    assert.equal(fromEnv?.source, "claude-code-env");
    assert.equal(fromEnv?.creds.accessToken, "env-access");

    // On darwin, the keychain is checked before the file.
    const onMac = discoverClaudeCodeCredentials({ env, keychain, platform: "darwin" });
    assert.equal(onMac?.source, "claude-code-keychain");
    assert.equal(onMac?.creds.accessToken, "kc-access");

    // Elsewhere, the file is checked first.
    const onLinux = discoverClaudeCodeCredentials({ env, keychain, platform: "linux" });
    assert.equal(onLinux?.source, "claude-code-file");
    assert.equal(onLinux?.creds.accessToken, "file-access");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("discoverClaudeCodeCredentials honors the OMD_DISCOVER opt-out", () => {
  const { env, dir, claudePath } = discoveryEnv();
  try {
    writeFileSync(claudePath, claudeBlob());
    assert.equal(
      discoverClaudeCodeCredentials({
        env: { ...env, OMD_DISCOVER: "off" } as NodeJS.ProcessEnv,
        platform: "linux",
      }),
      null,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getValidAccessToken falls back to discovered Claude Code file credentials", async () => {
  const { env, dir, claudePath } = discoveryEnv();
  try {
    writeFileSync(claudePath, claudeBlob({ accessToken: "file-access" }));
    const token = await getValidAccessToken({ env, platform: "linux" });
    assert.equal(token, "file-access");
    // Discovery is read-only: it must not create our own store.
    assert.equal(readCredentials(env), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getValidAccessToken prefers our own store over discovery", async () => {
  const { env, dir, claudePath } = discoveryEnv();
  try {
    writeCredentials(sampleCreds({ accessToken: "omd-access" }), env);
    writeFileSync(claudePath, claudeBlob({ accessToken: "file-access" }));
    const token = await getValidAccessToken({ env, platform: "linux" });
    assert.equal(token, "omd-access");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getValidAccessToken refreshes a near-expiry discovered cred into our store, not Claude Code's", async () => {
  const { env, dir, claudePath } = discoveryEnv();
  try {
    const claudeText = claudeBlob({ accessToken: "stale", refreshToken: "cc-refresh", expiresAt: Date.now() - 1 });
    writeFileSync(claudePath, claudeText);
    const next = sampleCreds({ accessToken: "fresh", refreshToken: "rot", expiresAt: Date.now() + 3_600_000 });
    const token = await getValidAccessToken({
      env,
      platform: "linux",
      refresh: async (rt) => {
        assert.equal(rt, "cc-refresh"); // refreshed via Claude Code's refresh token
        return next;
      },
    });
    assert.equal(token, "fresh");
    // Refreshed creds land in OUR store…
    assert.deepEqual(readCredentials(env), next);
    // …and Claude Code's file is left byte-for-byte untouched.
    assert.equal(readFileSync(claudePath, "utf8"), claudeText);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getValidAccessToken uses an env-token cred as-is without refreshing", async () => {
  const { env, dir } = discoveryEnv();
  try {
    const token = await getValidAccessToken({
      env: { ...env, CLAUDE_CODE_OAUTH_TOKEN: "env-access" } as NodeJS.ProcessEnv,
      platform: "linux",
      refresh: async () => {
        throw new Error("must not refresh an env token");
      },
    });
    assert.equal(token, "env-access");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("status reports the credential source", async () => {
  const { env, dir, claudePath } = discoveryEnv();
  try {
    // omd store wins and is labeled accordingly.
    writeCredentials(sampleCreds(), env);
    assert.equal((await status(env)).source, "omd");
    clearCredentials(env);

    // Falls back to the discovered Claude Code file.
    writeFileSync(claudePath, claudeBlob());
    const fileStatus = await status(env, { platform: "linux" });
    assert.equal(fileStatus.source, "claude-code-file");
    assert.equal(fileStatus.loggedIn, true);
    rmSync(claudePath, { force: true });

    // Env-token source: logged in, but no meaningful expiry reported.
    const envStatus = await status(
      { ...env, CLAUDE_CODE_OAUTH_TOKEN: "env-access" } as NodeJS.ProcessEnv,
      { platform: "linux" },
    );
    assert.equal(envStatus.source, "claude-code-env");
    assert.equal(envStatus.expiresAt, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- OAuth endpoint env overrides -------------------------------------------

test("buildAuthorizeUrl honors OMD_OAUTH_* overrides", () => {
  const env = {
    OMD_OAUTH_AUTHORIZE_URL: "https://example.test/authorize",
    OMD_OAUTH_CLIENT_ID: "client-override",
  } as NodeJS.ProcessEnv;
  const url = new URL(buildAuthorizeUrl("chal", "st8", "http://127.0.0.1:1/callback", env));
  assert.equal(url.origin + url.pathname, "https://example.test/authorize");
  assert.equal(url.searchParams.get("client_id"), "client-override");
});

test("refreshTokens posts to OMD_OAUTH_TOKEN_URL and the overridden client id", async () => {
  const realFetch = globalThis.fetch;
  let seenUrl = "";
  let seenBody: Record<string, unknown> = {};
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    seenUrl = String(url);
    seenBody = JSON.parse(init?.body ?? "{}");
    return {
      ok: true,
      json: async () => ({ access_token: "a", refresh_token: "r", expires_in: 3600 }),
    };
  }) as unknown as typeof fetch;
  try {
    const env = {
      OMD_OAUTH_TOKEN_URL: "https://example.test/token",
      OMD_OAUTH_CLIENT_ID: "client-override",
    } as NodeJS.ProcessEnv;
    const creds = await refreshTokens("rt", env);
    assert.equal(seenUrl, "https://example.test/token");
    assert.equal(seenBody.client_id, "client-override");
    assert.equal(seenBody.grant_type, "refresh_token");
    assert.equal(creds.accessToken, "a");
  } finally {
    globalThis.fetch = realFetch;
  }
});

// Helper: write raw bytes to the store path (for malformed-file cases).
function writeFileSyncRaw(env: NodeJS.ProcessEnv, text: string): void {
  const p = credentialsPath(env);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
}
