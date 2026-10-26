import { serve } from "@hono/node-server";
import * as Sentry from "@sentry/node";

import { createAgents } from "./agents/index.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db/index.js";
import { migrate } from "./db/migrate.js";
import { createRunStore } from "./db/runs.js";
import { createTelegramNotifier } from "./lib/telegram.js";
import { createRunner } from "./runner.js";
import { startScheduler } from "./scheduler.js";
import { createApp } from "./web/app.js";

const config = loadConfig();

if (config.SENTRY_DSN) {
  Sentry.init({ dsn: config.SENTRY_DSN, environment: config.NODE_ENV, tracesSampleRate: 0 });
}

const sql = createDb(config.DATABASE_URL);
const applied = await migrate(sql);
if (applied) console.log(`[db] applied ${applied} migration(s)`);

const store = createRunStore(sql);
const interrupted = await store.failInterrupted();
if (interrupted) console.log(`[runs] marked ${interrupted} interrupted run(s) as failed`);

const notify = createTelegramNotifier(config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_CHAT_ID);
const agents = createAgents(config);
const runner = createRunner({ store, notify, oauthToken: config.CLAUDE_CODE_OAUTH_TOKEN, model: config.AGENT_MODEL, dashboardUrl: process.env.PUBLIC_URL?.replace(/\/+$/, "") });

const scheduler = startScheduler(agents, runner, config.TZ_NAME, async () => {
  const removed = await store.deleteOlderThan(config.RUN_RETENTION_DAYS);
  if (removed) console.log(`[runs] deleted ${removed} run(s) older than ${config.RUN_RETENTION_DAYS} days`);
});

const app = createApp({
  agents,
  store,
  runner,
  scheduler,
  admin: { username: config.ADMIN_USER, password: config.ADMIN_PASSWORD },
  secureCookies: config.NODE_ENV === "production",
  healthcheck: async () => {
    try {
      await sql`select 1`;
      return true;
    } catch {
      return false;
    }
  },
});

const server = serve({ fetch: app.fetch, port: config.PORT, hostname: "0.0.0.0" }, (info) => {
  console.log(`[web] listening on :${info.port} · agents: ${agents.map((agent) => agent.id).join(", ")}`);
});

async function shutdown(signal: string) {
  console.log(`[shutdown] ${signal}`);
  scheduler.stop();
  server.close();
  await sql.end({ timeout: 5 });
  await Sentry.flush(2000);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
