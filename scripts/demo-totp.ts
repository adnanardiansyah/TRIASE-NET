/**
 * Penampil kode TOTP untuk akun demo.
 *
 * Jalankan:  npm run demo:totp
 *
 * Seed TOTP akun demo ada di `src/app/api/auth/route.ts`: nilai dari
 * environment bila diisi, dan jatuh ke `DEVELOPMENT_TOTP_FALLBACK` bila tidak.
 * Skrip ini memanggil `generateTotp` yang sama dengan yang dipakai server saat
 * verifikasi, jadi kode yang tampil di sini selalu bisa diterima.
 *
 * Kode hanya berlaku 30 detik. Tutup dengan Ctrl+C.
 */

import { generateTotp, TOTP_TIME_STEP_SECONDS, verifyTotp } from "@/lib/auth/totp";

import { loadEnvFiles } from "./lib/env.js";

loadEnvFiles();

interface DemoAccount {
  label: string;
  email: string;
  password: string;
  envKey: string;
}

/** Cerminan `USERS` di `src/app/api/auth/route.ts`. */
const ACCOUNTS: readonly DemoAccount[] = [
  {
    label: "Satgas",
    email: "satgas@poltek.test",
    password: "admin123",
    envKey: "DEMO_TOTP_SECRET_SATGAS",
  },
  {
    label: "Mahasiswa",
    email: "mahasiswa@poltek.test",
    password: "mahasiswa123",
    envKey: "DEMO_TOTP_SECRET_MAHASISWA",
  },
  {
    label: "Admin",
    email: "admin@poltek.test",
    password: "admin123",
    envKey: "DEMO_TOTP_SECRET_ADMIN",
  },
];

/** Sama dengan `DEVELOPMENT_TOTP_FALLBACK` di route auth. */
const FALLBACK_SECRET = "JBSWY3DPEHPK3PXP";

function secretFor(account: DemoAccount): string {
  const configured = process.env[account.envKey];

  return configured && configured.length > 0 ? configured : FALLBACK_SECRET;
}

function secondsLeft(): number {
  return TOTP_TIME_STEP_SECONDS - (Math.floor(Date.now() / 1000) % TOTP_TIME_STEP_SECONDS);
}

function render(secrets: readonly string[]): string {
  const codes = secrets.map((secret) => generateTotp(secret));
  const left = secondsLeft();
  const bar = "#".repeat(left).padEnd(TOTP_TIME_STEP_SECONDS, ".");

  // `verifyTotp` dipanggil supaya skrip ini diam-diam membuktikan bahwa kode
  // yang dicetak benar-benar diterima endpoint, bukan cuma kelihatan mirip.
  const rejected = codes.filter((code, index) => !verifyTotp(secrets[index] ?? "", code, 1));

  if (rejected.length > 0) {
    return `  tidak tervalidasi: ${rejected.join(", ")} (jam mesin meleset)`;
  }

  const rows = ACCOUNTS.map((account, index) => {
    return `  ${account.label.padEnd(10)} ${codes[index] ?? "------"}`;
  });

  return [rows.join("\n"), "", `  sisa ${String(left).padStart(2)} detik  [${bar}]`].join("\n");
}

function main(): void {
  const secrets = ACCOUNTS.map(secretFor);

  const paint = () => {
    process.stdout.write("\n  Kode TOTP akun demo TRIASE-Net\n");
    process.stdout.write(`  ${"-".repeat(34)}\n`);
    process.stdout.write(`${render(secrets)}\n`);
    process.stdout.write("\n  Ctrl+C untuk berhenti\n\n");
  };

  paint();

  // Sengaja tidak memakai `unref()`: interval inilah satu-satunya yang
  // menahan event loop. Dengan `unref()`, proses langsung keluar setelah
  // cetakan pertama dan hitungan mundur tidak pernah bergerak.
  setInterval(() => {
    // naik 4 baris, lalu tulis ulang isi frame yang sama
    process.stdout.write("\x1b[4A\x1b[J");
    paint();
  }, 1000);
}

main();