import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSdkMcpServer, query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import * as Sentry from "@sentry/node";

import type { AgentDefinition } from "./agents/types.js";
import type { EventKind, RunFinish, RunStore, RunTrigger } from "./db/runs.js";
import type { Notifier } from "./lib/telegram.js";

const MAX_EVENT_CHARS = 20_000;

export type QueryFn = typeof query;

export type RunnerDeps = {
  store: RunStore;
  notify: Notifier;
  oauthToken?: string;
  model: string;
  dashboardUrl?: string;
  /** Injected in tests. */
  queryFn?: QueryFn;
};

export class AgentBusyError extends Error {
  constructor(agentId: string) {
    super(`Agent "${agentId}" is already running`);
    this.name = "AgentBusyError";
  }
}

function clip(text: string): string {
  return text.length > MAX_EVENT_CHARS ? `${text.slice(0, MAX_EVENT_CHARS)}\n… (${text.length - MAX_EVENT_CHARS} karakter kesildi)` : text;
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Turns one SDK message into zero or more rows for the run timeline. */
export function toEvents(message: SDKMessage): { kind: EventKind; content: string; name?: string }[] {
  if (message.type === "assistant") {
    const events: { kind: EventKind; content: string; name?: string }[] = [];
    for (const block of message.message.content) {
      if (block.type === "text" && block.text.trim()) events.push({ kind: "text", content: block.text });
      if (block.type === "tool_use") events.push({ kind: "tool_use", name: block.name, content: stringify(block.input) });
    }
    if (message.error) events.push({ kind: "error", content: `Model error: ${message.error}` });
    return events;
  }
  if (message.type === "user" && Array.isArray(message.message.content)) {
    const events: { kind: EventKind; content: string; name?: string }[] = [];
    for (const block of message.message.content) {
      if (block.type !== "tool_result") continue;
      const body = Array.isArray(block.content)
        ? block.content.map((part) => (part.type === "text" ? part.text : `[${part.type}]`)).join("\n")
        : stringify(block.content ?? "");
      events.push({ kind: block.is_error ? "error" : "tool_result", content: body });
    }
    return events;
  }
  return [];
}

export function createRunner(deps: RunnerDeps) {
  const active = new Set<string>();
  const runQuery = deps.queryFn ?? query;

  async function execute(agent: AgentDefinition, runId: string): Promise<RunFinish> {
    let seq = 0;
    const record = async (kind: EventKind, content: string, name?: string) => {
      seq += 1;
      await deps.store.addEvent(runId, seq, kind, clip(content), name);
    };

    if (!deps.oauthToken) {
      await record("error", "CLAUDE_CODE_OAUTH_TOKEN is not set.");
      return { status: "error", error: "CLAUDE_CODE_OAUTH_TOKEN is not set" };
    }

    const cwd = join(tmpdir(), "synorq-agents", agent.id);
    await mkdir(cwd, { recursive: true });
    const timeoutMs = (agent.timeoutMinutes ?? 10) * 60 * 1000;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);

    const tools = agent.tools({ runId });
    const server = createSdkMcpServer({ name: agent.id, version: "1.0.0", tools });
    try {
      const stream = runQuery({
        prompt: agent.prompt({ runId }),
        options: {
          systemPrompt: agent.systemPrompt,
          model: deps.model,
          maxTurns: agent.maxTurns,
          // No built-in tools (no shell, no file access): only the agent's own tools.
          tools: [],
          mcpServers: { [agent.id]: server },
          allowedTools: tools.map((tool) => `mcp__${agent.id}__${tool.name}`),
          permissionMode: "dontAsk",
          settingSources: [],
          persistSession: false,
          cwd,
          abortController: abort,
          // The Claude process gets only what it needs; service secrets stay in this process.
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            CLAUDE_CODE_OAUTH_TOKEN: deps.oauthToken,
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
            CLAUDE_AGENT_SDK_CLIENT_APP: "synorq-agents/0.1.0",
          },
        },
      });

      for await (const message of stream) {
        for (const event of toEvents(message)) await record(event.kind, event.content, event.name);
        if (message.type !== "result") continue;

        const usage = Object.values(message.modelUsage ?? {});
        const totals = {
          numTurns: message.num_turns,
          costUsd: message.total_cost_usd,
          inputTokens: usage.reduce((sum, item) => sum + (item.inputTokens ?? 0), 0),
          outputTokens: usage.reduce((sum, item) => sum + (item.outputTokens ?? 0), 0),
          cacheReadTokens: usage.reduce((sum, item) => sum + (item.cacheReadInputTokens ?? 0), 0),
        };
        if (message.subtype === "success" && !message.is_error) return { status: "success", result: message.result, ...totals };
        const error = message.subtype === "success" ? message.result : `${message.subtype}: ${message.errors.join("; ")}`;
        await record("error", error);
        return { status: "error", error, ...totals };
      }
      return { status: "error", error: "The agent stopped without a result" };
    } catch (error) {
      const text = abort.signal.aborted ? `Timed out after ${timeoutMs / 60_000} minutes` : error instanceof Error ? error.message : String(error);
      Sentry.captureException(error, { tags: { agent: agent.id } });
      await record("error", text).catch(() => undefined);
      return { status: "error", error: text };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    isActive: (agentId: string) => active.has(agentId),

    /** Starts a run and returns its id at once; the run continues in the background. */
    async start(agent: AgentDefinition, trigger: RunTrigger): Promise<{ runId: string; done: Promise<void> }> {
      if (active.has(agent.id) || (await deps.store.isRunning(agent.id))) throw new AgentBusyError(agent.id);
      active.add(agent.id);
      let runId: string;
      try {
        runId = await deps.store.start(agent.id, trigger);
      } catch (error) {
        active.delete(agent.id);
        throw error;
      }

      const done = (async () => {
        let finish: RunFinish;
        try {
          finish = await execute(agent, runId);
        } catch (error) {
          finish = { status: "error", error: error instanceof Error ? error.message : String(error) };
          Sentry.captureException(error, { tags: { agent: agent.id } });
        }
        try {
          await deps.store.finish(runId, finish);
        } finally {
          active.delete(agent.id);
        }
        const link = deps.dashboardUrl ? `\n\n${deps.dashboardUrl}/runs/${runId}` : "";
        const message =
          finish.status === "success"
            ? agent.notifyResult && finish.result ? `${finish.result}${link}` : null
            : `⚠️ ${agent.name} başarısız oldu\n\n${finish.error ?? "Bilinmeyen hata"}${link}`;
        if (message) await deps.notify(message).catch((error) => Sentry.captureException(error));
      })();

      return { runId, done };
    },
  };
}

export type Runner = ReturnType<typeof createRunner>;
