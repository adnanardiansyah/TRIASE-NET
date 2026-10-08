/**
 * Runner migrasi SQL untuk TRIASE-Net.
 *
 * Sifat penting:
 *   - Setiap berkas dijalankan dalam SATU transaksi. Bila ada galat sintaks
 *     di tengah, seluruh berkas dibatalkan sehingga skema tidak pernah berada
 *     pada keadaan setengah jadi.
 *   - `schema_migrations` mencatat checksum. Bila berkas yang sudah pernah
 *     diterapkan lalu diubah isinya, runner berhenti dan memberi peringatan
 *     alih-alih diam-diam membuat skema tidak konsisten.
 *
 * Jalankan:  npm run db:migrate
 */

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";

import { loadEnvFiles } from "./lib/env.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(HERE, "..", "database", "migrations");

loadEnvFiles();

interface AppliedRow {
  version: string;
  checksum: string;
}

async function connect(): Promise<Kysely<unknown>> {
  // Migrasi adalah operasi DDL, jadi ia memakai URL DDL, bukan URL
  // runtime. `DATABASE_URL` (peran aplikasi) sengaja tidak punya hak
  // membuat skema; mencampur keduanya membuat pemisahan hak akses antara
  // build dan runtime tidak berarti apa pun.
  //
  // DATABASE_URL tetap diterima sebagai cadangan supaya alur lama tidak
  // langsung rusak, tetapi migrasi memberi peringatan.
  const usingFallback = process.env.DATABASE_MIGRATION_URL === undefined;
  const connectionString =
    process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_MIGRATION_URL belum disetel.\n" +
        '  $env:DATABASE_MIGRATION_URL = "postgresql://triase_ddl_login:PASS@localhost:5432/triase_net"\n' +
        "  atau isi .env.local lalu jalankan ulang\n" +
        "  Jalankan `npm run db:roles` lebih dulu untuk membuat triase_ddl_login.",
    );
  }

  if (usingFallback) {
    console.warn(
      "[db] DATABASE_MIGRATION_URL belum disetel; memakai DATABASE_URL.\n" +
        "     Proses runtime seharusnya tidak punya hak DDL. Setel DATABASE_MIGRATION_URL.",
    );
  }

  const pool = new Pool({ connectionString, max: 2 });
  pool.on("error", (error) => {
    console.error("[db] error pada pool:", error.message);
  });

  return new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
}

async function ensureBookkeeping(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version      text PRIMARY KEY,
      checksum     text        NOT NULL,
      applied_at   timestamptz NOT NULL DEFAULT now(),
      applied_by   text        NOT NULL DEFAULT current_user,
      execution_ms integer     NOT NULL DEFAULT 0
    )
  `.execute(db);
}

async function listMigrationFiles(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  return entries.filter((name) => name.endsWith(".sql")).sort();
}

function checksumOf(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Membaca batas atas versi dari argumen baris perintah.
 *
 * Dipakai untuk bootstrap database baru: migrasi 0024 ke atas
 * memberikan keanggotaan bagi peran LOGIN yang belum ada, jadi
 * `npm run db:roles` harus berjalan di tengah rangkaian migrasi.
 *
 *     npm run db:migrate -- --to 0023
 *
 * Tanpa batas ini, database baru tidak pernah bisa di-bootstrap karena
 * migrasi akan berhenti di 0024 sebelum peran LOGIN ada.
 */
function parseTargetVersion(argv: string[]): string | null {
  const index = argv.indexOf("--to");

  if (index === -1) {
    return null;
  }

  const value = argv[index + 1];

  if (!value) {
    throw new Error("--to membutuhkan nomor versi, contoh: --to 0023");
  }

  return value;
}

async function run(): Promise<void> {
  const db = await connect();
  const targetVersion = parseTargetVersion(process.argv.slice(2));

  try {
    await ensureBookkeeping(db);

    const applied = await sql<AppliedRow>`
      SELECT version, checksum FROM public.schema_migrations ORDER BY version
    `.execute(db);

    const appliedMap = new Map(applied.rows.map((row) => [row.version, row.checksum]));
    const files = await listMigrationFiles();

    console.log(`[db] direktori migrasi : ${MIGRATIONS_DIR}`);
    console.log(`[db] berkas ditemukan  : ${files.length}`);
    console.log(`[db] sudah diterapkan   : ${appliedMap.size}`);
    if (targetVersion !== null) {
      console.log(`[db] berhenti sampai    : ${targetVersion}`);
    }
    console.log("");

    let executed = 0;
    let reachedTarget = false;

    for (const file of files) {
      const version = file.replace(/\.sql$/, "");
      const content = await readFile(join(MIGRATIONS_DIR, file), "utf8");
      const checksum = checksumOf(content);
      const previous = appliedMap.get(version);

      if (previous !== undefined) {
        if (previous !== checksum) {
          throw new Error(
            `Drift terdeteksi pada ${version}.\n` +
              `  checksum tersimpan : ${previous}\n` +
              `  checksum sekarang  : ${checksum}\n` +
              "Berkas migrasi yang sudah diterapkan tidak boleh diubah. " +
              "Buat migrasi baru sebagai gantinya.",
          );
        }
console.log(`  [skip] ${file}`);
      reachedTarget ||= version.startsWith(`${targetVersion}_`);
      continue;
    }

      const startedAt = Date.now();

      try {
        await db.transaction().execute(async (trx) => {
          await sql.raw(content).execute(trx);
          await sql`
            INSERT INTO public.schema_migrations (version, checksum, execution_ms)
            VALUES (${version}, ${checksum}, ${Date.now() - startedAt})
          `.execute(trx);
        });
      } catch (error) {
        console.error(`  [FAIL] ${file}`);
        const message = error instanceof Error ? error.message : String(error);
        console.error(`         ${message}`);
        throw new Error(
          `Migrasi ${version} gagal dan telah dibatalkan (rollback). Basis data tetap konsisten.`,
        );
      }

      executed += 1;
      console.log(`  [ok]   ${file}  (${Date.now() - startedAt} ms)`);

      // Versi dicocokkan sebagai AWALAN nama berkas, bukan sama persis.
      // Nama berkas sebenarnya adalah `0031_fixture_role_for_verification`,
      // sedangkan yang diketik pengguna adalah `0031`.
      if (targetVersion !== null && version.startsWith(`${targetVersion}_`)) {
        reachedTarget = true;
        break;
      }
    }

    console.log("");

    if (targetVersion !== null) {
      if (!reachedTarget) {
        throw new Error(
          `Versi ${targetVersion} tidak ditemukan di ${MIGRATIONS_DIR}. ` +
            ` Berkas yang ada: ${files.map((f) => f.replace(/\.sql$/, "")).join(", ")}`,
        );
      }
      console.log(
        `[db] berhenti di ${targetVersion}. Jalankan "npm run db:roles" lalu ulangi tanpa --to.`,
      );
    } else {
      console.log(
        executed === 0
          ? "[db] skema sudah paling mutakhir."
          : `[db] selesai. ${executed} migrasi baru diterapkan.`,
      );
    }
  } finally {
    await db.destroy();
  }
}

run().catch((error: unknown) => {
  console.error("");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
