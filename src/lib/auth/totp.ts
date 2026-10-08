import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Panjang standar RFC 6238. */
export const TOTP_TIME_STEP_SECONDS = 30;

/** Jumlah digit kode TOTP. */
export const TOTP_DIGITS = 6;

export function generateTotpSecret(): string {
  return randomBytes(20).toString("hex");
}

function generateCounter(timestamp: number, timeStepSeconds: number): number {
  return Math.floor(timestamp / 1000 / timeStepSeconds);
}

export function generateTotp(secret: string, timeStepSeconds = TOTP_TIME_STEP_SECONDS): string {
  const counter = generateCounter(Date.now(), timeStepSeconds);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(0, 0);
  counterBuffer.writeUInt32BE(counter, 4);

  const hash = createHmac("sha1", secret)
    .update(counterBuffer)
    .digest();

  const lastByte = hash[hash.length - 1];
  if (lastByte === undefined) {
    throw new Error("Gagal menghasilkan kode TOTP.");
  }

  const offset = lastByte & 0x0f;
  const byte1 = hash[offset];
  const byte2 = hash[offset + 1];
  const byte3 = hash[offset + 2];
  const byte4 = hash[offset + 3];

  if (byte1 === undefined || byte2 === undefined || byte3 === undefined || byte4 === undefined) {
    throw new Error("Gagal menghasilkan kode TOTP.");
  }

  const binary = ((byte1 & 0x7f) << 24) |
    ((byte2 & 0xff) << 16) |
    ((byte3 & 0xff) << 8) |
    (byte4 & 0xff);

  const otp = binary % 10 ** TOTP_DIGITS;
  return String(otp).padStart(TOTP_DIGITS, "0");
}

export function verifyTotp(
  secret: string,
  candidate: string,
  window = 1,
  timeStepSeconds = TOTP_TIME_STEP_SECONDS,
): boolean {
  const normalized = candidate.replace(/\s+/g, "");
  const isSixDigits = new RegExp(`^[0-9]{${TOTP_DIGITS}}$`).test(normalized);
  const comparison = isSixDigits ? normalized : "";

  if (!comparison) {
    return false;
  }

  const stepMs = timeStepSeconds * 1000;

  for (let offset = -window; offset <= window; offset += 1) {
    const time = Date.now() + offset * stepMs;
    const counter = Math.floor(time / 1000 / timeStepSeconds);
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeUInt32BE(0, 0);
    counterBuffer.writeUInt32BE(counter, 4);

    const hash = createHmac("sha1", secret)
      .update(counterBuffer)
      .digest();

    const lastByte = hash[hash.length - 1];
    if (lastByte === undefined) {
      continue;
    }

    const index = lastByte & 0x0f;
    const byte1 = hash[index];
    const byte2 = hash[index + 1];
    const byte3 = hash[index + 2];
    const byte4 = hash[index + 3];

    if (byte1 === undefined || byte2 === undefined || byte3 === undefined || byte4 === undefined) {
      continue;
    }

    const binary = ((byte1 & 0x7f) << 24) |
      ((byte2 & 0xff) << 16) |
      ((byte3 & 0xff) << 8) |
      (byte4 & 0xff);

    const otp = String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
    const expected = Buffer.from(otp, "utf8");
    const actual = Buffer.from(comparison, "utf8");

    if (timingSafeEqual(expected, actual)) {
      return true;
    }
  }

  return false;
}
