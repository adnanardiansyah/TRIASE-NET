import "server-only";
import type { QueryConfig } from "pg";
import { randomUUID } from "node:crypto";
import { getPool } from "@/lib/db/client";
import { sealTotp, openTotp } from "./real-accounts";
import { sendAccountEmail, type AccountMailPurpose } from "./email";
import { mailFailure, mailProgress } from "./mail-diagnostics";
export function accountMailPayload(email:string,rawToken:string,purpose:AccountMailPurpose){
 const id=randomUUID();
 return {mail_id:id,mail_sealed:sealTotp(JSON.stringify({email,token:rawToken,purpose}),id)};
}
async function command<T>(action:string,p:Record<string,unknown>):Promise<T>{
 const query:QueryConfig & {query_timeout:number}={text:"SELECT public.fn_auth_mail($1,$2::jsonb) AS result",values:[action,JSON.stringify(p)],query_timeout:5000};
 const r=await getPool().query<{result:T}>(query);return r.rows[0]?.result as T;
}
async function acknowledge(action:"complete"|"fail", job:{id:string;lease_id:string}) {
 try {
  if(await command(action,{id:job.id,lease_id:job.lease_id}) !== true) throw new Error("Acknowledgement refused");
  mailProgress("acknowledged"); return true;
 } catch {mailFailure("OUTBOX_ACK_FAILED",undefined,action); return false;}
}
export async function deliverAccountMail(){
 let jobs:{id:string;sealed_payload:string;lease_id:string}[];
 try {
  jobs=await command("claim",{});
  if(!Array.isArray(jobs)) throw new Error("Invalid claim result");
 } catch {mailFailure("OUTBOX_CLAIM_FAILED");throw new Error("Mail worker unavailable");}
 mailProgress("claimed",{claimed:jobs.length});
 let delivered=0,failed=0;
 for(const job of jobs){
  let payload:{email?:unknown;userId?:unknown;token:string;purpose:AccountMailPurpose};
  try {
   payload=JSON.parse(openTotp(job.sealed_payload,job.id));
   if(!payload || typeof payload.token!=="string" || !payload.token || !["verify","invite","reset"].includes(payload.purpose)) throw new Error("Invalid payload");
   mailProgress("decrypted");
  } catch {mailFailure("DECRYPT_FAILED");await acknowledge("fail",job);failed++;continue;}
  let email:unknown;
  try {
   email=payload.email;
   if(email == null && typeof payload.userId === "string") email=(await command<{email:string}|null>("recipient",{user_id:payload.userId}))?.email;
   if(typeof email!=="string" || email.length>254 || !/^[^@\s<>\r\n]+@[^@\s<>\r\n]+\.[^@\s<>\r\n]+$/.test(email)) throw new Error("Invalid recipient");
   mailProgress("recipient_validated");
  } catch {mailFailure("RECIPIENT_UNAVAILABLE");await acknowledge("fail",job);failed++;continue;}
  try {await sendAccountEmail(email as string,payload.token,payload.purpose);}
  catch {await acknowledge("fail",job);failed++;continue;}
  // SMTP has accepted this message. A failed complete is not a send failure;
  // leave the lease intact rather than issuing fail and immediately retrying.
  if(await acknowledge("complete",job)) delivered++; else failed++;
 }
 mailProgress("batch",{claimed:jobs.length,delivered,failed});
 return {delivered,failed};
}
