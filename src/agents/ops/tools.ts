import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import type { Config } from "../../config.js";
import { fetchJson, type FetchFn } from "../../lib/http.js";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 1) }] };
}

function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

async function guarded(run: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await run());
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

const notConfigured = (what: string) => fail(`${what} is not configured on this service.`);

// ---------------------------------------------------------------- Coolify

type CoolifyApp = { uuid: string; name: string; fqdn?: string | null; status?: string; build_pack?: string; updated_at?: string };
type CoolifyNamed = { uuid: string; name: string; status?: string };
type CoolifyServer = { uuid: string; name: string; ip?: string; settings?: { is_reachable?: boolean; is_usable?: boolean } };

export async function coolifyOverview(config: Config, fetchFn: FetchFn) {
  const base = config.COOLIFY_URL!.replace(/\/+$/, "");
  const headers = { Authorization: `Bearer ${config.COOLIFY_API_TOKEN}`, Accept: "application/json" };
  const get = <T>(path: string) => fetchJson<T>(fetchFn, `${base}/api/v1${path}`, { headers });
  const settle = async <T>(promise: Promise<T>) => promise.then((value) => ({ value })).catch((error: Error) => ({ error: error.message }));

  const [applications, services, databases, servers] = await Promise.all([
    settle(get<CoolifyApp[]>("/applications")),
    settle(get<CoolifyNamed[]>("/services")),
    settle(get<CoolifyNamed[]>("/databases")),
    settle(get<CoolifyServer[]>("/servers")),
  ]);
  return {
    applications: "value" in applications ? applications.value.map(({ name, fqdn, status, build_pack, updated_at }) => ({ name, fqdn, status, build_pack, updated_at })) : applications,
    services: "value" in services ? services.value.map(({ name, status }) => ({ name, status })) : services,
    databases: "value" in databases ? databases.value.map(({ name, status }) => ({ name, status })) : databases,
    servers: "value" in servers ? servers.value.map(({ name, ip, settings }) => ({ name, ip, reachable: settings?.is_reachable, usable: settings?.is_usable })) : servers,
  };
}

// ---------------------------------------------------------------- Sentry

type SentryIssue = {
  shortId: string;
  title: string;
  culprit?: string;
  level?: string;
  count?: string;
  userCount?: number;
  firstSeen?: string;
  lastSeen?: string;
  permalink?: string;
  project?: { slug?: string };
};

export async function sentryIssues(config: Config, fetchFn: FetchFn, hours: number, onlyNew: boolean) {
  const query = onlyNew ? `is:unresolved firstSeen:-${hours}h` : `is:unresolved lastSeen:-${hours}h`;
  const params = new URLSearchParams({ query, sort: "freq", limit: "25", statsPeriod: "14d" });
  const url = `${config.SENTRY_API_URL.replace(/\/+$/, "")}/api/0/organizations/${encodeURIComponent(config.SENTRY_ORG)}/issues/?${params}`;
  const issues = await fetchJson<SentryIssue[]>(fetchFn, url, { headers: { Authorization: `Bearer ${config.SENTRY_API_TOKEN}` } });
  return {
    query,
    total: issues.length,
    issues: issues.map((issue) => ({
      id: issue.shortId,
      project: issue.project?.slug,
      title: issue.title,
      where: issue.culprit,
      level: issue.level,
      events: Number(issue.count ?? 0),
      users: issue.userCount ?? 0,
      firstSeen: issue.firstSeen,
      lastSeen: issue.lastSeen,
      link: issue.permalink,
    })),
  };
}

// ---------------------------------------------------------------- UptimeRobot

const uptimeStatus: Record<number, string> = { 0: "paused", 1: "not checked yet", 2: "up", 8: "seems down", 9: "down" };

type UptimeMonitor = { friendly_name: string; url: string; status: number; custom_uptime_ratio?: string };

