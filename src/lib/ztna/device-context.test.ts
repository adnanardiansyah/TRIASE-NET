import { describe, expect, it } from "vitest";

import { RISK_BAND_CHALLENGE_THRESHOLD, getRiskBand } from "@/lib/crypto/adaptive";

import {
  UNKNOWN_TRANSPORT,
  assessLoginContext,
  parseTransportContext,
  type ContextAssessment,
  type ContextCheck,
  type DeviceSignals,
  type SignalStatus,
  type TransportContext,
} from "./device-context";

function check(id: string, status: SignalStatus): ContextCheck {
  return { id, label: id, detail: id, status };
}

function signals(checks: ContextCheck[]): DeviceSignals {
  return {
    device: "Windows - Google Chrome",
    platform: "Windows",
    browser: "Google Chrome",
    timezone: "Asia/Jakarta",
    viewport: "1440x900 @2x",
    checks,
  };
}

function transport(overrides: Partial<TransportContext> = {}): TransportContext {
  return { ip: "203.0.113.24", ipSource: "forwarded", secureTransport: true, ...overrides };
}

/** Konteks sehat: dua sinyal peramban yang semuanya lolos. */
function healthySignals(): DeviceSignals {
  return signals([check("automation", "PASS"), check("viewport", "PASS")]);
}

describe("assessLoginContext", () => {
  it("menurunkan risiko begitu TOTP terverifikasi", () => {
    const before = assessLoginContext(healthySignals(), transport(), false);
    const after = assessLoginContext(healthySignals(), transport(), true);

    expect(after.riskScore).toBeLessThan(before.riskScore);
    expect(after.checks.find((item) => item.id === "mfa")?.status).toBe("PASS");
  });

  it("menaikkan risiko setiap kali satu sinyal memburuk", () => {
    // Sinyal yang gagal harus menaikkan risiko. Model sebelumnya justru
    // menurunkan skor risiko saat atribusi IP gagal, karena penalti
    // kepercayaan masuk lewat parameter yang arahnya sudah terbalik.
    const baseline = assessLoginContext(healthySignals(), transport(), false);

    const scenarios: Array<[string, ContextAssessment]> = [
      [
        "ip tidak teratribusi",
        assessLoginContext(healthySignals(), transport({ ip: "unknown" }), false),
      ],
      [
        "transport tanpa TLS",
        assessLoginContext(healthySignals(), transport({ secureTransport: false }), false),
      ],
      [
        "peramban terflag otomatis",
        assessLoginContext(
          signals([check("automation", "FAIL"), check("viewport", "PASS")]),
          transport(),
          false,
        ),
      ],
      [
        "geometri layar tidak wajar",
        assessLoginContext(
          signals([check("automation", "PASS"), check("viewport", "FAIL")]),
          transport(),
          false,
        ),
      ],
    ];

    for (const [label, assessment] of scenarios) {
      expect(assessment.riskScore, label).toBeGreaterThan(baseline.riskScore);
      expect(assessment.trustScore, label).toBeLessThan(baseline.trustScore);
    }
  });

  it("tidak mengubah risiko bila sinyalnya sama persis", () => {
    const baseline = assessLoginContext(healthySignals(), transport(), false);
    const repeat = assessLoginContext(
      signals([check("viewport", "PASS"), check("automation", "PASS")]),
      transport(),
      false,
    );

    expect(repeat.riskScore).toBe(baseline.riskScore);
    expect(repeat.riskScore).toBeLessThan(RISK_BAND_CHALLENGE_THRESHOLD);
  });

  it("menandai MFA yang belum selesai sebagai WARN, bukan PASS", () => {
    const pending = assessLoginContext(healthySignals(), transport(), false);

    expect(pending.checks.find((item) => item.id === "mfa")?.status).toBe("WARN");
  });

  it("memakai ambang band milik enkripsi adaptif, bukan ambang sendiri", () => {
    // Band harus selalu sama dengan getRiskBand supaya panel login dan
    // enkripsi adaptif tidak berbeda pendapat soal level risiko.
    const combinations: ContextCheck[][] = [
      [check("a", "PASS"), check("b", "PASS")],
      [check("a", "PASS"), check("b", "WARN")],
      [check("a", "WARN"), check("b", "WARN")],
      [check("a", "PASS"), check("b", "FAIL")],
      [check("a", "FAIL"), check("b", "FAIL")],
    ];

    for (const checks of combinations) {
      const assessment = assessLoginContext(signals(checks), transport(), false);

      expect(assessment.riskBand).toBe(getRiskBand(assessment.riskScore));
    }
  });

  it("menahan skor di rentang 0-100 dan escalate saat semua sinyal gagal", () => {
    // Enam sinyal gagal dan hanya TOTP yang lolos, jadi skor kepercayaan
    // menyentuh titik terendah yang masih mungkin dicapai.
    const worst = assessLoginContext(
      signals([check("a", "FAIL"), check("b", "FAIL"), check("c", "FAIL"), check("d", "FAIL")]),
      transport({ ip: "unknown", secureTransport: false }),
      true,
    );

    expect(worst.trustScore).toBe(14);
    expect(worst.riskScore).toBeLessThanOrEqual(100);
    expect(worst.riskScore).toBeGreaterThanOrEqual(0);
    expect(worst.riskBand).toBe("HIGH");
    expect(worst.requiresStepUp).toBe(true);
  });
});

describe("parseTransportContext", () => {
  it("menolak payload yang bukan objek", () => {
    for (const payload of [null, undefined, "203.0.113.24", 42, []]) {
      expect(parseTransportContext(payload)).toEqual(UNKNOWN_TRANSPORT);
    }
  });

  it("menolak nilai di luar enum yang dikenal", () => {
    const parsed = parseTransportContext({
      ip: "203.0.113.24",
      ipSource: "socket-dari-server",
      secureTransport: "true",
    });

    // secureTransport harus tetap boolean sejati. String "true" yang di-cast
    // diam-diam akan membuat panel menampilkan koneksi aman padahal server
    // tidak pernah mengatakannya.
    expect(parsed.ipSource).toBe("socket");
    expect(parsed.secureTransport).toBe(false);
  });

  it("menjalankan ip kosong menjadi unknown", () => {
    expect(parseTransportContext({ ip: "" }).ip).toBe("unknown");
  });

  it("menerapkan payload yang valid", () => {
    expect(
      parseTransportContext({
        ip: "198.51.100.7",
        ipSource: "forwarded",
        secureTransport: true,
      }),
    ).toEqual({ ip: "198.51.100.7", ipSource: "forwarded", secureTransport: true });
  });
});
