import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeAdaptiveCipher, decryptTicketPayload, encodeAdaptiveCipher, encryptTicketPayload } from "./ticket-cipher";

describe("persistent adaptive encryption", () => {
  const key = randomBytes(32);
  const aad = JSON.stringify(["TRX-2026-0123ABCD", "owner", "FASILITAS", 20]);
  it.each([[0, "AES_256_GCM"], [29, "AES_256_GCM"], [30, "CHACHA20_POLY1305"], [69, "CHACHA20_POLY1305"], [70, "HYBRID_DOUBLE"], [100, "HYBRID_DOUBLE"]] as const)("round-trips risk %s with %s", (risk, algorithm) => {
    const encrypted = encryptTicketPayload(key, "Isi rahasia mahasiswa", risk, aad);
    expect(encrypted.algorithm).toBe(algorithm);
    const stored = JSON.parse(JSON.stringify(encodeAdaptiveCipher(encrypted)));
    expect(JSON.stringify(stored)).not.toContain("Isi rahasia mahasiswa");
    expect(decryptTicketPayload(key, decodeAdaptiveCipher(stored), risk, aad)).toBe("Isi rahasia mahasiswa");
  });
  it.each([20, 45, 80])("rejects tampering and row swapping at risk %s", (risk) => {
    const encrypted = encryptTicketPayload(key, "Rahasia", risk, aad);
    expect(() => decryptTicketPayload(key, encrypted, risk, "other-ticket")).toThrow();
    expect(() => decryptTicketPayload(randomBytes(32), encrypted, risk, aad)).toThrow();
    encrypted.primary.tag[0] = encrypted.primary.tag[0]! ^ 1;
    expect(() => decryptTicketPayload(key, encrypted, risk, aad)).toThrow();
  });
  it("requires both HIGH layers and binds the outer tag", () => {
    const encrypted = encryptTicketPayload(key, "Rahasia", 80, aad);
    expect(encrypted.primary.ciphertext.equals(encrypted.outer!.ciphertext)).toBe(true);
    expect(encrypted.primary.wrappedDek.equals(encrypted.outer!.wrappedDek)).toBe(false);
    expect(() => decryptTicketPayload(key, { ...encrypted, outer: null }, 80, aad)).toThrow();
    encrypted.outer!.tag[0] = encrypted.outer!.tag[0]! ^ 1;
    expect(() => decryptTicketPayload(key, encrypted, 80, aad)).toThrow();
  });
  it("uses a fresh nonce and DEK for every encryption", () => {
    const first = encryptTicketPayload(key, "same", 20, aad);
    const next = encryptTicketPayload(key, "same", 20, aad);
    expect(first.primary.iv.equals(next.primary.iv)).toBe(false);
    expect(first.primary.wrappedDek.equals(next.primary.wrappedDek)).toBe(false);
  });
  it("rejects algorithm downgrades and invalid scores", () => {
    const encrypted = encryptTicketPayload(key, "data", 80, aad);
    expect(() => decryptTicketPayload(key, { ...encrypted, algorithm: "AES_256_GCM" }, 80, aad)).toThrow();
    for (const risk of [-1, 101, NaN, 1.5]) expect(() => encryptTicketPayload(key, "x", risk, aad)).toThrow();
  });
});
