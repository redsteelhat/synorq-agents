import type { Sql } from "./index.js";

export type RunStatus = "running" | "success" | "error";
export type RunTrigger = "schedule" | "manual";
export type EventKind = "text" | "tool_use" | "tool_result" | "error" | "info";

export type Run = {
  id: string;
  agent: string;
  trigger: RunTrigger;
  status: RunStatus;
  started_at: Date;
  finished_at: Date | null;
  duration_ms: number | null;
  num_turns: number | null;
  cost_usd: string | null;
  input_tokens: string | null;
  output_tokens: string | null;
  cache_read_tokens: string | null;
  result: string | null;
  error: string | null;
};

export type RunEvent = {
  id: string;
  seq: number;
  at: Date;
  kind: EventKind;
  name: string | null;
  content: string;
};

export type RunFinish = {
  status: Exclude<RunStatus, "running">;
  numTurns?: number;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  result?: string;
  error?: string;
};

export type UsageSummary = { runs: number; failed: number; cost_usd: string; input_tokens: string; output_tokens: string };

export function createRunStore(sql: Sql) {
  return {
    async start(agent: string, trigger: RunTrigger): Promise<string> {
      const [row] = await sql<{ id: string }[]>`insert into runs (agent, trigger) values (${agent}, ${trigger}) returning id`;
      if (!row) throw new Error("Could not create run");
      return row.id;
    },

    async addEvent(runId: string, seq: number, kind: EventKind, content: string, name?: string): Promise<void> {
      await sql`insert into run_events (run_id, seq, kind, name, content) values (${runId}, ${seq}, ${kind}, ${name ?? null}, ${content})`;
    },

    async finish(runId: string, finish: RunFinish): Promise<void> {
      await sql`
        update runs set
          status = ${finish.status},
          finished_at = now(),
          duration_ms = (extract(epoch from (now() - started_at)) * 1000)::integer,
          num_turns = ${finish.numTurns ?? null},
          cost_usd = ${finish.costUsd ?? null},
          input_tokens = ${finish.inputTokens ?? null},
          output_tokens = ${finish.outputTokens ?? null},
          cache_read_tokens = ${finish.cacheReadTokens ?? null},
          result = ${finish.result ?? null},
          error = ${finish.error ?? null}
        where id = ${runId}`;
    },

    /** Runs left "running" by a previous process (crash, redeploy) can never finish. */
    async failInterrupted(): Promise<number> {
      const rows = await sql`
        update runs set status = 'error', finished_at = now(), error = 'Interrupted: the service restarted during this run'
        where status = 'running' returning id`;
      return rows.length;
    },

    async isRunning(agent: string): Promise<boolean> {
      const [row] = await sql<{ count: number }[]>`select count(*)::int as count from runs where agent = ${agent} and status = 'running'`;
      return (row?.count ?? 0) > 0;
    },

    async get(runId: string): Promise<Run | undefined> {
      const [row] = await sql<Run[]>`select * from runs where id = ${runId}`;
      return row;
    },

    async events(runId: string): Promise<RunEvent[]> {
      return sql<RunEvent[]>`select id, seq, at, kind, name, content from run_events where run_id = ${runId} order by seq`;
    },

    async list(options: { agent?: string; limit?: number } = {}): Promise<Run[]> {
      const limit = Math.min(options.limit ?? 50, 200);
      return options.agent
        ? sql<Run[]>`select * from runs where agent = ${options.agent} order by started_at desc limit ${limit}`
        : sql<Run[]>`select * from runs order by started_at desc limit ${limit}`;
    },

    async lastByAgent(): Promise<Map<string, Run>> {
      const rows = await sql<Run[]>`select distinct on (agent) * from runs order by agent, started_at desc`;
      return new Map(rows.map((row) => [row.agent, row]));
    },

    async usageSince(days: number): Promise<UsageSummary> {
      const [row] = await sql<UsageSummary[]>`
        select count(*)::int as runs,
               count(*) filter (where status = 'error')::int as failed,
               coalesce(sum(cost_usd), 0)::text as cost_usd,
               coalesce(sum(input_tokens), 0)::text as input_tokens,
               coalesce(sum(output_tokens), 0)::text as output_tokens
        from runs where started_at > now() - make_interval(days => ${days})`;
      return row ?? { runs: 0, failed: 0, cost_usd: "0", input_tokens: "0", output_tokens: "0" };
    },

    async deleteOlderThan(days: number): Promise<number> {
      const rows = await sql`delete from runs where started_at < now() - make_interval(days => ${days}) returning id`;
      return rows.length;
    },
  };
}

export type RunStore = ReturnType<typeof createRunStore>;
