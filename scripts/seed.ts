/**
 * Pembuat data pengembangan.
 *
 * TUJUHAN: membuat akun satuan tugas dengan kata sandi acak yang langsung
 * dicetak ke terminal SATU KALI. Tidak ada nilai default yang tertanam di
 * dalam repositori.
 *
 * Jalankan:  npm run db:seed
 *
 * CATATAN KEAMANAN: skrip ini tidak boleh pernah dijalankan pada produksi.
 * Periksa `NODE_ENV` sebelum melanjutkan.
 */

import { randomBytes } from "node:crypto";

import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";

import { loadEnvFiles } from "./lib/env.js";

loadEnvFiles();

/** Kata sandi acak yang cukup kuat untuk data uji. */
function generatePassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(24);
  let password = "";

  for (const byte of bytes) {
    password += alphabet[byte % alphabet.length];
  }

  // Jamin kompleks: minimal satu huruf besar, satu huruf kecil, satu angka.
  password = `A${password.slice(1, 17)}7${password.slice(18)}`;
  return password;
}

/**
 * Seed mengubah `password_hash` pada `users`.
 *
 * `DATABASE_MIGRATION_URL` (yaitu `triase_ddl_login`) SENGAJA tidak bisa
 * dipakai di sini. Peran migrasi hanya memegang INSERT dan SELECT
 * terbatas pada tabel identitas, tanpa UPDATE sama sekali. Itu memang
 * benar: peran migrasi tidak boleh mengubah akun yang sudah ada.
 *
 * `DATABASE_URL` juga tidak bisa dipakai. Peran runtime boleh mengubah
 * `password_hash` miliknya sendiri, tetapi tidak boleh menyentuh akun
 * milik orang lain, dan seed justru menuliskan hash ke akun admin.
 *
 * Jadi seed memakai `DATABASE_ADMIN_URL`, sama seperti `db:roles`.
 * Keduanya adalah operasi administrasi, bukan operasi skema dan bukan
 * operasi aplikasi.
 */
async function connect(): Promise<Kysely<unknown>> {
  const connectionString =
    process.env.DATABASE_ADMIN_URL ??
    process.env.DATABASE_MIGRATION_URL ??
    process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_ADMIN_URL belum disetel (seed mengubah kredensial).\n" +
        '  $env:DATABASE_ADMIN_URL = "postgresql://postgres:PASS@localhost:5432/triase_net"\n' +
        "  Jalankan `npm run db:roles` lebih dulu untuk membuat peran LOGIN.",
    );
  }

  if (!process.env.DATABASE_ADMIN_URL) {
    console.warn(
      "[seed] Peringatan: DATABASE_ADMIN_URL belum disetel; memakai URL lain.\n" +
        "         Seed menulis kredensial, jadi seharusnya memakai kredensial admin.",
    );
  }

  return new Kysely<unknown>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString, max: 1 }) }),
  });
}

/**
 * Hash kata sandi memakai Argon2id (RFC 9106).
 *
 * sebelumnya skrip ini memakai scrypt dan basis data menerima prefix
 * `$scrypt$`. Itu adalah pelonggaran skema yang disengaja untuk
 * menghindari dependensi native, dan sudah dihapus oleh migrasi
 * `0021_argon2id_only.sql`: skema kini hanya menerima Argon2id, di
 * setiap lingkungan.
 *
 * `@node-rs/argon2` memakai prebuilt binary untuk Windows/Linux/macOS,
 * jadi tidak ada kebutuhan kompilasi di lokal maupun di CI.
 *
 * Parameter mengikuti rekomendasi OWASP untuk hashing kata sandi.
 * Nilai salt dan parameter ikut terekam di dalam string PHC, sehingga
 * parameter dapat dinaikkan tanpa mengubah skema.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19456, // m = 19 MiB
  timeCost: 2, // t
  parallelism: 1, // p
} as const;

async function hashPassword(password: string): Promise<string> {
  const { hash } = await import("@node-rs/argon2");
  return hash(password, ARGON2_OPTIONS);
}

const STAFF_ACCOUNTS = [
  {
    email: "satgas.fasilitas@poltek.test",
    name: "Petugas Fasilitas (Uji)",
  },
  {
    email: "satgas.keamanan@poltek.test",
    name: "Petugas Keamanan Informasi (Uji)",
  },
  {
    email: "admin@poltek.test",
    name: "Administrator Sistem (Uji)",
  },
] as const;

async function run(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("db:seed ditolak pada NODE_ENV=production.");
  }

  const db = await connect();
  const created: Array<{ email: string; password: string }> = [];

  try {
    // Pastikan KEK versi 1 ada (dibuat oleh migrasi atau seed SQL).
    const kek = await sql<{ version: number }>`
      SELECT version FROM public.kek_versions WHERE version = 1
    `.execute(db);

    if (kek.rows.length === 0) {
      console.warn(
        "[seed] Peringatan: kek_versions versi 1 belum ada. Jalankan db:migrate terlebih dahulu.",
      );
    }

    for (const account of STAFF_ACCOUNTS) {
      const password = generatePassword();
      const passwordHash = await hashPassword(password);

      const result = await sql`
        UPDATE public.users
        SET password_hash = ${passwordHash},
            status = 'ACTIVE',
            mfa_enrolled = false
        WHERE email_normalized = ${account.email.toLowerCase()}
        RETURNING id
      `.execute(db);

      if (result.rows.length === 0) {
        console.warn(
          `[seed] Akun ${account.email} tidak ditemukan. Jalankan seed SQL terlebih dahulu.`,
        );
        continue;
      }

      created.push({ email: account.email, password });
    }

    console.log("");
    console.log("=".repeat(60));
    console.log("KREDENSIAL UJI - SIMPAN SEKALI, TIDAK DISIMPAN DI MANA PUN");
    console.log("=".repeat(60));
    for (const account of created) {
      console.log(`  email    : ${account.email}`);
      console.log(`  password : ${account.password}`);
      console.log("");
    }
    console.log("Langkah berikutnya: daftarkan TOTP untuk setiap akun,");
    console.log("lalu ubah duty_status menjadi 'ON_DUTY' untuk menguji dekripsi.");
    console.log("=".repeat(60));
  } finally {
    await db.destroy();
  }
}

run().catch((error: unknown) => {
  console.error("Seed gagal:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
