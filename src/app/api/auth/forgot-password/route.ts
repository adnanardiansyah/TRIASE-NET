import { NextResponse,type NextRequest } from "next/server";
import { apiErrorResponse } from "@/lib/api/errors";
import { assertSameOrigin,readJson } from "@/lib/api/validation";
import { enforceRateLimit,getClientIp } from "@/lib/auth/rate-limit";
import { resendSchema } from "@/lib/auth/schemas";
import { authCommand,newEmailToken } from "@/lib/auth/real-accounts";
import { mailConfiguration } from "@/lib/auth/email";
import { accountMailPayload } from "@/lib/auth/mail-outbox";
export const runtime="nodejs";
export async function POST(request:NextRequest){try{
 assertSameOrigin(request);
 await enforceRateLimit("forgot-password",getClientIp(request),undefined,20);
 const {email}=await readJson(request,resendSchema,1024);
 await enforceRateLimit("forgot-password-account",getClientIp(request),email,5);
 mailConfiguration();const token=newEmailToken();
 const mail=accountMailPayload(email,token.raw,"reset");
 await authCommand("reset_request",{email,token_hash:token.hash,...mail});
 return NextResponse.json({ok:true,message:"Jika akun memenuhi syarat, instruksi pemulihan akan dikirim. Periksa inbox dan spam."},{headers:{"Cache-Control":"no-store"}});
}catch(e){return apiErrorResponse(e);}}
