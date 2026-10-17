import { createInterface } from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";
import { randomBytes, randomUUID } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { Pool } from "pg";
import { loadEnvFiles, requireEnv } from "./lib/env.js";
loadEnvFiles();
async function secret(prompt:string):Promise<string>{
 if(!process.stdin.isTTY)throw new Error("Gunakan terminal interaktif untuk memasukkan password.");
 process.stdout.write(prompt);emitKeypressEvents(process.stdin);process.stdin.setRawMode(true);process.stdin.resume();
 return new Promise((resolve,reject)=>{let value="";const onKey=(text:string,key:{name?:string;ctrl?:boolean})=>{if(key.ctrl&&key.name==="c"){finish();reject(new Error("Dibatalkan."));}else if(key.name==="return"){finish();resolve(value);}else if(key.name==="backspace"){value=value.slice(0,-1);}else if(!key.ctrl&&text&&!/[\x00-\x1f]/.test(text)){value+=text;}};const finish=()=>{process.stdin.off("keypress",onKey);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write("\n");};process.stdin.on("keypress",onKey);});
}
async function main(){
 const rl=createInterface({input:process.stdin,output:process.stdout});
 const email=(await rl.question("Email Admin milik Anda: ")).trim().toLowerCase();const name=(await rl.question("Nama tampilan Admin: ")).trim();rl.close();
 const password=await secret("Password baru (minimal 12 karakter, input disembunyikan): ");const confirm=await secret("Ulangi password: ");
 if(!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)||email.length>254||!name||name.length>120||password.length<12||password.length>128||password!==confirm)throw new Error("Email, nama, atau konfirmasi password tidak valid.");
 const pool=new Pool({connectionString:requireEnv("DATABASE_ADMIN_URL","penyiapan Admin pertama"),max:1});const client=await pool.connect();
 try{await client.query("BEGIN");await client.query("SELECT pg_advisory_xact_lock(hashtextextended('first-real-admin',0))");
 const existing=await client.query("SELECT 1 FROM public.users u JOIN public.account_credentials c ON c.user_id=u.id WHERE u.role='ADMIN'");if(existing.rowCount)throw new Error("Admin nyata sudah tersedia. Penyiapan awal hanya dapat dilakukan sekali.");
 const id=randomUUID();const passwordHash=await hash(password,{memoryCost:19456,timeCost:2,parallelism:1});
 await client.query("INSERT INTO public.users(id,role,status,identity_provider,institutional_email,display_name,password_hash) VALUES($1,'ADMIN','ACTIVE','LOCAL',$2,$3,$4)",[id,email,name,passwordHash]);
 await client.query("INSERT INTO public.account_credentials(user_id,password_hash,email_verified_at) VALUES($1,$2,now())",[id,passwordHash]);
 await client.query("INSERT INTO public.satgas_profiles(user_id,employee_id,unit_name,authorized_categories,max_decrypt_risk_score,clearance_level,duty_status,requires_step_up,kek_access_version) VALUES($1,$2,'Pengelola layanan',enum_range(NULL::public.aduan_category),100,5,'ON_DUTY',true,$3)",[id,'ADMIN-'+randomBytes(6).toString('hex'),Number(process.env.KEK_ACTIVE_VERSION??1)]);
 await client.query("COMMIT");console.log("Admin berhasil dibuat. Masuk dengan akun Anda, lalu hubungkan aplikasi autentikator. Tidak ada kode MFA bawaan.");
 }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();await pool.end();}
}
main().catch(()=>{console.error("Penyiapan Admin belum berhasil. Periksa input, migrasi, koneksi database, dan apakah Admin nyata sudah tersedia. Tidak ada kredensial yang dicetak.");process.exitCode=1;});
