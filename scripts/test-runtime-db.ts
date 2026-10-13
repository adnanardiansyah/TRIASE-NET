import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { Pool } from "pg";
import { loadEnvFiles, requireEnv } from "./lib/env.js";

loadEnvFiles();

async function child(args: string[], env: NodeJS.ProcessEnv) {
  await new Promise<void>((resolve, reject) => {
    const process = spawn(globalThis.process.execPath, args, { env, stdio: "inherit", windowsHide: true });
    process.on("error", reject);
    process.on("exit", (code) => code === 0 ? resolve() : reject(new Error("Pemeriksaan database gagal.")));
  });
}

async function run() {
  if (process.env.NODE_ENV === "production") throw new Error("Tes database harus memakai lingkungan pengembangan.");
  const source = new URL(process.env.DATABASE_ADMIN_URL ?? requireEnv("DATABASE_URL", "database uji terisolasi"));
  const template = decodeURIComponent(source.pathname.slice(1));
  if (!/^[A-Za-z0-9_]+$/.test(template) || ["postgres", "template0", "template1"].includes(template)) throw new Error("Database sumber uji tidak valid.");
  const dbName = `triase_test_${randomBytes(6).toString("hex")}`;
  if (!/^triase_test_[0-9a-f]{12}$/.test(dbName)) throw new Error("Nama database uji tidak valid.");
  source.pathname = "/postgres";
  const admin = new Pool({ connectionString: source.toString(), max: 1, connectionTimeoutMillis: 5000 });
  let created = false;
  let roleCreated = false;
  const login = `${dbName}_login`;
  try {
    await admin.query(`CREATE DATABASE "${dbName}" WITH TEMPLATE "${template}"`);
    created = true;
    const password = randomBytes(24).toString("hex");
    await admin.query(`CREATE ROLE "${login}" LOGIN PASSWORD '${password}'`);
    roleCreated = true;
    await admin.query(`GRANT triase_app TO "${login}"`);
    source.pathname = `/${dbName}`;
    const runtime = new URL(source);
    runtime.username = login;
    runtime.password = password;
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "test", DATABASE_ADMIN_URL: source.toString(), DATABASE_MIGRATION_URL: source.toString(), DATABASE_URL: runtime.toString(), TRIASE_INTEGRATION_DATABASE_URL: source.toString(), KEK_MASTER_BASE64: randomBytes(32).toString("base64"), PSEUDONYM_HMAC_KEY_BASE64: randomBytes(32).toString("base64"), KEK_ACTIVE_VERSION: "1" };
    await child(["--import", "tsx", "scripts/migrate.ts", "--admin"], env);
    await child(["--import", "tsx", "scripts/seed-runtime-demo.ts"], env);
    await child(["node_modules/vitest/vitest.mjs", "run", "src/lib/db/tickets.integration.test.ts"], env);
  } finally {
    if (created) await admin.query(`DROP DATABASE "${dbName}" WITH (FORCE)`);
    if (roleCreated) await admin.query(`DROP ROLE "${login}"`);
    await admin.end();
  }
}

run().catch((error: unknown) => {
  console.error("Pemeriksaan runtime database gagal.", { code: (error as { code?: string })?.code ?? "TEST_FAILED" });
  process.exitCode = 1;
});
