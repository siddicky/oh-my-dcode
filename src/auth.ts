/**
 * Claude Code subscription OAuth — login, credential storage, and token refresh.
 *
 * Lets a user authenticate Anthropic model calls with a Claude Code / Claude
 * Pro/Max subscription via OAuth (PKCE) instead of an `ANTHROPIC_API_KEY`. The
 * resulting bearer token is consumed at the agent boundary
 * ({@link ./agent.ts}) to build Anthropic model instances that send
 * `Authorization: Bearer …` + `anthropic-beta: oauth-2025-04-20` (never an
 * `x-api-key`).
 *
 * Deliberately depends only on Node built-ins so the `omd auth` subcommand
 * stays zero-dependency, like the other inspect/scaffold commands. Network and
 * disk are isolated in named functions so the PKCE and store logic is unit
 * testable; `getValidAccessToken`/`login` accept seams for injecting fakes.
 */

import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { homedir } from "node:os";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

/** Public OAuth client id of Claude Code (the same flow `claude` itself uses). */
export const OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
/** Authorization endpoint (the user logs in here). */
export const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
/** Token endpoint (code↔token exchange and refresh). */
export const TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
/** Scopes requested: profile + inference for subscription-backed model calls. */
export const OAUTH_SCOPES = "org:create_api_key user:profile user:inference";
/** Anthropic beta header value enabling OAuth-token inference. */
export const OAUTH_BETA_HEADER = "oauth-2025-04-20";
/** Redirect used for the manual-paste (`--no-browser`) flow. */
export const MANUAL_REDIRECT_URI =
  "https://console.anthropic.com/oauth/code/callback";

/** Refresh when the access token is within this many ms of expiry. */
const EXPIRY_SKEW_MS = 60_000;

/** Persisted OAuth credentials. */
export interface StoredCredentials {
  accessToken: string;
  refreshToken: string;
  /** Absolute expiry, epoch milliseconds. */
  expiresAt: number;
  scope: string;
  /** When these credentials were obtained, epoch milliseconds. */
  obtainedAt: number;
}

/** Login state reported by {@link status}. */
export interface AuthStatus {
  loggedIn: boolean;
  expiresAt?: number;
  expired?: boolean;
  scope?: string;
}

// ---- credential store -------------------------------------------------------

/**
 * Path to the credentials file. Defaults to `~/.omd/credentials.json`; override
 * with `OMD_CREDENTIALS_PATH` (used by tests to redirect to a temp dir).
 */
export function credentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.OMD_CREDENTIALS_PATH;
  if (typeof override === "string" && override.trim() !== "") return override;
  return join(homedir(), ".omd", "credentials.json");
}

/** Validate a parsed object as {@link StoredCredentials}. */
function isStoredCredentials(value: unknown): value is StoredCredentials {
  if (value === null || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.accessToken === "string" &&
    typeof o.refreshToken === "string" &&
    typeof o.expiresAt === "number" &&
    typeof o.scope === "string" &&
    typeof o.obtainedAt === "number"
  );
}

/**
 * Read stored credentials, or `null` when absent or malformed. Never throws —
 * a missing or corrupt file must degrade to "not logged in" so callers can fall
 * back to API-key auth rather than crashing a run.
 */
export function readCredentials(
  env: NodeJS.ProcessEnv = process.env,
): StoredCredentials | null {
  let text: string;
  try {
    text = readFileSync(credentialsPath(env), "utf8");
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return isStoredCredentials(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Persist credentials with owner-only permissions (dir 0700, file 0600). */
export function writeCredentials(
  creds: StoredCredentials,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const path = credentialsPath(env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 });
  // Defensive: an existing file keeps its old mode through writeFileSync.
  chmodSync(path, 0o600);
}

/** Remove stored credentials (idempotent). */
export function clearCredentials(env: NodeJS.ProcessEnv = process.env): void {
  rmSync(credentialsPath(env), { force: true });
}

// ---- PKCE -------------------------------------------------------------------

/** URL-safe base64 with no padding (RFC 7636 base64url). */
function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Generate a PKCE verifier and its S256 challenge. */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

/** Generate an opaque CSRF `state` value. */
export function generateState(): string {
  return base64url(randomBytes(32));
}

/** Assemble the authorization URL the user opens to grant access. */
export function buildAuthorizeUrl(
  challenge: string,
  state: string,
  redirectUri: string,
): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", OAUTH_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", OAUTH_SCOPES);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  return url.toString();
}

