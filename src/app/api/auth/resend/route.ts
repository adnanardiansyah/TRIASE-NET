import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/api/errors";
import { assertSameOrigin, readJson } from "@/lib/api/validation";
import { consumeRateLimit, getClientIp } from "@/lib/auth/rate-limit";
import { resendSchema } from "@/lib/auth/schemas";
import { authCommand, newEmailToken } from "@/lib/auth/real-accounts";
import { mailConfiguration } from "@/lib/auth/email";
import { accountMailPayload } from "@/lib/auth/mail-outbox";
export const runtime="nodejs";
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    if (!(await consumeRateLimit(`resend:${getClientIp(request)}`, 5, 900000)).allowed) throw new ApiError(429,"Terlalu banyak percobaan. Tunggu 15 menit.");
    const { email } = await readJson(request, resendSchema, 1024);
    if (!(await consumeRateLimit(`email-request:${email}`,5,900000)).allowed) throw new ApiError(429,"Terlalu banyak percobaan. Coba kembali nanti.");
    mailConfiguration(); const token = newEmailToken();
    await authCommand<boolean>("resend", { email, token_hash: token.hash, ...accountMailPayload(email,token.raw,"verify") });

    return NextResponse.json({ ok: true, message: "Jika akun menunggu verifikasi, tautan baru akan dikirim. Periksa inbox dan spam." }, {headers:{"Cache-Control":"no-store"}});
  } catch (error) { return apiErrorResponse(error); }
}
