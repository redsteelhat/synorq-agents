export const sectors = {
  klinik: { label: "Klinik", queries: ["diş kliniği", "estetik kliniği", "fizik tedavi merkezi", "veteriner kliniği", "psikolog", "diyetisyen"] },
  guzellik: { label: "Kuaför / güzellik", queries: ["kuaför", "berber", "güzellik merkezi", "tırnak salonu"] },
  restoran: { label: "Restoran / kafe", queries: ["restoran", "kafe", "pastane", "meyhane"] },
  emlak: { label: "Emlak", queries: ["emlak ofisi", "gayrimenkul danışmanlığı"] },
  "teknik-servis": { label: "Teknik servis", queries: ["klima servisi", "kombi servisi", "beyaz eşya servisi", "oto servis"] },
} as const;

export type SectorId = keyof typeof sectors;
export const sectorIds = Object.keys(sectors) as SectorId[];

export const districts = ["Konak", "Karşıyaka", "Bornova", "Bayraklı", "Buca", "Çiğli"] as const;
export type District = (typeof districts)[number];

export const opportunityLabels = {
  no_website: "Sitesi yok",
  social_only: "Sadece sosyal medya",
  broken_website: "Site çalışmıyor",
  weak_website: "Site zayıf",
} as const;

export const statusLabels = {
  new: "Yeni",
  contacted: "İletişime geçildi",
  interested: "İlgileniyor",
  not_interested: "İlgilenmiyor",
  customer: "Müşteri",
} as const;
