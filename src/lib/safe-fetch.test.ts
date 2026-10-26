import { describe, expect, it } from "vitest";

import { isPublicAddress, safeGet } from "./safe-fetch.js";

describe("safe fetch", () => {
  it("allows public addresses only", () => {
    for (const address of ["8.8.8.8", "62.83.71.46", "2606:4700::1111"]) expect(isPublicAddress(address)).toBe(true);
    for (const address of ["127.0.0.1", "10.0.1.5", "172.17.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "0.0.0.0", "not-an-ip"]) {
      expect(isPublicAddress(address)).toBe(false);
    }
  });

  it("refuses private, loopback and non-http targets before connecting", async () => {
    await expect(safeGet("http://127.0.0.1:3000/")).rejects.toThrow("non-public");
    await expect(safeGet("http://169.254.169.254/latest/meta-data")).rejects.toThrow("non-public");
    await expect(safeGet("http://[::1]/")).rejects.toThrow("non-public");
    await expect(safeGet("file:///etc/passwd")).rejects.toThrow("Unsupported protocol");
    await expect(safeGet("http://user:pass@example.com/")).rejects.toThrow("credentials");
    await expect(safeGet("http://localhost:3000/")).rejects.toThrow();
  });
});
