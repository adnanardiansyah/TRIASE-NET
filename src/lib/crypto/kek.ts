import { createHash, randomBytes } from "node:crypto";

/**
 * Material kunci pembungkus (KEK) untuk badan aduan.
 *
 * Aturannya sama seperti kunci pseudonim: nilai cadangan hanya dibangkitkan di
 * luar produksi. Kunci yang tertanam di source code berarti siapa pun yang
 * membaca repositori bisa mendekripsi apa pun yang dienkripsi dengannya, jadi
 * di produksi `KEK_MASTER_BASE64` wajib diisi dan tidak ada jalan lain.
 */
export const KEK_KEY_ID = "kek-001";

const DEVELOPMENT_KEK_SEED = "triase-net-development-kek-do-not-use-in-production";

let developmentKey: Buffer | null = null;

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Mengembalikan material kunci, atau `null` bila tidak ada yang bisa dipakai.
 *
 * Mengembalikan `null` lebih baik daripada melempar galat: pemanggil decides
 * sendiri apakah konfigurasi yang hilang berarti "jalur dekripsi dimatikan" atau
 * "permintaan ditolak".
 */
export function getKekMaterial(): Buffer | null {
  const configured = process.env.KEK_MASTER_BASE64;

  if (configured && configured.length > 0) {
    const material = Buffer.from(configured, "base64");

    // AES-256 butuh tepat 32 byte. Material yang lebih pendek ditolak, bukan
    // dipotong, karena memotong kunci melemahkan jaminan yang seharusnya
    // dikuatkan.
    return material.length === 32 ? material : null;
  }

  if (isProduction()) {
    return null;
  }

  if (!developmentKey) {
    // Diturunkan lewat hash supaya panjangnya dijamin 32 byte.
    developmentKey = createHash("sha256").update(DEVELOPMENT_KEK_SEED).digest();
  }

  return developmentKey;
}

/** Dipakai tes. */
export function __resetKekCache(): void {
  developmentKey = null;
}

/** Membuat kunci acak yang valid untuk dipakai di `.env`. */
export function generateKekBase64(): string {
  return randomBytes(32).toString("base64");
}
