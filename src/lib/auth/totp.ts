import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
export const TOTP_TIME_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function encodeBase32(bytes: Buffer): string {
  let bits = 0, value = 0, output = "";
  for (const byte of bytes) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { output += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}
function decodeBase32(secret: string): Buffer {
  let bits = 0, value = 0; const output: number[] = [];
  for (const char of secret.toUpperCase().replace(/=+$/, "")) { const index = ALPHABET.indexOf(char); if (index < 0) throw new Error("Invalid authenticator secret"); value = (value << 5) | index; bits += 5; if (bits >= 8) { output.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(output);
}
export function generateTotpSecret(): string { return encodeBase32(randomBytes(20)); }
export function totpAt(secret: string, timestamp: number, step = 30, digits = 6): string {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(timestamp / 1000 / step)));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counter).digest(); const offset = digest[digest.length - 1]! & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits).padStart(digits, "0");
}
export function generateTotp(secret: string, step = 30): string { return totpAt(secret, Date.now(), step); }
export function matchingTotpCounter(secret: string, candidate: string, timestamp = Date.now(), window = 1, step = 30): number | null {
  if (!/^\d{6}$/.test(candidate)) return null;
  for (let delta = -window; delta <= window; delta++) { const time = timestamp + delta * step * 1000; if (time < 0) continue; if (timingSafeEqual(Buffer.from(totpAt(secret, time, step)), Buffer.from(candidate))) return Math.floor(time / 1000 / step); }
  return null;
}
export function verifyTotp(secret: string, candidate: string, window = 1, step = 30): boolean { return matchingTotpCounter(secret, candidate, Date.now(), window, step) !== null; }
