import type { CreateDeepAgentParams, DeepAgent } from "deepagents";

interface DeepAgentsModule {
  createDeepAgent: (config: CreateDeepAgentParams) => DeepAgent;
}
