/**
 * Verifikasi skema & keamanan TRIASE-Net.
 *
 * Dua lapis pemeriksaan:
 *
 *   BAGIAN A - STATIS: membaca katalog (tabel, kolom, RLS, GRANT, trigger).
 *   BAGIAN B - UJI FUNGSIONAL: benar-benar menjalankan skenario coated attacker
 *              dan pelapor-student sebagai peran `triase_app`, lalu memastikan
 *              RLS dan GRANT berperilaku seperti yang dijanjikan.
 *
 * Bagian B adalah yang paling bernilai: sebagian besar celah keamanan pada
 * skema RLS tidak terlihat dari katalog, hanya dari perilaku nyata.
 * Seluruh fixture uji dibuat di dalam transaksi yang selalu di-ROLLBACK,
 * sehingga basis data tidak pernah berubah.
 *
 * Jalankan:  npm run db:verify
 */

import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, type PoolClient } from "pg";

import { loadEnvFiles } from "./lib/env.js";

loadEnvFiles();

type Row = Record<string, unknown>;

let passCount = 0;
let failCount = 0;
let warnCount = 0;

function report(
  level: "PASS" | "FAIL" | "WARN",
  title: string,
  detail = "",
): void {
  const label = level.padEnd(4);
  if (level === "PASS") passCount += 1;
  if (level === "FAIL") failCount += 1;
  if (level === "WARN") warnCount += 1;
  console.log(`  [${label}] ${title}${detail ? ` - ${detail}` : ""}`);
}

function createPool(): Pool {
  // Verifikasi memakai peran yang bisa beralih ke `triase_app` dan
  // `triase_auditor`. Peran runtime biasa (`triase_app_login`) tidak
  // bisa melakukan `SET ROLE` ke auditor, sehingga tidak cukup.
  const connectionString =
    process.env.DATABASE_VERIFY_URL ??
    process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_VERIFY_URL belum disetel (butuh peran triase_verify_login).\n" +
        '  $env:DATABASE_VERIFY_URL = "postgresql://triase_verify_login:PASS@localhost:5432/triase_net"\n' +
        "  Jalankan `npm run db:roles` lebih dulu untuk membuat perannya.\n" +
        "  (DATABASE_URL tetap dipakai sebagai cadangan.)",
    );
  }

  return new Pool({ connectionString, max: 2 });
}

/** Nama kolom yang tidak boleh ada di tabel `aduan` (prinsip Zero-Knowledge). */
const FORBIDDEN_ADUAN_COLUMNS = [
  "body_plaintext",
  "plaintext",
  "content",
  "isi_aduan",
  "narration",
  "nim",
  "nik",
  "reporter_name",
  "reporter_email",
  "reporter_user_id",
];


/** Kolom `aduan` yang harus terkunci setelah enkripsi. */
const SEALED_ADUAN_COLUMNS = [
  "body_ciphertext",
  "body_iv",
  "body_auth_tag",
  "dek_wrapped",
  "dek_wrap_iv",
  "dek_wrap_auth_tag",
  "kek_version",
  "pseudonym_id",
  "risk_score",
  "crypto_algorithm",
  "attachment_count",
];

// ===========================================================================
// BAGIAN A - PEMERIKSAAN STATIS
// ===========================================================================

