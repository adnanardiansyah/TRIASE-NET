import { z } from "zod";
import { ADUAN_CATEGORY, ADUAN_STATUS } from "@/lib/domain/enums";
import { ApiError } from "./errors";

export const createTicketSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  category: z.enum(ADUAN_CATEGORY),
  body: z.string().trim().min(1).max(8000),
}).strict();

export const changeStatusSchema = z.object({
  status: z.enum(ADUAN_STATUS),
  expectedVersion: z.number().int().nonnegative(),
}).strict();

export const replySchema = z.object({
  body: z.string().trim().min(1).max(4000),
  clientId: z.string().uuid(),
}).strict();

export const ticketCodeSchema = z.string().trim().toUpperCase().regex(/^TRX-[0-9]{4}-[A-Z0-9]{8}$/);
export const decryptSchema = z.object({ ticket: ticketCodeSchema }).strict();
export const stepUpSchema = z.object({ otp: z.string().regex(/^\d{6}$/) }).strict();
export const loginSchema = z.union([
  z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(1).max(256) }).strict(),
  z.object({ challengeId: z.string().uuid(), otp: z.string().regex(/^\d{6}$/) }).strict(),
]);

export async function readJson<T>(request: Request, schema: z.ZodType<T>, maxBytes = 48_000): Promise<T> {
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    throw new ApiError(415, "Permintaan harus berupa JSON.");
  }
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new ApiError(413, "Permintaan terlalu besar.");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "Isi permintaan wajib diisi.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ApiError(413, "Permintaan terlalu besar.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ApiError(400, "JSON tidak valid."); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "Data tidak valid. Periksa kolom dan batas panjang isian.", "VALIDATION_ERROR");
  return parsed.data;
}

export function readTicketCode(value: string): string {
  const parsed = ticketCodeSchema.safeParse(value);
  if (!parsed.success) throw new ApiError(404, "Tiket tidak ditemukan.");
  return parsed.data;
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new ApiError(403, "Asal permintaan tidak diizinkan.");
  }
}
