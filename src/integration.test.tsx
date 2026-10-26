import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { AgentDefinition } from "./agents/types.js";
import { createDb } from "./db/index.js";
import { migrate } from "./db/migrate.js";
import { createRunStore } from "./db/runs.js";
import { createRunner, type QueryFn } from "./runner.js";
import { createApp } from "./web/app.js";

const url = process.env.TEST_DATABASE_URL;
const sql = url ? createDb(url) : undefined;

const agent: AgentDefinition = {
  id: "ops",
  name: "Ops raporu",
  description: "test",
  schedule: "0 8 * * *",
  systemPrompt: "s",
  prompt: () => "p",
  tools: [],
  maxTurns: 3,
  notifyResult: true,
};

function fakeQuery(messages: unknown[]): QueryFn {
  return (() =>
    (async function* () {
      for (const message of messages) yield message as SDKMessage;
    })()) as unknown as QueryFn;
}

const success = [
  { type: "assistant", message: { content: [{ type: "text", text: "Kontrol ediyorum" }, { type: "tool_use", id: "t1", name: "mcp__ops__uptime_monitors", input: {} }] } },
  { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "[{\"status\":\"up\"}]" }] }] } },
  { type: "result", subtype: "success", is_error: false, result: "Her şey yolunda.", num_turns: 2, total_cost_usd: 0.0123, modelUsage: { sonnet: { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 10 } } },
];

