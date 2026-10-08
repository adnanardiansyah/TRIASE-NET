/**
 * Membuat atau merotasi peran LOGIN untuk setiap peran hak NOLOGIN.
 *
 * Jalankan sekali per lingkungan, SETELAH `npm run db:migrate` sampai
 * migrasi 0031 terpasang:
 *
 *     $env:DATABASE_ADMIN_URL = "postgresql://postgres:...@localhost:5432/triase_net"
 *     $env:TRIASE_APP_PASSWORD = "..."
 *     $env:TRIASE_DDL_PASSWORD = "..."
 *     $env:TRIASE_VERIFY_PASSWORD = "..."
 *     $env:TRIASE_RETENTION_PASSWORD = "..."
 *     npm run db:roles
 *
 * Kenapa peran LOGIN dibuat di sini, bukan di migrasi:
 *   - Kata sandi tidak boleh pernah masuk ke berkas yang di-commit.
 *   - Migrasi bersifat deklaratif dan tidak bergantung pada environment.
 *   - Peran LOGIN bisa dirotasi tanpa menyentuh skema.
 *
 * KONEKSI YANG DIGUNAKAN
 *   Skrip ini memerlukan hak admin (CREATEROLE), karena ia membuat peran.
 *   `DATABASE_MIGRATION_URL` sengaja TIDAK dipakai: migrasi berjalan
 *   sebagai `triase_ddl_login`, yang memang tidak boleh memegang
 *   CREATEROLE. Campur keduanya akan membuat hasil terlihat berhasil di
 *   localhost lalu gagal di CI, atau sebaliknya.
 *
 * KONSEKUENSI UNTUK DATABASE BARU
 *   Migrasi 0024 dan 0031 memberikan keanggotaan bagi peran LOGIN yang
 *   belum ada, dan blok PENEGAKEN-nya akan gagal dengan pesan jelas.
 *   Jadi pada database baru urutannya adalah:
 *
 *       1. db:migrate dengan admin  -> sampai 0023 (peran hak tercipta)
 *       2. db:roles                 -> peran LOGIN tercipta
 *       3. db:migrate dengan admin  -> 0024 ke atas (membership terpenuhi)
 *
 *   Jalankan `npm run db:migrate -- --to 0023` untuk langkah pertama.
 *   Kegagalan pada langkah 1-2 itu disengaja: konfigurasi hak akses
 *   setengah jadi lebih berbahaya daripada tidak terkonfigurasi sama sekali.
 *
 * KONSEKUENSI UNTUK VERIFIKASI
 *   `triase_verify_login` adalah anggota TIGA peran sekaligus:
 *   `triase_app` (untuk menguji RLS), `triase_auditor` (untuk rantai
 *   audit), dan `triase_fixture` (untuk menyiapkan data fixture).
 *   Ketiganya adalah peran hak yang tidak simetris, jadi skrip ini
 *   mendukung lebih dari satu group per peran.
 *
 * Keamanan:
 *   - Kata sandi di-set dengan `password_encryption = scram-sha-256`,
 *     bukan md5, apa pun `password_encryption` bawaan server.
 *   - Peran dibuat dengan `NOSUPERUSER NOCREATEDB NOCREATEROLE
 *     NOBYPASSRLS NOREPLICATION`, sehingga tidak ada eskalasi tak
 *     terduga. `NOBYPASSRLS` adalah pengaman utama: tanpa itu, peran
 *     login bisa melewati seluruh kebijakan RLS yang baru saja dibangun.
 *   - `INHERIT` (bukan NOINHERIT) dipakai secara sengaja. Keanggotaan
 *     harus langsung berlaku supaya aplikasi cukup terhubung dengan
 *     `DATABASE_URL` tanpa harus `SET ROLE` di setiap koneksi. Pemisahan
 *     yang dijaga adalah peran hak mana yang diwarisi, bukan apakah
 *     pewarisan terjadi.
 *   - Keanggotaan DITARIK ULANG sebelum diberikan ulang, supaya rotasi
 *     tidak meninggalkan jalur lama yang tidak disadari. Membership
 *     dipanggil eksplisit oleh migrasi, jadi_play aman untuk diulang.
 *   - Skrip menolak jalan bila target database adalah `postgres`,
 *     `template0`, atau `template1`.
 */

import { loadEnvFiles, requireEnv } from "./lib/env.js";

import { Client } from "pg";

loadEnvFiles();

/**
 * Satu peran LOGIN dan peran-peran hak yang diwarisinya.
 *
 * `groups` berisi satu atau beberapa. Hanya `triase_verify_login` yang
 * punya lebih dari satu, dan itu memang dibutuhkan oleh skrip verifikasi.
 */
const PAIRS = [
  {
    login: "triase_app_login",
    groups: ["triase_app"],
    urlVar: "DATABASE_URL",
    purpose: "proses aplikasi runtime (Next.js)",
    envVar: "TRIASE_APP_PASSWORD",
  },
  {
    login: "triase_ddl_login",
    groups: ["triase_migrator"],
    urlVar: "DATABASE_MIGRATION_URL",
    purpose: "proses migrasi (npm run db:migrate)",
    envVar: "TRIASE_DDL_PASSWORD",
  },
  {
    login: "triase_verify_login",
    groups: ["triase_app", "triase_auditor", "triase_fixture"],
    urlVar: "DATABASE_VERIFY_URL",
    purpose: "skrip verifikasi keamanan (npm run db:verify)",
    envVar: "TRIASE_VERIFY_PASSWORD",
  },
  {
    login: "triase_retention_login",
    groups: ["triase_maintenance"],
    urlVar: "DATABASE_RETENTION_URL",
    purpose: "job retensi terjadwal",
    envVar: "TRIASE_RETENTION_PASSWORD",
  },
] as const;

