// Snapshot schema only, create an isolated database, test, then drop that exact database.
// No account data is copied or changed. Never print connection strings or tokens.
import assert from "node:assert/strict";
import { randomUUID,randomBytes,createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { hash } from "@node-rs/argon2";
const source=new URL(process.env.DATABASE_ADMIN_URL);
if(!["localhost","127.0.0.1"].includes(source.hostname))throw new Error("QA accepts a local source only. Production databases are prohibited.");
const executable=process.env.PG_DUMP_PATH??"D:\\PostreSQL\\bin\\pg_dump.exe";
const dump=spawnSync(executable,["--schema-only","--no-owner"],{encoding:"utf8",maxBuffer:20*1024*1024,env:{...process.env,PGHOST:source.hostname,PGPORT:source.port||"5432",PGUSER:decodeURIComponent(source.username),PGPASSWORD:decodeURIComponent(source.password),PGDATABASE:source.pathname.slice(1)}});
if(dump.status!==0)throw new Error("Schema-only export failed (details suppressed).");
const name=`triase_security_qa_${randomBytes(8).toString("hex")}`;
assert.match(name,/^triase_security_qa_[0-9a-f]{16}$/);
const controlUrl=new URL(source);controlUrl.pathname="/postgres";
const control=new Pool({connectionString:controlUrl.toString(),max:1});
const metadata=new Pool({connectionString:source.toString(),max:1});
let applied;
try{applied=new Map((await metadata.query("SELECT version,checksum FROM public.schema_migrations")).rows.map(row=>[row.version,row.checksum]));}finally{await metadata.end();}
let pool;let created=false;
const digest=()=>createHash("sha256").update(randomBytes(32)).digest("hex");
const recoveryHashes=()=>Array.from({length:10},digest);
const mail=()=>({mail_id:randomUUID(),mail_sealed:"synthetic-ciphertext"});
try{
 await control.query(`CREATE DATABASE "${name}" TEMPLATE template0`);created=true;
 const url=new URL(source);url.pathname=`/${name}`;pool=new Pool({connectionString:url.toString(),max:12});
 await pool.query(dump.stdout.split(/\r?\n/).filter(line=>!line.startsWith("\\")).join("\n"));
 for(const file of ["0042_central_auth_rate_limits.sql","0043_auth_recovery_and_mail_outbox.sql","0044_auth_mail_delivery.sql","0045_admin_invitation_outbox.sql"]){
  const sql=await readFile(new URL(`../database/migrations/${file}`,import.meta.url),"utf8");
  const version=file.replace(/\.sql$/,""),previous=applied.get(version);
  if(previous){assert.equal(createHash("sha256").update(sql).digest("hex"),previous,"Source migration checksum mismatch");continue;}
  const db=await pool.connect();try{await db.query("BEGIN");await db.query(sql);await db.query("COMMIT");}catch(e){await db.query("ROLLBACK");throw e;}finally{db.release();}
 }
 const db=await pool.connect();
 const auth=async(action,p)=>(await db.query("SELECT public.fn_account_auth($1,$2::jsonb) AS result",[action,JSON.stringify(p)])).rows[0].result;
 const management=async(action,p)=>(await db.query("SELECT public.fn_admin_accounts($1,$2::jsonb) AS result",[action,JSON.stringify(p)])).rows[0].result;
 const password=await hash(randomUUID());const email=`qa-${randomUUID()}@example.test`;const first=digest();
 try{
  await db.query("SET ROLE triase_app");
  assert.equal(await auth("register",{email,hash:password,token_hash:first,...mail()}),true);
  assert.equal(await auth("lookup",{email}),null);
  assert.equal(await auth("reset_request",{email,token_hash:digest(),...mail()}),false);
  assert.equal(await auth("verify",{token_hash:first}),true);
  assert.equal(await auth("verify",{token_hash:first}),false);
  const student=await auth("lookup",{email});assert.equal(student.role,"MAHASISWA");
  assert.equal(await auth("validate",{email,role:"ADMIN",version:student.version}),null);
  assert.equal(await auth("validate",{email,role:"MAHASISWA"}),null);
  assert.equal(await auth("challenge",{id:student.id,version:student.version}),null);
  const oldReset=digest(),reset=digest();
  assert.equal(await auth("reset_request",{email,token_hash:oldReset,...mail()}),true);
  assert.equal(await auth("reset_request",{email,token_hash:reset,...mail()}),true);
  assert.equal(await auth("reset_finish",{token_hash:oldReset,hash:password}),false);
  const resetCalls=await Promise.all(Array.from({length:8},async()=>{
   const c=await pool.connect();try{await c.query("SET ROLE triase_app");return (await c.query("SELECT public.fn_account_auth('reset_finish',$1::jsonb) AS result",[JSON.stringify({token_hash:reset,hash:password})])).rows[0].result;}finally{await c.query("RESET ROLE");c.release();}
  }));assert.equal(resetCalls.filter(Boolean).length,1);
  assert.equal(await auth("validate",{email,role:"MAHASISWA",version:student.version}),null);
  await db.query("RESET ROLE");
  await db.query("INSERT INTO public.kek_versions(version,label,key_reference) VALUES(1,'QA','local://qa')");
  const admin=randomUUID();await db.query("INSERT INTO public.users(id,role,status,identity_provider,institutional_email,display_name,password_hash) VALUES($1,'ADMIN','ACTIVE','LOCAL',$2,'QA Admin',$3)",[admin,`admin-${email}`,password]);
  await db.query("INSERT INTO public.account_credentials(user_id,password_hash,email_verified_at) VALUES($1,$2,now())",[admin,password]);
  await db.query("INSERT INTO public.satgas_profiles(user_id,employee_id,unit_name,authorized_categories,max_decrypt_risk_score,duty_status) VALUES($1,$2,'QA',enum_range(NULL::public.aduan_category),100,'ON_DUTY')",[admin,randomUUID()]);
  await db.query("BEGIN");await db.query("SET LOCAL ROLE triase_app");await db.query("SELECT public.fn_ztna_set_actor_context($1,'ADMIN',NULL,NULL)",[admin]);
  const invitation=digest();const staffEmail=`staff-${email}`;
  const staff=await management("invite",{email:staffEmail,name:"QA staff",unit_name:"QA",categories:["FASILITAS"],max_risk:50,expires_at:new Date(Date.now()+86400000).toISOString(),hash:password,token_hash:invitation,reason:"Isolated security test",...mail()});
  await db.query("COMMIT");await db.query("SET ROLE triase_app");
  assert.equal(await auth("verify",{token_hash:invitation}),false);
  assert.equal(await auth("verify",{token_hash:invitation,hash:password}),true);
  const account=await auth("lookup",{email:staffEmail});const bind={ip_hash:"qa-ip",device_hash:"qa-device"};
  const counter=()=>Math.floor(Date.now()/30000);
  const ch=await auth("challenge",{id:staff,version:account.version,pending:"sealed-initial",...bind});
  assert.equal(await auth("challenge_read",{id:ch,...bind,device_hash:"wrong"}),null);
  await auth("challenge_read",{id:ch,...bind});const hashes=recoveryHashes();
  const enrolled=await auth("mfa_finish",{id:ch,counter:counter(),recovery_hashes:hashes,...bind});assert.equal(enrolled.recoveryCreated,true);
  assert.ok(enrolled.version>account.version);
  assert.equal(await auth("step_up",{id:staff,version:enrolled.version,counter:counter()}),false);
  const recoveryChallenge=await auth("challenge",{id:staff,version:enrolled.version,...bind});await auth("challenge_read",{id:recoveryChallenge,...bind});
  assert.equal(await auth("recovery_begin",{id:recoveryChallenge,code_hash:digest(),pending:"sealed-replacement",...bind}),null);
  const next=await auth("recovery_begin",{id:recoveryChallenge,code_hash:hashes[0],pending:"sealed-replacement",...bind});assert.ok(next);
  assert.equal(await auth("validate",{email:staffEmail,role:"SATGAS",version:enrolled.version}),null);
  assert.equal(await auth("recovery_begin",{id:recoveryChallenge,code_hash:hashes[0],pending:"another",...bind}),null);
  const pending=await auth("challenge_read",{id:next,...bind});assert.equal(pending.sealed,"sealed-replacement");
  const reenrolled=await auth("mfa_finish",{id:next,counter:counter(),recovery_hashes:recoveryHashes(),...bind});assert.equal(reenrolled.recoveryCreated,true);
  const exhausted=await auth("challenge",{id:staff,version:reenrolled.version,...bind});
  for(let i=0;i<5;i++)assert.ok(await auth("challenge_read",{id:exhausted,...bind}));assert.equal(await auth("challenge_read",{id:exhausted,...bind}),null);
  await db.query("RESET ROLE");const events=await db.query("SELECT action FROM public.auth_security_events WHERE user_id=$1",[staff]);assert.deepEqual(new Set(events.rows.map(x=>x.action)),new Set(["MFA_ENROLLED","MFA_RECOVERY_USED","MFA_REENROLLED"]));
  const records=await db.query("SELECT code_hash FROM public.account_recovery_codes WHERE user_id=$1",[staff]);assert.equal(records.rowCount,10);assert.ok(!records.rows.some(x=>x.code_hash===hashes[0]));
  await db.query("UPDATE public.users SET locked_until=now()+interval '1 hour' WHERE id=$1",[staff]);await db.query("SET ROLE triase_app");assert.equal(await auth("lookup",{email:staffEmail}),null);assert.equal(await auth("step_up",{id:staff,version:reenrolled.version,counter:counter()+1}),false);
  await db.query("RESET ROLE");
  await assert.rejects(db.query("UPDATE public.auth_security_events SET action='MFA_RECOVERY_USED' WHERE user_id=$1",[staff]),/append-only/);
  await db.query("SET ROLE triase_app");
  const beforeLogout=await auth("lookup",{email});assert.equal(await auth("session_revoke",{id:beforeLogout.id,role:beforeLogout.role,version:beforeLogout.version}),true);
  assert.equal(await auth("validate",{email,role:beforeLogout.role,version:beforeLogout.version}),null);
  await db.query("RESET ROLE");await db.query("BEGIN");await db.query("SET LOCAL ROLE triase_app");await db.query("SELECT public.fn_ztna_set_actor_context($1,'ADMIN',NULL,NULL)",[admin]);
  const combinedEvents=await management("events",{});assert.ok(combinedEvents.some(x=>x.action==='MFA_RECOVERY_USED'&&x.target_email===staffEmail));await db.query("COMMIT");await db.query("SET ROLE triase_app");
  // Direct access to secret tables must be denied to runtime.
  for(const table of ["account_credentials","account_recovery_codes","account_password_tokens","auth_mail_outbox","auth_security_events","auth_rate_limits"]){await assert.rejects(db.query(`SELECT * FROM public.${table}`),{code:"42501"});}
  const key=digest();const limits=await Promise.all(Array.from({length:24},async()=>{
   const c=await pool.connect();try{await c.query("SET ROLE triase_app");return (await c.query("SELECT public.fn_auth_rate_limit($1,5,60000) AS result",[key])).rows[0].result.allowed;}finally{await c.query("RESET ROLE");c.release();}
  }));assert.equal(limits.filter(Boolean).length,5);
  await db.query("RESET ROLE");await db.query("UPDATE public.auth_rate_limits SET reset_at=now()-interval '2 days' WHERE key_hash=$1",[key]);await db.query("SET ROLE triase_app");assert.equal((await db.query("SELECT public.fn_auth_rate_limit($1,5,60000) AS result",[key])).rows[0].result.allowed,true);
  await db.query("RESET ROLE");
  const expiredKeys=Array.from({length:16},digest);for(const k of expiredKeys)await db.query("INSERT INTO public.auth_rate_limits(key_hash,hits,reset_at) VALUES($1,10,now()-interval '2 days')",[k]);
  await Promise.all(expiredKeys.map(async k=>{const c=await pool.connect();try{await c.query("SET ROLE triase_app");await c.query("SELECT public.fn_auth_rate_limit($1,5,60000)",[k]);}finally{await c.query("RESET ROLE");c.release();}}));
  await db.query("SET ROLE triase_app");
  // Two workers cannot claim the same message concurrently.
  const claims=await Promise.all([1,2].map(async()=>{const c=await pool.connect();try{await c.query("SET ROLE triase_app");return (await c.query("SELECT public.fn_auth_mail('claim','{}') AS result")).rows[0].result;}finally{await c.query("RESET ROLE");c.release();}}));
  const ids=claims.flat().map(x=>x.id);assert.equal(new Set(ids).size,ids.length);
  process.stdout.write("PASS: isolated migrations; single-use/rotated email and password tokens; concurrent reset; session revocation; MFA enrollment/recovery/replay/lockout; immutable security audit; secret-table privileges; 24 concurrent rate-limit calls; concurrent mail claims.\n");
 }finally{await db.query("RESET ROLE");db.release();}
}finally{
 if(pool)await pool.end();
 if(created){assert.match(name,/^triase_security_qa_[0-9a-f]{16}$/);await control.query(`DROP DATABASE "${name}"`);}
 await control.end();
}
