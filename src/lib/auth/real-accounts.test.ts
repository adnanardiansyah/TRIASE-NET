import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeBase32, matchingTotpCounter, totpAt } from "./totp";
import { newEmailToken, openTotp, passwordHash, passwordMatches, sealTotp, tokenHash } from "./real-accounts";
import { registrationSchema, verificationSchema } from "./schemas";
import { mailConfiguration } from "./email";

afterEach(() => vi.unstubAllEnvs());
describe("real account security", () => {
  it("matches RFC 6238 SHA1 test vectors", () => {
    const secret = encodeBase32(Buffer.from("12345678901234567890"));
    for (const [seconds, code] of [[59,"94287082"],[1111111109,"07081804"],[1111111111,"14050471"],[1234567890,"89005924"],[2000000000,"69279037"]] as const) {
      expect(totpAt(secret, seconds * 1000, 30, 8)).toBe(code);
    }
    expect(matchingTotpCounter(secret, totpAt(secret, 90000), 90000)).toBe(3);
    expect(matchingTotpCounter(secret, "12345", 90000)).toBeNull();
    expect(matchingTotpCounter(secret, totpAt(secret, 300000), 90000)).toBeNull();
  });
  it("encrypts each authenticator independently and binds it to its account", () => {
    vi.stubEnv("AUTH_ENCRYPTION_KEY_BASE64", Buffer.alloc(32, 42).toString("base64"));
    const sealed = sealTotp("SECRET", "account-a");
    expect(sealed).not.toContain("SECRET");
    expect(sealTotp("SECRET", "account-a")).not.toBe(sealed);
    expect(openTotp(sealed,"account-a")).toBe("SECRET");
    expect(() => openTotp(sealed,"account-b")).toThrow();
    vi.stubEnv("AUTH_ENCRYPTION_KEY_BASE64", Buffer.alloc(32, 43).toString("base64"));
    expect(() => openTotp(sealed,"account-a")).toThrow();
    vi.stubEnv("AUTH_ENCRYPTION_KEY_BASE64", "");
    expect(() => sealTotp("SECRET","a")).toThrow();
  });
  it("uses Argon2id and rejects missing accounts and incorrect passwords", async () => {
    const hash = await passwordHash("a-personal-password");
    const account = { id: "a", email: "a@example.test", role: "MAHASISWA" as const, name: null, version: 1, hash };
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await passwordMatches(account,"a-personal-password")).toBe(true);
    expect(await passwordMatches(account,"incorrect")).toBe(false);
    expect(await passwordMatches(null,"a-personal-password")).toBe(false);
  });
  it("generates opaque tokens and rejects privilege injection", () => {
    const token = newEmailToken();
    expect(token.raw).toHaveLength(43);
    expect(token.hash).toBe(tokenHash(token.raw));
    expect(newEmailToken().raw).not.toBe(token.raw);
    expect(verificationSchema.safeParse({token:token.raw}).success).toBe(true);
    expect(registrationSchema.safeParse({email:"a@example.test",password:"long-password",role:"ADMIN"}).success).toBe(false);
    expect(registrationSchema.safeParse({email:"a@example.test",password:"short"}).success).toBe(false);
  });
  it("fails explicitly when SMTP is absent and requires secure public origins", () => {
    vi.stubEnv("SMTP_HOST", "");
    expect(() => mailConfiguration()).toThrow(/belum dikonfigurasi/);
    vi.stubEnv("SMTP_HOST", "smtp.example.test");vi.stubEnv("MAIL_FROM", "app@example.test");vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://public.example.test");
    expect(() => mailConfiguration()).toThrow(/HTTPS/);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");vi.stubEnv("SMTP_PORT", "587");
    expect(mailConfiguration()).toMatchObject({ port:587,secure:false });
  });
});
