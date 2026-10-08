import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { assertProductionEnvIfNeeded, assertRiskThresholdsSane, getServerEnv } from "./env";
const VALID_ENV = {
  DATABASE_URL: "postgresql://app:pw@localhost:5432/triase_net",
  KEK_MASTER_BASE64: randomBytes(32).toString("base64"),
  KEK_HKDF_SALT_BASE64: randomBytes(32).toString("base64"),
  PSEUDONYM_HMAC_KEY_BASE64: randomBytes(32).toString("base64"),
  JWT_SIGNING_SECRET: "x".repeat(32),
  JWT_ISSUER: "triase-net",
  JWT_AUDIENCE: "triase-net-app",
};

const ORIGINAL_ENV = { ...process.env };

function setEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function clearEnvKeys() {
  for (const key of Object.keys(VALID_ENV)) {
    delete process.env[key];
  }

  delete process.env.ZTNA_RISK_DENY_THRESHOLD;
  delete process.env.ZTNA_RISK_CHALLENGE_THRESHOLD;
  delete process.env.KEK_ACTIVE_VERSION;
  delete process.env.DATABASE_POOL_MAX;
  delete process.env.DATABASE_SSL;
  delete process.env.ATTACHMENT_MAX_BYTES;
}

describe("environment server", () => {
  beforeEach(() => {
    clearEnvKeys();
    setEnv(VALID_ENV);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllEnvs();
  });

  it("menerima konfigurasi lengkap", () => {
    const env = getServerEnv();

    expect(env.DATABASE_URL).toBe(VALID_ENV.DATABASE_URL);
    expect(env.DATABASE_POOL_MAX).toBe(10);
    expect(env.DATABASE_SSL).toBe(false);
    expect(env.KEK_ACTIVE_VERSION).toBe(1);
    expect(env.ATTACHMENT_MAX_BYTES).toBe(5_242_880);
    expect(Buffer.isBuffer(env.KEK_MASTER_BASE64)).toBe(true);
    expect(env.KEK_MASTER_BASE64.length).toBe(32);
  });

  it("menolak kunci yang lebih pendek dari 32 byte", () => {
    setEnv({ KEK_MASTER_BASE64: randomBytes(16).toString("base64") });

    // Placeholder `CHANGE_ME` di .env.example juga harus ditolak.
    expect(() => getServerEnv()).toThrow(/KEK_MASTER_BASE64/);
  });

  it("menolak secret sesi yang terlalu pendek", () => {
    setEnv({ JWT_SIGNING_SECRET: "pendek" });

    expect(() => getServerEnv()).toThrow(/JWT_SIGNING_SECRET: Minimal 32 karakter/);
  });

  it("memakai pesan Indonesia saat variabel tidak diisi sama sekali", () => {
    setEnv({ JWT_SIGNING_SECRET: undefined });

    expect(() => getServerEnv()).toThrow(/JWT_SIGNING_SECRET: Wajib diisi/);
  });

  it("menolak konfigurasi tanpa DATABASE_URL", () => {
    setEnv({ DATABASE_URL: undefined });

    // Zod menyusun detail sebagai "  - DATABASE_URL: Wajib diisi".
    expect(() => getServerEnv()).toThrow(/DATABASE_URL: Wajib diisi/);
  });

  it("pesan galat tidak membocorkan nilai rahasia", () => {
    const secret = randomBytes(32).toString("base64");
    setEnv({ KEK_MASTER_BASE64: secret, DATABASE_URL: undefined });

    try {
      getServerEnv();
      expect.unreachable("getServerEnv seharusnya melempar galat");
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
    }
  });

  it("menolak ambang risiko yang tidak logis", () => {
    expect(() =>
      assertRiskThresholdsSane({
        ZTNA_RISK_DENY_THRESHOLD: 30,
        ZTNA_RISK_CHALLENGE_THRESHOLD: 70,
      }),
    ).toThrow(/harus lebih besar/);
  });

  it("tidak memvalidasi apa pun di luar produksi", () => {
    vi.stubEnv("NODE_ENV", "development");
    clearEnvKeys();

    // Demo in-memory harus tetap bisa jalan tanpa Postgres dan tanpa kunci.
    expect(() => assertProductionEnvIfNeeded()).not.toThrow();
  });

  it("menolak start produksi dengan konfigurasi tidak lengkap", () => {
    vi.stubEnv("NODE_ENV", "production");
    setEnv({ KEK_MASTER_BASE64: undefined });

    expect(() => assertProductionEnvIfNeeded()).toThrow(/Konfigurasi produksi tidak lengkap/);
  });

  it("start produksi tidak mewajibkan DATABASE_URL untuk demo in-memory", () => {
    vi.stubEnv("NODE_ENV", "production");
    setEnv({ DATABASE_URL: undefined });

    // Demo tidak pernah menyentuh Postgres. Menuntut DATABASE_URL hanya akan
    // membuat `next start` gagal start untuk konfigurasi yang sebenarnya sudah
    // cukup, sementara jalur kriptografi dan sesinya sudah tervalidasi.
    expect(() => assertProductionEnvIfNeeded()).not.toThrow();
  });

  it("start produksi menolak secret sesi yang pendek meski kunci valid", () => {
    vi.stubEnv("NODE_ENV", "production");
    setEnv({ JWT_SIGNING_SECRET: "pendek" });

    expect(() => assertProductionEnvIfNeeded()).toThrow(/JWT_SIGNING_SECRET/);
  });

  it("memvalidasi ulang setelah environment berubah", () => {
    // Cache yang tidak memakai sidik jari nilai sumber akan mengembalikan
    // verdict "valid" selamanya setelah satu panggilan berhasil.
    expect(getServerEnv().DATABASE_URL).toBe(VALID_ENV.DATABASE_URL);

    setEnv({ JWT_SIGNING_SECRET: "pendek" });

    expect(() => getServerEnv()).toThrow(/JWT_SIGNING_SECRET/);

    setEnv({ JWT_SIGNING_SECRET: VALID_ENV.JWT_SIGNING_SECRET });

    expect(getServerEnv().JWT_SIGNING_SECRET).toBe(VALID_ENV.JWT_SIGNING_SECRET);
  });

  it("cache mengembalikan objek yang sama untuk environment yang tidak berubah", () => {
    expect(getServerEnv()).toBe(getServerEnv());
  });
});
