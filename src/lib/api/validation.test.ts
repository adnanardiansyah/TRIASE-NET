import { describe, expect, it } from "vitest";
import { assertSameOrigin, createTicketSchema, loginSchema, readJson, readTicketCode, replySchema } from "./validation";

const request = (value: unknown) => new Request("http://localhost/api/aduan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
describe("API validation", () => {
  it.each([null, [], { subject: 42 }, { subject: "a", body: "b", category: "UNKNOWN" }, { subject: "a", body: "b", category: "LAINNYA", riskBand: "LOW" }, { subject: "a".repeat(201), body: "b", category: "LAINNYA" }])("rejects malformed payload %j", async (input) => {
    await expect(readJson(request(input), createTicketSchema)).rejects.toMatchObject({ status: 400 });
  });
  it("trims valid input without truncating it", async () => {
    expect(await readJson(request({ subject: " a ", body: " b ", category: "LAINNYA" }), createTicketSchema)).toEqual({ subject: "a", body: "b", category: "LAINNYA" });
  });
  it("rejects oversized streamed bodies without content-length", async () => {
    await expect(readJson(request({ body: "a".repeat(100) }), replySchema, 30)).rejects.toMatchObject({ status: 413 });
  });
  it("rejects invalid JSON and non-JSON requests", async () => {
    await expect(readJson(new Request("http://localhost", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }), createTicketSchema)).rejects.toMatchObject({ status: 400 });
    await expect(readJson(new Request("http://localhost", { method: "POST", body: "x" }), createTicketSchema)).rejects.toMatchObject({ status: 415 });
  });
  it("validates both login stages", () => {
    expect(loginSchema.safeParse({ email: "USER@example.test", password: "abc" }).success).toBe(true);
    expect(loginSchema.safeParse({ challengeId: "not-a-uuid", otp: 123456 }).success).toBe(false);
  });
  it("normalizes ticket codes and blocks foreign origins", () => {
    expect(readTicketCode(" trx-2026-0123abcd ")).toBe("TRX-2026-0123ABCD");
    expect(() => readTicketCode("unknown")).toThrow();
    expect(() => assertSameOrigin(new Request("http://localhost/api", { headers: { origin: "http://attacker.test" } }))).toThrow();
    expect(() => assertSameOrigin(new Request("http://localhost/api", { headers: { origin: "http://localhost" } }))).not.toThrow();
  });
});
