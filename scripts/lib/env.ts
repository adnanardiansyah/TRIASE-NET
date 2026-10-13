/**
 * Pemuat `.env.local` untuk skrip CLI (migrate / verify / seed).
 *
 * Mengapa tidak memakai `dotenv`:
 *   - Node 20.12+ sudah menyediakan `process.loadEnvFile()`.
 *   - Prevensi variabel yang sudah disetel di shell TIDAK ditimpa. Ini
 *     penting untuk CI dan untuk operasi di mana kredensial datang dari
 *     secret store, bukan dari berkas.
 *
 * Aturan:
 *   1. Isi `process.env` yang sudah ada menang atas isi berkas.
 *   2. Kekosongan dan `#` di awal nilai diperlakukan sebagai belum diisi,
 *      sehingga berkas contoh (`CHANGE_ME_...`) tidak aktif diam-diam.
 *   3. Kegagalan memuat berkas bukan error fatal bila variabel yang
 *     dibutuhkan sudah tersedia di environment.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, "..", "..");

const ENV_FILES = [".env.local", ".env"] as const;

function parseEnvFile(contents: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator <= 0) continue;

    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = line.slice(separator + 1).trim();

    // Lepas tanda kutip pembungkus bila ada.
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

/**
 * Memuat berkas environment proyek ke `process.env`.
 *
 * Returns nama berkas yang benar-benar terbaca, atau array kosong.
 */
export function loadEnvFiles(): string[] {
  const loaded: string[] = [];

  for (const name of ENV_FILES) {
    const path = resolve(PROJECT_ROOT, name);
    if (!existsSync(path)) continue;

    let parsed: Record<string, string>;
    try {
      parsed = parseEnvFile(readFileSync(path, "utf8"));
    } catch {
      continue;
    }

    for (const [key, value] of Object.entries(parsed)) {
      // Variabel yang sudah disetel di shell selalu menang.
      if (process.env[key] !== undefined) continue;

      // Nilai kosong bukan kredensial; biarkan agar pemeriksaan
      // ketiadaan variabel melaporkan pesan yang benar.
      if (value.length === 0 || value === "CHANGE_ME") continue;

      process.env[key] = value;
    }

    loaded.push(name);
  }

  return loaded;
}

/**
 * Mengambil nilai environment yang wajib ada, dengan pesan galat yang
 * menyebutkan berkas mana yang perlu disunting.
 */
export function requireEnv(key: string, purpose: string): string {
  const value = process.env[key];

  if (!value || value.length === 0) {
    throw new Error(
      `${key} belum disetel (${purpose}).\n` +
        `  Isi nilainya di ${PROJECT_ROOT}\\.env.local, atau setel di shell:\n` +
        `    $env:${key} = "postgresql://USER:PASS@localhost:5432/triase_net"`,
    );
  }

  return value;
}
