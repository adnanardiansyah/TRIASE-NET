import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/api/errors";
import { assertSameOrigin, readJson, loginSchema } from "@/lib/api/validation";
import { consumeRateLimit, buildRateLimitKeys, getClientIp } from "@/lib/auth/rate-limit";
import { authCommand, passwordMatches, sealTotp, openTotp, tokenHash, type AuthAccount } from "@/lib/auth/real-accounts";
import { generateTotpSecret, matchingTotpCounter } from "@/lib/auth/totp";
import { loginResponse } from "@/lib/auth/session-response";
import { deviceHash } from "@/lib/ztna/access-policy";
import { newRecoveryCodes, recoveryHash } from "@/lib/auth/recovery";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const body = await readJson(request, loginSchema, 4096);
    const agent = request.headers.get("user-agent") ?? ""; const ip = getClientIp(request);
    const email = "email" in body ? body.email : "";
    const keys = email ? buildRateLimitKeys(ip, email) : [`auth:ip:${ip}`];
    if ((await Promise.all(keys.map(key => consumeRateLimit(key, 8, 600000)))).some(result => !result.allowed)) throw new ApiError(429, "Terlalu banyak percobaan. Tunggu sepuluh menit.");
    const binding = { ip_hash: tokenHash(ip), device_hash: deviceHash(agent) };
    if ("challengeId" in body) {
      const account = await authCommand<AuthAccount | null>("challenge_read", { id: body.challengeId, ...binding });
      if ("recoveryCode" in body) {
        if (!account?.sealed) throw new ApiError(401,"Pemulihan tidak tersedia. Masuk ulang.");
        const secret = generateTotpSecret();
        const next = await authCommand<string|null>("recovery_begin",{ id:body.challengeId, code_hash:recoveryHash(body.recoveryCode), pending:sealTotp(secret,account.id), ...binding });
        if(!next) throw new ApiError(401,"Kode pemulihan tidak valid atau sudah digunakan.");
        return NextResponse.json({ok:true,mfaRequired:true,challengeId:next,enrollmentSecret:secret},{headers:{"Cache-Control":"no-store"}});
      }
      if (!account?.sealed) throw new ApiError(401, "Sesi verifikasi berakhir atau tidak valid. Masuk ulang.");
      const counter = matchingTotpCounter(openTotp(account.sealed, account.id), body.otp);
      if (counter === null) throw new ApiError(401, "Kode autentikator tidak valid.");
      const recovery = newRecoveryCodes();
      const complete = await authCommand<AuthAccount | null>("mfa_finish", { id: body.challengeId, counter, recovery_hashes:recovery.hashes, ...binding });
      if (!complete) throw new ApiError(401, "Kode sudah digunakan atau sesi berubah. Gunakan kode terbaru.");
      return loginResponse(complete, agent, true, complete.recoveryCreated ? recovery.codes : undefined);
    }
    const account = await authCommand<AuthAccount | null>("lookup", { email: body.email });
    if (!await passwordMatches(account, body.password) || !account) throw new ApiError(401, "Email atau password tidak sesuai, atau akun belum aktif. Pastikan email sudah diverifikasi.");
    if (account.role === "MAHASISWA") {
      const complete = await authCommand<AuthAccount | null>("student_login", { id: account.id, version: account.version });
      if (!complete) throw new ApiError(401, "Akun berubah. Silakan masuk ulang.");
      return loginResponse(complete, agent, false);
    }
    const secret = account.sealed ? null : generateTotpSecret();
    const challengeId = await authCommand<string | null>("challenge", { id: account.id, version: account.version, pending: secret ? sealTotp(secret, account.id) : null, ...binding });
    if (!challengeId) throw new ApiError(401, "Akun berubah. Silakan masuk ulang.");
    return NextResponse.json({ ok: true, mfaRequired: true, challengeId, ...(secret ? { enrollmentSecret: secret, enrollmentUri: `otpauth://totp/${encodeURIComponent(`TRIASE-Net:${account.email}`)}?secret=${secret}&issuer=TRIASE-Net&algorithm=SHA1&digits=6&period=30` } : {}) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
