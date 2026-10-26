import { describe, expect, it, vi } from "vitest";

import { createTelegramNotifier, fitTelegram } from "./telegram.js";

describe("telegram", () => {
  it("keeps short text and cuts long text under the limit", () => {
    expect(fitTelegram("  merhaba  ")).toBe("merhaba");
    const long = fitTelegram("a".repeat(10_000));
    expect(long.length).toBeLessThanOrEqual(4096);
    expect(long.endsWith("(kısaltıldı)")).toBe(true);
  });

  it("does nothing when the bot is not configured", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await createTelegramNotifier(undefined, "1")("x");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
