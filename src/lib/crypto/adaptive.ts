export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

/**
 * Ambang batas band risiko.
 *
 * Nilai ini harus sama persis dengan `ZTNA_RISK_CHALLENGE_THRESHOLD` dan
 * `ZTNA_RISK_DENY_THRESHOLD` di `src/lib/config/env.ts` serta tabel pada
 * `docs/TAHAP-1.md` bagian 6. Ketiganya mendefinisikan band yang sama;
 * kalau hanya satu yang berubah, lapisan enkripsi adaptif dan tampilan dasbor
 * akan berbeda pendapat tentang apakah sebuah aduan itu LOW atau MEDIUM.
 *
 * Versi sebelumnya memakai 35 sebagai batas bawah MEDIUM, sementara dokumen
 * dan konfigurasi memakai 30. Akibatnya skor 30-34 dilabeli LOW, dan kebijakan
 * Challenge tidak pernah terpicu.
 */
export const RISK_BAND_CHALLENGE_THRESHOLD = 30;
export const RISK_BAND_DENY_THRESHOLD = 70;

export interface RiskSignals {
  deviceTrust: number;
  sessionAgeMinutes: number;
  mfaVerified: boolean;
  trustedProxy: boolean;
  anomalyRate: number;
  accessScope: "LOW" | "MEDIUM" | "HIGH";
}

export function calculateRiskScore(signals: RiskSignals): number {
  const weighted =
    signals.deviceTrust * 0.3 +
    Math.min(signals.sessionAgeMinutes, 180) * 0.07 +
    (signals.mfaVerified ? 10 : 0) +
    (signals.trustedProxy ? -12 : 15) +
    signals.anomalyRate * 25 +
    (signals.accessScope === "HIGH" ? 18 : signals.accessScope === "MEDIUM" ? 8 : 0);

  return Math.max(0, Math.min(100, Math.round(weighted)));
}

export function getRiskBand(score: number): RiskLevel {
  if (score >= RISK_BAND_DENY_THRESHOLD) return "HIGH";
  if (score >= RISK_BAND_CHALLENGE_THRESHOLD) return "MEDIUM";
  return "LOW";
}

/**
 * Cipher yang dipakai untuk sebuah band risiko.
 *
 * Menetapkan pemetaan ini di satu tempat mencegah `getRiskBand` dan pemilihan
 * algoritme sampai memakai tabel yang berbeda. Lihat `docs/TAHAP-1.md` bagian 6.
 */
export function getCryptoAlgorithmForBand(band: RiskLevel): string {
  switch (band) {
    case "HIGH":
      return "HYBRID_DOUBLE";
    case "MEDIUM":
      return "CHACHA20_POLY1305";
    default:
      return "AES_256_GCM";
  }
}
