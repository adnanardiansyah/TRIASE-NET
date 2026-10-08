/**
 * Penilaian konteks perangkat dan IP untuk indikator ZTNA di layar login.
 *
 * Modul ini TypeScript murni tanpa dependensi Node, jadi aman diimpor dari
 * komponen klien.
 *
 * Band risiko memakai `getRiskBand` dan aturan step-up memakai
 * `requiresStepUp`, keduanya milik modul ZTNA yang sama dengan enkripsi
 * adaptif. Ambang 30 dan 70 itu harus tetap satu sumber kebenaran; menyalin
 * angkanya ke sini membuat panel login dan server bisa berbeda pendapat soal
 * apakah sebuah akses berisiko tinggi.
 *
 * Skornya sendiri dihitung di modul ini, bukan lewat `calculateRiskScore`.
 * Reason: di `RiskSignals`, `deviceTrust` masuk dengan bobot positif sementara
 * `trustedProxy` dan `mfaVerified` masuk dengan bobot negatif, jadi istilah
 * "trust" di sana sudah tidak seragam. Mengoper angka kepercayaan perangkat ke
 * parameter itu membuat arahnya terbalik: sinyal yang gagal justru menurunkan
 * skor risiko. Band dan aturan step-up yang sama sudah dijaga lewat
 * `getRiskBand` dan `requiresStepUp`, jadi yang hilang hanya bobot risikonya.
 *
 * Sinyal yang dikumpulkan semuanya terukur, bukan angka dekoratif. Panel yang
 * selalu menampilkan "98/100" tanpa dasar hanya hiasan, bukan kontrol
 * keamanan:
 *
 * - `navigator.webdriver` menandai peramban yang dikemudikan mesin.
 * - `window.isSecureContext` memastikan konteksnya bukan plaintext.
 * - Geometri `screen` dan `devicePixelRatio` yang nol adalah tanda lingkungan
 *   headless yang tidak melakukan komposisi layar.
 * - `hardwareConcurrency` yang tidak ada menandai lingkungan minimal.
 * - Preferensi `saveData` dan tipe koneksi lambat menurunkan keyakinan tanpa
 *   menolak akses, karena jaringan kampus memang sering lambat.
 */

import { getRiskBand, type RiskLevel } from "@/lib/crypto/adaptive";
import { requiresStepUp } from "@/lib/ztna/risk-engine";

export type SignalStatus = "PASS" | "WARN" | "FAIL";

/**
 * Bobot tiap status sinyal terhadap skor kepercayaan.
 *
 * Monoton: satu sinyal yang memburuk tidak pernah menaikkan skor. Skor
 * kepercayaan dihitung dari rata-rata bobot, bukan dari penalti, supaya
 * menambah sinyal baru tidak ikut mengubah skor sinyal lama.
 */
const STATUS_WEIGHT: Readonly<Record<SignalStatus, number>> = {
  PASS: 1,
  WARN: 0.5,
  FAIL: 0,
};

/**
 * Tambahan risiko selama faktor kedua belum dibuktikan.
 *
 * Ini step-up, bukan sekadar pengurangan kepercayaan: tanpa TOTP, konteks
 * perennial-perfect pun belum cukup untuk considers akses penuh.
 */
const PENDING_MFA_PENALTY = 10;

export interface ContextCheck {
  id: string;
  label: string;
  detail: string;
  status: SignalStatus;
}

/**
 * Fakta transport yang hanya bisa diketahui server.
 *
 * JavaScript tidak bisa membaca alamat IP sendiri, jadi nilainya wajib datang
 * dari route handler. `ipSource` memberi tahu apakah alamat itu berasal dari
 * header proxy yang dipakai deployment atau langsung dari soket.
 */
export interface TransportContext {
  ip: string;
  ipSource: "forwarded" | "socket";
  secureTransport: boolean;
}

export interface DeviceSignals {
  /** Ringkasan perangkat, mis. "Windows · Google Chrome". */
  device: string;
  platform: string;
  browser: string;
  timezone: string;
  viewport: string;
  checks: ContextCheck[];
}

