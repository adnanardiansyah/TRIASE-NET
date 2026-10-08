/**
 * Pembatas laju in-memory untuk endpoint autentikasi.
 *
 * Ini lapisan pertahanan pertama, bukan pengganti penyimpanan penghitung yang
 * dibagikan antar-instance. Pada deployment multi-instance, setiap instance
 * punya salinan sendiri; penghitung yang benar-benar bersama akan perlu Redis
 * atau tabel `mfa_challenges` / `users.failed_login_count`.
 *
 * Yang dilindungi di sini adalah penyerangan satu proses: mencoba semua
 * kemungkinan kata sandi atau kode TOTP secara cepat dari satu sumber.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Buang bucket kedaluwarsa agar Map tidak tumbuh tanpa batas. */
function sweep(now: number): void {
  if (buckets.size < 512) {
    return;
  }

  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Mencatat satu percobaan terhadap `key` dan melaporkan apakah masih diizinkan.
 *
 * `limit` adalah jumlah percobaan yang boleh dipakai dalam satu jendela waktu.
 * Panggilan yang melewati limit tetap dihitung, sehingga penunggu tidak bisa
 * memperpanjang blokir hanya dengan terus mencoba.
 */
export function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return {
      allowed: true,
      remaining: limit - 1,
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }

  existing.count += 1;

  return {
    allowed: existing.count <= limit,
    remaining: Math.max(0, limit - existing.count),
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

/** Menghapus penghitung setelah autentikasi berhasil. */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/** Dipakai tes. */
export function __resetRateLimits(): void {
  buckets.clear();
}

/** Kunci penghitung berdasarkan alamat IP dan identitas yang dicoba. */
export function buildRateLimitKeys(ip: string, identity: string): string[] {
  return [`auth:ip:${ip}`, `auth:identity:${identity}`];
}

export function getClientIp(request: {
  headers: { get(name: string): string | null };
}): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const direct = request.headers.get("x-real-ip");

  if (forwarded) {
    const first = forwarded.split(",")[0];
    if (first) return first.trim();
  }

  return direct?.trim() || "unknown";
}