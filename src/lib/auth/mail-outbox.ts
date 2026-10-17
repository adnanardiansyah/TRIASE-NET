import "server-only";
import type { QueryConfig } from "pg";
import { randomUUID } from "node:crypto";
import { getPool } from "@/lib/db/client";
import { sealTotp, openTotp } from "./real-accounts";
import { sendAccountEmail, type AccountMailPurpose } from "./email";
export function accountMailPayload(email:string,rawToken:string,purpose:AccountMailPurpose){
 const id=randomUUID();
 return {mail_id:id,mail_sealed:sealTotp(JSON.stringify({email,token:rawToken,purpose}),id)};
}
async function command<T>(action:string,p:Record<string,unknown>):Promise<T>{
 const query:QueryConfig & {query_timeout:number}={text:"SELECT public.fn_auth_mail($1,$2::jsonb) AS result",values:[action,JSON.stringify(p)],query_timeout:5000};
 const r=await getPool().query<{result:T}>(query);return r.rows[0]!.result;
}
export async function deliverAccountMail(){
 await command("cleanup",{});
 const jobs=await command<{id:string;sealed_payload:string;lease_id:string}[]>("claim",{});
 let delivered=0,failed=0;
 for(const job of jobs){
  try{const payload=JSON.parse(openTotp(job.sealed_payload,job.id)) as {email?:string;userId?:string;token:string;purpose:AccountMailPurpose};const email=payload.email??(await command<{email:string}|null>("recipient",{user_id:payload.userId}))?.email;if(!email)throw new Error("Recipient unavailable");await sendAccountEmail(email,payload.token,payload.purpose);await command("complete",{id:job.id,lease_id:job.lease_id});delivered++;}
  catch{await command("fail",{id:job.id,lease_id:job.lease_id});failed++;}
 }
 return {delivered,failed};
}
