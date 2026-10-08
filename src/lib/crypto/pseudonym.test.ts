import { describe, expect, it } from "vitest";

import {
  createHashFingerprint,
  createPseudonym,
  createPseudonymId,
  createTicketId,
  verifyHashFingerprint,
} from "./pseudonym";

describe("pseudonym", () => {
  it("createHashFingerprint menghasilkan hash yang tidak dapat dibalik", () => {
    const fingerprint = createHashFingerprint("Mozilla/5.0 (Windows NT 10.0)");

    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint).not.toContain("Mozilla");
    // Nilai aslinya tidak muncul di mana pun di dalam output.
    expect(Buffer.from(fingerprint, "hex").toString("utf8")).not.toContain("Mozilla");
  });

  it("createHashFingerprint tidak bisa dibalik lewat base64", () => {
    // Implementasi lama hanya melakukan base64-encode lalu memotong 16
    // karakter. Base64 adalah penyandian, bukan hash.
    const fingerprint = createHashFingerprint("user-agent");

    expect(createHashFingerprint("user-agent")).toBe(fingerprint);
    expect(createHashFingerprint("user-agenc")).not.toBe(fingerprint);
  });

  it("verifyHashFingerprint menolak nilai yang tidak cocok", () => {
    const fingerprint = createHashFingerprint("abc");

    expect(verifyHashFingerprint("abc", fingerprint)).toBe(true);
    expect(verifyHashFingerprint("abd", fingerprint)).toBe(false);
    expect(verifyHashFingerprint("abc", "")).toBe(false);
    expect(verifyHashFingerprint("abc", "bukan-hex")).toBe(false);
  });

  it("createPseudonymId deterministik untuk identitas yang sama", () => {
    const first = createPseudonymId("mahasiswa@poltek.test");
    const second = createPseudonymId("mahasiswa@poltek.test");

    expect(first).toBe(second);
    expect(first).not.toContain("mahasiswa");
    expect(first).not.toContain("poltek");
  });

  it("createPseudonymId berbeda untuk identitas berbeda", () => {
    expect(createPseudonymId("a@poltek.test")).not.toBe(createPseudonymId("b@poltek.test"));
  });

  it("createTicketId memakai alfabet yang bebas ambiguitas dan cukup panjang", () => {
    const id = createTicketId("TR");

    expect(id).toMatch(/^TR-[0-9A-HJKMNP-TV-Z]{10}$/);
    // Tidak boleh memuat huruf yang mudah tertukar dengan digit: I, L, O, U.
    expect(id.slice(3)).not.toMatch(/[ILOU]/);
  });

  it("createTicketId tidak berulang pada banyak pemanggilan", () => {
    const ids = new Set<string>();

    for (let index = 0; index < 2_000; index += 1) {
      ids.add(createTicketId("TR"));
    }

    expect(ids.size).toBe(2_000);
  });

  it("createPseudonym tidak berulang pada banyak pemanggilan", () => {
    const values = new Set<string>();

    for (let index = 0; index < 2_000; index += 1) {
      values.add(createPseudonym("PS"));
    }

    expect(values.size).toBe(2_000);
  });
});