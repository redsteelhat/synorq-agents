import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";

import type { AgentDefinition } from "../agents/types.js";
import type { RunStore } from "../db/runs.js";
import { AgentBusyError, type Runner } from "../runner.js";
import type { Scheduler } from "../scheduler.js";
import { checkCredentials, createLoginLimiter, endSession, requireSession, safeNext, startSession, type Admin } from "./auth.js";
import { Dashboard, LoginPage, NotFound, RunPage, RunsPage } from "./views.js";

export type AppDeps = {
  agents: AgentDefinition[];
  store: RunStore;
  runner: Runner;
  scheduler: Pick<Scheduler, "nextRun">;
  admin: Admin;
  /** Mark the session cookie Secure (true behind HTTPS in production). */
  secureCookies?: boolean;
  healthcheck: () => Promise<boolean>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createApp(deps: AppDeps) {
  const app = new Hono();
  const byId = new Map(deps.agents.map((agent) => [agent.id, agent]));

  // Unauthenticated, for the container healthcheck and uptime monitors.
  app.get("/healthz", async (c) => ((await deps.healthcheck()) ? c.text("ok") : c.text("database unavailable", 503)));

  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: { defaultSrc: ["'none'"], styleSrc: ["'unsafe-inline'"], imgSrc: ["'self'", "data:"], formAction: ["'self'"], frameAncestors: ["'none'"], baseUri: ["'none'"] },
      referrerPolicy: "same-origin",
    }),
  );
  app.use("*", async (c, next) => {
    await next();
    c.header("X-Robots-Tag", "noindex, nofollow");
    c.header("Cache-Control", "no-store");
  });
  app.use("*", csrf());

  const secure = deps.secureCookies ?? false;
  const limiter = createLoginLimiter();
  const clientKey = (c: { req: { header: (name: string) => string | undefined } }) =>
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "local";

  app.get("/login", (c) => c.html(<LoginPage next={safeNext(c.req.query("next"))} />));

  app.post("/login", async (c) => {
    const key = clientKey(c);
    const form = await c.req.parseBody();
    const next = safeNext(typeof form.next === "string" ? form.next : undefined);
    if (limiter.blocked(key)) return c.html(<LoginPage next={next} error="Çok fazla deneme. 15 dakika sonra tekrar deneyin." />, 429);
    const username = typeof form.username === "string" ? form.username.trim() : "";
    const password = typeof form.password === "string" ? form.password : "";
    if (!checkCredentials(deps.admin, username, password)) {
      limiter.fail(key);
      return c.html(<LoginPage next={next} error="Kullanıcı adı veya şifre yanlış." />, 401);
    }
    limiter.reset(key);
    await startSession(c, deps.admin, secure);
    return c.redirect(next, 303);
  });

  app.post("/logout", (c) => {
    endSession(c, secure);
    return c.redirect("/login", 303);
  });

  app.use("*", requireSession(deps.admin, ["/login", "/healthz"]));

  app.get("/", async (c) => {
    const [last, day, week, recent] = await Promise.all([deps.store.lastByAgent(), deps.store.usageSince(1), deps.store.usageSince(7), deps.store.list({ limit: 15 })]);
    return c.html(<Dashboard agents={deps.agents} last={last} next={deps.scheduler.nextRun} busy={deps.runner.isActive} day={day} week={week} recent={recent} />);
  });

  app.get("/runs", async (c) => {
    const agent = c.req.query("agent");
    const runs = await deps.store.list({ agent: agent && byId.has(agent) ? agent : undefined, limit: 100 });
    return c.html(<RunsPage runs={runs} agent={agent && byId.has(agent) ? agent : undefined} />);
  });

  app.get("/runs/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return c.html(<NotFound />, 404);
    const run = await deps.store.get(id);
    if (!run) return c.html(<NotFound />, 404);
    const events = await deps.store.events(id);
    return c.html(<RunPage run={run} agentName={byId.get(run.agent)?.name ?? run.agent} events={events} />);
  });

  app.post("/agents/:id/run", async (c) => {
    const agent = byId.get(c.req.param("id"));
    if (!agent) return c.html(<NotFound />, 404);
    try {
      const { runId } = await deps.runner.start(agent, "manual");
      return c.redirect(`/runs/${runId}`, 303);
    } catch (error) {
      if (error instanceof AgentBusyError) return c.redirect(`/runs?agent=${agent.id}`, 303);
      throw error;
    }
  });

  app.notFound((c) => c.html(<NotFound />, 404));
  app.onError((error, c) => {
    // Auth (401) and CSRF (403) rejections carry their own response.
    if (error instanceof HTTPException) return error.getResponse();
    console.error(error);
    return c.text("Sunucu hatası", 500);
  });

  return app;
}
