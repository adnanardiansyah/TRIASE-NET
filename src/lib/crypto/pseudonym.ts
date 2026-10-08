import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Pembuat pseudonim dan sidik jari.
 *
 * Semua nilai di sini dimaksudkan tidak dapat dibalik dan tidak dapat ditebak:
 *   - pseudonim memakai HMAC-SHA256 dengan kunci dari environment, sehingga
 *     admin basis data yang hanya punya isi tabel tidak dapat memetakan
 *     pseudonim kembali ke identitas asli;
 *   - id tiket memakai `randomBytes`, bukan `Math.random()`, karena `Math.random`
 *     tidak menghasilkan entropi yang cukup dan bisa ditebak;
 *   - sidik jari memakai SHA-256 dan disimpan sebagai hex penuh, bukan dipotong
 *     ke 16 karakter base64 seperti sebelumnya. Pemotongan base64 bukan
* penyandian: `Buffer.from(v, "base64")` membalikkan nilainya persis. Sekarang
 * nilainya benar-benar tidak dapat dibalik.
 */

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // tanpa I, L, O, U

export function getPseudonymHmacKey(): string {
  const configured = process.env.PSEUDONYM_HMAC_KEY_BASE64;

  if (configured && configured.length > 0) {
    return configured;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "PSEUDONYM_HMAC_KEY_BASE64 wajib disetel di produksi. Tanpa kunci itu " +
        "pseudonim hanya berupa deretan acak yang tidak mengikat apa pun.",
    );
  }

  return "dGVzdC1wa2V1ZG9ueW0taG1hYy1rZXktMzItYnl0ZXMhISE=";
}

function randomToken(length: number): string {
  const bytes = randomBytes(length);
  let result = "";

  for (let index = 0; index < length; index += 1) {
    const byte = bytes[index];
    if (byte === undefined) continue;
    result += ALPHABET[byte % ALPHABET.length];
  }

  return result;
}

export function createPseudonym(prefix = "PSA"): string {
  return `${prefix}${randomToken(16)}`;
}

export function createTicketId(prefix = "TR"): string {
  return `${prefix}-${randomToken(10)}`;
}

/** HMAC-SHA256 deterministik atas sebuah identitas. */
export function createPseudonymId(identity: string, prefix = "PSA"): string {
  const digest = createHmac("sha256", getPseudonymHmacKey())
    .update(identity, "utf8")
    .digest("hex");

  return `${prefix}${digest.slice(0, 24).toUpperCase()}`;
}

/**
 * Sidik jari perangkat dalam hex SHA-256 penuh.
 *
 * Fungsi ini dulu bernama `createHashFingerprint` tetapi hanya melakukan
 * base64-encode lalu dipotong 16 karakter. Base64 adalah penyandian, bukan
 * hash: `Buffer.from(v, "base64")` mengembalikan nilai aslinya persis. Sekarang
 * nilainya benar-benar tidak dapat dibalik.
 */
export function createHashFingerprint(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function verifyHashFingerprint(value: string, expectedHex: string): boolean {
  const actual = Buffer.from(createHashFingerprint(value), "hex");
  const expected = Buffer.from(expectedHex, "hex");

  if (actual.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(actual, expected);
}