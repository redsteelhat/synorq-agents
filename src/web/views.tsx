import type { Child } from "hono/jsx";

import type { AgentDefinition } from "../agents/types.js";
import { districts, opportunityLabels, sectorIds, sectors, statusLabels } from "../agents/leads/catalog.js";
import type { Lead, LeadFilter, LeadStatus } from "../db/leads.js";
import { leadStatuses, opportunities } from "../db/leads.js";
import type { Run, RunEvent, UsageSummary } from "../db/runs.js";
import { whatsappLink } from "./leads.js";
import { formatCost, formatDateTime, formatDuration, formatNumber, statusLabel } from "./format.js";

const css = `
:root { color-scheme: dark; --bg:#111312; --panel:#191c1b; --line:#2a2f2d; --text:#e8ebe9; --muted:#8d9691; --lime:#c6f432; --red:#ff6b6b; --amber:#f5c451; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
a { color:var(--lime); text-decoration:none; } a:hover { text-decoration:underline; }
header { border-bottom:1px solid var(--line); padding:14px 20px; display:flex; gap:20px; align-items:center; }
header .brand { font-weight:700; color:var(--text); letter-spacing:.2px; } header .brand span { color:var(--lime); }
main { max-width:1100px; margin:0 auto; padding:24px 16px 64px; }
h1 { font-size:22px; margin:0 0 16px; } h2 { font-size:16px; margin:28px 0 12px; color:var(--muted); font-weight:600; }
.grid { display:grid; gap:12px; grid-template-columns:repeat(auto-fill, minmax(300px, 1fr)); }
.card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:16px; }
.card h3 { margin:0 0 4px; font-size:16px; } .muted { color:var(--muted); font-size:13px; }
.stats { display:grid; gap:12px; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); }
.stat b { display:block; font-size:22px; }
.badge { display:inline-block; padding:1px 8px; border-radius:99px; font-size:12px; font-weight:600; border:1px solid currentColor; }
.badge.success { color:var(--lime); } .badge.error { color:var(--red); } .badge.running { color:var(--amber); }
table { width:100%; border-collapse:collapse; } th, td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); font-size:14px; vertical-align:top; }
th { color:var(--muted); font-weight:600; font-size:12px; text-transform:uppercase; letter-spacing:.4px; }
.table-wrap { overflow-x:auto; background:var(--panel); border:1px solid var(--line); border-radius:10px; }
button { background:var(--lime); color:#111; border:0; border-radius:8px; padding:7px 14px; font-weight:700; cursor:pointer; font-size:14px; }
button:disabled { opacity:.5; cursor:not-allowed; }
button.ghost { background:transparent; color:var(--muted); border:1px solid var(--line); padding:5px 12px; font-weight:600; }
.filters { display:flex; gap:8px; flex-wrap:wrap; align-items:end; margin-bottom:16px; }
.filters label { font-size:12px; color:var(--muted); display:flex; flex-direction:column; gap:4px; }
select, textarea { background:#0d0f0e; color:var(--text); border:1px solid var(--line); border-radius:8px; padding:7px 9px; font:inherit; font-size:14px; }
textarea { width:100%; min-height:54px; resize:vertical; }
.lead h3 { display:flex; justify-content:space-between; gap:8px; align-items:start; }
.lead ul { margin:8px 0; padding-left:18px; font-size:14px; }
.pitch { background:#0d0f0e; border:1px dashed var(--line); border-radius:8px; padding:8px 10px; font-size:14px; margin:8px 0; }
.score { font-size:13px; font-weight:700; color:#111; background:var(--lime); border-radius:6px; padding:1px 7px; white-space:nowrap; }
.links { display:flex; gap:12px; flex-wrap:wrap; font-size:14px; margin-top:6px; }
.badge.opp { color:#6aa9ff; }
.login { max-width:360px; margin:48px auto; }
.login label { display:block; font-size:13px; color:var(--muted); margin:12px 0 4px; }
.login input { width:100%; padding:9px 11px; border-radius:8px; border:1px solid var(--line); background:#0d0f0e; color:var(--text); font-size:15px; }
.login button { width:100%; margin-top:18px; padding:10px; }
.row { display:flex; gap:10px; align-items:center; justify-content:space-between; margin-top:12px; flex-wrap:wrap; }
.timeline { display:flex; flex-direction:column; gap:10px; }
.event { background:var(--panel); border:1px solid var(--line); border-left:3px solid var(--line); border-radius:8px; padding:10px 12px; }
.event.text { border-left-color:var(--lime); } .event.tool_use { border-left-color:#6aa9ff; } .event.tool_result { border-left-color:#5c6b65; } .event.error { border-left-color:var(--red); }
.event .meta { font-size:12px; color:var(--muted); margin-bottom:4px; }
pre { margin:0; white-space:pre-wrap; word-break:break-word; font:13px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; max-height:420px; overflow:auto; }
.result { white-space:pre-wrap; }
.error-text { color:var(--red); white-space:pre-wrap; }
`;

