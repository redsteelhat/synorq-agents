# synorq-agents

Synorq's internal AI agents and the dashboard that watches them.

- **Runtime:** Node 24, TypeScript, [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview).
- **Storage:** PostgreSQL (runs and every step of every run).
- **Dashboard:** server-rendered pages at `/`, `/runs`, `/runs/:id`, behind a login form (signed, HttpOnly session cookie for 30 days; 5 failed attempts per 15 minutes per client).
- **Notifications:** Telegram (successful results when an agent asks for it, every failure).
- **Errors:** Sentry.

## How an agent runs

Each agent is an `AgentDefinition` in `src/agents/` (id, schedule, system prompt, task prompt, tools). The runner starts the Claude Agent SDK with:

- **no built-in tools** (`tools: []`): no shell, no file access;
- only the agent's own in-process tools, pre-approved, everything else denied (`permissionMode: "dontAsk"`);
- a minimal environment for the Claude process: the service's secrets (database, API tokens) stay in this process and are used by the tools;
- a 10-minute timeout and the agent's `maxTurns`.

Every assistant message, tool call and tool result is stored in `run_events`; the final result, turns, tokens and the SDK's cost estimate in `runs`. Runs older than `RUN_RETENTION_DAYS` are deleted at 03:15.

## Authentication and plan use

`CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) uses the owner's Claude subscription and is meant for **internal agents that work for the owner**. Agents or features that serve clients or end users must use a Claude Console API key instead (see the Claude Code legal and compliance page).

## Agents

| id | Schedule | What it does |
|---|---|---|
| `ops` | 08:00 daily | Reads Coolify, UptimeRobot, Sentry and Umami and sends a short Turkish morning report to Telegram. |
| `leads` | Monday 08:30 | Finds 50 businesses in central İzmir districts with no, broken or weak websites (Google Places + a website check + optional PageSpeed) and saves them to the lead list at `/leads`. |

### Lead agent notes

- Sectors, search terms and districts live in `src/agents/leads/catalog.ts`.
- `save_leads` accepts only places returned by `search_places` in the same run; name, phone, address and website always come from Google, never from the model.
- Website checks go through `safeGet` (`src/lib/safe-fetch.ts`): public addresses only, checked inside the DNS lookup, manual redirects, size and time limits.
- The dashboard at `/leads` filters by status, sector, district and opportunity, updates status and notes, offers a prefilled WhatsApp link for mobile numbers, and exports CSV (formula-safe, UTF-8 with BOM).
- Cold outreach to businesses is subject to Turkish commercial messaging rules; check them before sending messages in bulk.

### Add an agent

1. Create `src/agents/<id>/index.ts` returning an `AgentDefinition` and its tools (`tool()` from the SDK, return `isError: true` instead of throwing).
2. Register it in `src/agents/index.ts`.
3. Add any new environment variables to `src/config.ts` and `.env.example`.

## Development

```bash
pnpm install
cp .env.example .env   # fill in DATABASE_URL and ADMIN_PASSWORD at least
pnpm dev
TEST_DATABASE_URL=postgres://... pnpm test   # integration tests need a throwaway database
pnpm typecheck
```

## Deploy (Coolify)

Dockerfile build pack, port 3000. The image has a `HEALTHCHECK` on `/healthz`. Set the variables from `.env.example` as runtime variables.