// ---- token endpoint ---------------------------------------------------------

/** Shape of a successful token-endpoint response. */
interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
}

/** POST a JSON body to the token endpoint and parse the credential response. */
async function postToken(body: Record<string, string>): Promise<StoredCredentials> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `OAuth token request failed (${res.status} ${res.statusText})${detail ? `: ${detail}` : ""}`,
    );
  }
  const json = (await res.json()) as TokenResponse;
  const now = Date.now();
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: now + json.expires_in * 1000,
    scope: json.scope ?? OAUTH_SCOPES,
    obtainedAt: now,
  };
}

/**
 * Exchange an authorization code for tokens. The manual-paste flow returns the
 * value as `code#state`; tolerate that (and a stray `&`-suffixed code) by taking
 * the leading segment.
 */
export async function exchangeCodeForTokens(
  code: string,
  verifier: string,
  redirectUri: string,
  state: string,
): Promise<StoredCredentials> {
  const cleanCode = code.trim().split(/[#&]/)[0] ?? code.trim();
  return postToken({
    grant_type: "authorization_code",
    code: cleanCode,
    state,
    client_id: OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
}

/** Exchange a refresh token for a fresh access (and refresh) token. */
export async function refreshTokens(
  refreshToken: string,
): Promise<StoredCredentials> {
  return postToken({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: OAUTH_CLIENT_ID,
  });
}

// ---- loopback callback server ----------------------------------------------

/** A running loopback server awaiting the OAuth redirect. */
interface LoopbackServer {
  /** Redirect URI the authorize request should use. */
  redirectUri: string;
  /** Resolves with the authorization code once the redirect arrives. */
  waitForCode(): Promise<string>;
  /** Shut the server down (idempotent). */
  close(): void;
}

/**
 * Start a loopback HTTP server on `127.0.0.1` that captures the OAuth redirect.
 * Validates the returned `state` against the one we sent, serves a small
 * "you can close this tab" page, and resolves with the `code`.
 */
export async function startLoopbackServer(state: string): Promise<LoopbackServer> {
  let resolveCode: (code: string) => void;
  let rejectCode: (err: Error) => void;
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/callback") {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    const err = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");
    res.setHeader("content-type", "text/html");
    if (err) {
      res.end(`<p>Login failed: ${err}. You can close this tab.</p>`);
      rejectCode(new Error(`OAuth error: ${err}`));
      return;
    }
    if (returnedState !== state) {
      res.end("<p>Login failed: state mismatch. You can close this tab.</p>");
      rejectCode(new Error("OAuth state mismatch — possible CSRF; aborting."));
      return;
    }
    if (!code) {
      res.end("<p>Login failed: no code returned. You can close this tab.</p>");
      rejectCode(new Error("OAuth callback returned no authorization code."));
      return;
    }
    res.end("<p>Logged in to oh-my-dcode. You can close this tab.</p>");
    resolveCode(code);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    // Use 127.0.0.1 (not `localhost`) to match the bind address: where
    // `localhost` resolves to IPv6 `::1` first, the browser redirect could fail
    // to reach a server bound only to the IPv4 loopback.
    redirectUri: `http://127.0.0.1:${port}/callback`,
    waitForCode: () => codePromise,
    close: () => server.close(),
  };
}

// ---- browser + stdin helpers ------------------------------------------------

/** Best-effort: open `url` in the default browser. Never throws. */
function openBrowser(url: string): void {
  // Spawn without a shell so the URL's `&` query separators are passed as a
  // single argument and never reinterpreted as command separators. On Windows,
  // go through `rundll32 url.dll,FileProtocolHandler` (which receives the URL as
  // a plain argument) rather than cmd's `start`, which would split on `&`.
  const [cmd, args]: [string, string[]] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Headless or no browser — the URL was already printed for manual use.
  }
}

/** Prompt on stdin for the pasted authorization code. */
function readCodeFromStdin(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    rl.question("Paste the authorization code here: ", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ---- top-level operations ---------------------------------------------------

/** Options for {@link login} (seams `open`/`readCode` are for testing). */
export interface LoginOptions {
  /** Skip the loopback server; print the URL and read a pasted code instead. */
  noBrowser?: boolean;
  /** Override the browser-open behavior (testing/headless). */
  open?: (url: string) => void;
  /** Override stdin code capture (testing). */
  readCode?: () => Promise<string>;
  env?: NodeJS.ProcessEnv;
}

/**
 * Run the OAuth login flow and persist the resulting credentials.
 *
 * With a browser (default): start a loopback server, open + print the authorize
 * URL, and await the redirect. Headless (`noBrowser`): print the URL with the
 * manual redirect and read the pasted code from stdin.
 */
export async function login(opts: LoginOptions = {}): Promise<AuthStatus> {
  const env = opts.env ?? process.env;
  const { verifier, challenge } = generatePkce();
  const state = generateState();

  let creds: StoredCredentials;
  if (opts.noBrowser) {
    const url = buildAuthorizeUrl(challenge, state, MANUAL_REDIRECT_URI);
    console.log("\nOpen this URL in your browser to sign in:\n");
    console.log(`  ${url}\n`);
    const code = await (opts.readCode ?? readCodeFromStdin)();
    creds = await exchangeCodeForTokens(code, verifier, MANUAL_REDIRECT_URI, state);
  } else {
    const server = await startLoopbackServer(state);
    try {
      const url = buildAuthorizeUrl(challenge, state, server.redirectUri);
      console.log("\nOpening your browser to sign in. If it doesn't open, visit:\n");
      console.log(`  ${url}\n`);
      (opts.open ?? openBrowser)(url);
      const code = await server.waitForCode();
      creds = await exchangeCodeForTokens(code, verifier, server.redirectUri, state);
    } finally {
      server.close();
    }
  }

  writeCredentials(creds, env);
  return {
    loggedIn: true,
    expiresAt: creds.expiresAt,
    expired: false,
    scope: creds.scope,
  };
}

/** Remove stored credentials. */
export async function logout(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  clearCredentials(env);
}

/** Report current login state. */
export async function status(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AuthStatus> {
  const creds = readCredentials(env);
  if (!creds) return { loggedIn: false };
  return {
    loggedIn: true,
    expiresAt: creds.expiresAt,
    expired: Date.now() >= creds.expiresAt,
    scope: creds.scope,
  };
}

/** Seams for {@link getValidAccessToken}, injectable in tests. */
export interface AccessTokenDeps {
  refresh?: (refreshToken: string) => Promise<StoredCredentials>;
  now?: () => number;
  env?: NodeJS.ProcessEnv;
}

/**
 * Return a valid access token, refreshing if it is at or near expiry. Returns
 * `null` when not logged in, so the agent boundary can fall back to API-key auth
 * rather than failing. Persists a refreshed token before returning it.
 */
export async function getValidAccessToken(
  deps: AccessTokenDeps = {},
): Promise<string | null> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const refresh = deps.refresh ?? refreshTokens;

  const creds = readCredentials(env);
  if (!creds) return null;

  if (now() < creds.expiresAt - EXPIRY_SKEW_MS) return creds.accessToken;

  const refreshed = await refresh(creds.refreshToken);
  writeCredentials(refreshed, env);
  return refreshed.accessToken;
}