export function Layout(props: { title: string; refreshSeconds?: number; hideNav?: boolean; children: Child }) {
  return (
    <html lang="tr">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        {props.refreshSeconds ? <meta http-equiv="refresh" content={String(props.refreshSeconds)} /> : null}
        <title>{`${props.title} · Synorq Agents`}</title>
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>
        <header>
          <a class="brand" href="/">synorq<span>.</span>agents</a>
          <a href="/">Agent'lar</a>
          <a href="/runs">Çalıştırmalar</a>
          <a href="/leads">Lead'ler</a>
          {props.hideNav ? null : (
            <form method="post" action="/logout" style="margin-left:auto">
              <button type="submit" class="ghost">Çıkış</button>
            </form>
          )}
        </header>
        <main>{props.children}</main>
      </body>
    </html>
  );
}

function Status({ status }: { status: Run["status"] }) {
  return <span class={`badge ${status}`}>{statusLabel[status]}</span>;
}

export function Dashboard(props: { agents: AgentDefinition[]; last: Map<string, Run>; next: (id: string) => Date | null; busy: (id: string) => boolean; day: UsageSummary; week: UsageSummary; recent: Run[] }) {
  const anyRunning = props.recent.some((run) => run.status === "running");
  return (
    <Layout title="Agent'lar" refreshSeconds={anyRunning ? 5 : undefined}>
      <h1>Agent'lar</h1>
      <div class="grid">
        {props.agents.map((agent) => {
          const last = props.last.get(agent.id);
          const busy = props.busy(agent.id) || last?.status === "running";
          return (
            <div class="card">
              <h3>{agent.name}</h3>
              <div class="muted">{agent.description}</div>
              <div class="muted" style="margin-top:10px">
                Zamanlama: {agent.schedule ?? "yalnızca elle"} · Sonraki: {formatDateTime(props.next(agent.id))}
              </div>
              <div class="muted">
                Son çalışma: {last ? <><a href={`/runs/${last.id}`}>{formatDateTime(last.started_at)}</a> <Status status={last.status} /></> : "henüz yok"}
              </div>
              <div class="row">
                <a href={`/runs?agent=${agent.id}`}>Geçmiş</a>
                <form method="post" action={`/agents/${agent.id}/run`}>
                  <button type="submit" disabled={busy}>{busy ? "Çalışıyor…" : "Şimdi çalıştır"}</button>
                </form>
              </div>
            </div>
          );
        })}
      </div>

      <h2>Kullanım (tahmini)</h2>
      <div class="stats">
        <div class="card stat"><span class="muted">Son 24 saat</span><b>{props.day.runs} çalıştırma</b><span class="muted">{props.day.failed} hata · {formatCost(props.day.cost_usd)}</span></div>
        <div class="card stat"><span class="muted">Son 7 gün</span><b>{props.week.runs} çalıştırma</b><span class="muted">{props.week.failed} hata · {formatCost(props.week.cost_usd)}</span></div>
        <div class="card stat"><span class="muted">7 gün token</span><b>{formatNumber(Number(props.week.input_tokens) + Number(props.week.output_tokens))}</b><span class="muted">girdi {formatNumber(props.week.input_tokens)} · çıktı {formatNumber(props.week.output_tokens)}</span></div>
      </div>
      <p class="muted">Maliyet, Agent SDK'nın API fiyatlarıyla yaptığı tahmindir. Max planında kullanım plan limitlerinden düşer.</p>

      <h2>Son çalıştırmalar</h2>
      <RunsTable runs={props.recent} />
    </Layout>
  );
}