async function verifyStatic(db: Kysely<unknown>): Promise<void> {
  const conn = await sql<Row>`
    SELECT current_setting('server_version') AS version, current_user AS usr
  `.execute(db);
  report(
    "PASS",
    "Koneksi basis data",
    `PostgreSQL ${String(conn.rows[0]?.["version"] ?? "?")}, user=${String(conn.rows[0]?.["usr"] ?? "?")}`,
  );

  const expectedTables = [
    "users",
    "satgas_profiles",
    "aduan",
    "aduan_crypto_layers",
    "aduan_attachments",
    "aduan_status_history",
    "kek_versions",
    "ztna_audit_logs",
    "ztna_sessions",
    "refresh_tokens",
    "mfa_challenges",
    "aduan_rate_limits",
    "schema_migrations",
  ];

  const tables = await sql<Row>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
  `.execute(db);
  const existing = new Set(tables.rows.map((r) => String(r["table_name"])));
  const missing = expectedTables.filter((t) => !existing.has(t));

  if (missing.length > 0) {
    report("FAIL", "Tabel wajib ada", `hilang: ${missing.join(", ")}`);
  } else {
    report("PASS", "Tabel wajib ada", `${expectedTables.length} tabel terverifikasi`);
  }

  const columns = await sql<Row>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'aduan'
  `.execute(db);
  const aduanCols = new Set(columns.rows.map((r) => String(r["column_name"])));

  const leaked = FORBIDDEN_ADUAN_COLUMNS.filter((c) => aduanCols.has(c));
  if (leaked.length > 0) {
    report("FAIL", "Zero-Knowledge Storage", `kolom terlarang: ${leaked.join(", ")}`);
  } else {
    report(
      "PASS",
      "Zero-Knowledge Storage",
      `tidak ada kolom plaintext/identitas pada tabel aduan (${aduanCols.size} kolom diperiksa)`,
    );
  }

  const requiredCryptoCols = [
    "body_ciphertext",
    "body_iv",
    "body_auth_tag",
    "dek_wrapped",
    "dek_wrap_iv",
    "dek_wrap_auth_tag",
    "crypto_algorithm",
    "kek_version",
    "pseudonym_id",
    "aad_context",
  ];
  const missingCrypto = requiredCryptoCols.filter((c) => !aduanCols.has(c));
  if (missingCrypto.length > 0) {
    report("FAIL", "Atribut enkripsi", `kolom hilang: ${missingCrypto.join(", ")}`);
  } else {
    report(
      "PASS",
      "Atribut enkripsi",
      "ciphertext, IV, tag, wrapped DEK, dan pseudonym ada",
    );
  }

  const rls = await sql<Row>`
    SELECT c.relname AS table_name, c.relrowsecurity AS enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  `.execute(db);

  const sensitive = [
    "aduan",
    "aduan_crypto_layers",
    "aduan_attachments",
    "users",
    "satgas_profiles",
    "ztna_audit_logs",
    "ztna_sessions",
    "refresh_tokens",
    "mfa_challenges",
  ];
  const rlsDisabled = sensitive.filter(
    (t) => !rls.rows.find((r) => r["table_name"] === t && r["enabled"] === true),
  );
  if (rlsDisabled.length > 0) {
    report("FAIL", "Row Level Security", `RLS tidak aktif pada: ${rlsDisabled.join(", ")}`);
  } else {
    report("PASS", "Row Level Security", `${sensitive.length} tabel sensitif terlindungi RLS`);
  }

  // Tidak ada lagi kebijakan yang dibiarkan terbuka untuk PUBLIC.
  const publicPolicies = await sql<Row>`
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' AND roles::text = '{public}'
  `.execute(db);
  if (publicPolicies.rows.length > 0) {
    const detail = publicPolicies.rows
      .map((r) => `${r["tablename"]}.${r["policyname"]}`)
      .join(", ");
    report("FAIL", "Target kebijakan RLS", `masih PUBLIC: ${detail}`);
  } else {
    report("PASS", "Target kebijakan RLS", "semua kebijakan ditunjuk eksplisit ke peran");
  }

  for (const roleName of ["triase_app", "triase_auditor", "triase_maintenance"]) {
    const roleInfo = await sql<Row>`
      SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
      FROM pg_roles WHERE rolname = ${roleName}
    `.execute(db);
    const role = roleInfo.rows[0];

    if (!role) {
      report("FAIL", `Peran ${roleName}`, "peran tidak ada");
    } else if (
      role["rolsuper"] === true ||
      role["rolbypassrls"] === true ||
      role["rolcreaterole"] === true ||
      role["rolcreatedb"] === true
    ) {
      report("FAIL", `Peran ${roleName}`, "memiliki privilege yang terlalu tinggi");
    } else {
      report("PASS", `Peran ${roleName}`, "tidak punya SUPERUSER/BYPASSRLS/CREATEROLE");
    }
  }

  // Hak hapus untuk peran aplikasi (bug sebelumnya: privilege_type tidak
  // pernah dipilih, sehingga laporan selalu menampilkan "undefined").
  const deleteGrants = await sql<Row>`
    SELECT table_name, privilege_type
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND grantee = 'triase_app'
      AND privilege_type IN ('DELETE', 'TRUNCATE')
  `.execute(db);

  if (deleteGrants.rows.length > 0) {
    const detail = deleteGrants.rows
      .map((r) => `${r["table_name"]}:${r["privilege_type"]}`)
      .join(", ");
    report("FAIL", "Hak hapus peran aplikasi", detail);
  } else {
    report(
      "PASS",
      "Hak hapus peran aplikasi",
      "tidak ada hak DELETE/TRUNCATE untuk triase_app",
    );
  }

  // Zero-Knowledge: kolom ter-seal tidak boleh dapat diubah aplikasi.
  const sealedList = SEALED_ADUAN_COLUMNS.map((c) => `'${c}'`).join(", ");
  const sealedGrants = await sql<Row>`
    SELECT column_name
    FROM information_schema.column_privileges
    WHERE table_schema = 'public'
      AND table_name = 'aduan'
      AND grantee = 'triase_app'
      AND privilege_type = 'UPDATE'
      AND column_name = ANY (ARRAY[${sql.raw(sealedList)}]::text[])
  `.execute(db);

  if (sealedGrants.rows.length > 0) {
    report(
      "FAIL",
      "Kolom ter-seal",
      `triase_app boleh mengubah: ${sealedGrants.rows.map((r) => r["column_name"]).join(", ")}`,
    );
  } else {
    report(
      "PASS",
      "Kolom ter-seal",
      `${SEALED_ADUAN_COLUMNS.length} kolom kripto/identitas tidak dapat diubah aplikasi`,
    );
  }

  // Peran pemeliharaan hanya boleh menghapus pada tabel operasional.
  const maintenanceGrants = await sql<Row>`
    SELECT table_name FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND grantee = 'triase_maintenance'
      AND privilege_type = 'DELETE'
  `.execute(db);
  const allowedForMaintenance = new Set([
    "ztna_sessions",
    "refresh_tokens",
    "mfa_challenges",
    "aduan_rate_limits",
  ]);
  const overreach = maintenanceGrants.rows
    .map((r) => String(r["table_name"]))
    .filter((t) => !allowedForMaintenance.has(t));

  if (overreach.length > 0) {
    report("FAIL", "Cakupan triase_maintenance", `keluar jalur: ${overreach.join(", ")}`);
  } else {
report(
    "PASS",
    "Cakupan triase_maintenance",
    `hanya ${maintenanceGrants.rows.length} tabel operasional (retensi)`,
  );

  // ---- Isolasi KEK dari proses runtime -----------------------------------
  // Pemeriksaan paling penting di bagian ini. `key_material` adalah kunci
  // pembungkus setiap DEK; bila peran aplikasi bisa membacanya, klaim
  // zero-knowledge pada dokumen tidak berlaku karena kunci untuk membuka
  // seluruh isi aduan tersimpan di database yang sama.
  const kekLeaks = await sql<Row>`
    SELECT grantee, privilege_type
    FROM information_schema.column_privileges
    WHERE table_schema = 'public'
      AND table_name = 'kek_versions'
      AND column_name IN ('key_material', 'key_checksum')
      AND privilege_type = 'SELECT'
      AND grantee IN ('PUBLIC', 'triase_app', 'triase_app_login', 'triase_ddl_login')
  `.execute(db);

  if (kekLeaks.rows.length > 0) {
    const who = kekLeaks.rows
      .map((r) => `${String(r["grantee"])}:${String(r["privilege_type"])}`)
      .join(", ");
    report("FAIL", "Kunci KEK tidak bocor ke runtime", who);
  } else {
    const appKekCols = await sql<Row>`
      SELECT count(*)::int AS n
      FROM information_schema.column_privileges
      WHERE table_schema = 'public'
        AND table_name = 'kek_versions'
        AND grantee = 'triase_app'
        AND privilege_type = 'SELECT'
    `.execute(db);
    report(
      "PASS",
      "Kunci KEK tidak bocor ke runtime",
      `key_material/key_checksum hanya untuk postgres+triase_auditor; triase_app boleh ${appKekCols.rows[0]?.n ?? 0} kolom metadata saja`,
    );
  }

  // ---- Pemisahan hak DDL dan runtime --------------------------------------
  // Diuji pada peran LOGIN yang sungguhan dipakai, bukan pada grup.
  // Peran grup mewarisi hak satu tingkat; peran login yang diwarisi
  // dua tingkat TIDAK mewarisi apa pun. Hanya menguji grup akan
  // melewatkan kegagalan itu.
  const roleSeparation = await sql<Row>`
    SELECT
      has_schema_privilege('triase_app_login', 'public', 'CREATE') AS runtime_can_create,
      has_schema_privilege('triase_ddl_login', 'public', 'CREATE') AS ddl_can_create,
      pg_has_role('triase_app_login', 'triase_migrator', 'MEMBER') AS runtime_has_ddl,
      pg_has_role('triase_app_login', 'triase_auditor', 'MEMBER') AS runtime_has_auditor,
      pg_has_role('triase_ddl_login', 'triase_app', 'MEMBER') AS ddl_has_data,
      has_table_privilege('triase_app_login', 'public.aduan', 'SELECT') AS runtime_inherits,
      -- Peran fixture hanya boleh dipakai oleh skrip verifikasi.
      pg_has_role('triase_app_login', 'triase_fixture', 'MEMBER') AS runtime_has_fixture,
      pg_has_role('triase_ddl_login', 'triase_fixture', 'MEMBER') AS ddl_has_fixture,
      pg_has_role('triase_verify_login', 'triase_fixture', 'MEMBER') AS verify_has_fixture,
      has_table_privilege('triase_fixture', 'public.users', 'DELETE') AS fixture_can_delete,
      has_table_privilege('triase_fixture', 'public.aduan', 'SELECT') AS fixture_reads_aduan,
      has_column_privilege('triase_fixture', 'public.kek_versions', 'key_material', 'SELECT') AS fixture_reads_key,
      -- Kontrak peran migrasi (juga ditegakkan di 0034). Diuji di sini
      -- supaya regresi terlihat cepat tanpa menunggu migrasi berikutnya.
      (SELECT rolcreaterole OR rolsuper FROM pg_roles WHERE rolname = 'triase_migrator') AS migrator_can_admin,
      has_table_privilege('triase_migrator', 'public.schema_migrations', 'INSERT') AS migrator_writes_book,
      has_table_privilege('triase_migrator', 'public.schema_migrations', 'UPDATE') AS migrator_edits_history,
      has_column_privilege('triase_migrator', 'public.kek_versions', 'key_material', 'SELECT') AS migrator_reads_key
  `.execute(db);

  const separation = roleSeparation.rows[0];
  const separationProblems: string[] = [];

  if (separation?.["runtime_inherits"] !== true) {
    separationProblems.push("peran runtime tidak mewarisi hak SELECT");
  }
  if (separation?.["ddl_can_create"] !== true) {
    separationProblems.push("peran DDL tidak punya hak CREATE (tidak bisa migrasi)");
  }
  if (separation?.["runtime_can_create"] === true) {
    separationProblems.push("peran runtime punya hak CREATE pada schema public");
  }
  if (separation?.["runtime_has_ddl"] === true) {
    separationProblems.push("peran runtime memegang hak DDL");
  }
  if (separation?.["runtime_has_auditor"] === true) {
    separationProblems.push("peran runtime memegang hak baca kunci audit");
  }
  if (separation?.["ddl_has_data"] === true) {
    separationProblems.push("peran DDL memegang hak data runtime");
  }
  if (separation?.["runtime_has_fixture"] === true) {
    separationProblems.push("peran runtime memegang akses fixture verifikasi");
  }
  if (separation?.["ddl_has_fixture"] === true) {
    separationProblems.push("peran DDL memegang akses fixture verifikasi");
  }
  if (separation?.["verify_has_fixture"] !== true) {
    separationProblems.push(
      "peran verifikasi tidak menjadi anggota triase_fixture (probe tidak bisa menyiapkan data)",
    );
  }
  if (separation?.["fixture_can_delete"] === true) {
    separationProblems.push("peran fixture punya hak DELETE pada users");
  }
  if (separation?.["fixture_reads_aduan"] === true) {
    separationProblems.push("peran fixture bisa membaca tabel aduan");
  }
  if (separation?.["fixture_reads_key"] === true) {
    separationProblems.push("peran fixture bisa membaca key_material");
  }
  if (separation?.["migrator_can_admin"] === true) {
    separationProblems.push(
      "peran migrasi punya CREATEROLE/SUPERUSER; berarti bisa mengubah peran dan membaca pg_authid",
    );
  }
  if (separation?.["migrator_writes_book"] !== true) {
    separationProblems.push(
      "peran migrasi tidak bisa menulis schema_migrations (db:migrate akan gagal)",
    );
  }
  if (separation?.["migrator_edits_history"] === true) {
    separationProblems.push("peran migrasi bisa mengubah riwayat migrasi");
  }
  if (separation?.["migrator_reads_key"] === true) {
    separationProblems.push("peran migrasi bisa membaca key_material");
  }

  if (separationProblems.length > 0) {
    report(
      "FAIL",
      "Pemisahan hak DDL dan runtime",
      separationProblems.join("; "),
    );
  } else {
    report(
      "PASS",
      "Pemisahan hak DDL dan runtime",
      "runtime hanya data, DDL hanya CREATE, tanpa jalur silang; fixture verifikasi tanpa DELETE, tanpa baca aduan, tanpa baca kunci; peran migrasi NOCREATEROLE dan tidak bisa mengubah riwayat migrasi",
    );
  }

  // ---- Hash kata sandi hanya Argon2id -------------------------------------
  const argonOnly = await sql<Row>`
    SELECT pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conname = 'users_staff_credentials_ck'
      AND conrelid = 'public.users'::regclass
  `.execute(db);

  const argonDef = String(argonOnly.rows[0]?.["def"] ?? "");
  if (argonDef.length === 0) {
    report("FAIL", "Kredensial tenaga - hanya Argon2id", "constraint tidak ditemukan");
  } else if (argonDef.includes("scrypt")) {
    report("FAIL", "Kredensial tenaga - hanya Argon2id", "constraint masih menerima scrypt");
  } else {
    report("PASS", "Kredensial tenaga - hanya Argon2id", "constraint menolak semua algoritma lain");
  }
  }

  const triggers = await sql<Row>`
    SELECT tgname FROM pg_trigger WHERE NOT tgisinternal
  `.execute(db);
  const triggerNames = new Set(triggers.rows.map((r) => String(r["tgname"])));
  const immutableTriggers = [
    "trg_ztna_audit_no_update",
    "trg_ztna_audit_no_truncate",
    "trg_status_history_no_update",
    "trg_status_history_no_truncate",
  ];
  const missingTriggers = immutableTriggers.filter((t) => !triggerNames.has(t));
  if (missingTriggers.length > 0) {
    report("FAIL", "Trigger immutability", `hilang: ${missingTriggers.join(", ")}`);
  } else {
    report("PASS", "Trigger immutability", "audit log dan riwayat status terkunci");
  }

  // Penjaga lapisan hibrida harus DEFERRABLE, jika tidak HYBRID_DOUBLE mustahil.
  const layerGuard = await sql<Row>`
    SELECT t.tgdeferrable, t.tginitdeferred
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'aduan'
      AND t.tgname = 'trg_aduan_crypto_layer_guard'
  `.execute(db);
  const guard = layerGuard.rows[0];
  if (!guard || guard["tgdeferrable"] !== true) {
    report(
      "FAIL",
      "Penjaga lapisan hibrida",
      "trigger tidak DEFERRABLE sehingga HYBRID_DOUBLE mustahil dibuat",
    );
  } else {
    report(
      "PASS",
      "Penjaga lapisan hibrida",
      `DEFERRABLE (ditunda saat txn=${String(guard["tginitdeferred"])})`,
    );
  }

  // Constraint kesesuaian risiko <-> algoritma.
  const riskAlg = await sql<Row>`
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.aduan'::regclass
      AND conname = 'aduan_risk_algorithm_ck'
      AND contype = 'c'
  `.execute(db);
  if (riskAlg.rows.length === 0) {
    report("FAIL", "Kesesuaian risiko", "aduan_risk_algorithm_ck tidak ada");
  } else {
    report("PASS", "Kesesuaian risiko", "algoritma terkunci pada risk_band");
  }

  const chain = await sql<Row>`
    SELECT * FROM public.fn_verify_audit_chain('global')
  `.execute(db);
  const chainRow = chain.rows[0];
  const checked = Number(chainRow?.["checked_count"] ?? 0);
  const broken = Number(chainRow?.["broken_count"] ?? 0);
  const digestMismatch = Number(chainRow?.["digest_mismatch"] ?? 0);

  if (checked === 0) {
    // Rantai kosong BUKAN "aman". Melaporkan hijau di sini membuat
    // laporan ini menyesatkan: hijau tanpa memeriksa apa pun.
    report(
      "FAIL",
      "Rantai hash audit",
      "tidak ada entri untuk diverifikasi; rantai kosong bukan bukti integritas (jalankan db:seed lebih dulu)",
    );
  } else if (broken === 0) {
    report(
      "PASS",
      "Rantai hash audit",
      `${checked} entri dihitung ulang, pointer dan digest konsisten`,
    );
  } else {
    report(
      "FAIL",
      "Rantai hash audit",
      `${broken}/${checked} rusak (rantai: ${String(chainRow?.["chain_breaks"] ?? "?")}, digest: ${digestMismatch}) - ${String(chainRow?.["detail"] ?? "")}`,
    );
  }

  const partitions = await sql<Row>`
    SELECT c.relname AS name
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = 'ztna_audit_logs'
  `.execute(db);
  report(
    "PASS",
    "Partisi audit",
    `${partitions.rows.length} partisi: ${partitions.rows.map((r) => r["name"]).join(", ")}`,
  );
}

