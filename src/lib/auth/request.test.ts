import { describe, expect, it } from "vitest";

import { hasAnyRole } from "./request";
import type { SessionClaims } from "./jwt";

const mahasiswa: SessionClaims = {
  sub: "mahasiswa@poltek.test",
  role: "MAHASISWA",
  iat: 1,
  exp: 9_999_999_999,
};

describe("request role checks", () => {
  it("allows only explicitly listed roles", () => {
    expect(hasAnyRole(mahasiswa, ["MAHASISWA"])).toBe(true);
    expect(hasAnyRole(mahasiswa, ["SATGAS", "ADMIN"])).toBe(false);
    expect(hasAnyRole(null, ["ADMIN"])).toBe(false);
  });
});