export function RunsTable({ runs }: { runs: Run[] }) {
  if (runs.length === 0) return <p class="muted">Henüz çalıştırma yok.</p>;
  return (
    <div class="table-wrap">
      <table>
        <thead><tr><th>Başlangıç</th><th>Agent</th><th>Tetik</th><th>Durum</th><th>Süre</th><th>Tur</th><th>Maliyet</th></tr></thead>
        <tbody>
          {runs.map((run) => (
            <tr>
              <td><a href={`/runs/${run.id}`}>{formatDateTime(run.started_at)}</a></td>
              <td>{run.agent}</td>
              <td>{run.trigger === "manual" ? "elle" : "zamanlı"}</td>
              <td><Status status={run.status} /></td>
              <td>{formatDuration(run.duration_ms)}</td>
              <td>{run.num_turns ?? "—"}</td>
              <td>{formatCost(run.cost_usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RunsPage(props: { runs: Run[]; agent?: string }) {
  const anyRunning = props.runs.some((run) => run.status === "running");
  return (
    <Layout title="Çalıştırmalar" refreshSeconds={anyRunning ? 5 : undefined}>
      <h1>Çalıştırmalar{props.agent ? ` · ${props.agent}` : ""}</h1>
      <RunsTable runs={props.runs} />
    </Layout>
  );
}

const kindLabel = { text: "Agent", tool_use: "Araç çağrısı", tool_result: "Araç sonucu", error: "Hata", info: "Bilgi" } as const;

export function RunPage(props: { run: Run; agentName: string; events: RunEvent[] }) {
  const { run } = props;
  return (
    <Layout title={`${props.agentName} çalıştırması`} refreshSeconds={run.status === "running" ? 3 : undefined}>
      <h1>{props.agentName} <Status status={run.status} /></h1>
      <div class="stats">
        <div class="card stat"><span class="muted">Başlangıç</span><b style="font-size:16px">{formatDateTime(run.started_at)}</b></div>
        <div class="card stat"><span class="muted">Süre</span><b>{formatDuration(run.duration_ms)}</b></div>
        <div class="card stat"><span class="muted">Tur</span><b>{run.num_turns ?? "—"}</b></div>
        <div class="card stat"><span class="muted">Token (girdi / çıktı)</span><b style="font-size:16px">{formatNumber(run.input_tokens)} / {formatNumber(run.output_tokens)}</b></div>
        <div class="card stat"><span class="muted">Tahmini maliyet</span><b>{formatCost(run.cost_usd)}</b></div>
      </div>

      {run.result ? (<><h2>Sonuç</h2><div class="card result">{run.result}</div></>) : null}
      {run.error ? (<><h2>Hata</h2><div class="card error-text">{run.error}</div></>) : null}

      <h2>Adımlar</h2>
      {props.events.length === 0 ? <p class="muted">Henüz adım yok.</p> : (
        <div class="timeline">
          {props.events.map((event) => (
            <div class={`event ${event.kind}`}>
              <div class="meta">#{event.seq} · {kindLabel[event.kind]}{event.name ? ` · ${event.name}` : ""} · {formatDateTime(event.at)}</div>
              <pre>{event.content}</pre>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}

export function LoginPage(props: { next: string; error?: string }) {
  return (
    <Layout title="Giriş" hideNav>
      <div class="card login">
        <h1>Giriş yap</h1>
        {props.error ? <p class="error-text">{props.error}</p> : null}
        <form method="post" action="/login">
          <input type="hidden" name="next" value={props.next} />
          <label for="username">Kullanıcı adı</label>
          <input id="username" name="username" autocomplete="username" required autofocus />
          <label for="password">Şifre</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required />
          <button type="submit">Giriş</button>
        </form>
      </div>
    </Layout>
  );
}

function Select(props: { name: string; value?: string; options: [string, string][]; empty?: string }) {
  return (
    <select name={props.name}>
      {props.empty ? <option value="">{props.empty}</option> : null}
      {props.options.map(([value, label]) => (
        <option value={value} selected={props.value === value}>{label}</option>
      ))}
    </select>
  );
}

export function LeadsPage(props: { leads: Lead[]; filter: LeadFilter; counts: Record<LeadStatus, number>; query: string }) {
  const { filter } = props;
  const back = `/leads${props.query ? `?${props.query}` : ""}`;
  return (
    <Layout title="Lead'ler">
      <h1>Lead'ler</h1>
      <p class="muted">
        {leadStatuses.map((status) => `${statusLabels[status]}: ${props.counts[status]}`).join(" · ")}
      </p>
      <form class="filters" method="get" action="/leads">
        <label>Durum<Select name="status" value={filter.status} empty="Hepsi" options={leadStatuses.map((s) => [s, statusLabels[s]])} /></label>
        <label>Sektör<Select name="sector" value={filter.sector} empty="Hepsi" options={sectorIds.map((s) => [s, sectors[s].label])} /></label>
        <label>İlçe<Select name="district" value={filter.district} empty="Hepsi" options={districts.map((d) => [d, d])} /></label>
        <label>Fırsat<Select name="opportunity" value={filter.opportunity} empty="Hepsi" options={opportunities.map((o) => [o, opportunityLabels[o]])} /></label>
        <button type="submit">Filtrele</button>
        <a href={`/leads.csv${props.query ? `?${props.query}` : ""}`}>CSV indir</a>
      </form>

      {props.leads.length === 0 ? <p class="muted">Bu filtrede lead yok.</p> : (
        <div class="grid">
          {props.leads.map((lead) => {
            const wa = whatsappLink(lead.phone, lead.pitch);
            return (
              <div class="card lead">
                <h3><span>{lead.name}</span><span class="score">{lead.score}/10</span></h3>
                <div class="muted">
                  {sectors[lead.sector as keyof typeof sectors]?.label ?? lead.sector} · {lead.district} · <span class="badge opp">{opportunityLabels[lead.opportunity]}</span>
                </div>
                <div class="muted">
                  {lead.rating ? `★ ${lead.rating} (${lead.reviews ?? 0} yorum)` : "Puan yok"} · {formatDateTime(lead.created_at)}
                </div>
                <div class="links">
                  {lead.phone ? <a href={`tel:${lead.phone.replace(/\s/g, "")}`}>{lead.phone}</a> : null}
                  {wa ? <a href={wa} target="_blank" rel="noopener noreferrer">WhatsApp</a> : null}
                  {lead.maps_url ? <a href={lead.maps_url} target="_blank" rel="noopener noreferrer">Haritada</a> : null}
                  {lead.website ? <a href={lead.website} target="_blank" rel="noopener noreferrer nofollow">Site</a> : null}
                </div>
                <ul>{lead.findings.map((finding) => <li>{finding}</li>)}</ul>
                {lead.pitch ? <div class="pitch">{lead.pitch}</div> : null}
                <form method="post" action={`/leads/${lead.id}`}>
                  <input type="hidden" name="back" value={back} />
                  <div class="row" style="margin-top:4px">
                    <Select name="status" value={lead.status} options={leadStatuses.map((s) => [s, statusLabels[s]])} />
                    <button type="submit">Kaydet</button>
                  </div>
                  <textarea name="notes" placeholder="Not" style="margin-top:8px">{lead.notes ?? ""}</textarea>
                </form>
              </div>
            );
          })}
        </div>
      )}
    </Layout>
  );
}

export function NotFound() {
  return (
    <Layout title="Bulunamadı">
      <h1>Bulunamadı</h1>
      <p><a href="/">Ana sayfaya dön</a></p>
    </Layout>
  );
}
