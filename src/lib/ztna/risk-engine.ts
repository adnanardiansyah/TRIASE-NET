import { calculateRiskScore, getRiskBand, type RiskLevel } from "@/lib/crypto/adaptive";

import type { RiskSignals } from "@/lib/crypto/adaptive";

export interface RiskEvaluation {
  score: number;
  band: "LOW" | "MEDIUM" | "HIGH";
  requiresStepUp: boolean;
}

/**
 * Skor minimum yang sudah memaksa pengguna melakukan step-up authentication.
 *
 * Diekspor supaya lapisan lain memakai angka yang sama. Versi sebelumnya
 * menulis angka ini langsung di dalam `evaluateRisk`, sehingga setiap pemanggil
 * baru harus menebak ulang ambangnya dan risked melenceng dari server.
 */
const STEP_UP_SCORE_THRESHOLD = 60;

/** True bila band dan skor itu mewajibkan verifikasi tambahan. */
export function requiresStepUp(band: RiskLevel, score: number): boolean {
  return band === "HIGH" || score >= STEP_UP_SCORE_THRESHOLD;
}

export function evaluateRisk(signals: RiskSignals): RiskEvaluation {
  const score = calculateRiskScore(signals);
  const band = getRiskBand(score);

  return {
    score,
    band,
    requiresStepUp: requiresStepUp(band, score),
  };
}
