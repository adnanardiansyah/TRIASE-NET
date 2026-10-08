import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildRateLimitKeys,
  consumeRateLimit,
  getClientIp,
  resetRateLimit,
  __resetRateLimits,
} from "./rate-limit";

describe("rate limit", () => {
  beforeEach(() => {
    __resetRateLimits();
  });

  afterEach(() => {
    __resetRateLimits();
  });

  it("mengizinkan tepat `limit` percobaan lalu menolak", () => {
    // `limit` adalah jumlah percobaan yang BOLEH dipakai dalam satu jendela,
    // jadi dengan limit 3: panggilan 1-3 diizinkan, panggilan 4 ditolak.
    const results = [1, 2, 3, 4].map(() => consumeRateLimit("kunci", 3, 60_000));

    expect(results.map((result) => result.allowed)).toEqual([true, true, true, false]);
    expect(results[0]?.remaining).toBe(2);
    expect(results[2]?.remaining).toBe(0);
    expect(results[3]?.remaining).toBe(0);
  });

  it("terus menghitung setelah limit terlampaui", () => {
    for (let index = 0; index < 3; index += 1) {
      consumeRateLimit("kunci", 3, 60_000);
    }

    // Percobaan setelah limit terlampaui tidak boleh membiarkan penghitung
    // kembali ke bawah, sehingga penunggu tidak bisa memperpanjang blokir.
    expect(consumeRateLimit("kunci", 3, 60_000).allowed).toBe(false);
    expect(consumeRateLimit("kunci", 3, 60_000).allowed).toBe(false);
  });

  it("memisahkan penghitung antar kunci", () => {
    for (let index = 0; index < 3; index += 1) {
      consumeRateLimit("ip-a", 3, 60_000);
    }

    expect(consumeRateLimit("ip-a", 3, 60_000).allowed).toBe(false);
    expect(consumeRateLimit("ip-b", 3, 60_000).allowed).toBe(true);
  });

  it("resetRateLimit mengosongkan penghitung", () => {
    for (let index = 0; index < 3; index += 1) {
      consumeRateLimit("kunci", 3, 60_000);
    }

    resetRateLimit("kunci");

    expect(consumeRateLimit("kunci", 3, 60_000).allowed).toBe(true);
  });

  it("buildRateLimitKeys memisahkan IP dan identitas", () => {
    expect(buildRateLimitKeys("1.2.3.4", "a@poltek.test")).toEqual([
      "auth:ip:1.2.3.4",
      "auth:identity:a@poltek.test",
    ]);
  });

  it("getClientIp mengambil hop pertama dari X-Forwarded-For", () => {
    const request = {
      headers: {
        get: (name: string) =>
          name === "x-forwarded-for" ? "9.9.9.9, 8.8.8.8" : null,
      },
    };

    expect(getClientIp(request)).toBe("9.9.9.9");
  });

  it("getClientIp jatuh ke X-Real-IP lalu ke unknown", () => {
    expect(
      getClientIp({ headers: { get: (name) => (name === "x-real-ip" ? "7.7.7.7" : null) } }),
    ).toBe("7.7.7.7");
    expect(getClientIp({ headers: { get: () => null } })).toBe("unknown");
  });
});