export interface ContextAssessment extends DeviceSignals {
  transport: TransportContext;
  /** Skor risiko 0-100. Makin tinggi makin berisiko. */
  riskScore: number;
  riskBand: RiskLevel;
  requiresStepUp: boolean;
  /** Skor kepercayaan 0-100 dari seluruh sinyal. Makin tinggi makin-clean. */
  trustScore: number;
}

function detectBrowser(userAgent: string): string {
  if (/Edg\//.test(userAgent)) return "Microsoft Edge";
  if (/OPR\//.test(userAgent) || /Opera\//.test(userAgent)) return "Opera";
  if (/Firefox\//.test(userAgent)) return "Mozilla Firefox";
  if (/Chrome\//.test(userAgent)) return "Google Chrome";
  if (/Safari\//.test(userAgent)) return "Safari";
  return "Peramban tidak dikenal";
}

function detectPlatform(userAgent: string): string {
  if (/Windows NT/.test(userAgent)) return "Windows";
  if (/iPhone|iPad|iPod/.test(userAgent)) return "iOS";
  if (/Android/.test(userAgent)) return "Android";
  if (/Mac OS X/.test(userAgent)) return "macOS";
  if (/Linux/.test(userAgent)) return "Linux";
  return "Sistem tidak dikenal";
}

function resolveTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    // Beberapa lingkungan membatasi ICU. Zona waktu lalu dianggap tidak
    // terbaca, yang menurunkan keyakinan alih-alih menolak akses.
    return "";
  }
}

function scoreChecks(checks: ContextCheck[]): number {
  if (checks.length === 0) {
    return 100;
  }

  const total = checks.reduce((sum, check) => sum + STATUS_WEIGHT[check.status], 0);

  return Math.max(0, Math.min(100, Math.round((total / checks.length) * 100)));
}

/**
 * Mengumpulkan sinyal yang bisa dibaca peramban.
 *
 * Sengaja tidak melempar error. Setiap kegagalan baca ditandai sebagai sinyal
 * berstatus WARN atau FAIL, karena halaman login tidak boleh gagal dirender
 * hanya karena satu API browser tidak tersedia.
 */
export function collectDeviceSignals(): DeviceSignals {
  const userAgent = navigator.userAgent;
  const platform = detectPlatform(userAgent);
  const browser = detectBrowser(userAgent);
  const webdriver = navigator.webdriver === true;
  const secureContext = window.isSecureContext === true;

  const pixelRatio = window.devicePixelRatio;
  const viewportSane = screen.width > 0 && screen.height > 0 && pixelRatio > 0;

  const cores = navigator.hardwareConcurrency ?? 0;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const hasHardwareSignal = cores > 0 || typeof memory === "number";

  const languages = navigator.languages ?? [];
  const timezone = resolveTimezone();
  const hasLocale = languages.length > 0 && timezone.length > 0;

  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  const effectiveType = connection?.effectiveType ?? "";
  const isConstrainedNetwork =
    connection?.saveData === true || effectiveType === "slow-2g" || effectiveType === "2g";

  return {
    device: `${platform} · ${browser}`,
    platform,
    browser,
    timezone: timezone || "Zona waktu tidak terbaca",
    viewport: `${window.innerWidth}x${window.innerHeight} @${pixelRatio}x`,
    checks: [
      {
        id: "automation",
        label: "Integritas Peramban",
        detail: webdriver ? "Terflag otomatis (navigator.webdriver)" : "Tidak ada flag otomatisasi",
        status: webdriver ? "FAIL" : "PASS",
      },
      {
        id: "viewport",
        label: "Geometri Layar",
        detail: viewportSane ? "Komposisi layar konsisten" : "Dimensi layar tidak wajar",
        status: viewportSane ? "PASS" : "FAIL",
      },
      {
        id: "hardware",
        label: "Sinyal Perangkat",
        detail: hasHardwareSignal
          ? `Core ${cores || "?"}${memory ? ` · ${memory} GB` : ""}`
          : "Sinyal perangkat tidak tersedia",
        status: hasHardwareSignal ? "PASS" : "WARN",
      },
      {
        id: "locale",
        label: "Lokalisasi",
        detail: hasLocale ? timezone : "Bahasa atau zona waktu tidak terbaca",
        status: hasLocale ? "PASS" : "WARN",
      },
      {
        id: "network",
        label: "Kondisi Jaringan",
        detail: isConstrainedNetwork
          ? `Jaringan terbatas (${effectiveType || "tidak dilaporkan"})`
          : effectiveType
            ? `Jaringan ${effectiveType.toUpperCase()}`
            : "Jaringan normal",
        status: isConstrainedNetwork ? "WARN" : "PASS",
      },
      {
        id: "secure-context",
        label: "Konteks Aman",
        detail: secureContext ? "Window API terenkripsi" : "Konteks browser tidak terenkripsi",
        status: secureContext ? "PASS" : "FAIL",
      },
    ],
  };
}

/**
 * Menggabungkan sinyal perangkat dengan fakta transport server menjadi satu
 * penilaian ZTNA.
 *
 * `mfaVerified` dioper masuk supaya panel turunannya secara langsung begitu
 * tantangan TOTP selesai, tanpa perlu state terpisah di komponen.
 *
 * Skor risiko adalah kebalikan dari skor kepercayaan, ditambah penalti selama
 * faktor kedua belum terbukti. Hubungannya linear supaya satu sinyal yang
 * memburuk selalu menaikkan risiko, tidak pernah menurunkannya.
 */
export function assessLoginContext(
  signals: DeviceSignals,
  transport: TransportContext,
  mfaVerified: boolean,
): ContextAssessment {
  const checks: ContextCheck[] = [
    ...signals.checks,
    {
      id: "ip-attribution",
      label: "Atribusi IP",
      detail:
        transport.ip === "unknown"
          ? "Server tidak menerima alamat klien"
          : `Dialokalkan lewat ${transport.ipSource === "forwarded" ? "reverse proxy" : "soket langsung"}`,
      status: transport.ip === "unknown" ? "FAIL" : "PASS",
    },
    {
      id: "transport",
      label: "Transport",
      detail: transport.secureTransport ? "HTTPS terverifikasi" : "Koneksi tidak terenkripsi",
      status: transport.secureTransport ? "PASS" : "FAIL",
    },
    {
      id: "mfa",
      label: "Dua Faktor",
      detail: mfaVerified ? "TOTP terverifikasi pada alur ini" : "Menunggu verifikasi TOTP",
      status: mfaVerified ? "PASS" : "WARN",
    },
  ];

  const trustScore = scoreChecks(checks);
  const riskScore = Math.max(
    0,
    Math.min(100, 100 - trustScore + (mfaVerified ? 0 : PENDING_MFA_PENALTY)),
  );
  const riskBand = getRiskBand(riskScore);

  return {
    ...signals,
    transport,
    checks,
    trustScore,
    riskScore,
    riskBand,
    requiresStepUp: requiresStepUp(riskBand, riskScore),
  };
}

/** Nilai `TransportContext` yang dipakai sebelum server sempat menjawab. */
export const UNKNOWN_TRANSPORT: TransportContext = {
  ip: "unknown",
  ipSource: "socket",
  secureTransport: false,
};

/** Membaca `TransportContext` dari respons route handler secara defensif. */
export function parseTransportContext(payload: unknown): TransportContext {
  if (typeof payload !== "object" || payload === null) {
    return UNKNOWN_TRANSPORT;
  }

  const record = payload as Record<string, unknown>;
  const ip = typeof record.ip === "string" && record.ip.length > 0 ? record.ip : "unknown";
  const ipSource = record.ipSource === "forwarded" ? "forwarded" : "socket";
  const secureTransport = record.secureTransport === true;

  return { ip, ipSource, secureTransport };
}
