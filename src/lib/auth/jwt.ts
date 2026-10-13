import { createHmac, timingSafeEqual } from "node:crypto";

export type SessionRole = "MAHASISWA" | "SATGAS" | "ADMIN";

export const SESSION_ROLES: readonly SessionRole[] = ["MAHASISWA", "SATGAS", "ADMIN"];

export interface SessionClaims {
  sub: string;
  role: SessionRole;
  email?: string;
  userId?: string;
  mfaVerifiedAt?: number;
  deviceHash?: string;
  iat: number;
  exp: number;
}

const SESSION_COOKIE = "triase-session";

/**
 * Rahasia penandatangan token sesi.
 *
 * Nilai cadangan hanya boleh hidup di pengembangan. Di produksi, secret yang
 * hilang harus menggagalkan permintaan dengan pesan eksplisit — bukan diam-diam
 * menandatangani token memakai string yang diketahui publik. Secret cadangan
 * yang tertanam di source code berarti siapa pun yang membaca repository bisa
 * membuat token sesi untuk role mana pun.
 */
function getJwtSecret(): string {
  const secret = process.env.JWT_SIGNING_SECRET;

  if (secret && secret.length >= 32) {
    return secret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "JWT_SIGNING_SECRET wajib disetel di produksi (minimal 32 karakter). " +
        "Token sesi tidak boleh ditandatangani dengan nilai cadangan.",
    );
  }

  return "TRIASE_DEV_JWT_SECRET_32_BYTES_LONG";
}

export function encodeBase64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

export function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(signingInput: string): Buffer {
  return createHmac("sha256", getJwtSecret()).update(signingInput).digest();
}

export function issueSessionToken(
  payload: Omit<SessionClaims, "iat" | "exp">,
  ttlMinutes = 60,
): string {
  const now = Math.floor(Date.now() / 1000);
  const claims: SessionClaims = {
    ...payload,
    iat: now,
    exp: now + ttlMinutes * 60,
  };

  const header = encodeBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = encodeBase64Url(JSON.stringify(claims));
  const signingInput = `${header}.${body}`;

  return `${signingInput}.${sign(signingInput).toString("base64url")}`;
}

function parseClaims(payloadPart: string): SessionClaims {
  let parsed: unknown;

  try {
    parsed = JSON.parse(decodeBase64Url(payloadPart));
  } catch {
    throw new Error("Isi token sesi tidak dapat dibaca.");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Isi token sesi tidak valid.");
  }

  const candidate = parsed as Partial<SessionClaims>;

  if (typeof candidate.sub !== "string" || candidate.sub.length === 0) {
    throw new Error("Token sesi tidak memiliki subjek.");
  }

  // Role harus berasal dari daftar yang dikenal. Tanpa validasi ini, token yang
  // ditandatangani dengan role di luar daftar akan membuat `getRoleHomePath`
  // mengembalikan `undefined` dan `new URL(undefined)` melempar galat 500.
  if (!SESSION_ROLES.includes(candidate.role as SessionRole)) {
    throw new Error("Token sesi memiliki role yang tidak dikenal.");
  }

  if (typeof candidate.exp !== "number" || typeof candidate.iat !== "number") {
    throw new Error("Token sesi tidak memiliki klaim waktu yang valid.");
  }

  if (candidate.email !== undefined && typeof candidate.email !== "string") {
    throw new Error("Token sesi memiliki klaim email yang tidak valid.");
  }

  if (candidate.userId !== undefined && (typeof candidate.userId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate.userId))) {
    throw new Error("Identitas sesi tidak valid.");
  }
  if (candidate.deviceHash !== undefined && (typeof candidate.deviceHash !== "string" || !/^[0-9a-f]{64}$/.test(candidate.deviceHash))) {
    throw new Error("Perangkat sesi tidak valid.");
  }
  if (candidate.mfaVerifiedAt !== undefined && (!Number.isFinite(candidate.mfaVerifiedAt) || candidate.mfaVerifiedAt > Math.floor(Date.now() / 1000) + 30)) {
    throw new Error("Waktu MFA tidak valid.");
  }

  return candidate as SessionClaims;
}

export function verifySessionToken(token: string): SessionClaims {
  const parts = token.split(".");

  if (parts.length !== 3) {
    throw new Error("Token sesi tidak valid.");
  }

  const [headerPart, payloadPart, signaturePart] = parts;

  if (!headerPart || !payloadPart || !signaturePart) {
    throw new Error("Token sesi tidak valid.");
  }

  const expected = sign(`${headerPart}.${payloadPart}`);
  const actual = Buffer.from(signaturePart, "base64url");

  // `timingSafeEqual` melempar RangeError bila panjang kedua buffer berbeda.
  // Token dari klien adalah input tak tepercaya, jadi panjang yang berbeda itu
  // condition yang wajar (bukan kondisi yang boleh melempar galat tak terduga).
  if (actual.length !== expected.length || !timingSafeEqual(expected, actual)) {
    throw new Error("Token sesi rusak atau tidak sah.");
  }

  const claims = parseClaims(payloadPart);

  if (claims.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error("Token sesi sudah kadaluarsa.");
  }

  return claims;
}

export { SESSION_COOKIE };
