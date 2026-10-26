import type { Sql } from "./index.js";

export const leadStatuses = ["new", "contacted", "interested", "not_interested", "customer"] as const;
export type LeadStatus = (typeof leadStatuses)[number];
export const opportunities = ["no_website", "broken_website", "weak_website", "social_only"] as const;
export type Opportunity = (typeof opportunities)[number];

export type Lead = {
  id: string;
  place_id: string;
  name: string;
  sector: string;
  district: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  maps_url: string | null;
  rating: string | null;
  reviews: number | null;
  opportunity: Opportunity;
  score: number;
  findings: string[];
  pitch: string | null;
  status: LeadStatus;
  notes: string | null;
  run_id: string | null;
  created_at: Date;
  updated_at: Date;
};

export type NewLead = Omit<Lead, "id" | "status" | "notes" | "created_at" | "updated_at" | "rating"> & { rating: number | null };

export type LeadFilter = { status?: LeadStatus; sector?: string; district?: string; opportunity?: Opportunity; limit?: number };

export function createLeadStore(sql: Sql) {
  return {
    /** Inserts new leads; a place already on the list is skipped, never overwritten. */
    async save(leads: NewLead[]): Promise<{ saved: number; skipped: number }> {
      let saved = 0;
      for (const lead of leads) {
        const rows = await sql`
          insert into leads (place_id, name, sector, district, address, phone, website, maps_url, rating, reviews, opportunity, score, findings, pitch, run_id)
          values (${lead.place_id}, ${lead.name}, ${lead.sector}, ${lead.district}, ${lead.address}, ${lead.phone}, ${lead.website}, ${lead.maps_url},
                  ${lead.rating}, ${lead.reviews}, ${lead.opportunity}, ${lead.score}, ${sql.array(lead.findings)}, ${lead.pitch}, ${lead.run_id})
          on conflict (place_id) do nothing
          returning id`;
        saved += rows.length;
      }
      return { saved, skipped: leads.length - saved };
    },

    async knownPlaceIds(placeIds: string[]): Promise<Set<string>> {
      if (placeIds.length === 0) return new Set();
      const rows = await sql<{ place_id: string }[]>`select place_id from leads where place_id = any(${sql.array(placeIds)})`;
      return new Set(rows.map((row) => row.place_id));
    },

    async logSearch(entry: { sector: string; district: string; query: string; results: number; runId: string | null }): Promise<void> {
      await sql`insert into lead_searches (sector, district, query, results, run_id) values (${entry.sector}, ${entry.district}, ${entry.query}, ${entry.results}, ${entry.runId})`;
    },

    async coverage(): Promise<{ sector: string; district: string; last_searched: Date | null; searches: number; leads: number }[]> {
      return sql`
        select s.sector, s.district, max(s.at) as last_searched, count(*)::int as searches,
               (select count(*)::int from leads l where l.sector = s.sector and l.district = s.district) as leads
        from lead_searches s group by s.sector, s.district order by last_searched asc`;
    },

    async list(filter: LeadFilter = {}): Promise<Lead[]> {
      const limit = Math.min(filter.limit ?? 200, 1000);
      return sql<Lead[]>`
        select * from leads
        where (${filter.status ?? null}::text is null or status = ${filter.status ?? null})
          and (${filter.sector ?? null}::text is null or sector = ${filter.sector ?? null})
          and (${filter.district ?? null}::text is null or district = ${filter.district ?? null})
          and (${filter.opportunity ?? null}::text is null or opportunity = ${filter.opportunity ?? null})
        order by created_at desc, score desc
        limit ${limit}`;
    },

    async counts(): Promise<Record<LeadStatus, number>> {
      const rows = await sql<{ status: LeadStatus; count: number }[]>`select status, count(*)::int as count from leads group by status`;
      const result = Object.fromEntries(leadStatuses.map((status) => [status, 0])) as Record<LeadStatus, number>;
      for (const row of rows) result[row.status] = row.count;
      return result;
    },

    async update(id: string, change: { status?: LeadStatus; notes?: string | null }): Promise<boolean> {
      const rows = await sql`
        update leads set
          status = coalesce(${change.status ?? null}, status),
          notes = case when ${change.notes !== undefined} then ${change.notes ?? null} else notes end,
          updated_at = now()
        where id = ${id} returning id`;
      return rows.length > 0;
    },
  };
}

export type LeadStore = ReturnType<typeof createLeadStore>;
