import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/api/errors";
import { assertSameOrigin, readJson } from "@/lib/api/validation";
import { consumeRateLimit, getClientIp } from "@/lib/auth/rate-limit";
import { verificationSchema } from "@/lib/auth/schemas";
import { authCommand, passwordHash, tokenHash } from "@/lib/auth/real-accounts";
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    if (!(await consumeRateLimit(`verify:${getClientIp(request)}`, 5, 900000)).allowed) throw new ApiError(429,"Terlalu banyak percobaan. Tunggu 15 menit.");
    const { token, password } = await readJson(request, verificationSchema, 4096);
    const result = await authCommand<boolean>("verify", { token_hash: tokenHash(token), ...(password ? {hash:await passwordHash(password)} : {}) });
    if (!result) throw new ApiError(400,"Tautan tidak valid, kedaluwarsa, atau sudah digunakan. Minta tautan baru.");
    return NextResponse.json({ok:true,message:"Email berhasil diverifikasi. Silakan masuk."},{headers:{"Cache-Control":"no-store"}});
  } catch (error) { return apiErrorResponse(error); }
}