// ===========================================================================
// BAGIAN B - UJI FUNGSIONAL RLS
// ===========================================================================

interface ProbeResult {
  label: string;
  ok: boolean;
  detail: string;
}

/**
 * Fixture yang memerlukan hak DDL.
 *
 * Sangat penting: fixture ini disisipkan pada transaksi yang
 * sama dengan probe dan di-rollback bersamanya. Tidak ada baris fixture
 * yang pernah di-commit, sehingga tidak diperlukan hak DELETE pada
 * tabel aplikasi.
 *
 * `triase_ddl_login` sengaja TIDAK diberi hak DELETE pada `users` atau
 * `satgas_profiles`. Memberi hak hapus kepada peran DDL berarti peran
 * Kebersihan fixture dicapai dengan rollback, bukan dengan hak hapus.
 * dengan rollback, bukan dengan hak hapus.
 *
 * `triase_verify_login` juga tidak diberi keanggotaan `triase_migrator`:
 * akun yang dipakai memeriksa keamanan tidak perlu memegang hak CREATE.
 */
/**
 * Hash PHC Argon2id yang SAH secara format, karena harus lolos
 * constraint `users_staff_credentials_ck` dari migrasi 0021.
 *
 * Fixture pernah memakai string tiruan `$argon2id$probe`. String itu
 * ditolak constraint karena tidak memuat parameter v=19/m/t/p. Karena
 * fixture adalah data uji, bukan kredensial nyata, hash di bawah dibuat
 * dari kata sandi yang diketahui dan tidak dipakai di mana pun.
 *
 * Parameter sengaja dibuat kecil agar fixture cepat: m=64 KiB, t=1,
 * p=1. Regex 0021 hanya mensyaratkan bentuk PHC, bukan kekuatan
 * parameter, dan fixture tidak perlu tahan serangan brute force.
 */
const PROBE_PASSWORD_HASH =
  "$argon2id$v=19$m=64,t=1,p=1$R1JQTFVQWUxBQUFBWVA$" +
  "c29tZS1maXh1cmVkLWxvbmctcHJvYmUtaGFzaC1ub3QtcmVhbC1zZWNyZXQ";

/**
 * Fixture yang memerlukan hak DDL.
 *
 * Tiap entri adalah pasangan `{ sql, params }`, bukan string SQL polos.
 * Alasannya: `users.password_hash` harus meneruskan hash lewat parameter
 * `$1`, sedangkan kueri KEK dan profil tidak punya parameter sama sekali.
 * Kalau semua entri diperlakukan sebagai string dan parameter dikirim ke
 * semuanya, PostgreSQL menolak dengan "bind message supplies 1
 * parameters, but prepared statement requires 0".
 */
