import { describe, expect, it } from "vitest";

import {
  calculateRiskScore,
  getCryptoAlgorithmForBand,
  getRiskBand,
  RISK_BAND_CHALLENGE_THRESHOLD,
  RISK_BAND_DENY_THRESHOLD,
} from "./adaptive";

describe("adaptive risk", () => {
  it("memakai batas band yang sama dengan dokumen dan konfigurasi", () => {
    // docs/TAHAP-1.md bagian 6: < 30 LOW, 30-69 MEDIUM, >= 70 HIGH.
    // Nilai ini harus sama dengan ZTNA_RISK_*_THRESHOLD di env.ts.
    expect(RISK_BAND_CHALLENGE_THRESHOLD).toBe(30);
    expect(RISK_BAND_DENY_THRESHOLD).toBe(70);
  });

  it("mengklasifikasikan skor 30-34 sebagai MEDIUM, bukan LOW", () => {
    // Versi sebelumnya memakai 35, sehingga rentang 30-34 dilabeli LOW dan
    // kebijakan Challenge tidak pernah terpicu.
    for (const score of [30, 31, 34, 35, 69]) {
      expect(getRiskBand(score)).toBe("MEDIUM");
    }
    expect(getRiskBand(29)).toBe("LOW");
    expect(getRiskBand(70)).toBe("HIGH");
    expect(getRiskBand(100)).toBe("HIGH");
  });

  it("memetakan band ke cipher sesuai tabel dokumen", () => {
    expect(getCryptoAlgorithmForBand("LOW")).toBe("AES_256_GCM");
    expect(getCryptoAlgorithmForBand("MEDIUM")).toBe("CHACHA20_POLY1305");
    expect(getCryptoAlgorithmForBand("HIGH")).toBe("HYBRID_DOUBLE");
  });

  it("selalu mengembalikan skor dalam rentang 0-100", () => {
    const base = {
      deviceTrust: 0,
      sessionAgeMinutes: 0,
      mfaVerified: false,
      trustedProxy: true,
      anomalyRate: 0,
      accessScope: "LOW" as const,
    };

    expect(calculateRiskScore(base)).toBe(0);
    expect(
      calculateRiskScore({
        deviceTrust: 100,
        sessionAgeMinutes: 10_000,
        mfaVerified: true,
        trustedProxy: false,
        anomalyRate: 100,
        accessScope: "HIGH",
      }),
    ).toBe(100);
  });

  it("menaikkan risiko ketika konteks tidak dipercaya", () => {
    const base = {
      deviceTrust: 50,
      sessionAgeMinutes: 10,
      mfaVerified: false,
      trustedProxy: true,
      anomalyRate: 0,
      accessScope: "MEDIUM" as const,
    };

    const untrusted = calculateRiskScore({ ...base, trustedProxy: false });
    const trusted = calculateRiskScore(base);

    expect(untrusted).toBeGreaterThan(trusted);
  });
});