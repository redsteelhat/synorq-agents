import type { Sql } from "./index.js";

/**
 * Forward-only migrations, applied in order inside one transaction each.
 * Never edit a migration that has shipped; add a new one.
 */
const migrations: { id: number; sql: string }[] = [
  {
    id: 1,
    sql: `
      create table runs (
        id uuid primary key default gen_random_uuid(),
        agent text not null,
        trigger text not null check (trigger in ('schedule', 'manual')),
        status text not null default 'running' check (status in ('running', 'success', 'error')),
        started_at timestamptz not null default now(),
        finished_at timestamptz,
        duration_ms integer,
        num_turns integer,
        cost_usd numeric(10, 4),
        input_tokens bigint,
        output_tokens bigint,
        cache_read_tokens bigint,
        result text,
        error text
      );
      create index runs_agent_started_idx on runs (agent, started_at desc);
      create index runs_started_idx on runs (started_at desc);

      create table run_events (
        id bigserial primary key,
        run_id uuid not null references runs (id) on delete cascade,
        seq integer not null,
        at timestamptz not null default now(),
        kind text not null check (kind in ('text', 'tool_use', 'tool_result', 'error', 'info')),
        name text,
        content text not null
      );
      create index run_events_run_idx on run_events (run_id, seq);
    `,
  },
  {
    id: 2,
    sql: `
      create table leads (
        id uuid primary key default gen_random_uuid(),
        place_id text not null unique,
        name text not null,
        sector text not null,
        district text not null,
        address text,
        phone text,
        website text,
        maps_url text,
        rating numeric(2, 1),
        reviews integer,
        opportunity text not null check (opportunity in ('no_website', 'broken_website', 'weak_website', 'social_only')),
        score smallint not null check (score between 1 and 10),
        findings text[] not null default '{}',
        pitch text,
        status text not null default 'new' check (status in ('new', 'contacted', 'interested', 'not_interested', 'customer')),
        notes text,
        run_id uuid references runs (id) on delete set null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create index leads_created_idx on leads (created_at desc);
      create index leads_status_idx on leads (status);

      create table lead_searches (
        id bigserial primary key,
        sector text not null,
        district text not null,
        query text not null,
        results integer not null,
        run_id uuid references runs (id) on delete set null,
        at timestamptz not null default now()
      );
      create index lead_searches_combo_idx on lead_searches (sector, district, at desc);
    `,
  },
];

export async function migrate(sql: Sql): Promise<number> {
  await sql`create table if not exists schema_migrations (id integer primary key, applied_at timestamptz not null default now())`;
  const rows = await sql<{ id: number }[]>`select id from schema_migrations`;
  const applied = new Set(rows.map((row) => row.id));
  let count = 0;
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    await sql.begin(async (tx) => {
      await tx.unsafe(migration.sql);
      await tx`insert into schema_migrations (id) values (${migration.id})`;
    });
    count += 1;
  }
  return count;
}
