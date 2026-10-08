/**
 * Klien basis data type-safe berbasis Kysely.
 *
 * Prinsip:
 *   1. Lazy singleton. Pool hanya dibuat ketika benar-benar dibutuhkan, agar
 *      `next build` tidak mencoba koneksi ke basis data.
 *   2. Role `triase_app` adalah satu-satunya role yang boleh dipakai runtime.
 *      Script migrasi memakai DATABASE_URL dari env yang sama tetapi dijalankan
 *      sebagai `triase_migrator`.
 *   3. Semua query wajib dibungkus `withActorContext` bila menyentuh tabel
 *      yang dilindungi RLS.
 */

import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, type PoolConfig } from "pg";

import type { AppRole } from "@/lib/domain/enums";
import type { Database } from "@/lib/db/types";

declare global {
  var __triaseDb: Kysely<Database> | undefined;
  var __triasePool: Pool | undefined;
}

/** Konteks aktor yang dipasang pada setiap transaksi. */
export interface ActorContext {
  userId: string | null;
  role: AppRole;
  pseudonymId?: string | null;
  sessionId?: string | null;
}

function readConnectionConfig(): PoolConfig {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL belum disetel. Salin .env.example menjadi .env.local lalu isi nilainya.",
    );
  }

  const max = Number.parseInt(process.env.DATABASE_POOL_MAX ?? "10", 10);
  const useSsl = process.env.DATABASE_SSL === "true";

  return {
    connectionString,
    max: Number.isFinite(max) && max > 0 ? max : 10,
    // Jalur produksi: basis data berada di jaringan privat/VPC.
    ssl: useSsl ? { rejectUnauthorized: true } : undefined,
    // Nama aplikasi pada log koneksi agar mudah disaring.
    application_name: "triase-net-app",
  };
}

function createPool(): Pool {
  return new Pool(readConnectionConfig());
}

/** Pool yang dipakai runtime. Dibuat sekali per proses. */
export function getPool(): Pool {
  if (!globalThis.__triasePool) {
    globalThis.__triasePool = createPool();
  }
  return globalThis.__triasePool;
}

/** Instans Kysely yang di-share. */
export function getDb(): Kysely<Database> {
  if (!globalThis.__triaseDb) {
    globalThis.__triaseDb = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: getPool() }),
    });
  }
  return globalThis.__triaseDb;
}

/**
 * Menjalankan `callback` di dalam transaksi yang sudah memasang konteks ZTNA.
 *
 * Karena `set_config(..., true)` bersifat lokal-transaksi, pengaturan akan
 * hilang otomatis saat COMMIT/ROLLBACK. Ini penting karena aplikasi memakai
 * connection pool: tanpa sifat lokal, identitas aktor bisa bocor ke request
 * berikutnya yang memakai koneksi yang sama.
 */
export async function withActorContext<T>(
  actor: ActorContext,
  callback: (trx: Kysely<Database>) => Promise<T>,
): Promise<T> {
  const db = getDb();

  return db.transaction().execute(async (trx) => {
    await sql`SELECT public.fn_ztna_set_actor_context(
      ${actor.userId}::uuid,
      ${actor.role}::public.app_role,
      ${actor.pseudonymId ?? null},
      ${actor.sessionId ?? null}::uuid
    )`.execute(trx);

    return callback(trx);
  });
}

/** Transaksi biasa tanpa konteks aktor (hanya untuk jalur publik terbatas). */
export async function withTransaction<T>(
  callback: (trx: Kysely<Database>) => Promise<T>,
): Promise<T> {
  return getDb().transaction().execute(callback);
}

/** Pemeriksaan kesehatan koneksi. Dipakai `npm run db:verify`. */
export async function checkConnection(): Promise<{
  ok: boolean;
  serverVersion: string;
  currentUser: string;
  error?: string;
}> {
  try {
    const result = await sql<{ server_version: string; current_user: string }>`
      SELECT current_setting('server_version') AS server_version,
             current_user
    `.execute(getDb());

    const row = result.rows[0];

    return {
      ok: true,
      serverVersion: row?.server_version ?? "unknown",
      currentUser: row?.current_user ?? "unknown",
    };
  } catch (error) {
    return {
      ok: false,
      serverVersion: "",
      currentUser: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Menutup pool. Dipanggil pada shutdown dan pada skrip one-shot. */
export async function closeDb(): Promise<void> {
  if (globalThis.__triaseDb) {
    await globalThis.__triaseDb.destroy();
    globalThis.__triaseDb = undefined;
  }
  if (globalThis.__triasePool) {
    await globalThis.__triasePool.end();
    globalThis.__triasePool = undefined;
  }
}
