import { NextRequest } from "next/server";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { issueSessionToken } from "@/lib/auth/jwt";
import { ApiError } from "@/lib/api/errors";
import { downloadEvidence } from "@/lib/db/tickets";
import { GET } from "./route";

vi.mock("@/lib/db/tickets", () => ({ downloadEvidence: vi.fn() }));
beforeEach(() => { vi.stubEnv("JWT_SIGNING_SECRET", "test-only-attachment-secret-at-least-32-characters"); vi.mocked(downloadEvidence).mockReset(); });
afterEach(() => vi.unstubAllEnvs());
const id = "11111111-1111-4111-8111-111111111111";
function request(auth = true) {
  const token = issueSessionToken({ sub: "student@example.test", role: "MAHASISWA" });
  return new NextRequest(`http://localhost/api/aduan/TRX-2026-12345678/attachments/${id}`, { headers: auth ? { cookie: `triase-session=${token}` } : {} });
}
const context = { params: Promise.resolve({ ticket: "TRX-2026-12345678", attachment: id }) };
describe("protected evidence download", () => {
  it("requires a session and rejects invalid identifiers before accessing data", async () => {
    expect((await GET(request(false), context)).status).toBe(401);
    expect((await GET(request(), { params: Promise.resolve({ ticket: "TRX-2026-12345678", attachment: "invalid" }) })).status).toBe(404);
    expect(downloadEvidence).not.toHaveBeenCalled();
  });
  it("downloads bytes without inline execution or shared caching", async () => {
    const data = Buffer.from("%PDF-1.7\nTest file");
    vi.mocked(downloadEvidence).mockResolvedValue({ name: "bukti tést.pdf", mimeType: "application/pdf", data });
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("attachment;");
    expect(response.headers.get("content-disposition")).toContain("bukti%20t%C3%A9st.pdf");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(data);
  });
  it("does not return file bytes after an authorization failure", async () => {
    vi.mocked(downloadEvidence).mockRejectedValue(new ApiError(403, "Di luar kewenangan.", "OUTSIDE_CLEARANCE"));
    const response = await GET(request(), context);
    expect(response.status).toBe(403);
    expect(response.headers.get("content-disposition")).toBeNull();
    expect((await response.json()).code).toBe("OUTSIDE_CLEARANCE");
  });
});
