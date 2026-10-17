import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "kysely";
import type { SessionClaims } from "@/lib/auth/jwt";
import { assertSessionContext, assertFreshMfa } from "@/lib/ztna/access-policy";
import { ApiError } from "@/lib/api/errors";
import { resolveActorId } from "@/lib/db/actors";
import { withActorContext } from "@/lib/db/client";
import { sealTotp, newEmailToken, passwordHash } from "@/lib/auth/real-accounts";
import { mailConfiguration } from "@/lib/auth/email";
export async function adminAccounts(session:SessionClaims, agent:string, action:string, payload:Record<string,unknown>) {
 assertSessionContext(session,agent);if(session.role!=="ADMIN")throw new ApiError(403,"Hanya Admin yang dapat mengelola akun.");
 if(!["list","events"].includes(action))assertFreshMfa(session,true);
 const id=await resolveActorId(session.email??session.sub,session.role,session.authVersion);
 if(id!==session.userId)throw new ApiError(401,"Identitas sesi berubah.");
 let token:ReturnType<typeof newEmailToken>|undefined;
 if(action==="invite"||action==="invite_resend"){mailConfiguration();token=newEmailToken();payload={...payload,...(action==="invite"?{hash:await passwordHash(randomBytes(32).toString("hex"))}:{}),token_hash:token.hash};
 const mailId=randomUUID();payload={...payload,mail_id:mailId,mail_sealed:sealTotp(JSON.stringify({email:action==="invite"?String(payload.email):undefined,userId:action==="invite_resend"?String(payload.id):undefined,token:token.raw,purpose:"invite"}),mailId)};}
 const result=await withActorContext({userId:id,role:"ADMIN"},async trx=>{
  const row=await sql<{result:Record<string,unknown>|unknown[]}>`SELECT public.fn_admin_accounts(${action},${JSON.stringify(payload)}::jsonb) AS result`.execute(trx);
  return row.rows[0]!.result;
 }).catch((e:unknown)=>{const code=(e as {code?:string})?.code;if(code==="42501")throw new ApiError(403,"Tindakan di luar kewenangan, mandat tidak aktif, atau akun Admin dilindungi.");if(code==="23505")throw new ApiError(409,"Email sudah terdaftar. Gunakan akun yang berbeda.");throw e;});
 if(result&&typeof result==="object"&&"error" in result){const code=result.error;throw new ApiError(code==="NOT_FOUND"?404:409,code==="STALE_VERSION"?"Data berubah. Muat ulang sebelum menyimpan.":code==="VERIFY_REQUIRED"?"Email belum diverifikasi. Akun belum dapat diaktifkan.":"Akun tidak ditemukan.");}

 return result;
}
