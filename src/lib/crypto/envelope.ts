import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface EncryptedEnvelope {
  ciphertext: string;
  iv: string;
  tag: string;
  keyId: string;
}

const ALGORITHM = "aes-256-gcm";

export function createEnvelope(
  keyMaterial: Buffer,
  plaintext: string,
  keyId = "kek-001",
): EncryptedEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, keyMaterial, iv, { authTagLength: 16 });
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, "utf8")), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: tag.toString("base64url"),
    keyId,
  };
}

export function decryptEnvelope(
  keyMaterial: Buffer,
  envelope: EncryptedEnvelope,
): string {
  const decipher = createDecipheriv(ALGORITHM, keyMaterial, Buffer.from(envelope.iv, "base64url"), {
    authTagLength: 16,
  });

  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  const payload = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
    decipher.final(),
  ]);

  return payload.toString("utf8");
}