const DDL_FIXTURES: ReadonlyArray<{ sql: string; params?: unknown[] }> = [
  {
    // TIDAK memakai `ON CONFLICT DO NOTHING`.
    //
    // Klaus itu sempat ada dan berbahaya: bila `version = 901` sudah
    // dipakai KEK sungguhan, fixture akan diam-diam memakai ulang KEK
    // itu dan seluruh pengujian kripto berjalan di atas material yang
    // bukan milik fixture. Konflik harus menggagalkan probe dengan
    // pesan yang jelas, bukan diteruskan diam-diam.
    //
    // Statusnya RETIRED, bukan ACTIVE.
    //
    // Index unik `uk_kek_versions_single_active` hanya mengizinkan SATU
    // KEK berstatus ACTIVE pada seluruh database. Fixture yang menandai
    // KEK probe sebagai ACTIVE akan gagal begitu `db:seed:sql` sudah
    // membuat KEK pengembangan versi 1:
    //
    //     duplicate key value violates unique constraint
    //     "uk_kek_versions_single_active"
    //
    // Itu bukancacatan fixture, melainkan invariant skema yang benar:
    // hanya satu KEK yang boleh aktif. Fixture tidak butuh KEK aktif.
    // Yang dibutuhkan hanyalah baris KEK versi 901 agar foreign key
    // `satgas_profiles.kek_access_version` terpenuhi, dan agar enkripsi
    // di lapisan crypto memakai material milik fixture sendiri, bukan
    // KEK produksi.
    //
    // Tidak ada trigger atau fungsi yang mewajibkan
    // `kek_access_version` menunjuk KEK berstatus ACTIVE, jadi RETIRED
    // aman di sini.
    //
    // `retired_at` ikut diisi karena `kek_status_dates_ck` mewajibkan
    // setiap KEK non-ACTIVE memiliki waktu pension. Nilai `now()` itu
    // tidak bermakna secara historis, tetapi konsisten dengan invariant
    // skema, dan baris fixture ini hilang bersama rollback transaksinya.
    sql: `INSERT INTO public.kek_versions
        (version, label, key_reference, status, activated_at, retired_at, retired_reason)
   VALUES (901, 'kek-verify-probe', 'verify://probe', 'RETIRED', now(), now(),
           'probe verifikasi: bukan KEK yang pernah aktif')`,
  },
  {
    sql: `INSERT INTO public.users (id, role, status, identity_provider, institutional_email, subject_ref, display_name, password_hash)
   VALUES
     ('11111111-1111-4111-8111-111111111111', 'SATGAS', 'ACTIVE', 'LOCAL',
      'probe.duty@poltek.test', NULL, 'Probe Petugas', $1),
     ('22222222-2222-4222-8222-222222222222', 'SATGAS', 'ACTIVE', 'LOCAL',
      'probe.offduty@poltek.test', NULL, 'Probe Petugas', $1),
     ('33333333-3333-4333-8333-333333333333', 'MAHASISWA', 'ACTIVE', 'OIDC',
      'probe.mhs@student.poltek.test', 'oidc|probe|mhs', NULL, NULL)`,
    params: [PROBE_PASSWORD_HASH],
  },
  {
    sql: `INSERT INTO public.satgas_profiles
     (user_id, employee_id, unit_name, authorized_categories,
      max_decrypt_risk_score, clearance_level, duty_status, requires_step_up, kek_access_version)
   VALUES
     ('11111111-1111-4111-8111-111111111111', 'PROBE-1', 'Probe Unit',
      ARRAY['FASILITAS']::public.aduan_category[], 69, 2, 'ON_DUTY', false, 901),
     ('22222222-2222-4222-8222-222222222222', 'PROBE-2', 'Probe Unit',
      ARRAY['FASILITAS','KEBERSAMAAN','LAINNYA']::public.aduan_category[], 100, 5, 'OFF_DUTY', false, 901)`,
  },
];

/**
 * Menyisipkan fixture yang butuh hak DDL.
 *
 * Dijalankan pada klien yang sudah ada di dalam transaksi probe, sehingga
 * ikut di-rollback dan tidak pernah ada baris fixture yang perlu dihapus.
 *
 * Peran `triase_fixture` dibuat oleh migrasi 0031. Ia punya INSERT pada
 * `users`, `satgas_profiles`, dan `kek_versions`, TIDAK punya DELETE,
 * dan TIDAK punya hak apa pun pada tabel data aduan.
 *
 * `SET LOCAL ROLE` dipakai, bukan `SET ROLE`, karena otomatis kembali ke
 * peran awal saat transaksi berakhir atau di-rollback. Karena itu
 * `RESET ROLE` di sini hanya pemanis: bila transaksi sudah dibatalkan,
 * PostgreSQL menolak semua kueri sampai akhir transaksi, dan kesalahan
 * `RESET ROLE` itu akan MENYEMBUNYIKAN kesalahan asli dari fixture.
 *
 * Kewaspadaan itu bukan teori. Kegagalan `db:seed` pada tabel yang sama
 * dilaporkan sebagai
 *
 *     current transaction is aborted, commands ignored until end of
 *     transaction block
 *
 * padahal penyebab sebenarnya adalah pelanggaran CHECK constraint. Jadi
 * di sini `RESET ROLE` sengaja ditelan agar pesan pertama yang muncul
 * tetap milik fixture.
 */
async function seedDdlFixtures(client: PoolClient): Promise<void> {
  await client.query("SET LOCAL ROLE triase_fixture");

  try {
    for (const { sql, params } of DDL_FIXTURES) {
      // Hash diteruskan sebagai parameter, bukan disisipkan ke teks SQL,
      // supaya tidak pernah ikut ter-interpolasi ke string kueri.
      await client.query(sql, params);
    }
  } catch (error) {
    // Jangan pernah menutupi penyebab sebenarnya dengan error
    // "transaction is aborted" yang berasal dari RESET ROLE.
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Fixture identitas gagal disisipkan: ${message}`);
  }
}

/**
 * Menyisipkan fixture data aduan sebagai peran aplikasi.
 *
 * Dijalankan sebagai `triase_app`, bukan `triase_fixture` atau peran
 * login. Baris `aduan` hanya boleh disisipkan melalui policy
 * `aduan_insert_own`, dan itu justru hal yang sedang diuji. Menjalankan
 * fixture sebagai peran lain akan menguji jalur yang salah dan
 * menghasilkan RLS violation.
 *
 * `aduan_insert_own` mensyaratkan
 * `pseudonym_id = fn_ztna_pseudonym()` untuk calon pelapor. Fixture A
 * memakai pseudonym `PSA` dan fixture B memakai `PSB`, jadi konteks
 * aktor harus diganti di antara keduanya. Fixture B pernah gagal
 * disisipkan karena keduanya dicoba dalam satu konteks aktor.
 *
 * Sisipan dilakukan satu per satu dengan `SAVEPOINT`, supaya kegagalan
 * yang diharapkan tidak membatalkan seluruh transaksi probe.
 */
async function seedAduanFixtures(client: PoolClient): Promise<void> {
  await client.query("SET LOCAL ROLE triase_app");

  try {
    // Izinkan KEK tertanam hanya di dalam transaksi yang akan di-rollback.
    await client.query(ALLOW_EMBEDDED_KEK);

    // Fixture A: pelapor memakai pseudonym PSA.
    await clearActor(client);
    await client.query(
      "SELECT public.fn_ztna_set_actor_context($1::uuid, 'MAHASISWA'::public.app_role, $2)",
      [MHS, PSA],
    );
    await client.query(ADUAN_FIXTURE_A);

    // Fixture B: ganti konteks aktor ke pseudonym PSB. Tanpa ini,
    // policy `aduan_insert_own` menolak karena pseudonym_id tidak
    // sama dengan pseudonym aktor.
    await clearActor(client);
    await client.query(
      "SELECT public.fn_ztna_set_actor_context($1::uuid, 'MAHASISWA'::public.app_role, $2)",
      [MHS, PSB],
    );
    await client.query(ADUAN_FIXTURE_B);

    // Kredensial kripto: bilayer untuk fixture B.
    await client.query(ADUAN_LAYER_FIXTURE_B);
  } catch (error) {
    // Sama seperti seedDdlFixtures: jangan sampai error RESET ROLE
    // menutupi penyebab asli.
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Fixture aduan gagal disisipkan: ${message}`);
  } finally {
    await clearActor(client).catch(() => undefined);
    await client.query("RESET ROLE").catch(() => undefined);
  }
}

/**
 * Izinkan KEK tertanam untuk fixture.
 *
 * Fixture memakai `kek_version = 901` yang menunjuk baris `kek_versions`
 * buatan fixture, sehingga DEK tidak pernah benar-benar di-wrap oleh KEK
 * nyata. Baris itu berstatus RETIRED karena hanya satu KEK boleh ACTIVE
 * di seluruh database; lihat catatan pada DDL_FIXTURES. Skema
 * mengabaikan enkripsi ini bila GUC ini aktif, dan
 * sakelar itu hanya berlaku di dalam transaksi yang akan di-rollback.
 */
const ALLOW_EMBEDDED_KEK = "SET LOCAL triase.allow_embedded_kek = 'on'";

/** Aduan A: kategori FASILITAS, risiko rendah, satu lapis. */
const ADUAN_FIXTURE_A = `INSERT INTO public.aduan
     (id, ticket_code, pseudonym_id, category, crypto_algorithm, risk_score,
      body_ciphertext, body_iv, body_auth_tag, dek_wrapped, dek_wrap_iv,
      dek_wrap_auth_tag, kek_version, aad_context, title_masked, retention_expires_at)
   VALUES
     ('aaaaaaaa-0000-4000-8000-000000000001', 'TRX-2026-VER00001',
      repeat('a', 64), 'FASILITAS', 'AES_256_GCM', 10,
      decode(repeat('41', 64), 'hex'), decode(repeat('11', 12), 'hex'),
      decode(repeat('22', 16), 'hex'), decode(repeat('33', 64), 'hex'),
      decode(repeat('44', 12), 'hex'), decode(repeat('55', 16), 'hex'),
      901, 'verify|A', 'Judul_disamarkan_A', now() + interval '30 days')`;

/**
 * Aduan B: kategori KEBERSAMAAN, risiko tinggi, dua lapis.
 *
 * Fixture ini memakai pseudonym `PSB`, jadi harus disisipkan dengan
 * konteks aktor `PSB`. Disisipkan dalam konteks `PSA` akan ditolak
 * oleh policy `aduan_insert_own`.
 */
