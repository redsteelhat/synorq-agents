import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { AgentDefinition } from "./agents/types.js";
import { createDb } from "./db/index.js";
import { migrate } from "./db/migrate.js";
import { createLeadStore } from "./db/leads.js";
import { createRunStore } from "./db/runs.js";
import { createLeadTools } from "./agents/leads/tools.js";
import { loadConfig } from "./config.js";
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
  tools: () => [],
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
    expect(await migrate(sql!)).toBe(2);
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
    const app = createApp({ agents: [agent], store, leads: createLeadStore(sql!), runner, scheduler: { nextRun: () => null }, admin: { username: "tarik", password: "secret-password-123" }, healthcheck: async () => true });

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
    const app = createApp({ agents: [agent], store, leads: createLeadStore(sql!), runner: createRunner({ store, notify: async () => undefined, model: "sonnet" }), scheduler: { nextRun: () => null }, admin: { username: "tarik", password: "secret-password-123" }, healthcheck: async () => true });
    for (let i = 0; i < 5; i += 1) expect((await login(app, "tarik", "nope")).status).toBe(401);
    expect((await login(app, "tarik", "secret-password-123")).status).toBe(429);
  });

  it("escapes agent output in the HTML", async () => {
    const store = createRunStore(sql!);
    const xss = [{ type: "result", subtype: "success", is_error: false, result: "<script>alert(1)</script>", num_turns: 1, total_cost_usd: 0, modelUsage: {} }];
    const runner = createRunner({ store, notify: async () => undefined, oauthToken: "tok", model: "sonnet", queryFn: fakeQuery(xss) });
    const { runId, done } = await runner.start(agent, "manual");
    await done;
    const app = createApp({ agents: [agent], store, leads: createLeadStore(sql!), runner, scheduler: { nextRun: () => null }, admin: { username: "a", password: "b" }, healthcheck: async () => true });
    const cookie = (await login(app, "a", "b")).headers.get("set-cookie")!.split(";")[0]!;
    const html = await (await app.request(`/runs/${runId}`, { headers: { Cookie: cookie } })).text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("finds, filters and saves leads, and never trusts model-supplied business data", async () => {
    const store = createRunStore(sql!);
    const leads = createLeadStore(sql!);
    const runId = await store.start("leads", "manual");
    const config = loadConfig({ DATABASE_URL: "x", ADMIN_PASSWORD: "a-long-enough-password", GOOGLE_PLACES_API_KEY: "g-key" });
    const places = [
      { id: "p1", displayName: { text: "Gülüş Diş" }, nationalPhoneNumber: "0532 111 22 33", userRatingCount: 120, rating: 4.8, businessStatus: "OPERATIONAL", googleMapsUri: "https://maps.google.com/?cid=1" },
      { id: "p2", displayName: { text: "Eski Site Diş" }, websiteUri: "http://eski.example", userRatingCount: 40, businessStatus: "OPERATIONAL" },
      { id: "p3", displayName: { text: "Kapalı Diş" }, businessStatus: "CLOSED_PERMANENTLY" },
    ];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://places.googleapis.com/v1/places:searchText");
      expect(JSON.parse(String(init?.body)).textQuery).toBe("diş kliniği Bornova İzmir");
      return new Response(JSON.stringify({ places }), { status: 200 });
    });
    const check = vi.fn(async (site: string | null | undefined) => (site ? { ok: true, https: false, mobileViewport: false, copyrightYear: 2018 } : { ok: false, problem: "no_website" }));
    const tools = createLeadTools({ config, leads, runId, fetchFn: fetchFn as typeof fetch, check });
    const call = async (name: string, args: object) => {
      const result = await (tools.find((t) => t.name === name)!.handler as (a: object, e: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>)(args, undefined);
      return { ...result, data: result.isError ? undefined : JSON.parse(result.content[0]!.text) };
    };

    const first = await call("search_places", { sector: "klinik", district: "Bornova", query: "diş kliniği" });
    expect(first.data.found).toBe(3);
    expect(first.data.closed).toBe(1);
    expect(first.data.candidates.map((c: { place_id: string }) => c.place_id)).toEqual(["p1", "p2"]);

    const saved = await call("save_leads", {
      leads: [
        { place_id: "p1", opportunity: "no_website", score: 9, findings: ["Web sitesi yok, 120 yorum"], pitch: "Merhaba!" },
        { place_id: "fabricated", opportunity: "no_website", score: 10, findings: ["x"], pitch: "x" },
      ],
    });
    expect(saved.data).toEqual({ saved: 1, skipped: 0, rejected_unknown_place_ids: ["fabricated"] });
    const [lead] = await leads.list();
    expect(lead).toMatchObject({ name: "Gülüş Diş", phone: "0532 111 22 33", sector: "klinik", district: "Bornova", score: 9, run_id: runId, status: "new" });

    const again = await call("search_places", { sector: "klinik", district: "Bornova", query: "diş kliniği" });
    expect(again.data.already_on_list).toBe(1);
    expect(again.data.candidates.map((c: { place_id: string }) => c.place_id)).toEqual(["p2"]);

    const coverage = await call("coverage", {});
    expect(coverage.data.grid).toHaveLength(30);
    const bornova = coverage.data.grid.find((row: { sector: string; district: string }) => row.sector === "klinik" && row.district === "Bornova");
    expect(bornova).toMatchObject({ searches: 2, leads: 1 });
    expect(coverage.data.grid.at(-1)).toMatchObject({ sector: "klinik", district: "Bornova" });
  });

  it("shows leads, updates their status and exports CSV", async () => {
    const store = createRunStore(sql!);
    const leads = createLeadStore(sql!);
    const app = createApp({ agents: [agent], store, leads, runner: createRunner({ store, notify: async () => undefined, model: "sonnet" }), scheduler: { nextRun: () => null }, admin: { username: "a", password: "b" }, healthcheck: async () => true });
    const cookie = (await login(app, "a", "b")).headers.get("set-cookie")!.split(";")[0]!;
    const headers = { Cookie: cookie };

    const page = await (await app.request("/leads?sector=klinik&status=new&district=evil", { headers })).text();
    expect(page).toContain("Gülüş Diş");
    expect(page).toContain("https://wa.me/905321112233?text=Merhaba!");

    const [lead] = await leads.list();
    const body = new URLSearchParams({ status: "contacted", notes: "Pazartesi aradım", back: "/leads?sector=klinik" });
    const saved = await app.request(`http://localhost/leads/${lead!.id}`, { method: "POST", body, headers: { ...headers, Origin: "http://localhost", "Content-Type": "application/x-www-form-urlencoded" } });
    expect(saved.status).toBe(303);
    expect(saved.headers.get("location")).toBe("/leads?sector=klinik");
    expect((await leads.list())[0]).toMatchObject({ status: "contacted", notes: "Pazartesi aradım" });

    const csv = await app.request("/leads.csv?status=contacted", { headers });
    expect(csv.headers.get("content-type")).toContain("text/csv");
    const text = await csv.text();
    expect(text).toContain("Gülüş Diş");
    expect(text).toContain("İletişime geçildi");
  });
});
