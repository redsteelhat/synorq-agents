import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import type { Config } from "../../config.js";
import { opportunities, type LeadStore } from "../../db/leads.js";
import type { FetchFn } from "../../lib/http.js";
import { districts, sectorIds, sectors } from "./catalog.js";
import { pageSpeedMobile, searchPlaces, type Place } from "./places.js";
import { checkSite, type SiteCheck } from "./site-check.js";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (data: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(data) }] });
const fail = (message: string): ToolResult => ({ content: [{ type: "text", text: message }], isError: true });

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]!);
      }
    }),
  );
  return results;
}

function compactSite(site: SiteCheck) {
  const { ok: works, socialOnly, problem, finalUrl, https, loadMs, mobileViewport, copyrightYear, generator, hasWhatsapp, hasPhoneLink, hasForm, hasBookingLink, hasMetaDescription } = site;
  return { works, socialOnly, problem, finalUrl, https, loadMs, mobileViewport, copyrightYear, generator, hasWhatsapp, hasPhoneLink, hasForm, hasBookingLink, hasMetaDescription };
}

export type LeadToolDeps = {
  config: Config;
  leads: LeadStore;
  runId: string;
  fetchFn?: FetchFn;
  check?: typeof checkSite;
};

export function createLeadTools(deps: LeadToolDeps) {
  const fetchFn = deps.fetchFn ?? fetch;
  const check = deps.check ?? checkSite;
  /** Places seen in this run. save_leads only accepts these, so names and phones always come from Google, never from the model. */
  const seen = new Map<string, { place: Place; sector: string; district: string }>();

  return [
    tool("coverage", "Which sector + district combinations were searched before, when, and how many leads they gave. Never-searched combinations come first.", {}, async () => {
      const done = await deps.leads.coverage();
      const key = (sector: string, district: string) => `${sector}|${district}`;
      const byKey = new Map(done.map((row) => [key(row.sector, row.district), row]));
      const grid = sectorIds.flatMap((sector) =>
        districts.map((district) => {
          const row = byKey.get(key(sector, district));
          return { sector, district, last_searched: row?.last_searched ?? null, searches: row?.searches ?? 0, leads: row?.leads ?? 0 };
        }),
      );
      grid.sort((a, b) => (a.last_searched ? new Date(a.last_searched).getTime() : 0) - (b.last_searched ? new Date(b.last_searched).getTime() : 0));
      return ok({ sectors: Object.fromEntries(sectorIds.map((id) => [id, sectors[id].queries])), grid });
    }),

    tool(
      "search_places",
      "Search Google Maps for one business type in one district of İzmir. Returns operational businesses that are not already on the lead list, each with an automatic website check. Businesses already saved are left out.",
      {
        sector: z.enum(sectorIds as [string, ...string[]]),
        district: z.enum(districts),
        query: z.string().min(2).max(60).describe("Business type in Turkish, e.g. one of the sector's queries from coverage"),
      },
      async ({ sector, district, query }) => {
        if (!deps.config.GOOGLE_PLACES_API_KEY) return fail("GOOGLE_PLACES_API_KEY is not configured on this service.");
        try {
          const places = await searchPlaces(deps.config.GOOGLE_PLACES_API_KEY, `${query} ${district} İzmir`, fetchFn);
          await deps.leads.logSearch({ sector, district, query, results: places.length, runId: deps.runId });
          const operational = places.filter((place) => !place.status || place.status === "OPERATIONAL");
          const known = await deps.leads.knownPlaceIds(operational.map((place) => place.id));
          const fresh = operational.filter((place) => !known.has(place.id));
          const checked = await mapLimit(fresh, 5, async (place) => ({ place, site: await check(place.website) }));
          for (const { place } of checked) seen.set(place.id, { place, sector, district });
          return ok({
            query: `${query} ${district} İzmir`,
            found: places.length,
            closed: places.length - operational.length,
            already_on_list: known.size,
            candidates: checked.map(({ place, site }) => ({
              place_id: place.id,
              name: place.name,
              type: place.type,
              phone: place.phone,
              rating: place.rating,
              reviews: place.reviews,
              website: place.website,
              site: compactSite(site),
            })),
          });
        } catch (error) {
          return fail(error instanceof Error ? error.message : String(error));
        }
      },
    ),

    tool("pagespeed", "Mobile PageSpeed (Lighthouse) performance and SEO scores for a website. Slow (up to a minute); use only for promising leads with a working site.", { url: z.string().url() }, async ({ url }) => {
      try {
        return ok(await pageSpeedMobile(url, deps.config.GOOGLE_PAGESPEED_API_KEY, fetchFn));
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    }),

    tool(
      "save_leads",
      "Save qualified leads from this run's searches. Only place_ids returned by search_places in this run are accepted; name, phone, address and website are taken from Google, not from this input.",
      {
        leads: z
          .array(
            z.object({
              place_id: z.string(),
              opportunity: z.enum(opportunities),
              score: z.number().int().min(1).max(10),
              findings: z.array(z.string().max(160)).min(1).max(6).describe("Short factual Turkish observations from the tool data"),
              pitch: z.string().max(400).describe("1-2 sentence Turkish opening message for this business"),
            }),
          )
          .min(1)
          .max(25),
      },
      async ({ leads }) => {
        const rejected: string[] = [];
        const rows = leads.flatMap((lead) => {
          const entry = seen.get(lead.place_id);
          if (!entry) {
            rejected.push(lead.place_id);
            return [];
          }
          const { place, sector, district } = entry;
          return [{
            place_id: place.id,
            name: place.name,
            sector,
            district,
            address: place.address,
            phone: place.phone,
            website: place.website,
            maps_url: place.mapsUrl,
            rating: place.rating,
            reviews: place.reviews,
            opportunity: lead.opportunity,
            score: lead.score,
            findings: lead.findings,
            pitch: lead.pitch,
            run_id: deps.runId,
          }];
        });
        try {
          const result = rows.length ? await deps.leads.save(rows) : { saved: 0, skipped: 0 };
          return ok({ ...result, rejected_unknown_place_ids: rejected });
        } catch (error) {
          return fail(error instanceof Error ? error.message : String(error));
        }
      },
    ),
  ];
}