const FORBIDDEN_DATABASES = new Set(["postgres", "template0", "template1"]);

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Nama peran divalidasi sebelum dipakai di SQL apa pun. */
function assertValidRoleName(name: string, label: string): void {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`${label} tidak valid: ${name}`);
  }
}

async function main(): Promise<void> {
  const connectionString = requireEnv(
    "DATABASE_ADMIN_URL",
    "koneksi admin (CREATEROLE) untuk membuat dan merotasi peran LOGIN",
  );

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const dbInfo = await client.query<{
      current_database: string;
      has_admin: boolean;
    }>(
      `SELECT current_database() AS current_database,
              (SELECT rolsuper OR rolcreaterole FROM pg_roles WHERE rolname = current_user) AS has_admin`,
    );
    const currentDatabase = dbInfo.rows[0]?.current_database ?? "";

    if (FORBIDDEN_DATABASES.has(currentDatabase)) {
      throw new Error(
        `Menolak menjalankan di database "${currentDatabase}". ` +
          `Skrip ini hanya boleh dijalankan pada database aplikasi.`,
      );
    }

    // Kegagalan hak di sini akan muncul sebagai "permission denied for
    // role" yang membingungkan 10 baris kemudian, jadi dicek lebih dulu.
    if (dbInfo.rows[0]?.has_admin !== true) {
      throw new Error(
        `Pengguna "${client.user ?? "?"}" tidak punya SUPERUSER atau CREATEROLE. ` +
          `DATABASE_ADMIN_URL harus menunjuk kredensial admin, bukan triase_ddl_login.`,
      );
    }

    // SCRAM untuk sesi ini juga, supaya kata sandi baru tidak pernah
    // tersimpan apa adanya.
    await client.query("SET password_encryption = 'scram-sha-256'");

    const created: string[] = [];
    const rotated: string[] = [];

    for (const pair of PAIRS) {
      assertValidRoleName(pair.login, "Nama peran LOGIN");

      const password = process.env[pair.envVar];

      if (!password || password.length < 16) {
        throw new Error(
          `${pair.envVar} belum disetel atau terlalu pendek (minimal 16 karakter).\n` +
            `  Peran "${pair.login}" dipakai untuk: ${pair.purpose}`,
        );
      }

      for (const group of pair.groups) {
        assertValidRoleName(group, "Nama peran hak");

        const groupCheck = await client.query(
          "SELECT 1 FROM pg_roles WHERE rolname = $1 AND NOT rolcanlogin",
          [group],
        );

        if (groupCheck.rowCount === 0) {
          throw new Error(
            `Peran hak "${group}" belum ada atau bisa login.\n` +
              `  Jalankan migrasi sampai 0031 terlebih dahulu: npm run db:migrate -- --to 0031`,
          );
        }
      }

      const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [
        pair.login,
      ]);

      // CREATE ROLE tidak menerima parameter untuk password, jadi
      // pernyataan harus dirakit. Nama peran sudah divalidasi di atas
      // sehingga tidak ada injeksi lewat nama peran.
      if (exists.rowCount === 0) {
        await client.query(
          `CREATE ROLE ${quoteIdent(pair.login)} ` +
            `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION INHERIT ` +
            `PASSWORD ${quoteLiteral(password)}`,
        );
        created.push(pair.login);
      } else {
        // Peran sudah ada: rotasi kata sandinya agar tetap sinkron.
        await client.query(
          `ALTER ROLE ${quoteIdent(pair.login)} ` +
            `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION INHERIT ` +
            `PASSWORD ${quoteLiteral(password)}`,
        );
        rotated.push(pair.login);
      }

      // Tarik semua keanggotaan peran hak yang diketahui skrip ini,
      // lalu pasang kembali yang benar. Ini membuat rotasi tidak
      // menyisakan jalur lama.
      for (const group of [
        "triase_app",
        "triase_auditor",
        "triase_maintenance",
        "triase_migrator",
        "triase_fixture",
      ]) {
        await client.query(
          `REVOKE ${quoteIdent(group)} FROM ${quoteIdent(pair.login)}`,
        );
      }

      for (const group of pair.groups) {
        await client.query(
          `GRANT ${quoteIdent(group)} TO ${quoteIdent(pair.login)}`,
        );
      }

      process.stdout.write(
        `  [ok] ${pair.login} -> ${pair.groups.join(", ")}  (${pair.purpose})\n`,
      );
    }

    process.stdout.write(
      `\nSelesai. ${created.length} peran dibuat, ${rotated.length} kata sandi dirotasi.\n` +
        `Isi nilai berikut di .env.local:\n` +
        PAIRS.map(
          (p) =>
            `  ${p.urlVar} untuk ${p.purpose}: postgresql://${p.login}:<password>@localhost:5432/${currentDatabase}`,
        ).join("\n") +
        "\n",
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `[db:roles] gagal: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
