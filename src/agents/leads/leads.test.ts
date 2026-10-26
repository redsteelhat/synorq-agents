import { describe, expect, it } from "vitest";

import { csvCell, whatsappLink } from "../../web/leads.js";
import { analyseHtml, checkSite, latestYear } from "./site-check.js";

describe("lead helpers", () => {
  it("builds WhatsApp links for mobile numbers only", () => {
    expect(whatsappLink("0532 111 22 33", "Merhaba")).toBe("https://wa.me/905321112233?text=Merhaba");
    expect(whatsappLink("+90 532 111 22 33", null)).toBe("https://wa.me/905321112233");
    expect(whatsappLink("0232 444 55 66", "x")).toBeNull();
    expect(whatsappLink(null, "x")).toBeNull();
  });

  it("keeps CSV cells safe from formula injection", () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("+90 532")).toBe("'+90 532");
    expect(csvCell("a, b")).toBe('"a, b"');
    expect(csvCell(["x", "y"])).toBe("x | y");
    expect(csvCell(null)).toBe("");
  });

  it("reads the useful signals from a page", () => {
    const html = `<html><head><title>Gülüş Diş</title><meta name="viewport" content="width=device-width"><meta name="generator" content="WordPress 5.2"></head>
      <body><a href="https://wa.me/905321112233">WA</a><a href="tel:+902324445566">Ara</a><form></form> Online randevu © 2016 - 2019 Gülüş</body></html>`;
    expect(analyseHtml(html)).toMatchObject({ title: "Gülüş Diş", mobileViewport: true, copyrightYear: 2019, generator: "WordPress 5.2", hasWhatsapp: true, hasPhoneLink: true, hasForm: true, hasBookingLink: true, hasMetaDescription: false });
    expect(latestYear("Copyright 2031", new Date("2026-10-26"))).toBeNull();
  });

  it("classifies missing and social-only websites without fetching", async () => {
    expect(await checkSite(null)).toEqual({ ok: false, problem: "no_website" });
    expect(await checkSite("https://www.instagram.com/gulusdis")).toMatchObject({ ok: false, socialOnly: true, problem: "social_only" });
    expect(await checkSite("http://127.0.0.1/")).toMatchObject({ ok: false, problem: "unsafe_address" });
  });
});
