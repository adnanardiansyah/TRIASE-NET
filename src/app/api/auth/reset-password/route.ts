import { NextResponse,type NextRequest } from "next/server";
import { ApiError,apiErrorResponse } from "@/lib/api/errors";
import { assertSameOrigin,readJson } from "@/lib/api/validation";
import { enforceRateLimit,getClientIp } from "@/lib/auth/rate-limit";
import { resetPasswordSchema } from "@/lib/auth/schemas";
import { authCommand,passwordHash,tokenHash } from "@/lib/auth/real-accounts";
export const runtime="nodejs";
export async function POST(request:NextRequest){try{
 assertSameOrigin(request);await enforceRateLimit("reset-password",getClientIp(request),undefined,10);
 const {token,password}=await readJson(request,resetPasswordSchema,2048);
 await enforceRateLimit("reset-token",getClientIp(request),tokenHash(token),5);
 const ok=await authCommand("reset_finish",{token_hash:tokenHash(token),hash:await passwordHash(password)});
 if(!ok)throw new ApiError(400,"Tautan tidak valid, kedaluwarsa, atau sudah digunakan.");
 return NextResponse.json({ok:true,message:"Password diperbarui dan sesi lama dicabut. Silakan login. Petugas tetap memerlukan autentikator."},{headers:{"Cache-Control":"no-store"}});
}catch(e){return apiErrorResponse(e);}}
