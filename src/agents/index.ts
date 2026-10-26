import type { Config } from "../config.js";
import type { LeadStore } from "../db/leads.js";
import { createLeadsAgent } from "./leads/index.js";
import { createOpsAgent } from "./ops/index.js";
import type { AgentDefinition } from "./types.js";

export type AgentDeps = { leads: LeadStore };

/** Every agent the service knows about. Add new agents here. */
export function createAgents(config: Config, deps: AgentDeps): AgentDefinition[] {
  return [createOpsAgent(config), createLeadsAgent(config, deps.leads)];
}