export async function uptimeMonitors(config: Config, fetchFn: FetchFn) {
  const body = new URLSearchParams({ api_key: config.UPTIMEROBOT_API_KEY!, format: "json", custom_uptime_ratios: "1-7-30" });
  const data = await fetchJson<{ stat: string; monitors?: UptimeMonitor[]; error?: { message?: string } }>(fetchFn, "https://api.uptimerobot.com/v2/getMonitors", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (data.stat !== "ok") throw new Error(`UptimeRobot: ${data.error?.message ?? "request failed"}`);
  return (data.monitors ?? []).map((monitor) => {
    const [day, week, month] = (monitor.custom_uptime_ratio ?? "").split("-");
    return { name: monitor.friendly_name, url: monitor.url, status: uptimeStatus[monitor.status] ?? `unknown (${monitor.status})`, uptime: { "24h": day, "7d": week, "30d": month } };
  });
}

// ---------------------------------------------------------------- Umami

type UmamiWebsite = { id: string; name: string; domain: string };

export async function umamiStats(config: Config, fetchFn: FetchFn, days: number, now = Date.now()) {
  const base = config.UMAMI_URL!.replace(/\/+$/, "");
  const login = await fetchJson<{ token: string }>(fetchFn, `${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: config.UMAMI_USERNAME, password: config.UMAMI_PASSWORD }),
  });
  const headers = { Authorization: `Bearer ${login.token}`, Accept: "application/json" };
  const get = <T>(path: string) => fetchJson<T>(fetchFn, `${base}/api${path}`, { headers });

  const websitesResponse = await get<{ data?: UmamiWebsite[] } | UmamiWebsite[]>("/websites");
  const websites = Array.isArray(websitesResponse) ? websitesResponse : (websitesResponse.data ?? []);
  const span = days * 24 * 60 * 60 * 1000;
  const current = { startAt: now - span, endAt: now };
  const previous = { startAt: now - 2 * span, endAt: now - span };
  const range = (r: { startAt: number; endAt: number }) => `startAt=${r.startAt}&endAt=${r.endAt}`;

  return Promise.all(
    websites.map(async (site) => {
      const [stats, before, pages, referrers] = await Promise.all([
        get<unknown>(`/websites/${site.id}/stats?${range(current)}`),
        get<unknown>(`/websites/${site.id}/stats?${range(previous)}`),
        get<unknown>(`/websites/${site.id}/metrics?type=path&limit=5&${range(current)}`).catch(() => get<unknown>(`/websites/${site.id}/metrics?type=url&limit=5&${range(current)}`)),
        get<unknown>(`/websites/${site.id}/metrics?type=referrer&limit=5&${range(current)}`).catch(() => null),
      ]);
      return { website: site.name, domain: site.domain, period: `last ${days} day(s)`, stats, previousPeriod: before, topPages: pages, topReferrers: referrers };
    }),
  );
}

// ---------------------------------------------------------------- tool set

export function createOpsTools(config: Config, fetchFn: FetchFn = fetch) {
  return [
    tool("coolify_overview", "Status of every application, service, database and server on the Coolify host.", {}, async () =>
      config.COOLIFY_URL && config.COOLIFY_API_TOKEN ? guarded(() => coolifyOverview(config, fetchFn)) : notConfigured("Coolify"),
    ),
    tool(
      "sentry_issues",
      "Unresolved Sentry issues across all projects. Use only_new=true for issues first seen in the window.",
      { hours: z.number().int().min(1).max(168).default(24), only_new: z.boolean().default(false) },
      async ({ hours, only_new }) => (config.SENTRY_API_TOKEN ? guarded(() => sentryIssues(config, fetchFn, hours, only_new)) : notConfigured("Sentry")),
    ),
    tool("uptime_monitors", "Current status and 24h / 7d / 30d uptime of every UptimeRobot monitor.", {}, async () =>
      config.UPTIMEROBOT_API_KEY ? guarded(() => uptimeMonitors(config, fetchFn)) : notConfigured("UptimeRobot"),
    ),
    tool(
      "umami_stats",
      "Website traffic from Umami for each site: visitors, visits, pageviews, bounces and total time for the window and the window before it, plus top pages and referrers.",
      { days: z.number().int().min(1).max(30).default(1) },
      async ({ days }) => (config.UMAMI_URL && config.UMAMI_USERNAME && config.UMAMI_PASSWORD ? guarded(() => umamiStats(config, fetchFn, days)) : notConfigured("Umami")),
    ),
  ];
}
