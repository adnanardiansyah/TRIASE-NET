import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { getPool } from "@/lib/db/client";
import { ApiError } from "@/lib/api/errors";
import type { SessionRole } from "./jwt";

export interface AuthAccount { id: string; email: string; role: SessionRole; name: string | null; version: number; hash?: string; sealed?: string | null; counter?: number; recoveryCreated?: boolean }
export async function authCommand<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  const result = await getPool().query<{ result: T }>("SELECT public.fn_account_auth($1,$2::jsonb) AS result", [action, JSON.stringify(payload)]);
  return result.rows[0]!.result;
}
export function tokenHash(token: string): string { return createHash("sha256").update(token).digest("hex"); }
export function newEmailToken() { const raw = randomBytes(32).toString("base64url"); return { raw, hash: tokenHash(raw) }; }
export function passwordHash(password: string): Promise<string> { return hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 }); }
// One fixed-cost dummy hash also covers unknown accounts without plaintext fallbacks.
let dummy: Promise<string> | undefined;
export async function passwordMatches(account: AuthAccount | null, password: string): Promise<boolean> {
  dummy ??= passwordHash(randomBytes(32).toString("hex"));
  const valid = await verify(account?.hash ?? await dummy, password);
  return !!account && valid;
}
function authKey(): Buffer {
  const key = Buffer.from(process.env.AUTH_ENCRYPTION_KEY_BASE64 ?? "", "base64");
  if (key.length !== 32 || key.toString("base64") !== process.env.AUTH_ENCRYPTION_KEY_BASE64) throw new ApiError(503, "Kunci keamanan autentikator belum dikonfigurasi.", "AUTH_CONFIG_MISSING");
  return key;
}
export function sealTotp(secret: string, userId: string): string {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", authKey(), iv); cipher.setAAD(Buffer.from(`triase-auth-v1:${userId}`));
  return [iv.toString("base64"), Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]).toString("base64"), cipher.getAuthTag().toString("base64")].filter(Boolean).join(".");
}
export function openTotp(sealed: string, userId: string): string {
  const [iv, body, tag] = sealed.split("."); if (!iv || !body || !tag) throw new ApiError(503, "Data autentikator tidak valid.");
  const decipher = createDecipheriv("aes-256-gcm", authKey(), Buffer.from(iv, "base64")); decipher.setAAD(Buffer.from(`triase-auth-v1:${userId}`)); decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
}
