import { Cron } from "croner";

import type { AgentDefinition } from "./agents/types.js";
import { AgentBusyError, type Runner } from "./runner.js";

export type Scheduler = { nextRun(agentId: string): Date | null; stop(): void };

export function startScheduler(agents: AgentDefinition[], runner: Runner, timezone: string, onHousekeeping: () => Promise<void>): Scheduler {
  const jobs = new Map<string, Cron>();
  for (const agent of agents) {
    if (!agent.schedule) continue;
    const job = new Cron(agent.schedule, { timezone, protect: true, name: agent.id }, async () => {
      try {
        await runner.start(agent, "schedule");
      } catch (error) {
        if (!(error instanceof AgentBusyError)) console.error(`[scheduler] ${agent.id}:`, error);
      }
    });
    jobs.set(agent.id, job);
  }
  const housekeeping = new Cron("15 3 * * *", { timezone, protect: true }, onHousekeeping);

  return {
    nextRun: (agentId) => jobs.get(agentId)?.nextRun() ?? null,
    stop: () => {
      for (const job of jobs.values()) job.stop();
      housekeeping.stop();
    },
  };
}
