import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/api/errors";
import { requireSession } from "@/lib/api/session";
import { assertSameOrigin, readJson, stepUpSchema } from "@/lib/api/validation";
import { issueSessionToken } from "@/lib/auth/jwt";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
import { verifyTotp } from "@/lib/auth/totp";
import { resolveActorId } from "@/lib/db/actors";
import { assertSessionContext } from "@/lib/ztna/access-policy";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const session = requireSession(request);
    assertSessionContext(session, request.headers.get("user-agent") ?? "");
    const id = await resolveActorId(session.email ?? session.sub, session.role);
    if (id !== session.userId) throw new ApiError(401, "Silakan masuk ulang.");
    const limit = consumeRateLimit(`step-up:${id}`, 5, 5 * 60_000);
    if (!limit.allowed) throw new ApiError(429, "Terlalu banyak percobaan. Tunggu lima menit.");
    const { otp } = await readJson(request, stepUpSchema, 1024);
    if (process.env.NODE_ENV === "production" && process.env.DEMO_AUTH_ENABLED !== "true") {
      throw new ApiError(503, "Autentikasi demo dinonaktifkan.");
    }
    const configured = process.env[`DEMO_TOTP_SECRET_${session.role}`];
    const secret = configured || (process.env.NODE_ENV !== "production" ? "JBSWY3DPEHPK3PXP" : "");
    if (!secret) throw new ApiError(503, "Rahasia MFA belum dikonfigurasi.");
    if (!verifyTotp(secret, otp, 1)) throw new ApiError(401, "Kode autentikator tidak valid.");
    const now = Math.floor(Date.now() / 1000);
    const token = issueSessionToken({ sub: session.sub, role: session.role, email: session.email, userId: id, deviceHash: session.deviceHash, mfaVerifiedAt: now }, (session.exp - now) / 60);
    const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set("triase-session", token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: session.exp - now });
    return response;
  } catch (error) { return apiErrorResponse(error); }
}
