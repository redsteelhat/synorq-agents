import type { SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk";

export type AgentDefinition = {
  /** Stable id used in URLs and the database. Lowercase, no spaces. */
  id: string;
  name: string;
  description: string;
  /** Cron expression evaluated in the service time zone, or null for manual runs only. */
  schedule: string | null;
  systemPrompt: string;
  /** The task for one run. A function so it can include the current date. */
  prompt: () => string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: SdkMcpToolDefinition<any>[];
  maxTurns: number;
  /** Send the final answer to Telegram when the run succeeds. Failures are always sent. */
  notifyResult: boolean;
};
