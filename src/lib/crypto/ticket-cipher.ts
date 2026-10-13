import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getRiskBand } from "./adaptive";
import type { CryptoAlgorithm } from "@/lib/domain/enums";

type Cipher = "aes-256-gcm" | "chacha20-poly1305";
export interface CipherLayer {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  wrappedDek: Buffer;
  wrapIv: Buffer;
  wrapTag: Buffer;
  aad: string;
}
export interface AdaptiveCipher {
  algorithm: CryptoAlgorithm;
  primary: CipherLayer;
  outer: CipherLayer | null;
}

function seal(key: Buffer, data: Buffer, aad: string, algorithm: Cipher) {
  const iv = randomBytes(12);
  const cipher = algorithm === "aes-256-gcm"
    ? createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 })
    : createCipheriv("chacha20-poly1305", key, iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(aad), { plaintextLength: data.length });
  return { ciphertext: Buffer.concat([cipher.update(data), cipher.final()]), iv, tag: cipher.getAuthTag() };
}

function open(key: Buffer, data: { ciphertext: Buffer; iv: Buffer; tag: Buffer }, aad: string, algorithm: Cipher) {
  const cipher = algorithm === "aes-256-gcm"
    ? createDecipheriv("aes-256-gcm", key, data.iv, { authTagLength: 16 })
    : createDecipheriv("chacha20-poly1305", key, data.iv, { authTagLength: 16 });
  cipher.setAuthTag(data.tag);
  cipher.setAAD(Buffer.from(aad), { plaintextLength: data.ciphertext.length });
  return Buffer.concat([cipher.update(data.ciphertext), cipher.final()]);
}

function sealLayer(kek: Buffer, plaintext: Buffer, aad: string, algorithm: Cipher): CipherLayer {
  const dek = randomBytes(32);
  try {
    const sealed = seal(dek, plaintext, aad, algorithm);
    const wrapped = seal(kek, dek, `${aad}|dek`, "aes-256-gcm");
    return { ...sealed, wrappedDek: wrapped.ciphertext, wrapIv: wrapped.iv, wrapTag: wrapped.tag, aad };
  } finally { dek.fill(0); }
}

function openLayer(kek: Buffer, layer: CipherLayer, expectedAad: string, algorithm: Cipher, ciphertext = layer.ciphertext) {
  if (layer.aad !== expectedAad) throw new Error("Konteks ciphertext tidak cocok.");
  const dek = open(kek, { ciphertext: layer.wrappedDek, iv: layer.wrapIv, tag: layer.wrapTag }, `${expectedAad}|dek`, "aes-256-gcm");
  try { return open(dek, { ...layer, ciphertext }, expectedAad, algorithm); }
  finally { dek.fill(0); }
}

export function encryptTicketPayload(kek: Buffer, plaintext: string, risk: number, aad: string): AdaptiveCipher {
  if (!Number.isInteger(risk) || risk < 0 || risk > 100) throw new Error("Skor risiko tidak valid.");
  const band = getRiskBand(risk);
  const primary = sealLayer(kek, Buffer.from(plaintext), `${aad}|1`, band === "LOW" ? "aes-256-gcm" : "chacha20-poly1305");
  if (band !== "HIGH") return { algorithm: band === "LOW" ? "AES_256_GCM" : "CHACHA20_POLY1305", primary, outer: null };
  const outer = sealLayer(kek, primary.ciphertext, `${aad}|2`, "aes-256-gcm");
  // Only the outer ciphertext is persisted; the inner ciphertext is recovered during decryption.
  return { algorithm: "HYBRID_DOUBLE", primary: { ...primary, ciphertext: outer.ciphertext }, outer };
}

export function decryptTicketPayload(kek: Buffer, data: AdaptiveCipher, risk: number, aad: string): string {
  const band = getRiskBand(risk);
  const expected = band === "LOW" ? "AES_256_GCM" : band === "MEDIUM" ? "CHACHA20_POLY1305" : "HYBRID_DOUBLE";
  if (data.algorithm !== expected) throw new Error("Algoritma dan risiko tidak cocok.");
  if (band === "HIGH") {
    if (!data.outer || !data.primary.ciphertext.equals(data.outer.ciphertext)) throw new Error("Lapisan hybrid tidak lengkap.");
    const inner = openLayer(kek, data.outer, `${aad}|2`, "aes-256-gcm");
    return openLayer(kek, data.primary, `${aad}|1`, "chacha20-poly1305", inner).toString("utf8");
  }
  if (data.outer) throw new Error("Lapisan tambahan tidak diizinkan.");
  return openLayer(kek, data.primary, `${aad}|1`, band === "LOW" ? "aes-256-gcm" : "chacha20-poly1305").toString("utf8");
}

export function encodeAdaptiveCipher(data: AdaptiveCipher): Record<string, unknown> {
  const encode = (layer: CipherLayer) => Object.fromEntries(Object.entries(layer).map(([k, v]) => [k, Buffer.isBuffer(v) ? v.toString("base64") : v]));
  return { algorithm: data.algorithm, primary: encode(data.primary), outer: data.outer ? encode(data.outer) : null };
}

export function decodeAdaptiveCipher(data: Record<string, unknown>): AdaptiveCipher {
  const decode = (value: unknown): CipherLayer => {
    if (!value || typeof value !== "object") throw new Error("Envelope tidak valid.");
    const row = value as Record<string, unknown>;
    const bytes = (key: string) => {
      if (typeof row[key] !== "string") throw new Error("Envelope tidak valid.");
      return Buffer.from(row[key], "base64");
    };
    if (typeof row.aad !== "string") throw new Error("AAD tidak valid.");
    return { ciphertext: bytes("ciphertext"), iv: bytes("iv"), tag: bytes("tag"), wrappedDek: bytes("wrappedDek"), wrapIv: bytes("wrapIv"), wrapTag: bytes("wrapTag"), aad: row.aad };
  };
  if (!["AES_256_GCM", "CHACHA20_POLY1305", "HYBRID_DOUBLE"].includes(String(data.algorithm))) throw new Error("Algoritma tidak valid.");
  return { algorithm: data.algorithm as CryptoAlgorithm, primary: decode(data.primary), outer: data.outer === null ? null : decode(data.outer) };
}