describe.skipIf(!sql)("runner + store + dashboard", () => {
  beforeAll(async () => {
    await sql!`drop schema public cascade`;
    await sql!`create schema public`;
    expect(await migrate(sql!)).toBe(1);
    expect(await migrate(sql!)).toBe(0);
  });
  afterAll(async () => {
    await sql?.end();
  });

  it("records a successful run, its steps, usage, and notifies", async () => {
    const store = createRunStore(sql!);
    const notify = vi.fn(async () => undefined);
    const runner = createRunner({ store, notify, oauthToken: "tok", model: "sonnet", dashboardUrl: "https://agents.example.com", queryFn: fakeQuery(success) });
    const { runId, done } = await runner.start(agent, "manual");
    await done;

    const run = await store.get(runId);
    expect(run).toMatchObject({ status: "success", result: "Her şey yolunda.", num_turns: 2, input_tokens: "100", output_tokens: "50", cache_read_tokens: "10" });
    expect(Number(run!.cost_usd)).toBeCloseTo(0.0123);
    const events = await store.events(runId);
    expect(events.map((e) => e.kind)).toEqual(["text", "tool_use", "tool_result"]);
    expect(events[1]!.name).toBe("mcp__ops__uptime_monitors");
    expect(notify).toHaveBeenCalledWith(`Her şey yolunda.\n\nhttps://agents.example.com/runs/${runId}`);
  });

  it("marks a failed run and always notifies the failure", async () => {
    const store = createRunStore(sql!);
    const notify = vi.fn(async () => undefined);
    const failing = [{ type: "result", subtype: "error_max_turns", is_error: true, errors: ["too many turns"], num_turns: 3, total_cost_usd: 0, modelUsage: {} }];
    const runner = createRunner({ store, notify, oauthToken: "tok", model: "sonnet", queryFn: fakeQuery(failing) });
    const { runId, done } = await runner.start({ ...agent, notifyResult: false }, "schedule");
    await done;
    expect(await store.get(runId)).toMatchObject({ status: "error", error: "error_max_turns: too many turns" });
    expect(notify).toHaveBeenCalledOnce();
  });

  it("refuses to start without a Claude token and does not start twice", async () => {
    const store = createRunStore(sql!);
    const runner = createRunner({ store, notify: async () => undefined, model: "sonnet" });
    const { runId, done } = await runner.start(agent, "manual");
    await expect(runner.start(agent, "manual")).rejects.toThrow("already running");
    await done;
    expect(await store.get(runId)).toMatchObject({ status: "error", error: "CLAUDE_CODE_OAUTH_TOKEN is not set" });
  });

  it("marks runs left running by a restart as failed", async () => {
    const store = createRunStore(sql!);
    await store.start("ops", "schedule");
    expect(await store.failInterrupted()).toBe(1);
    expect(await store.isRunning("ops")).toBe(false);
  });

  async function login(app: ReturnType<typeof createApp>, username: string, password: string) {
    const body = new URLSearchParams({ username, password, next: "/" });
    return app.request("http://localhost/login", { method: "POST", body, headers: { Origin: "http://localhost", "Content-Type": "application/x-www-form-urlencoded" } });
  }

  it("serves the dashboard behind a login and starts a run from the button", async () => {
    const store = createRunStore(sql!);
    const runner = createRunner({ store, notify: async () => undefined, oauthToken: "tok", model: "sonnet", queryFn: fakeQuery(success) });
    const app = createApp({ agents: [agent], store, runner, scheduler: { nextRun: () => null }, admin: { username: "tarik", password: "secret-password-123" }, healthcheck: async () => true });

    expect((await app.request("/healthz")).status).toBe(200);
    const anonymous = await app.request("/runs");
    expect(anonymous.status).toBe(303);
    expect(anonymous.headers.get("location")).toBe("/login?next=%2Fruns");
    expect((await app.request("/login")).status).toBe(200);

    expect((await login(app, "tarik", "wrong-password")).status).toBe(401);
    const ok = await login(app, "tarik", "secret-password-123");
    expect(ok.status).toBe(303);
    const cookie = ok.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    const auth = { Cookie: cookie.split(";")[0]! };

    const home = await app.request("/", { headers: auth });
    expect(home.status).toBe(200);
    const html = await home.text();
    expect(html).toContain("Ops raporu");
    expect(html).toContain("Şimdi çalıştır");

    const crossSite = await app.request("/agents/ops/run", { method: "POST", headers: { ...auth, Origin: "https://evil.example", "Content-Type": "application/x-www-form-urlencoded" } });
    expect(crossSite.status).toBe(403);

    const started = await app.request("http://localhost/agents/ops/run", { method: "POST", headers: { ...auth, Origin: "http://localhost", "Content-Type": "application/x-www-form-urlencoded" } });
    expect(started.status).toBe(303);
    const location = started.headers.get("location")!;
    expect(location).toMatch(/^\/runs\/[0-9a-f-]{36}$/);

    await vi.waitFor(async () => expect((await store.get(location.split("/").pop()!))?.status).toBe("success"));
    const page = await (await app.request(location, { headers: auth })).text();
    expect(page).toContain("Her şey yolunda.");
    expect(page).toContain("mcp__ops__uptime_monitors");
    expect((await app.request("/runs/not-a-uuid", { headers: auth })).status).toBe(404);

    const forged = await app.request("/", { headers: { Cookie: "synorq_agents_session=9999999999999.fake" } });
    expect(forged.status).toBe(303);
  });

  it("locks the login after repeated failures", async () => {
    const store = createRunStore(sql!);
    const app = createApp({ agents: [agent], store, runner: createRunner({ store, notify: async () => undefined, model: "sonnet" }), scheduler: { nextRun: () => null }, admin: { username: "tarik", password: "secret-password-123" }, healthcheck: async () => true });
    for (let i = 0; i < 5; i += 1) expect((await login(app, "tarik", "nope")).status).toBe(401);
    expect((await login(app, "tarik", "secret-password-123")).status).toBe(429);
  });

  it("escapes agent output in the HTML", async () => {
    const store = createRunStore(sql!);
    const xss = [{ type: "result", subtype: "success", is_error: false, result: "<script>alert(1)</script>", num_turns: 1, total_cost_usd: 0, modelUsage: {} }];
    const runner = createRunner({ store, notify: async () => undefined, oauthToken: "tok", model: "sonnet", queryFn: fakeQuery(xss) });
    const { runId, done } = await runner.start(agent, "manual");
    await done;
    const app = createApp({ agents: [agent], store, runner, scheduler: { nextRun: () => null }, admin: { username: "a", password: "b" }, healthcheck: async () => true });
    const cookie = (await login(app, "a", "b")).headers.get("set-cookie")!.split(";")[0]!;
    const html = await (await app.request(`/runs/${runId}`, { headers: { Cookie: cookie } })).text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
