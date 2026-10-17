import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/api/errors";
import { assertSameOrigin, readJson } from "@/lib/api/validation";
import { consumeRateLimit, getClientIp } from "@/lib/auth/rate-limit";
import { registrationSchema } from "@/lib/auth/schemas";
import { authCommand, newEmailToken, passwordHash } from "@/lib/auth/real-accounts";
import { mailConfiguration } from "@/lib/auth/email";
import { accountMailPayload } from "@/lib/auth/mail-outbox";
export const runtime="nodejs";
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    if (!(await consumeRateLimit(`register:${getClientIp(request)}`, 5, 900000)).allowed) throw new ApiError(429,"Terlalu banyak percobaan. Tunggu 15 menit.");
    const { email, password } = await readJson(request, registrationSchema, 4096);
    if (!(await consumeRateLimit(`email-request:${email}`,5,900000)).allowed) throw new ApiError(429,"Terlalu banyak percobaan. Coba kembali nanti.");
    mailConfiguration();
    const domains = (process.env.STUDENT_EMAIL_DOMAINS ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    if (domains.length && !domains.includes(email.split("@")[1]!)) throw new ApiError(400, "Gunakan email kampus yang diizinkan.");
    const token = newEmailToken();
    await authCommand<boolean>("register", { email, hash: await passwordHash(password), token_hash: token.hash, ...accountMailPayload(email,token.raw,"verify") });

    return NextResponse.json({ ok: true, message: "Jika pendaftaran dapat diproses, tautan verifikasi akan dikirim ke email Anda. Periksa inbox dan spam." }, {headers:{"Cache-Control":"no-store"}});
  } catch (error) { return apiErrorResponse(error); }
}
