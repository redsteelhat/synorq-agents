import { describe, expect, it, vi } from "vitest";

import { loadConfig } from "../../config.js";
import { coolifyOverview, createOpsTools, sentryIssues, umamiStats, uptimeMonitors } from "./tools.js";

const config = loadConfig({
  DATABASE_URL: "postgres://x",
  ADMIN_PASSWORD: "a-long-enough-password",
  COOLIFY_URL: "https://panel.example.com/",
  COOLIFY_API_TOKEN: "coolify-token",
  SENTRY_API_TOKEN: "sentry-token",
  UPTIMEROBOT_API_KEY: "ur-key",
  UMAMI_URL: "https://analytics.example.com",
  UMAMI_USERNAME: "agent",
  UMAMI_PASSWORD: "pw",
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("ops tools", () => {
  it("summarises Coolify and keeps going when one endpoint fails", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      expect(u.startsWith("https://panel.example.com/api/v1/")).toBe(true);
      if (u.endsWith("/applications")) return json([{ uuid: "1", name: "synorq-web", fqdn: "https://synorq.com", status: "running:healthy", secret: "nope" }]);
      if (u.endsWith("/services")) return json([], 500);
      if (u.endsWith("/databases")) return json([{ uuid: "2", name: "umami-db", status: "running" }]);
      return json([{ uuid: "3", name: "localhost", ip: "host.docker.internal", settings: { is_reachable: true, is_usable: true } }]);
    });
    const result = await coolifyOverview(config, fetchFn as typeof fetch);
    expect(result.applications).toEqual([{ name: "synorq-web", fqdn: "https://synorq.com", status: "running:healthy", build_pack: undefined, updated_at: undefined }]);
    expect(result.services).toEqual({ error: "HTTP 500 from panel.example.com" });
    expect(result.servers).toEqual([{ name: "localhost", ip: "host.docker.internal", reachable: true, usable: true }]);
  });

  it("asks Sentry for new issues in the EU region", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(url));
      expect(u.origin).toBe("https://de.sentry.io");
      expect(u.pathname).toBe("/api/0/organizations/synorq/issues/");
      expect(u.searchParams.get("query")).toBe("is:unresolved firstSeen:-24h");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sentry-token");
      return json([{ shortId: "SYNORQ-WEB-1", title: "Error: Sentry test", count: "3", userCount: 1, project: { slug: "synorq-web" } }]);
    });
    const result = await sentryIssues(config, fetchFn as typeof fetch, 24, true);
    expect(result.issues[0]).toMatchObject({ id: "SYNORQ-WEB-1", events: 3, users: 1, project: "synorq-web" });
  });

  it("maps UptimeRobot statuses and uptime ratios", async () => {
    const fetchFn = vi.fn(async () => json({ stat: "ok", monitors: [{ friendly_name: "synorq.com", url: "https://synorq.com", status: 9, custom_uptime_ratio: "99.1-99.8-99.9" }] }));
    expect(await uptimeMonitors(config, fetchFn as typeof fetch)).toEqual([{ name: "synorq.com", url: "https://synorq.com", status: "down", uptime: { "24h": "99.1", "7d": "99.8", "30d": "99.9" } }]);
  });

  it("logs in to Umami and compares two periods", async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      calls.push(u);
      if (u.endsWith("/api/auth/login")) return json({ token: "t" });
      if (u.endsWith("/api/websites")) return json({ data: [{ id: "w1", name: "synorq.com", domain: "synorq.com" }] });
      if (u.includes("/stats")) return json({ visitors: 5 });
      return json([{ x: "/tr", y: 4 }]);
    });
    const [site] = await umamiStats(config, fetchFn as typeof fetch, 1, 1_000_000_000);
    expect(site).toMatchObject({ website: "synorq.com", stats: { visitors: 5 }, previousPeriod: { visitors: 5 } });
    expect(calls.some((u) => u.includes("startAt=913600000&endAt=1000000000"))).toBe(true);
    expect(calls.some((u) => u.includes("startAt=827200000&endAt=913600000"))).toBe(true);
  });

  it("reports a missing integration as a tool error instead of throwing", async () => {
    const bare = loadConfig({ DATABASE_URL: "postgres://x", ADMIN_PASSWORD: "a-long-enough-password" });
    const uptime = createOpsTools(bare).find((t) => t.name === "uptime_monitors")!;
    const result = await (uptime.handler as (args: object, extra: unknown) => Promise<{ isError?: boolean }>)({}, undefined);
    expect(result.isError).toBe(true);
  });
});
