const TZ = process.env.TZ_NAME ?? "Europe/Istanbul";

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "medium", timeZone: TZ }).format(new Date(value));
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds} sn` : `${Math.floor(seconds / 60)} dk ${seconds % 60} sn`;
}

export function formatNumber(value: number | string | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("tr-TR").format(Number(value));
}

export function formatCost(value: number | string | null | undefined): string {
  if (value == null) return "—";
  return `$${Number(value).toFixed(4)}`;
}

export const statusLabel = { running: "Çalışıyor", success: "Başarılı", error: "Hata" } as const;
