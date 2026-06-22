/**
 * oh-my-dcode — oh-my-claudecode's multi-agent orchestration layer, ported to
 * the LangChain Deep Agents (Deep Agents Code) framework for TypeScript.
 *
 * Public entry point. The two things most users want:
 *   - `createOhMyDcode(options)` — build a live, orchestrating Deep Agent.
 *   - `buildDeepAgentConfig(options)` — inspect the wiring without the SDK.
 */

export type {
  ModelTier,
  ModelMap,
  RoutingPreset,
  AgentLane,
  AgentSpec,
  ResolvedSubagent,
  SkillSpec,
  DeepAgentConfig,
  BackendDescriptor,
  MiddlewareDescriptor,
  RetryMiddlewareDescriptor,
  InterpreterMiddlewareDescriptor,
  RubricMiddlewareDescriptor,
  McpServerSpec,
  InvokeConfig,
  InvokeInput,
  OhMyDcodeOptions,
} from "./types.ts";
export { MODEL_TIERS } from "./types.ts";

export {
  DEFAULT_ANTHROPIC_MODELS,
  DEFAULT_ADVERSARIAL_MODEL,
  ROUTING_PRESETS,
  isRoutingPreset,
  envModelOverrides,
  resolveModelMap,
  resolveModel,
  effectiveAdversarialModel,
} from "./routing.ts";

export {
  ROSTER,
  getAgent,
  agentsByLane,
  composeRoster,
  assertUniqueNames,
  isAdversarial,
  resolveAgentModel,
} from "./agents.ts";

export {
  OPERATING_PRINCIPLES,
  DELEGATION_RULES,
  renderRosterDirectory,
  buildSupervisorPrompt,
  buildAgentsMd,
} from "./prompts.ts";

export { SKILLS, getSkill, renderSkillMarkdown } from "./skills.ts";

export {
  CONFIG_RELATIVE_PATH,
  parseFileConfig,
  parseEnvConfig,
  mergeOptions,
  loadConfig,
} from "./config.ts";

export {
  bundledSkillsDir,
  resolveSubagents,
  resolveBackendDescriptor,
  resolveMiddlewareDescriptors,
  buildInterpreterDescriptor,
  sanitizePtc,
  applyOauthAdversarialDefault,
  buildDeepAgentConfig,
  createOhMyDcode,
  CLAUDE_CODE_IDENTITY,
  withClaudeCodeIdentity,
  DEFAULT_MODEL_RETRIES,
  DEFAULT_TOOL_RETRIES,
  DEFAULT_RUBRIC_MAX_ITERATIONS,
  DEFAULT_RUBRIC_GRADER_TIER,
  DEFAULT_GRADER_MCP_SERVERS,
  DEFAULT_INTERPRETER_ENABLED,
  DEFAULT_INTERPRETER_PTC,
  FORBIDDEN_INTERPRETER_PTC,
  RUBRIC_GRADER_SYSTEM_PROMPT,
  DEFAULT_RECURSION_LIMIT,
} from "./agent.ts";
export type { DeepAgent } from "./agent.ts";

export {
  login,
  logout,
  status,
  getValidAccessToken,
  OAUTH_CLIENT_ID,
  OAUTH_SCOPES,
  OAUTH_BETA_HEADER,
} from "./auth.ts";
export type { StoredCredentials, AuthStatus } from "./auth.ts";

export {
  buildAnthropicChatModel,
  isAnthropicSpec,
  stripProvider,
} from "./anthropic-model.ts";

export {
  renderAgentMarkdown,
  planScaffold,
  writeScaffold,
} from "./scaffold.ts";
export type { ScaffoldEntry, ScaffoldResult } from "./scaffold.ts";
