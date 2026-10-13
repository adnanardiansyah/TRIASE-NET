import { randomUUID } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { Pool } from "pg";
import { loadEnvFiles, requireEnv } from "./lib/env.js";

loadEnvFiles();

async function run() {
  if (process.env.NODE_ENV === "production") throw new Error("Seed demo tidak boleh dijalankan di produksi.");
  const connectionString = requireEnv("DATABASE_ADMIN_URL", "seed akun runtime demo");
  const target = new URL(connectionString).pathname.slice(1);
  if (["postgres", "template0", "template1"].includes(target)) throw new Error("Target seed bukan database aplikasi.");
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const account of [
      { email: "mahasiswa@poltek.test", role: "MAHASISWA", password: null },
      { email: "satgas@poltek.test", role: "SATGAS", password: "admin123" },
      { email: "admin@poltek.test", role: "ADMIN", password: "admin123" },
    ]) {
      const password = account.password ? await hash(account.password, { memoryCost: 19456, timeCost: 2, parallelism: 1 }) : null;
      await client.query(`INSERT INTO public.users
        (id, role, status, identity_provider, institutional_email, display_name, password_hash, subject_ref, mfa_enrolled, mfa_enrolled_at)
        VALUES ($1, $2, 'ACTIVE', $3, $4, $5, $6, $7, true, now())
        ON CONFLICT (email_normalized) DO NOTHING`, [randomUUID(), account.role, account.role === "MAHASISWA" ? "OIDC" : "LOCAL", account.email, account.role === "MAHASISWA" ? null : `${account.role} Demo`, password, account.role === "MAHASISWA" ? "demo|mahasiswa" : null]);
      if (account.role !== "MAHASISWA") {
        await client.query(`INSERT INTO public.satgas_profiles
          (user_id, employee_id, unit_name, authorized_categories, max_decrypt_risk_score, clearance_level, duty_status, requires_step_up, kek_access_version)
          SELECT id, $2, 'Unit Demo', enum_range(NULL::public.aduan_category), 100, 5, 'ON_DUTY', true, $3
          FROM public.users WHERE email_normalized = $1 AND role = $4
          ON CONFLICT (user_id) DO NOTHING`, [account.email, `DEMO-${account.role}`, Number(process.env.KEK_ACTIVE_VERSION ?? "1"), account.role]);
      }
    }
    await client.query("COMMIT");
    console.log("Akun runtime demo tersedia. Akun dan profil yang sudah ada tidak ditimpa.");
    console.log("Profil lama yang OFF_DUTY tetap OFF_DUTY; aktifkan melalui administrasi database bila diperlukan.");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); await pool.end(); }
}

run().catch((error: unknown) => {
  const failure = error as { code?: string; constraint?: string };
  console.error("Seed runtime gagal. Periksa koneksi, migrasi, dan hak admin database.", { code: failure.code ?? "SETUP_FAILED", constraint: failure.constraint });
  process.exitCode = 1;
});
