import type { Config } from "../../config.js";
import type { AgentDefinition } from "../types.js";
import { createOpsTools } from "./tools.js";

const systemPrompt = `Sen Synorq'un operasyon agent'ısın. Synorq, tek kişilik bir yazılım stüdyosu; sunucu netcup üzerinde Coolify ile yönetiliyor.

Görevin: araçlarla altyapının ve sitelerin durumunu toplayıp sahibine Telegram'da okunacak kısa bir Türkçe rapor yazmak.

Kurallar:
- Sadece araçlardan gelen veriyi kullan. Bir sayı ya da durum araçta yoksa uydurma.
- Bir araç hata verirse ya da "not configured" derse bunu raporda tek satırla belirt ve devam et.
- Önce dikkat gerektirenleri yaz (kapalı site, durmuş uygulama, yeni hata, ani trafik düşüşü). Her şey yolundaysa bunu açıkça söyle.
- Kısa ol: en fazla ~20 satır. Markdown kullanma; Telegram düz metin gösteriyor. Bölüm başlarında tek bir emoji kullanabilirsin.
- Yüzde değişimleri bir önceki dönemle karşılaştırarak ver; önceki dönem 0 ise yüzde yerine "yeni" yaz.
- Sentry hataları için kısa başlık, olay sayısı ve kısa kimliği (ör. SYNORQ-WEB-1) ver.`;

export function createOpsAgent(config: Config): AgentDefinition {
  return {
    id: "ops",
    name: "Ops raporu",
    description: "Her sabah Coolify, Sentry, UptimeRobot ve Umami'yi kontrol edip Telegram'a özet gönderir.",
    schedule: "0 8 * * *",
    systemPrompt,
    prompt: () => {
      const today = new Intl.DateTimeFormat("tr-TR", { dateStyle: "full", timeZone: config.TZ_NAME }).format(new Date());
      return `Bugün ${today}. Son 24 saatin sabah raporunu hazırla.

Sırayla: coolify_overview, uptime_monitors, sentry_issues (hours=24) ve umami_stats (days=1) araçlarını çağır. Sonra raporu şu bölümlerle yaz: Durum özeti (tek cümle), Sunucu ve uygulamalar, Erişilebilirlik, Hatalar, Trafik. Gerekiyorsa sonunda "Yapılacaklar" diye en fazla 3 madde ekle.`;
    },
    tools: createOpsTools(config),
    maxTurns: 12,
    notifyResult: true,
  };
}
