import type { Lead } from "../db/leads.js";
import { opportunityLabels, sectors, statusLabels } from "../agents/leads/catalog.js";

/** wa.me link for Turkish mobile numbers (05xx...), with the pitch prefilled. Landlines get none. */
export function whatsappLink(phone: string | null, text: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  const national = digits.startsWith("90") ? digits.slice(2) : digits.startsWith("0") ? digits.slice(1) : digits;
  if (!/^5\d{9}$/.test(national)) return null;
  return `https://wa.me/90${national}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

/** A spreadsheet treats cells starting with = + - @ as formulas; prefix them so they stay text. */
export function csvCell(value: unknown): string {
  let text = value == null ? "" : Array.isArray(value) ? value.join(" | ") : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function leadsCsv(leads: Lead[]): string {
  const header = ["Ad", "Sektör", "İlçe", "Telefon", "Web sitesi", "Google Maps", "Puan (Google)", "Yorum", "Fırsat", "Skor", "Bulgular", "Açılış mesajı", "Durum", "Not", "Eklendi"];
  const rows = leads.map((lead) => [
    lead.name,
    sectors[lead.sector as keyof typeof sectors]?.label ?? lead.sector,
    lead.district,
    lead.phone,
    lead.website,
    lead.maps_url,
    lead.rating,
    lead.reviews,
    opportunityLabels[lead.opportunity],
    lead.score,
    lead.findings,
    lead.pitch,
    statusLabels[lead.status],
    lead.notes,
    lead.created_at.toISOString(),
  ]);
  // BOM so Excel opens UTF-8 (Turkish characters) correctly.
  return `﻿${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
