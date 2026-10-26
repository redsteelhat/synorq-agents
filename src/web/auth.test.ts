import { describe, expect, it } from "vitest";

import { checkCredentials, safeNext } from "./auth.js";

describe("auth helpers", () => {
  it("checks both username and password", () => {
    const admin = { username: "tarik", password: "secret-password-123" };
    expect(checkCredentials(admin, "tarik", "secret-password-123")).toBe(true);
    expect(checkCredentials(admin, "tarik", "secret-password-12")).toBe(false);
    expect(checkCredentials(admin, "admin", "secret-password-123")).toBe(false);
  });

  it("only allows same-site relative redirects", () => {
    expect(safeNext("/runs")).toBe("/runs");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext(undefined)).toBe("/");
  });
});
