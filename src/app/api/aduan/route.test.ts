import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { issueSessionToken } from "@/lib/auth/jwt";
import { GET, POST } from "./route";

function request(body: unknown, authenticated = true, origin = "http://localhost") {
  const token = issueSessionToken({ sub: "student@example.test", role: "MAHASISWA" });
  return new NextRequest("http://localhost/api/aduan", { method: "POST", headers: {
    "Content-Type": "application/json", origin, ...(authenticated ? { cookie: `triase-session=${token}` } : {}),
  }, body: JSON.stringify(body) });
}

describe("ticket API boundary", () => {
  it("rejects unauthenticated lists and submissions", async () => {
    expect((await GET(new NextRequest("http://localhost/api/aduan"))).status).toBe(401);
    expect((await POST(request({}, false))).status).toBe(401);
  });
  it("returns 400 for null, wrongly typed and oversized fields instead of 500", async () => {
    for (const body of [null, { subject: 123, category: "LAINNYA", body: "x" }, { subject: "a", category: "LAINNYA", body: "x".repeat(8001) }]) {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe("VALIDATION_ERROR");
    }
  });
  it("rejects client-selected risk and cross-origin mutations", async () => {
    expect((await POST(request({ subject: "a", category: "LAINNYA", body: "b", riskBand: "LOW" }))).status).toBe(400);
    expect((await POST(request({}, true, "http://attacker.test"))).status).toBe(403);
  });
});
