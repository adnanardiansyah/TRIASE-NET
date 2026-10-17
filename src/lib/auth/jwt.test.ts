import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  issueSessionToken,
  verifySessionToken,
  SESSION_ROLES,
} from "./jwt";

describe("jwt sesi", () => {
  const originalSecret = process.env.JWT_SIGNING_SECRET;

  beforeEach(() => {
    process.env.JWT_SIGNING_SECRET = "test-secret-yang-panjang-sekitar-36-karakter";
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.JWT_SIGNING_SECRET;
    } else {
      process.env.JWT_SIGNING_SECRET = originalSecret;
    }

    vi.unstubAllEnvs();
  });

  it("bolak-balik untuk klaim yang benar", () => {
    const token = issueSessionToken({ sub: "a@poltek.test", role: "SATGAS" }, 60);
    const claims = verifySessionToken(token);

    expect(claims.sub).toBe("a@poltek.test");
    expect(claims.role).toBe("SATGAS");
    expect(claims.exp).toBeGreaterThan(claims.iat);
  });

  it("menolak token kedaluwarsa", () => {
    const token = issueSessionToken({ sub: "a@poltek.test", role: "ADMIN" }, -10);

    expect(() => verifySessionToken(token)).toThrow(/kadaluarsa/i);
  });

  it("melempar galat bersih, bukan RangeError, untuk tanda tangan Berbeda panjang", () => {
    // `timingSafeEqual` melempar RangeError bila panjang buffer berbeda.
    // Token dari klien adalah input tak tepercaya, jadi panjang yang berbeda
    // adalah kondisi yang wajar dan harus ditangani sebagai penolakan.
    const token = issueSessionToken({ sub: "a@poltek.test", role: "ADMIN" }, 60);
    const [header, payload] = token.split(".");

    expect(() => verifySessionToken(`${header}.${payload}.abc`)).toThrow(
      /rusak atau tidak sah/i,
    );
  });

  it("menolak role di luar daftar yang dikenal", () => {
    const token = issueSessionToken(
      { sub: "a@poltek.test", role: "SUPERADMIN" as never },
      60,
    );

    expect(() => verifySessionToken(token)).toThrow(/role yang tidak dikenal/i);
  });

  it("menolak payload yang ditandatangani tapi isinya rusak", () => {
    // Header dan payload digabung dengan tangan lalu ditandatangani dengan
    // secret yang sama, jadi tanda tangannya valid sementara isinya bukan.
    const encodedHeader = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    );
    const encodedPayload = Buffer.from(
      JSON.stringify({ sub: "x", role: "ADMIN" }),
    ).toString("base64url");
    const forged = `${encodedHeader}.${encodedPayload}`;

    const signature = createHmac("sha256", process.env.JWT_SIGNING_SECRET as string)
      .update(forged)
      .digest("base64url");

    expect(() => verifySessionToken(`${forged}.${signature}`)).toThrow(
      /waktu yang valid/i,
    );
  });

  it("menolak tanda tangan dari secret lain", () => {
    const token = issueSessionToken({ sub: "a@poltek.test", role: "ADMIN" }, 60);
    process.env.JWT_SIGNING_SECRET = "secret-yang-berbeda-sama-sekali-123456";

    expect(() => verifySessionToken(token)).toThrow(/rusak atau tidak sah/i);
  });

  it("menolak bentuk token yang salah", () => {
    expect(() => verifySessionToken("")).toThrow();
    expect(() => verifySessionToken("a.b")).toThrow();
    expect(() => verifySessionToken("a.b.c.d")).toThrow();
  });

  it("menggagalkan penerbitan tanpa secret di produksi, bukan memakai nilai cadangan", () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.JWT_SIGNING_SECRET;

    // Secret cadangan di dalam source code berarti siapa pun yang membaca
    // repository bisa membuat token sesi untuk role mana pun.
    expect(() => issueSessionToken({ sub: "a@poltek.test", role: "ADMIN" }, 60)).toThrow(
      /JWT_SIGNING_SECRET wajib/i,
    );
  });

  it("binds sessions to issuer, audience and bounded lifetime", () => {
    const token=issueSessionToken({sub:"user@example.test",role:"SATGAS"},60);
    vi.stubEnv("JWT_AUDIENCE","other-application");expect(()=>verifySessionToken(token)).toThrow(/tujuan/);
    vi.unstubAllEnvs();
    expect(()=>verifySessionToken(issueSessionToken({sub:"user@example.test",role:"SATGAS"},241))).toThrow(/Masa berlaku/);
  });

  it("mendeklarasikan daftar role sebagai satu sumber kebenaran", () => {
    expect(SESSION_ROLES).toEqual(["MAHASISWA", "SATGAS", "ADMIN"]);
  });
});