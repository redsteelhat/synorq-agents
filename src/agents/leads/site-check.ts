import { safeGet, UnsafeAddressError } from "../../lib/safe-fetch.js";

const SOCIAL = /(^|\.)(instagram\.com|facebook\.com|fb\.com|linktr\.ee|wa\.me|whatsapp\.com|tiktok\.com|x\.com|twitter\.com|youtube\.com|sites\.google\.com|business\.site)$/i;

export type SiteCheck = {
  ok: boolean;
  /** The listed address is a social profile or a link page, not a real website. */
  socialOnly?: boolean;
  problem?: string;
  finalUrl?: string;
  status?: number;
  https?: boolean;
  loadMs?: number;
  kb?: number;
  title?: string | null;
  hasMetaDescription?: boolean;
  mobileViewport?: boolean;
  copyrightYear?: number | null;
  generator?: string | null;
  hasWhatsapp?: boolean;
  hasPhoneLink?: boolean;
  hasForm?: boolean;
  hasBookingLink?: boolean;
};

function detectGenerator(html: string): string | null {
  const meta = html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i)?.[1];
  if (meta) return meta.slice(0, 60);
  if (/wp-content|wp-includes/i.test(html)) return "WordPress";
  if (/static\.wixstatic\.com|wix\.com/i.test(html)) return "Wix";
  if (/cdn\.shopify\.com/i.test(html)) return "Shopify";
  if (/ticimax|ideasoft|ikas/i.test(html)) return "Hazır e-ticaret altyapısı";
  if (/__next|_next\/static/i.test(html)) return "Next.js";
  return null;
}

export function latestYear(html: string, now = new Date()): number | null {
  const years = [...html.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/gi)].map((match) => Number(match[1]));
  const valid = years.filter((year) => year >= 1995 && year <= now.getFullYear() + 1);
  return valid.length ? Math.max(...valid) : null;
}

export function analyseHtml(html: string) {
  return {
    title: html.match(/<title[^>]*>([^<]{0,140})/i)?.[1]?.trim() ?? null,
    hasMetaDescription: /<meta[^>]+name=["']description["'][^>]+content=["'][^"']{10,}/i.test(html),
    mobileViewport: /<meta[^>]+name=["']viewport["']/i.test(html),
    copyrightYear: latestYear(html),
    generator: detectGenerator(html),
    hasWhatsapp: /wa\.me\/|api\.whatsapp\.com|whatsapp:\/\//i.test(html),
    hasPhoneLink: /href=["']tel:/i.test(html),
    hasForm: /<form[\s>]/i.test(html),
    hasBookingLink: /randevu|rezervasyon|booking|calendly|cal\.com/i.test(html),
  };
}

export function isSocialHost(hostname: string): boolean {
  return SOCIAL.test(hostname);
}

export async function checkSite(raw: string | undefined | null): Promise<SiteCheck> {
  if (!raw) return { ok: false, problem: "no_website" };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
  } catch {
    return { ok: false, problem: "invalid_url" };
  }
  if (isSocialHost(url.hostname)) return { ok: false, socialOnly: true, problem: "social_only", finalUrl: url.toString() };

  try {
    const response = await safeGet(url.toString());
    const html = response.body;
    if (isSocialHost(new URL(response.url).hostname)) return { ok: false, socialOnly: true, problem: "social_only", finalUrl: response.url };
    const base: SiteCheck = {
      ok: response.status < 400,
      finalUrl: response.url,
      status: response.status,
      https: response.url.startsWith("https://"),
      loadMs: response.ms,
      kb: Math.round(response.bytes / 1024),
    };
    if (response.status >= 400) return { ...base, problem: `http_${response.status}` };
    return { ...base, ...analyseHtml(html), problem: html.trim().length < 200 ? "empty_page" : undefined };
  } catch (error) {
    if (error instanceof UnsafeAddressError) return { ok: false, problem: "unsafe_address" };
    const cause = (error as { cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code;
    const name = (error as Error).name;
    const problem =
      name === "TimeoutError" ? "timeout"
      : cause === "ENOTFOUND" || cause === "EAI_AGAIN" ? "dns_not_found"
      : cause === "EUNSAFE" ? "unsafe_address"
      : cause?.startsWith("ERR_TLS") || cause?.includes("CERT") ? "ssl_error"
      : cause === "ECONNREFUSED" ? "connection_refused"
      : "unreachable";
    return { ok: false, problem, finalUrl: url.toString() };
  }
}