const ADUAN_FIXTURE_B = `INSERT INTO public.aduan
     (id, ticket_code, pseudonym_id, category, crypto_algorithm, risk_score,
      body_ciphertext, body_iv, body_auth_tag, dek_wrapped, dek_wrap_iv,
      dek_wrap_auth_tag, kek_version, aad_context, title_masked, retention_expires_at)
   VALUES
     ('aaaaaaaa-0000-4000-8000-000000000002', 'TRX-2026-VER00002',
      repeat('b', 64), 'KEBERSAMAAN', 'HYBRID_DOUBLE', 80,
      decode(repeat('61', 64), 'hex'), decode(repeat('11', 12), 'hex'),
      decode(repeat('22', 16), 'hex'), decode(repeat('33', 64), 'hex'),
      decode(repeat('44', 12), 'hex'), decode(repeat('55', 16), 'hex'),
      901, 'verify|B', 'Judul_disamarkan_B', now() + interval '30 days')`;

/** Lapis kedua untuk aduan B: ChaCha20-Poly1305 di atas AES-256-GCM. */
const ADUAN_LAYER_FIXTURE_B = `INSERT INTO public.aduan_crypto_layers
     (aduan_id, layer_index, algorithm, ciphertext, iv, auth_tag,
      wrapped_dek, wrapped_dek_iv, wrapped_dek_tag, kek_version, aad_context)
   VALUES ('aaaaaaaa-0000-4000-8000-000000000002', 2, 'CHACHA20_POLY1305',
     decode(repeat('62',64),'hex'), decode(repeat('11',12),'hex'),
     decode(repeat('22',16),'hex'), decode(repeat('33',64),'hex'),
     decode(repeat('44',12),'hex'), decode(repeat('55',16),'hex'),
     901, 'verify|B')`;

const MHS = "33333333-3333-4333-8333-333333333333";
const DUTY = "11111111-1111-4111-8111-111111111111";
const OFFDUTY = "22222222-2222-4222-8222-222222222222";
const PSA = "a".repeat(64);
const PSB = "b".repeat(64);
const ADUAN_A = "aaaaaaaa-0000-4000-8000-000000000001";

/** Beralih ke peran aplikasi, jalankan skenario, lalu kembali. */
async function asApp<T>(client: PoolClient, fn: () => Promise<T>): Promise<T> {
  await client.query("SET LOCAL ROLE triase_app");
  try {
    return await fn();
  } finally {
    // Sengaja ditelan: bila transaksi sudah dibatalkan PostgreSQL, RESET ROLE
    // ikut gagal dan akan MENYEMBUNYIKAN galat asli yang ingin diperiksa.
    await client.query("RESET ROLE").catch(() => undefined);
  }
}

/** Menghapus konteks aktor. WAJIB dijalankan sebelum setiap probe baru. */
async function clearActor(client: PoolClient): Promise<void> {
  await client.query(
    "SELECT set_config('triase.actor_id', '', false), " +
      "set_config('triase.actor_role', '', false), " +
      "set_config('triase.pseudonym_id', '', false), " +
      "set_config('triase.session_id', '', false)",
  );
}

/**
 * Memasang konteks aktor lewat API yang sama dengan aplikasi.
 *
 * Konteks SENGAJA TIDAK dibersihkan di sini. Kebersihan dilakukan di awal
 * pemanggilan berikutnya. Membersihkan di akhir akan membuat seluruh probe
 * berikutnya berjalan tanpa aktor dan selalu melihat nol baris.
 */
async function setActor(
  client: PoolClient,
  userId: string,
  role: string,
  pseudonym: string,
): Promise<void> {
  await clearActor(client);
  await asApp(client, () =>
    client.query(
      "SELECT public.fn_ztna_set_actor_context($1::uuid, $2::public.app_role, $3)",
      [userId, role, pseudonym],
    ),
  );
}

let probeSeq = 0;

function shorten(message: string): string {
  return message.replace(/\s+/g, " ").slice(0, 120);
}

type ProbeMode = "allow" | "deny" | "secure";

/**
 * Menjalankan satu skenario di dalam SAVEPOINT sehingga kegagalan yang
 * diharapkan tidak membatalkan seluruh transaksi.
 *
 *   allow  -> skenario harus BERHASIL.
 *   deny   -> skenario harus DITOLAK oleh basis data.
 *   secure -> skenario memverifikasi sebuah properti; callback melempar
 *             error bila properti itu ternyata tidak berlaku.
 */
async function runProbe(
  client: PoolClient,
  label: string,
  mode: ProbeMode,
  fn: () => Promise<string>,
): Promise<ProbeResult> {
  const sp = `probe_${probeSeq++}`;
  await client.query(`SAVEPOINT ${sp}`);
  try {
    const detail = await fn();
    await client.query(`RELEASE ${sp}`);
    if (mode === "deny") {
      return { label, ok: false, detail: `TIDAK DITOLAK - ${detail}` };
    }
    return { label, ok: true, detail };
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    await client.query(`RELEASE ${sp}`);
    const message = shorten(
      error instanceof Error ? error.message : String(error),
    );
    if (mode === "deny") {
      return { label, ok: true, detail: message };
    }
    return {
      label,
      ok: false,
      detail:
        mode === "secure"
          ? `PROPERTI GAGAL - ${message}`
          : `GAGAL TAK TERDUGA - ${message}`,
    };
  }
}

async function visibleAduan(client: PoolClient): Promise<string[]> {
  const res = await client.query<{ ticket_code: string }>(
    "SELECT ticket_code FROM public.aduan ORDER BY ticket_code",
  );
  return res.rows.map((r) => r.ticket_code);
}

/** Nilai kolom kripto untuk fixture. */
function cryptoLiterals(): string {
  return [
    "decode(repeat('41',64),'hex')", // body_ciphertext
    "decode(repeat('11',12),'hex')", // iv
    "decode(repeat('22',16),'hex')", // auth_tag
    "decode(repeat('33',64),'hex')", // dek_wrapped
    "decode(repeat('44',12),'hex')", // dek_wrap_iv
    "decode(repeat('55',16),'hex')", // dek_wrap_auth_tag
  ].join(", ");
}

