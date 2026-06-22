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
import { execFileSync, spawn } from "node:child_process";
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

/** Tokens that, in `OMD_DISCOVER`, switch off Claude Code credential discovery. */
const DISCOVER_OFF_TOKENS = new Set(["off", "false", "0", "no", "disable"]);

/** A trimmed non-empty env override, or `fallback`. */
function envOr(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const raw = env[key];
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : fallback;
}

/**
 * Resolve the OAuth endpoints/client id, preferring env overrides
 * (`OMD_OAUTH_CLIENT_ID` / `OMD_OAUTH_AUTHORIZE_URL` / `OMD_OAUTH_TOKEN_URL`)
 * over the exported defaults. Forward-compat (endpoints can move) and testable.
 */
function oauthClientId(env: NodeJS.ProcessEnv): string {
  return envOr(env, "OMD_OAUTH_CLIENT_ID", OAUTH_CLIENT_ID);
}
function oauthAuthorizeUrl(env: NodeJS.ProcessEnv): string {
  return envOr(env, "OMD_OAUTH_AUTHORIZE_URL", AUTHORIZE_URL);
}
function oauthTokenUrl(env: NodeJS.ProcessEnv): string {
  return envOr(env, "OMD_OAUTH_TOKEN_URL", TOKEN_URL);
}

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
  /** Where the active credentials came from (set when `loggedIn`). */
  source?: CredentialSource;
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

// ---- Claude Code credential discovery ---------------------------------------

/**
 * Where a usable token came from. `omd` is our own store; the rest are the
 * official Claude Code CLI's stores, which we read but never write.
 */
export type CredentialSource =
  | "omd"
  | "claude-code-env"
  | "claude-code-file"
  | "claude-code-keychain";

/** A credential set plus the source it was discovered from. */
export interface DiscoveredCredentials {
  creds: StoredCredentials;
  source: CredentialSource;
}

/** Seams for Claude Code credential discovery (all injectable in tests). */
export interface DiscoverDeps {
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  /** Return the raw keychain JSON string, or `null` when unavailable. */
  keychain?: () => string | null;
  platform?: NodeJS.Platform;
}

/**
 * Path to the official Claude Code CLI credentials file (Linux/Windows).
 * Defaults to `~/.claude/.credentials.json`; override with
 * `OMD_CLAUDE_CREDENTIALS_PATH` (used by tests to point at a fixture).
 */
export function claudeCodeCredentialsPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.OMD_CLAUDE_CREDENTIALS_PATH;
  if (typeof override === "string" && override.trim() !== "") return override;
  return join(homedir(), ".claude", ".credentials.json");
}

/**
 * Map Claude Code's `{ claudeAiOauth: {...} }` blob into our
 * {@link StoredCredentials}: join its `scopes` array into our space-joined
 * `scope`, synthesize `obtainedAt`, and default a missing `expiresAt` to `now`.
 * Returns `null` for anything malformed — never throws.
 */
function mapClaudeCodeCreds(raw: unknown, now: number): StoredCredentials | null {
  if (raw === null || typeof raw !== "object") return null;
  const block = (raw as Record<string, unknown>).claudeAiOauth;
  if (block === null || typeof block !== "object") return null;
  const o = block as Record<string, unknown>;
  if (typeof o.accessToken !== "string" || o.accessToken === "") return null;
  const refreshToken = typeof o.refreshToken === "string" ? o.refreshToken : "";
  const expiresAt = typeof o.expiresAt === "number" ? o.expiresAt : now;
  const scope = Array.isArray(o.scopes)
    ? o.scopes.filter((s): s is string => typeof s === "string").join(" ")
    : "";
  return {
    accessToken: o.accessToken,
    refreshToken,
    expiresAt,
    scope: scope || OAUTH_SCOPES,
    obtainedAt: now,
  };
}

