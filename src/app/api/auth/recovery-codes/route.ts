import { NextResponse,type NextRequest } from "next/server";
import { ApiError,apiErrorResponse } from "@/lib/api/errors";
import { requireSession } from "@/lib/api/session";
import { assertSameOrigin,readJson } from "@/lib/api/validation";
import { assertSessionContext,assertFreshMfa } from "@/lib/ztna/access-policy";
import { resolveActorId } from "@/lib/db/actors";
import { enforceRateLimit,getClientIp } from "@/lib/auth/rate-limit";
import { rotateRecoverySchema } from "@/lib/auth/schemas";
import { authCommand,openTotp,passwordMatches,type AuthAccount } from "@/lib/auth/real-accounts";
import { matchingTotpCounter } from "@/lib/auth/totp";
import { newRecoveryCodes } from "@/lib/auth/recovery";
export const runtime="nodejs";
export async function POST(request:NextRequest){try{
 assertSameOrigin(request);const session=requireSession(request);assertSessionContext(session,request.headers.get("user-agent")??"");
 if(session.role==="MAHASISWA")throw new ApiError(403,"Pemulihan MFA hanya untuk petugas.");
 assertFreshMfa(session,true);
 const id=await resolveActorId(session.email??session.sub,session.role,session.authVersion);
 if(id!==session.userId)throw new ApiError(401,"Identitas sesi berubah.");
 await enforceRateLimit("recovery-rotate",getClientIp(request),id,5,300000);
 const {password,otp}=await readJson(request,rotateRecoverySchema,2048);
 const account=await authCommand<AuthAccount|null>("lookup",{email:session.email??session.sub});
 if(!await passwordMatches(account,password)||!account?.sealed)throw new ApiError(401,"Password atau kode tidak valid.");
 const counter=matchingTotpCounter(openTotp(account.sealed,id),otp);const recovery=newRecoveryCodes();
 if(counter===null||!await authCommand("recovery_rotate",{id,version:session.authVersion,counter,recovery_hashes:recovery.hashes}))throw new ApiError(401,"Password atau kode tidak valid atau sudah digunakan.");
 return NextResponse.json({ok:true,codes:recovery.codes},{headers:{"Cache-Control":"no-store"}});
}catch(e){return apiErrorResponse(e);}}
