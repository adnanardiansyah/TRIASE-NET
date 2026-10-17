import { NextRequest } from "next/server";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { issueSessionToken } from "@/lib/auth/jwt";
import { GET, PATCH } from "./route";

beforeEach(() => vi.stubEnv("JWT_SIGNING_SECRET", "test-only-signing-secret-at-least-32-characters"));
afterEach(() => vi.unstubAllEnvs());

function request(body: unknown, authenticated = true, origin = "http://localhost") {
  const token = issueSessionToken({ sub: "student@example.test", role: "MAHASISWA" });
  return new NextRequest("http://localhost/api/notifications", { method: "PATCH", headers: {
    "Content-Type": "application/json", origin, ...(authenticated ? { cookie: `triase-session=${token}` } : {}),
  }, body: JSON.stringify(body) });
}

describe("notification API boundary", () => {
  it("requires authentication for reads and mutations", async () => {
    expect((await GET(new NextRequest("http://localhost/api/notifications"))).status).toBe(401);
    expect((await PATCH(request({ ids: ["status:test"] }, false))).status).toBe(401);
  });
  it("rejects empty, oversized, wrongly typed and extra fields", async () => {
    for (const body of [null, { ids: [] }, { ids: [123] }, { ids: ["x".repeat(161)] }, { ids: Array(51).fill("status:test") }, { ids: ["status:test"], userId: "other-user" }]) {
      expect((await PATCH(request(body))).status).toBe(400);
    }
  });
  it("rejects cross-origin marking", async () => {
    expect((await PATCH(request({ ids: ["status:test"] }, true, "http://attacker.test"))).status).toBe(403);
  });
});