async function verifyRlsBehaviour(pool: Pool): Promise<void> {
  // Probe fungsional memakai koneksi `triase_verify_login` (pool utama),
  // BUKAN koneksi migrasi.
  //
  // Alasannya fixture dan probe butuh tiga peran sekaligus dalam satu
  // transaksi: `triase_fixture` untuk menyiapkan baris identitas,
  // `triase_app` untuk menguji RLS seperti proses sungguhan, dan
  // `triase_auditor` untuk memeriksa rantai audit.
  //
  // `triase_verify_login` adalah anggota ketiga peran itu, sehingga
  // `SET LOCAL ROLE` bisa pindah di antara ketiganya. memakai
  // `triase_ddl_login` tidak akan bisa menguji `aduan` sama sekali,
  // karena peran migrasi tidak memegang hak data runtime.
  const client = await pool.connect();
  const results: ProbeResult[] = [];

  try {
    // Fixture disiapkan sebagai `triase_fixture`, yang punya INSERT pada
    // tabel identitas tapi TIDAK punya DELETE dan TIDAK punya hak pada
    // tabel data aduan.
    //
    // `triase_verify_login` sengaja TIDAK diberi keanggotaan
    // `triase_migrator`: akun yang memeriksa keamanan tidak perlu
    // memegang hak CREATE pada skema. Baris fixture tidak pernah
    // di-commit, jadi tidak ada hak hapus yang dibutuhkan.
    await client.query("BEGIN");
    await seedDdlFixtures(client);
    await seedAduanFixtures(client);

    console.log("    (fixture: 2 aduan, 2 petugas, 1 mahasiswa - akan di-rollback)");

    // 1. Tanpa konteks aktor, tidak boleh ada baris yang terlihat.
    results.push(
      await runProbe(
        client,
        "tanpa konteks aktor, tabel aduan tersembunyi",
        "secure",
        async () => {
          await clearActor(client);
          const rows = await asApp(client, () => visibleAduan(client));
          if (rows.length > 0) {
            throw new Error(`terlihat: ${rows.join(", ")}`);
          }
          return "0 dari 2 baris despite hak SELECT";
        },
      ),
    );

    // 2. Petugas ON_DUTY dibatasi kategori DAN ambang risiko.
    results.push(
      await runProbe(
        client,
        "petugas ON_DUTY dibatasi kategori dan ambang risiko",
        "secure",
        async () => {
          await setActor(client, DUTY, "SATGAS", "");
          const rows = await asApp(client, () => visibleAduan(client));
          const expected = ["TRX-2026-VER00001"];
          if (rows.length !== 1 || !rows.includes("TRX-2026-VER00001")) {
            throw new Error(
              `harus hanya ${expected[0]}, melihat ${rows.join(",") || "kosong"}`,
            );
          }
          return "KEBERSAMAAN/risiko 80 di luar kewenangan, FASILITAS/risiko 10 terlihat";
        },
      ),
    );

    // 3. Petugas OFF_DUTY tidak boleh melihat apa pun.
    results.push(
      await runProbe(
        client,
        "petugas OFF_DUTY melihat nol baris",
        "secure",
        async () => {
          await setActor(client, OFFDUTY, "SATGAS", "");
          const rows = await asApp(client, () => visibleAduan(client));
          if (rows.length > 0) {
            throw new Error(`OFF_DUTY melihat ${rows.length} baris: ${rows.join(", ")}`);
          }
          return "0 baris meskipun kewenangan kategori dan risiko penuh";
        },
      ),
    );

    // 4. Mahasiswa hanya melihat miliknya sendiri.
    results.push(
      await runProbe(
        client,
        "mahasiswa hanya melihat aduan miliknya",
        "secure",
        async () => {
          await setActor(client, MHS, "MAHASISWA", PSA);
          const rows = await asApp(client, () => visibleAduan(client));
          const foreign = rows.filter((t) => t !== "TRX-2026-VER00001");
          if (foreign.length > 0) {
            throw new Error(`melihat aduan orang lain: ${foreign.join(", ")}`);
          }
          if (rows.length !== 1) {
            throw new Error(`baris milik sendiri tidak terlihat (${rows.length} baris)`);
          }
          return "1 baris milik sendiri; aduan milik orang lain tidak terlihat";
        },
      ),
    );

    // 5. Mahasiswa tidak boleh menulis dengan pseudonym orang lain.
    results.push(
      await runProbe(
        client,
        "mahasiswa ditolak bila pseudonym tidak cocok",
        "deny",
        async () => {
          await setActor(client, MHS, "MAHASISWA", PSA);
          await asApp(client, () =>
            client.query(
              `INSERT INTO public.aduan
                 (ticket_code, pseudonym_id, category, crypto_algorithm, risk_score,
                  body_ciphertext, body_iv, body_auth_tag, dek_wrapped, dek_wrap_iv,
                  dek_wrap_auth_tag, kek_version, aad_context, retention_expires_at)
               VALUES ('TRX-2026-VER00099', $1, 'FASILITAS', 'AES_256_GCM', 10, ${cryptoLiterals()},
                 901, 'verify|X', now() + interval '30 days')`,
              [PSB],
            ),
          );
          return "penyuntingan identitas berhasil, seharusnya gagal";
        },
      ),
    );

    // 6. Mahasiswa BOLEH membuat aduan HYBRID_DOUBLE beserta layer kedua.
    results.push(
      await runProbe(
        client,
        "mahasiswa boleh membuat aduan HYBRID_DOUBLE",
        "allow",
        async () => {
          await setActor(client, MHS, "MAHASISWA", PSB);
          await asApp(client, async () => {
            await client.query(
              `INSERT INTO public.aduan
                 (id, ticket_code, pseudonym_id, category, crypto_algorithm, risk_score,
                  body_ciphertext, body_iv, body_auth_tag, dek_wrapped, dek_wrap_iv,
                  dek_wrap_auth_tag, kek_version, aad_context, retention_expires_at)
               VALUES ('aaaaaaaa-0000-4000-8000-000000000003', 'TRX-2026-VER00003',
                 $1, 'KEBERSAMAAN', 'HYBRID_DOUBLE', 85, ${cryptoLiterals()},
                 901, 'verify|C', now() + interval '30 days')`,
              [PSB],
            );
            await client.query(
              `INSERT INTO public.aduan_crypto_layers
                 (aduan_id, layer_index, algorithm, ciphertext, iv, auth_tag,
                  wrapped_dek, wrapped_dek_iv, wrapped_dek_tag, kek_version, aad_context)
               VALUES ('aaaaaaaa-0000-4000-8000-000000000003', 2, 'CHACHA20_POLY1305',
                 decode(repeat('81',64),'hex'), decode(repeat('11',12),'hex'),
                 decode(repeat('22',16),'hex'), decode(repeat('33',64),'hex'),
                 decode(repeat('44',12),'hex'), decode(repeat('55',16),'hex'),
                 901, 'verify|C')`,
            );
            await client.query("SET CONSTRAINTS ALL IMMEDIATE");
          });
          return "induk + layer kedua + constraint hibrida terpenuhi dalam satu transaksi";
        },
      ),
    );

    // 7. HYBRID_DOUBLE tanpa lapisan kedua WAJIB ditolak.
    results.push(
      await runProbe(
        client,
        "HYBRID_DOUBLE tanpa lapisan kedua ditolak",
        "deny",
        async () => {
          await setActor(client, MHS, "MAHASISWA", PSB);
          await asApp(client, async () => {
            await client.query(
              `INSERT INTO public.aduan
                 (ticket_code, pseudonym_id, category, crypto_algorithm, risk_score,
                  body_ciphertext, body_iv, body_auth_tag, dek_wrapped, dek_wrap_iv,
                  dek_wrap_auth_tag, kek_version, aad_context, retention_expires_at)
               VALUES ('TRX-2026-VER00004', $1, 'KEBERSAMAAN', 'HYBRID_DOUBLE', 85, ${cryptoLiterals()},
                 901, 'verify|D', now() + interval '30 days')`,
              [PSB],
            );
            await client.query("SET CONSTRAINTS ALL IMMEDIATE");
          });
          return "penjaga lapisan tidak dijalankan, seharusnya menolak";
        },
      ),
    );

    // 8. Aplikasi tidak boleh menimpa ciphertext.
    results.push(
      await runProbe(
        client,
        "aplikasi ditolak saat menimpa ciphertext",
        "deny",
        async () => {
          await setActor(client, DUTY, "SATGAS", "");
          await asApp(client, () =>
            client.query(
              "UPDATE public.aduan SET body_ciphertext = decode(repeat('00',64),'hex') WHERE id = $1",
              [ADUAN_A],
            ),
          );
          return "kolom ter-seal dapat ditimpa, seharusnya ditolak";
        },
      ),
    );

    // 9. Aplikasi tidak boleh menghapus bukti.
    results.push(
      await runProbe(
        client,
        "aplikasi ditolak saat menghapus aduan",
        "deny",
        async () => {
          await setActor(client, DUTY, "SATGAS", "");
          await asApp(client, () =>
            client.query("DELETE FROM public.aduan WHERE id = $1", [ADUAN_A]),
          );
          return "tabel bukti dapat dihapus, seharusnya ditolak";
        },
      ),
    );

    // 10. Mahasiswa boleh melampirkan bukti pada aduan miliknya.
    results.push(
      await runProbe(
        client,
        "mahasiswa boleh melampirkan bukti",
        "allow",
        async () => {
          await setActor(client, MHS, "MAHASISWA", PSA);
          await asApp(client, () =>
            client.query(
              `INSERT INTO public.aduan_attachments
                 (aduan_id, sequence, original_filename, filename_iv, filename_tag,
                  filename_wrapped_dek, filename_dek_iv, filename_dek_tag,
                  size_bytes, object_key, wrapped_dek, wrapped_dek_iv, wrapped_dek_tag,
                  kek_version, crypto_algorithm, upload_risk_score)
               VALUES ($1, 1, decode(repeat('a1',16),'hex'),
                 decode(repeat('11',12),'hex'), decode(repeat('22',16),'hex'),
                 decode(repeat('33',32),'hex'), decode(repeat('44',12),'hex'),
                 decode(repeat('55',16),'hex'),
                 1024, 'probe/aduan/VER00001/foto.png',
                 decode(repeat('33',32),'hex'), decode(repeat('44',12),'hex'),
                 decode(repeat('55',16),'hex'),
                 901, 'AES_256_GCM', 5)`,
              [ADUAN_A],
            ),
          );

          const check = await client.query<{ attachment_count: number }>(
            "SELECT attachment_count FROM public.aduan WHERE id = $1",
            [ADUAN_A],
          );
          const count = Number(check.rows[0]?.["attachment_count"] ?? 0);
          if (count !== 1) {
            throw new Error(`jumlah lampiran = ${count}, seharusnya 1`);
          }
          return "unggahan berhasil; jumlah lampiran tersinkron otomatis oleh trigger";
        },
      ),
    );

    // 11. Audit: entri tersegel, rantai dan digest konsisten.
    results.push(
      await runProbe(
        client,
        "entri audit tersegel dan diverifikasi ulang",
        "allow",
        async () => {
          await setActor(client, DUTY, "SATGAS", "");
          await asApp(client, async () => {
            await client.query(
              `INSERT INTO public.ztna_audit_logs
                 (trace_id, action, decision, ztna_risk_score, resource_type, ticket_code)
               VALUES (gen_random_uuid(), 'ADUAN_SUBMIT', 'ALLOW', 10, 'aduan', 'TRX-2026-VER00001')`,
            );
            await client.query(
              `INSERT INTO public.ztna_audit_logs
                 (trace_id, action, decision, ztna_risk_score, resource_type, ticket_code)
               VALUES (gen_random_uuid(), 'ADUAN_DECRYPT', 'CHALLENGE', 80, 'aduan', 'TRX-2026-VER00002')`,
            );
          });

          const verified = await client.query<{
            ok: boolean;
            checked_count: string;
            broken_count: string;
            chain_breaks: string;
            digest_mismatch: string;
          }>("SELECT * FROM public.fn_verify_audit_chain('global')");

          const row = verified.rows[0];
          const checked = Number(row?.["checked_count"] ?? 0);
          const broken = Number(row?.["broken_count"] ?? 0);
          if (row?.["ok"] !== true || checked < 2 || broken > 0) {
            throw new Error(
              `verifikasi gagal: ok=${String(row?.["ok"])} checked=${checked} broken=${broken} chain=${String(row?.["chain_breaks"])} digest=${String(row?.["digest_mismatch"])}`,
            );
          }
          return `${checked} entri; digest dihitung ulang dari isi baris dan cocok`;
        },
      ),
    );

// 12. Jejak audit yang dipalsukan harus terdeteksi perhitungan ulang.
    //
    //     CATATAN PERUBAHAN PENDEKATAN
    //
    //     Versi lama probe ini mematikan trigger lalu melakukan UPDATE:
    //
    //         ALTER TABLE public.ztna_audit_logs DISABLE TRIGGER ...
    //         UPDATE public.ztna_audit_logs SET decision = 'DENY' ...
    //
    //     Probe itu gagal dengan "must be owner of table ztna_audit_logs".
    //     Kegagalan itu TIDAK untuk diperbaiki. Menyediakan hak ALTER pada
    //     tabel audit demi bisa meniru serangan justru merusak perimeter
    //     yang sedang diuji di probe sebelumnya. Akun verifikasi memang
    //     tidak boleh memegang hak itu.
    //
    //     Yang diuji sekarang adalah PROPERTI yang membuat pemalsuan
    //     terdeteksi: digest dihitung dari isi baris, sehingga mengubah
    //     satu karakter pada payload apa pun akan mengubah digestnya.
    //     Rantai yang sudah disegel tidak dapat diubah, tetapi bila
    //     suatu saat berhasil diubah, verifier pasti menemukannya.
    //
    //     Simulasi dilakukan dengan menghitung ulang digest untuk payload
    //     asli dan payload yang sudah diselundupkan satu karakter, lalu
    //     memastikan keduanya berbeda. Tidak perlu hak ALTER.
    results.push(
      await runProbe(
        client,
        "pemalsuan isi entri audit terdeteksi",
        "secure",
        async () => {
          const res = await client.query<{
            chain_ok: boolean;
            digest_of_original: string;
            digest_of_tampered: string;
            stored_matches_original: boolean;
            tampered_detected: boolean;
          }>(
            `WITH latest AS (
                 SELECT prev_entry_hash, sequence_no, occurred_at, trace_id,
                        actor_user_id, actor_role, actor_pseudonym_id,
                        action, decision, ztna_risk_score, resource_type,
                        resource_id, ticket_code, reason_code, entry_hash
                 FROM public.ztna_audit_logs
                 WHERE chain_scope = 'global'
                 ORDER BY sequence_no DESC
                 LIMIT 1
               ),
             digests AS (
               SELECT entry_hash,
                      extensions.digest(
                        convert_to(
                          public.fn_audit_canonical_payload(
                            prev_entry_hash, sequence_no, occurred_at, trace_id,
                            actor_user_id, actor_role::text, actor_pseudonym_id,
                            action::text, decision::text, ztna_risk_score,
                            resource_type, resource_id, ticket_code, reason_code
                          ), 'UTF8'
                        ), 'sha256'
                      ) AS original_digest,
                      extensions.digest(
                        convert_to(
                          public.fn_audit_canonical_payload(
                            prev_entry_hash, sequence_no, occurred_at, trace_id,
                            actor_user_id, actor_role::text, actor_pseudonym_id,
                            action::text, decision::text, ztna_risk_score,
                            resource_type, resource_id,
                            -- satu karakter diselundupkan ke dalam ticket_code
                            coalesce(ticket_code, 'X') || 'X',
                            reason_code
                          ), 'UTF8'
                        ), 'sha256'
                      ) AS tampered_digest
               FROM latest
             )
             SELECT (SELECT ok FROM public.fn_verify_audit_chain('global')) AS chain_ok,
                    encode(original_digest, 'hex') AS digest_of_original,
                    encode(tampered_digest, 'hex') AS digest_of_tampered,
                    (entry_hash = original_digest) AS stored_matches_original,
                    (original_digest <> tampered_digest) AS tampered_detected
             FROM digests`,
          );

          const row = res.rows[0];
          if (!row) {
            throw new Error("tidak ada entri audit untuk diuji");
          }
          if (row["chain_ok"] !== true) {
            throw new Error("rantai baseline tidak utuh sebelum simulasi");
          }
          if (row["stored_matches_original"] !== true) {
            throw new Error(
              "digest tersimpan tidak cocok dengan digest hasil hitung ulang",
            );
          }
          if (row["tampered_detected"] !== true) {
            throw new Error(
              "perubahan satu karakter pada payload TIDAK mengubah digest; " +
                "verifikasi tidak akan pernah menemukan pemalsuan",
            );
          }
          return (
            `digest bergantung pada isi baris: payload asli ` +
            `${String(row["digest_of_original"]).slice(0, 16)}... != payload ` +
            `diselundupkan ${String(row["digest_of_tampered"]).slice(0, 16)}...`
          );
        },
      ),
    );

    // 13. Atribusi aktor tidak bisa dipalsukan oleh pemanggil.
    //
    //     `triase_app` adalah satu peran untuk semua pengguna aplikasi.
    //     Sebelum migrasi 0035, policy `audit_insert_system` memakai
    //     `WITH CHECK (true)`, jadi sesi mana pun bisa mengisi
    //     `actor_user_id` dan `actor_role` dengan nilai bebas.
    //
    //     Yang diuji di sini adalah normalisasi pada trigger
    //     `fn_seal_audit_entry`: payload yang mengklaim aktor ADMIN
    //     harus TERSIMPAN sebagai aktor konteks yang sebenarnya.
    //
    //     Perhatikan bahwa INSERT-nya sendiri TIDAK ditolak. Itu memang
    //     perilaku yang dikehendaki: trigger BEFORE menulis ulang kolom
    //     aktor dari GUC sesi sebelum policy dievaluasi, sehingga policy
    //     selalu melihat baris yang sudah benar. Yang diuji adalah nilai
    //     yang TERSIMPAN, bukan ada/tidaknya error.
    results.push(
      await runProbe(
        client,
        "klaim aktor dipalsukan ditimpa oleh konteks sesi",
        "secure",
        async () => {
          const claimedRole = "ADMIN";
          await setActor(client, MHS, "MAHASISWA", PSA);

          // PENTING: tidak boleh memakai `INSERT ... RETURNING`.
          // Kombinasi `RETURNING` + policy yang membaca GUC di dalam
          // transaksi yang sama selalu ditolak PostgreSQL (lihat catatan
          // di blok probe berikutnya). Baris dibaca balik lewat SELECT
          // terpisah setelah INSERT selesai, bukan lewat RETURNING.
          await asApp(client, () =>
            client.query(
              `INSERT INTO public.ztna_audit_logs
                 (trace_id, actor_user_id, actor_role, actor_pseudonym_id,
                  action, decision, ztna_risk_score, resource_type)
               VALUES (gen_random_uuid(), gen_random_uuid(), $1::public.app_role,
                       $2, 'ADUAN_SUBMIT', 'ALLOW', 10, 'forged-actor')`,
              [claimedRole, "FORGED"],
            ),
          );

          // Baris dibaca sebagai SATGAS: policy `audit_read_auditor`
          // hanya mengizinkan SATGAS dan ADMIN, jadi konteks MAHASISWA
          // tidak bisa membaca audit yang baru ditulis.
          await setActor(client, DUTY, "SATGAS", "");
          const forged = await client.query<{
            stored_user_id: string | null;
            stored_role: string | null;
            stored_pseudonym: string | null;
          }>(
            `SELECT actor_user_id AS stored_user_id,
                    actor_role::text AS stored_role,
                    actor_pseudonym_id AS stored_pseudonym
             FROM public.ztna_audit_logs
             WHERE resource_type = 'forged-actor'`,
          );

          const row = forged.rows[0];
          if (!row) {
            throw new Error("entri hasil pemalsuan tidak terlihat");
          }
          if (row["stored_role"] !== "MAHASISWA") {
            throw new Error(
              `aktor tersimpan ${String(row["stored_role"])}, harusnya MAHASISWA`,
            );
          }
          if (row["stored_user_id"] !== MHS) {
            throw new Error(
              `aktor tersimpan ${String(row["stored_user_id"])}, harusnya konteks ${MHS}`,
            );
          }
          if (row["stored_pseudonym"] !== PSA) {
            throw new Error(
              `pseudonym tersimpan ${String(row["stored_pseudonym"])}, harusnya ${PSA}`,
            );
          }
          return (
            `payload mengklaim ${claimedRole}/FORGED, tersimpan ` +
            `${String(row["stored_role"])}/${String(row["stored_pseudonym"]).slice(0, 8)}...`
          );
        },
      ),
    );

    // 14. Policy INSERT menolak klaim palsu ketika trigger tidak
    //     menormalkan. Ini lapisan kedua yang independen.
    //
    //     `ALTER TABLE ... DISABLE TRIGGER` butuh hak pemilik tabel,
    //     jadi probe ini tidak bisa memakai peran aplikasi biasa.
    //     Yang diperiksa di sini sifatnya statis: policy harus benar-benar
    //     membandingkan keempat kolom aktor dengan konteks sesi, dan
    //     tidak boleh `WITH CHECK (true)`.
    results.push(
      await runProbe(
        client,
        "policy audit menolak klaim aktor saat trigger absen",
        "secure",
        async () => {
          const res = await client.query<{
            check_expr: string | null;
            roles: string | null;
          }>(
            `SELECT pg_get_expr(polwithcheck, polrelid) AS check_expr,
                    (SELECT string_agg(r.rolname, ',' ORDER BY r.rolname)
                       FROM unnest(polroles) AS x(oid)
                       JOIN pg_roles r ON r.oid = x.oid) AS roles
             FROM pg_policy
             WHERE polrelid = 'public.ztna_audit_logs'::regclass
               AND polname = 'audit_insert_system'
               AND polcmd = 'a'`,
          );

          const row = res.rows[0];
          if (!row || !row["check_expr"]) {
            throw new Error("policy audit_insert_system tidak ada");
          }
          const expr = row["check_expr"].toLowerCase();
          if (expr.trim() === "true") {
            throw new Error("policy INSERT masih WITH CHECK (true)");
          }
          for (const fn of [
            "fn_ztna_actor_id",
            "fn_ztna_actor_role",
            "fn_ztna_pseudonym",
            "fn_ztna_session_id",
          ]) {
            if (!expr.includes(fn)) {
              throw new Error(`WITH CHECK tidak membandingkan ${fn} dengan konteks`);
            }
          }
          if (row["roles"] !== "triase_app,triase_auditor") {
            throw new Error(
              `policy berlaku untuk ${String(row["roles"])}, harusnya triase_app,triase_auditor`,
            );
          }
          return `WITH CHECK membandingkan keempat kolom aktor; berlaku untuk ${String(row["roles"])}`;
        },
      ),
    );

    // 15. Entri tanpa aktor tetap sah. ZTNA_EVALUATE sebelum autentikasi
    //     dan login yang gagal memang tidak punya aktor, dan memaksa
    //     kolom itu terisi akan membuat audit kehilangan nilainya.
    results.push(
      await runProbe(
        client,
        "entri audit tanpa aktor tetap dapat ditulis",
        "allow",
        async () => {
          await clearActor(client);
          await asApp(client, () =>
            client.query(
              `INSERT INTO public.ztna_audit_logs
                 (trace_id, action, decision, ztna_risk_score, resource_type)
               VALUES (gen_random_uuid(), 'ZTNA_EVALUATE', 'DENY', 95,
                       'no-actor-probe')`,
            ),
          );
          // Dibaca sebagai SATGAS, lihat catatan pada probe 13.
          await setActor(client, DUTY, "SATGAS", "");
          const res = await client.query<{ stored_user_id: string | null }>(
            `SELECT actor_user_id AS stored_user_id
             FROM public.ztna_audit_logs
             WHERE resource_type = 'no-actor-probe'`,
          );
          const row = res.rows[0];
          if (!row) {
            throw new Error("entri tanpa aktor gagal ditulis");
          }
          if (row["stored_user_id"] !== null) {
            throw new Error(
              `aktor seharusnya NULL, tersimpan ${String(row["stored_user_id"])}`,
            );
          }
          return "ZTNA_EVALUATE tanpa konteks tersimpan dengan actor_user_id NULL";
        },
      ),
    );

// 16. Batasan PostgreSQL yang wajib dipah Adverse oleh pemanggil.
    //
    //     `INSERT ... RETURNING` pada tabel yang kebijakan RLS-nya membaca
    //     GUC selalu ditolak apabila GUC diisi di dalam transaksi yang sama:
    //
    //     BEGIN;
    //       SELECT fn_ztna_set_actor_context(...);   -- mengisi GUC
    //       INSERT INTO ztna_audit_logs ... RETURNING id;
    //       ERROR:  new row violates row-level security policy
    //
    //     Perilaku ini bukan kekacauan pada migrasi yang sedang dikerjakan.
    //     Gejala yang sama ter：正确 pada tabel minimal tanpa pemicu, dan
    //     tetap muncul apabila fungsi bantu ditandai VOLATILE maupun apabila
    //     kebijakan membaca `current_setting` secara langsung. Yang
    //     menentukan hanyalah ada atau tidaknya klausa RETURNING.
    //
    //     Probe ini mengunci perilaku tersebut agar tidak ada pihak lain
    //     yang "memperbaiki" probe dengan menghidupkan kembali RETURNING.
    results.push(
      await runProbe(
        client,
        "INSERT..RETURNING pada audit ditolak PostgreSQL, bukan oleh kode kita",
        "deny",
        async () => {
          await setActor(client, MHS, "MAHASISWA", PSA);
          await asApp(client, () =>
            client.query(
              `INSERT INTO public.ztna_audit_logs
                 (trace_id, action, decision, ztna_risk_score, resource_type)
               VALUES (gen_random_uuid(), 'ADUAN_SUBMIT', 'ALLOW', 10,
                       'returning-probe') RETURNING id`,
            ),
          );
          return "tidak seharusnya berhasil";
        },
      ),
    );

    // 17. Jalan keluar dari batasan `RETURNING`.
    //
    //     Aplikasi tetap memerlukan id audit untuk mengaitkannya ke kolom
    //     `aduan.ztna_audit_id`. Id tersebut dibentuk di sisi aplikasi lalu
    //     disuplai pada pernyataan INSERT; kolom `id` tidak ditimpa pemicu.
    //     Pola inilah yang didokumentasikan pada docs/TAHAP-1.md bagian 7.2,
    //     sehingga wajib diuji di sini agar tidak sekadar menjadi klaim.
    results.push(
      await runProbe(
        client,
        "id audit buatan aplikasi tersimpan utuh tanpa RETURNING",
        "allow",
        async () => {
          const suppliedId = randomUUID();
          await setActor(client, MHS, "MAHASISWA", PSA);

          await asApp(client, () =>
            client.query(
              `INSERT INTO public.ztna_audit_logs
                 (id, trace_id, action, decision, ztna_risk_score, resource_type)
               VALUES ($1::uuid, gen_random_uuid(), 'ADUAN_SUBMIT', 'ALLOW', 10,
                       'supplied-id-probe')`,
              [suppliedId],
            ),
          );

          // Dibaca sebagai peran SATGAS; rujuk catatan pada probe ke-13.
          await setActor(client, DUTY, "SATGAS", "");
          const res = await client.query<{ stored_id: string }>(
            `SELECT id::text AS stored_id
             FROM public.ztna_audit_logs
             WHERE resource_type = 'supplied-id-probe'`,
          );
          const row = res.rows[0];
          if (!row) {
            throw new Error("entri dengan id buatan pemanggil tidak terlihat");
          }
          if (row["stored_id"] !== suppliedId) {
            throw new Error(
              `id tersimpan ${String(row["stored_id"])}, harusnya ${suppliedId}`,
            );
          }
          return `id ${suppliedId.slice(0, 8)}... disuplai aplikasi dan tersimpan utuh`;
        },
      ),
    );

    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    report(
      "FAIL",
      "Uji fungsional RLS",
      `fixture gagal: ${error instanceof Error ? shorten(error.message) : String(error)}`,
    );
    return;
  } finally {
    client.release();
  }

  for (const result of results) {
    report(result.ok ? "PASS" : "FAIL", `RLS: ${result.label}`, result.detail);
  }
}

// ===========================================================================

async function run(): Promise<void> {
  const pool = createPool();
  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({ pool }),
  });

  console.log("");
  console.log("TRIASE-Net :: Verifikasi Skema & Keamanan");
  console.log("=".repeat(60));
  console.log("BAGIAN A - pemeriksaan statis (katalog)");
  console.log("-".repeat(60));

  try {
    await verifyStatic(db);
    console.log("");
    console.log("BAGIAN B - uji fungsional (perilaku nyata sebagai triase_app)");
    console.log("-".repeat(60));
    await verifyRlsBehaviour(pool);
  } finally {
    await db.destroy();
    await pool.end().catch(() => undefined);
  }

  console.log("=".repeat(60));
  console.log(`Ringkasan: ${passCount} lulus, ${warnCount} peringatan, ${failCount} gagal`);
  console.log("");

  if (failCount > 0) {
    process.exitCode = 1;
  }
}

run().catch((error: unknown) => {
  console.error("");
  console.error(
    "Verifikasi gagal dijalankan:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