/** Read Claude Code's credentials file, or `null` when absent/malformed. */
export function readClaudeCodeFileCredentials(
  env: NodeJS.ProcessEnv = process.env,
  now: number = Date.now(),
): StoredCredentials | null {
  let text: string;
  try {
    text = readFileSync(claudeCodeCredentialsPath(env), "utf8");
  } catch {
    return null;
  }
  try {
    return mapClaudeCodeCreds(JSON.parse(text), now);
  } catch {
    return null;
  }
}

/**
 * Read an access token from `CLAUDE_CODE_OAUTH_TOKEN`, or `null` when unset.
 * This source has no refresh token (the empty `refreshToken` is the
 * "cannot refresh" sentinel) and no real expiry, so it is used as-is.
 */
export function readClaudeCodeEnvCredentials(
  env: NodeJS.ProcessEnv = process.env,
  now: number = Date.now(),
): StoredCredentials | null {
  const token = env.CLAUDE_CODE_OAUTH_TOKEN;
  if (typeof token !== "string" || token.trim() === "") return null;
  return {
    accessToken: token.trim(),
    refreshToken: "",
    expiresAt: now,
    scope: OAUTH_SCOPES,
    obtainedAt: now,
  };
}

/** Shell out to the macOS keychain for Claude Code's credentials JSON. */
function defaultKeychainRead(env: NodeJS.ProcessEnv): string | null {
  const account = env.USER ?? env.LOGNAME ?? "";
  try {
    return execFileSync(
      "security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-a", account, "-w"],
      { encoding: "utf8" },
    );
  } catch {
    return null;
  }
}

/**
 * Read Claude Code's credentials from the macOS Keychain, or `null`. Only
 * attempts the `security` command on macOS unless a `keychain` seam is injected
 * (tests). Any failure — command absent, no entry, malformed JSON — yields
 * `null`.
 */
export function readClaudeCodeKeychainCredentials(
  deps: DiscoverDeps = {},
): StoredCredentials | null {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const platform = deps.platform ?? process.platform;
  const read =
    deps.keychain ??
    (platform === "darwin" ? () => defaultKeychainRead(env) : () => null);
  let raw: string | null;
  try {
    raw = read();
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    return mapClaudeCodeCreds(JSON.parse(raw), now());
  } catch {
    return null;
  }
}

/**
 * Discover the official Claude Code CLI's credentials so a user already logged
 * into Claude Code need not run `omd auth login`. Precedence: the
 * `CLAUDE_CODE_OAUTH_TOKEN` env var, then the platform's primary store first
 * (macOS keychain on darwin, the file elsewhere) with the other as fallback.
 * Returns `null` when nothing is found or when `OMD_DISCOVER` is set to a falsy
 * token (`off`/`false`/`0`/`no`/`disable`). Read-only: never writes these stores.
 */
