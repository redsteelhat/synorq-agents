import type { Config } from "../config.js";
import { createOpsAgent } from "./ops/index.js";
import type { AgentDefinition } from "./types.js";

/** Every agent the service knows about. Add new agents here. */
export function createAgents(config: Config): AgentDefinition[] {
  return [createOpsAgent(config)];
}
