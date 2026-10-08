/**
 * Barrel ekspor untuk lapisan basis data.
 *
 * Semua klien basis data tinggal di `client.ts` supaya hanya ada satu pool dan
 * satu sumber konfigurasi. Modul ini sengaja tidak lagi membuat `Pool` sendiri:
 *
 *   - Pool yang dibuat di sini bersifat eager, sehingga `next build` mencoba
 *     membuka koneksi ke database.
 *   - Modul ini pernah memuat kredensial sebagai nilai cadangan. Kredensial
 *     tidak boleh ditulis di dalam source code; kalau `DATABASE_URL` kosong,
 *     pemanggil harus gagal dengan jelas, bukan diam-diam memakai kredensial
 *     yang tertanam.
 *
 * Helper `query(sql: string, ...)` juga dihapus. Jalur itu menerima SQL mentah
 * sebagai string, bertentangan dengan aturan proyek: query hanya lewat Kysely
 * dengan prepared parameter, dan tidak ada query string mentah.
 */

export {
  checkConnection,
  closeDb,
  getDb,
  getPool,
  withActorContext,
  withTransaction,
  type ActorContext,
} from "./client";

export type { Database } from "./types";