export function discoverClaudeCodeCredentials(
  deps: DiscoverDeps = {},
): DiscoveredCredentials | null {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const platform = deps.platform ?? process.platform;

  const toggle = (env.OMD_DISCOVER ?? "").trim().toLowerCase();
  if (DISCOVER_OFF_TOKENS.has(toggle)) return null;

  const fromEnv = readClaudeCodeEnvCredentials(env, now());
  if (fromEnv) return { creds: fromEnv, source: "claude-code-env" };

  const file = (): DiscoveredCredentials | null => {
    const c = readClaudeCodeFileCredentials(env, now());
    return c ? { creds: c, source: "claude-code-file" } : null;
  };
  const keychain = (): DiscoveredCredentials | null => {
    const c = readClaudeCodeKeychainCredentials(deps);
    return c ? { creds: c, source: "claude-code-keychain" } : null;
  };

  const ordered = platform === "darwin" ? [keychain, file] : [file, keychain];
  for (const src of ordered) {
    const found = src();
    if (found) return found;
  }
  return null;
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
  env: NodeJS.ProcessEnv = process.env,
): string {
  const url = new URL(oauthAuthorizeUrl(env));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", oauthClientId(env));
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
async function postToken(
  body: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<StoredCredentials> {
  const res = await fetch(oauthTokenUrl(env), {
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
  env: NodeJS.ProcessEnv = process.env,
): Promise<StoredCredentials> {
  const cleanCode = code.trim().split(/[#&]/)[0] ?? code.trim();
  return postToken(
    {
      grant_type: "authorization_code",
      code: cleanCode,
      state,
      client_id: oauthClientId(env),
      redirect_uri: redirectUri,
      code_verifier: verifier,
    },
    env,
  );
}

/** Exchange a refresh token for a fresh access (and refresh) token. */
export async function refreshTokens(
  refreshToken: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<StoredCredentials> {
  return postToken(
    {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: oauthClientId(env),
    },
    env,
  );
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

/**
 * Report current login state and which source the active credentials come from:
 * our own `omd` store first, then a discovered Claude Code credential (env, file,
 * or keychain). The env-token source has no meaningful expiry, so `expiresAt`
 * is omitted for it.
 */
export async function status(
  env: NodeJS.ProcessEnv = process.env,
  deps: DiscoverDeps = {},
): Promise<AuthStatus> {
  const ours = readCredentials(env);
  if (ours) {
    return {
      loggedIn: true,
      source: "omd",
      expiresAt: ours.expiresAt,
      expired: Date.now() >= ours.expiresAt,
      scope: ours.scope,
    };
  }

  const found = discoverClaudeCodeCredentials({ ...deps, env });
  if (!found) return { loggedIn: false };

  const { creds, source } = found;
  // The env-token source carries no real expiry; report it without one.
  if (source === "claude-code-env") {
    return { loggedIn: true, source, scope: creds.scope };
  }
  return {
    loggedIn: true,
    source,
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
  /** Override Claude Code credential discovery (testing). */
  discover?: (deps: DiscoverDeps) => DiscoveredCredentials | null;
  /** Keychain read seam, forwarded to discovery (testing). */
  keychain?: () => string | null;
  platform?: NodeJS.Platform;
}

/**
 * Return a valid access token, refreshing if it is at or near expiry. Resolves
 * from our own `~/.omd` store first; if absent, falls back to the official
 * Claude Code CLI's credentials (env var, file, or keychain) so a user already
 * logged into Claude Code needs no separate `omd auth login`.
 *
 * Returns `null` when nothing is found, so the agent boundary can fall back to
 * API-key auth rather than failing. A refreshed token is always persisted to our
 * own store — Claude Code's stores are read-only here, never written, to avoid
 * the known keychain/file drift and clobbering issues.
 */
export async function getValidAccessToken(
  deps: AccessTokenDeps = {},
): Promise<string | null> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const refresh = deps.refresh ?? refreshTokens;
  const discover = deps.discover ?? discoverClaudeCodeCredentials;

  const ours = readCredentials(env);
  if (ours) {
    if (now() < ours.expiresAt - EXPIRY_SKEW_MS) return ours.accessToken;
    const refreshed = await refresh(ours.refreshToken);
    writeCredentials(refreshed, env);
    return refreshed.accessToken;
  }

  // Fall back to the official Claude Code CLI's credentials (read-only).
  const found = discover({ env, now, keychain: deps.keychain, platform: deps.platform });
  if (!found) return null;

  const { creds } = found;
  // No refresh token (env-token source) → use the access token as-is.
  if (creds.refreshToken === "") return creds.accessToken;
  if (now() < creds.expiresAt - EXPIRY_SKEW_MS) return creds.accessToken;

  // Near expiry: refresh via Claude Code's refresh token, but persist to OUR
  // store only — never write back to `~/.claude` or the keychain.
  const refreshed = await refresh(creds.refreshToken);
  writeCredentials(refreshed, env);
  return refreshed.accessToken;
}
