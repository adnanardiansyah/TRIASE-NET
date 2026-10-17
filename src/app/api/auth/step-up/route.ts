import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/api/errors";
import { requireSession } from "@/lib/api/session";
import { assertSameOrigin, readJson, stepUpSchema } from "@/lib/api/validation";
import { issueSessionToken } from "@/lib/auth/jwt";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
import { matchingTotpCounter } from "@/lib/auth/totp";
import { authCommand, openTotp, type AuthAccount } from "@/lib/auth/real-accounts";
import { resolveActorId } from "@/lib/db/actors";
import { assertSessionContext } from "@/lib/ztna/access-policy";
export async function POST(request: NextRequest) {
 try {
  assertSameOrigin(request); const session = requireSession(request); assertSessionContext(session, request.headers.get("user-agent") ?? "");
  if (session.role === "MAHASISWA") throw new ApiError(403,"Verifikasi ini hanya untuk petugas.");
  const id = await resolveActorId(session.email ?? session.sub, session.role, session.authVersion);
  if (!(await consumeRateLimit(`step-up:${id}`,5,300000)).allowed) throw new ApiError(429,"Terlalu banyak percobaan. Tunggu lima menit.");
  const { otp } = await readJson(request, stepUpSchema,1024);
  const account = await authCommand<AuthAccount | null>("lookup",{email:session.email ?? session.sub});
  if (!account?.sealed) throw new ApiError(401,"Autentikator belum tersedia. Masuk ulang.");
  const counter = matchingTotpCounter(openTotp(account.sealed,id),otp);
  if (counter === null || !await authCommand<boolean>("step_up",{id,version:session.authVersion,counter})) throw new ApiError(401,"Kode tidak valid atau sudah digunakan. Gunakan kode terbaru.");
  const now = Math.floor(Date.now()/1000);
  const {iat: _iat,exp: _exp,...claims} = session;
  const token = issueSessionToken({...claims,mfaVerifiedAt:now},(session.exp-now)/60);
  const response=NextResponse.json({ok:true},{headers:{"Cache-Control":"no-store"}});
  response.cookies.set("triase-session",token,{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",path:"/",maxAge:session.exp-now});return response;
 }catch(error){return apiErrorResponse(error);}
}
