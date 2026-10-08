/**
 * Menjalankan berkas SQL seed pengembangan, lalu memberi tahu langkah
 * berikutnya.
 *
 * Kenapa perlu skrip terpisah:
 *
 *   `database/seeds/0001_dev_seed.sql` menuliskan akun satuan tugas,
 *   profil kewenangannya, dan material KEK pengembangan. Berkas itu
 *   TIDAK boleh dijalankan oleh `npm run db:migrate` untuk tiga alasan:
 *
 *     - Ia bukan migrasi. Menjalankannya ulang pada database yang sudah
 *       terisi akan bentrok dengan data, bukan dengan aman.
 *     - Ia menyertakan `key_material` KEK yang hanya boleh ada di
 *       pengembangan. Memb-biarkan berkas ini ikut berada di jalur
 *       migrasi berarti ada satu perintah yang terlihat aman tetapi
 *       menyimpan kunci di produksi.
 *     - Ia tidak boleh ikut di-commit sebagai riwayat skema.
 *
 *   Sebaliknya `npm run db:seed` (scripts/seed.ts) TIDAK bisa
 *   menjalankan berkas SQL itu sendiri, karena berkas SQL butuh hak
 *   INSERT ke `kek_versions` beserta `key_material`, sedangkan
 *   `password_hash` harus dihitung dengan Argon2id dan dicetak sekali
 *   ke terminal. Keduanya memang dua pekerjaan terpisah.
 *
 *   tanpa pemisah itu, `npm run db:seed` selalu gagal dengan
 *   "akun tidak ditemukan" dan tidak ada yang memberi tahu penyebabnya.
 *
 * URUTAN YANG BENAR
 *   1. npm run db:migrate        -> skema
 *   2. npm run db:seed:sql       -> akun, profil, KEK pengembangan
 *   3. npm run db:seed           -> hash Argon2id + cetak kredensial
 *
 * KEAMANAN
 *   - Menolak jalan bila NODE_ENV=production.
 *   - Menolak jalan bila target database adalah `postgres`, `template0`,
 *     atau `template1`.
 *   - Menolak jalan bila file seed yang akan dibaca adalah nama yang
 *     tidak dikenal. Nama diambil dari direktori seed, bukan dari
 *     argumen baris perintah, sehingga tidak ada jalur untuk membaca
 *     berkas sembarang.
 *   - Setiap berkas dijalankan dalam transaksinya sendiri, jadi berkas
 *     gagal tidak meninggalkan keadaan setengah jadi.
 */

import { loadEnvFiles, requireEnv } from "./lib/env.js";

import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

loadEnvFiles();

const HERE = dirname(fileURLToPath(import.meta.url));
const SEEDS_DIR = join(HERE, "..", "database", "seeds");

const FORBIDDEN_DATABASES = new Set(["postgres", "template0", "template1"]);

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("db:seed:sql ditolak pada NODE_ENV=production.");
  }

  const connectionString = requireEnv(
    "DATABASE_ADMIN_URL",
    "koneksi admin untuk menulis data seed pengembangan",
  );

  const entries = (await readdir(SEEDS_DIR))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  if (entries.length === 0) {
    throw new Error(`Tidak ada berkas .sql di ${SEEDS_DIR}.`);
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const info = await client.query<{ current_database: string }>(
      "SELECT current_database() AS current_database",
    );
    const currentDatabase = info.rows[0]?.current_database ?? "";

    if (FORBIDDEN_DATABASES.has(currentDatabase)) {
      throw new Error(
        `Menolak menjalankan di database "${currentDatabase}". ` +
          `Seed pengembangan hanya boleh berjalan pada database aplikasi.`,
      );
    }

    console.log(`[seed:sql] database : ${currentDatabase}`);
    console.log(`[seed:sql] direktori: ${SEEDS_DIR}`);
    console.log(`[seed:sql] berkas   : ${entries.join(", ")}`);
    console.log("");

    for (const entry of entries) {
      const sql = await readFile(join(SEEDS_DIR, entry), "utf8");

      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("COMMIT");
        console.log(`  [ok]   ${entry}`);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        const message = error instanceof Error ? error.message : String(error);
        console.error(`  [FAIL] ${entry}`);
        console.error(`         ${message}`);
        throw new Error(
          `Seed ${entry} gagal dan telah dibatalkan (rollback).`,
        );
      }
    }

    console.log("");
    console.log(
      "Langkah berikutnya: jalankan `npm run db:seed` untuk membuat hash\n" +
        "Argon2id dan mencetak kredensial uji sekali ke terminal.",
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `[db:seed:sql] gagal: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
