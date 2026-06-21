import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  generatePkce,
  generateState,
  buildAuthorizeUrl,
  writeCredentials,
  readCredentials,
  clearCredentials,
  credentialsPath,
  getValidAccessToken,
  status,
  OAUTH_CLIENT_ID,
  OAUTH_SCOPES,
  type StoredCredentials,
} from "../src/auth.ts";

/** base64url without padding, matching the module's internal encoder. */
function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A temp-dir env that redirects the credential store. */
function tempEnv(): { env: NodeJS.ProcessEnv; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "omd-auth-"));
  return { env: { OMD_CREDENTIALS_PATH: join(dir, "credentials.json") } as NodeJS.ProcessEnv, dir };
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

// Helper: write raw bytes to the store path (for malformed-file cases).
function writeFileSyncRaw(env: NodeJS.ProcessEnv, text: string): void {
  const p = credentialsPath(env);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
}
