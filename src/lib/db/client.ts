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

import "server-only";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, type PoolConfig } from "pg";
import { attachDatabasePool } from "@vercel/functions";

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

  const max = Number.parseInt(process.env.DATABASE_POOL_MAX ?? (process.env.VERCEL === "1" ? "3" : "10"), 10);
  const url = new URL(connectionString);
  const sslMode=url.searchParams.get("sslmode");
  const useSsl = process.env.DATABASE_SSL === "true" || sslMode === "verify-full" || sslMode === "require";
  if(process.env.NODE_ENV==="production" && !["localhost","127.0.0.1","[::1]"].includes(url.hostname) && !useSsl) throw new Error("PostgreSQL produksi wajib memakai TLS terverifikasi.");
  // pg connection-string SSL flags can override verification; use explicit TLS config.
  for(const name of ["sslmode","sslcert","sslkey","sslrootcert"])url.searchParams.delete(name);

  return {
    connectionString: url.toString(),
    max: Number.isFinite(max) && max > 0 ? max : 10,
    // Jalur produksi: basis data berada di jaringan privat/VPC.
    ssl: useSsl ? { rejectUnauthorized: true } : undefined,
    // Nama aplikasi pada log koneksi agar mudah disaring.
    application_name: "triase-net-app",
    idleTimeoutMillis: 10000,
    allowExitOnIdle: true,
    query_timeout: 17000,
    idle_in_transaction_session_timeout: 15000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
  };
}

function createPool(): Pool {
  return new Pool({
    ...readConnectionConfig(),
    verify: (client, done) => {
      client.query<{ safe: boolean }>(`SELECT NOT rolsuper AND NOT rolbypassrls
        AND NOT rolcreaterole AND pg_has_role(current_user, 'triase_app', 'MEMBER')
        AND NOT pg_has_role(current_user, 'triase_migrator', 'MEMBER')
        AND NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.aduan'::regclass
          AND pg_has_role(current_user, relowner, 'USAGE')) AS safe
        FROM pg_roles WHERE rolname = current_user`, (error, result) => {
        if (error) return done(error);
        if (!result.rows[0]?.safe) return done(new Error("DATABASE_URL harus memakai akun runtime non-superuser anggota triase_app."));
        done();
      });
    },
  });
}

/** Pool yang dipakai runtime. Dibuat sekali per proses. */
export function getPool(): Pool {
  if (!globalThis.__triasePool) {
    globalThis.__triasePool = createPool();
    if(process.env.VERCEL==="1")attachDatabasePool(globalThis.__triasePool);
    globalThis.__triasePool.on("error",()=>console.error("[db] Idle connection failed"));
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
  else if (globalThis.__triasePool) {
    await globalThis.__triasePool.end();
  }
  globalThis.__triasePool = undefined;
}
