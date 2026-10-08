# TAHAP 1 — Inisialisasi dan Perancangan Basis Data

Dokumen ini adalah rujukan arsitektur untuk TRIASE-Net. Seluruh keputusan
desain di sini akan dipakai ulang pada Tahap 2 (kriptografi), Tahap 3 (ZTNA
middleware), dan Tahap 4 (API).

---

## 1. Struktur Direktori

```
TRIASE-NET/
├── database/
│   ├── migrations/            # DDL, satu berkas = satu transaksi
│   │   ├── 0001_foundation.sql
│   │   ├── 0002_enum_types.sql
│   │   ├── 0003_functions_and_triggers.sql
│   │   ├── 0004_kek_versions.sql
│   │   ├── 0005_users.sql
│   │   ├── 0006_satgas_profiles.sql
│   │   ├── 0007_aduan.sql
│   │   ├── 0008_aduan_crypto_layers.sql
│   │   ├── 0009_aduan_attachments.sql
│   │   ├── 0010_aduan_status_history.sql
│   │   ├── 0011_ztna_audit_logs.sql
│   │   ├── 0012_auth_supporting.sql
│   │   ├── 0013_rls_policies.sql
│   │   └── 0014_grants_and_privileges.sql
│   └── seeds/                 # Data referensi & akun uji (opsional)
│
├── scripts/
│   ├── migrate.ts             # Runner migrasi (transaksional + checksum)
│   └── verify-db.ts           # Pemeriksaan skema & kontrol keamanan
│
├── src/
│   ├── middleware.ts          # TAHAP 3 — Policy Enforcement Point ZTNA
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── globals.css
│   │   ├── (student)/         # Route group: mahasiswa
│   │   │   ├──aduan/page.tsx        # TAHAP 4 — form aduan
│   │   │   └── lacak/page.tsx         # TAHAP 4 — pelacakan tiket
│   │   ├── satgas/             # Route group: satuan tugas
│   │   │   ├── masuk/page.tsx         # TAHAP 4 — login + MFA TOTP
│   │   │   ├── antrean/page.tsx       # TAHAP 4 — dashboard antrean
│   │   │   └── aduan/[ticket]/page.tsx# TAHAP 4 — detail & dekripsi
│   │   └── api/
│   │       ├── aduan/route.ts             # TAHAP 4 — POST /api/aduan
│   │       ├── satgas/masuk/route.ts
│   │       ├── satgas/decrypt/route.ts    # TAHAP 4 — POST /api/satgas/decrypt
│   │       └── ztna/audit/route.ts
│   ├── components/
│   │   ├── ui/                # Primitif: Button, Card, Badge, Table, Input
│   │   ├── ztna/              # RiskBadge, ContextPanel, ChallengeGate
│   │   ├── mahasiswa/ StudentForm.tsx      # Form aduan terenkripsi
│   │   └── satgas/            # QueueTable, FilterBar, DecryptPanel
│   └── lib/
│       ├── config/env.ts      # Validasi environment (Zod)
│       ├── domain/enums.ts    # Single source of truth nilai enum
│       ├── db/
│       │   ├── types.ts       # Tipe Kysely (type-safe)
│       │   └── client.ts      # Pool, withActorContext(), transaksi
│       ├── crypto/            # TAHAP 2
│       │   ├── adaptive.ts    # encryptAdaptive / decryptAdaptive
│       │   ├── envelope.ts    # DEK + KEK (AES-256-GCM)
│       │   ├── aead.ts        # AES-GCM & ChaCha20-Poly1305
│       │   └── pseudonym.ts   # HMAC-SHA256 + kode tiket
│       ├── ztna/              # TAHAP 3
│       │   ├── context.ts     # Ekstraksi konteks perangkat
│       │   ├── risk.ts        # Matriks & perhitungan risk score
│       │   ├── policy.ts      # Evaluasi kebijakan (ALLOW/CHALLENGE/DENY)
│       │   └── audit.ts       # Penulis entri audit
│       └── auth/              # TAHAP 3
│           ├── session.ts     # JWT (jose), rotasi refresh token
│           ├── password.ts    # Argon2id
│           ├── totp.ts        # TOTP 6 digit + challenge
│           └── oidc.ts        # Alur OIDC/SIB mahasiswa
│
├── docs/                      # Dokumen per tahap + diagram
├── tests/                     # TAHAP 5 — unit & integrasi
├── .env.example
├── eslint.config.mjs
├── next.config.ts
├── package.json
├── postcss.config.mjs
└── tsconfig.json
```

### Aturanoviasional

| Aturan | Penjelasan |
| --- | --- |
| Tidak ada `SELECT *` | Selalu sebutkan kolom. Melindungi diri bila skema berubah. |
| Query hanya di `src/lib/db` atau `route.ts` | Komponen klien tidak pernah menyentuh database. |
| Semua nilai enum dari `src/lib/domain/enums.ts` | Tidak ada magic string enum. |
| `decryptAdaptive()` hanya di server | Wajib `import "server-only"`. |
| Setiap perubahan skema = satu migrasi baru | Berkas yang sudah `applied` tidak boleh diubah. |

---

## 2. Peta Tabel

| Tabel | Peran | Data PII |
| --- | --- | --- |
| `users` | Aktor: mahasiswa, satgas, admin | Email institusi, nama (khusus tenaga) |
| `satgas_profiles` | Otorisasi + clearance + TOTP terenkripsi | NIP, unit kerja |
| `aduan` | **Hanya ciphertext** | Tidak ada |
| `aduan_crypto_layers` | Lapisan kedua (hybrid) | Tidak ada |
| `aduan_attachments` | Metadata lampiran terenkripsi | Nama berkas terenkripsi |
| `aduan_status_history` | Jejak perubahan status | Tidak ada |
| `ztna_audit_logs` | Log konteks akses append-only | Pseudonym, IP |
| `kek_versions` | Registri rotasi KEK | Material kunci (dev saja) |
| `ztna_sessions` | Sesi terikat konteks perangkat | Fingerprint (hash) |
| `refresh_tokens` | Rotasi token, deteksi reuse | Hash token |
| `mfa_challenges` | Tantangan TOTP tahap 2 | Hash kode |
| `aduan_rate_limits` | Pembatas laju anti-spam | Hash subjek |

### Relasi

```
users ──1:1── satgas_profiles
  │
  └──1:N── refresh_tokens, ztna_sessions

aduan ──1:N── aduan_crypto_layers     (layer_index >= 2, hanya bila HYBRID_DOUBLE)
  │     ──1:N── aduan_attachments
  │     ──1:N── aduan_status_history  ──(soft ref)──▶ ztna_audit_logs
  └──── ztna_audit_logs (tidak ada FK: tabel dipartisi)

kek_versions ──1:N──dipakai oleh semua ciphertext melalui kolom kek_version
```

---

## 3. Prinsip Zero-Knowledge di Level Basis Data

Prinsip ini bukan sekadar konvensi kode — ia **ditegakkan oleh CHECK constraint**
sehingga data tidak dapat violate bahkan oleh bug aplikasi.

```sql
-- MAHASISWA tidak boleh punya password lokal (harus OIDC)
CONSTRAINT users_mahasiswa_no_password_ck
    CHECK (role <> 'MAHASISWA' OR password_hash IS NULL),

-- MAHASISWA tidak boleh punya nama tampilan (identitas asli)
CONSTRAINT users_mahasiswa_no_display_name_ck
    CHECK (role <> 'MAHASISWA' OR display_name IS NULL),

-- Tenaga justru WAJIB punya keduanya
CONSTRAINT users_staff_credentials_ck
    CHECK (role = 'MAHASISWA'
        OR (password_hash LIKE '$argon2id$%' AND display_name IS NOT NULL)),
```

Tabel `aduan` sengaja **tidak punya** `reporter_user_id`. Relasi pelapor
digantikan `pseudonym_id` (HMAC-SHA256), sehingga admins basis data pun tidak
dapat memetakan Aduan ke identitas asli.

`npm run db:verify` memverifikasi hal ini secara otomatis: ia mencari kolom
berupa `nim`, `nik`, `reporter_name`, `body_plaintext`, dan sejenisnya pada
tabel `aduan`, dan **gagal** bila menemukan salah satunya.

---

## 4. Petakan Ancaman terhadap Kontrol Database

| Ancaman | Kontrol |
| --- | --- |
| SQL injection | Kysely memakai prepared parameter; tidak ada query string mentah. |
|Developer akses ke data|Ingin. Butuh DEK, perlu KEK. Tidak ada plaintext di DB. |
| Penyuntingan log audit | Trigger tolak UPDATE/DELETE + rantai hash SHA-256. |
| Penyuntingan riwayat status | Trigger tolak UPDATE/DELETE/TRUNCATE. |
| Privilege escalation via aplikasi | Peran `triase_app` tidak punya `BYPASSRLS`/`SUPERUSER`/`CREATEROLE`. |
| Pembacaan `password_hash` | Tidak ada di daftar `GRANT SELECT` tingkat kolom. |
| Penghapusan bukti | Tidak ada hak `DELETE` pada `aduan`; hanya crypto-shredding. |
| Cross-tenant access | RLS memfilter berdasarkan kategori, ambang risiko, dan status duty. |
| Row-swapping ciphertext | AAD mengikat `ticket_code` + `risk_band` + konteks ZTNA. |
| Rotasi kunci mendadak | `kek_version` pada setiap baris ciphertext. |
| DataKlaim basi | `updated_at` + trigger otomatis. |
| Token refresh dicuri | Rotasi token + deteksi reuse per `family_id`. |

---

## 5. Matriks Otorisasi RLS

| Aktor | Select `aduan` | Insert | Update | Delete |
| --- | --- | --- | --- | --- |
| MAHASISWA | `pseudonym_id` sendiri | `pseudonym_id` sendiri | — | — |
| SATGAS | kategori terotorisasi **dan** `risk_score <= max_decrypt_risk_score` **dan** `ON_DUTY` | — | kategori terotorisasi | — |
| ADMIN | seluruh kategori terotorisasi | ya | ya | — |
| *(tanpa konteks)* | tidak terlihat | ditolak | ditolak | ditolak |

`fn_ztna_max_decrypt_risk_score()` mengembalikan `0` bila akun sedang
`OFF_DUTY` atau mandatnya kedaluwarsa — sehingga akses dekripsi tertutup
otomatis tanpa perlu logika tambahan di aplikasi.

---

## 6. Enkripsi Adaptif dan Peta Kolom

Fungsi `encryptAdaptive(plainText, riskScore)` pada Tahap 2 menuliskan:

| riskScore | risk_band | `crypto_algorithm` | Struktur ciphertext |
| --- | --- | --- | --- |
| < 30 | `LOW` | `AES_256_GCM` | `aduan.body_*` |
| 30–69 | `MEDIUM` | `CHACHA20_POLY1305` | `aduan.body_*` |
| ≥ 70 | `HIGH` | `HYBRID_DOUBLE` | `aduan.body_*` + `aduan_crypto_layers` |

Semua variannya memakai **Envelope Encryption**: DEK acak 32 byte mengenkripsi
badan, lalu DEK dibungkus dengan KEK (`aduan.dek_wrapped`).

Trigger `fn_guard_crypto_layers` menolak bila `crypto_algorithm =
'HYBRID_DOUBLE'` tanpa baris di `aduan_crypto_layers`, atau sebaliknya.

---

## 7. Audit Rantai Hash

```
entry_hash[n] = SHA256( entry_hash[n-1] || payload_kanonik[n] )
```

- `pg_advisory_xact_lock` mencegah dua INSERT paralel membuat *fork*.
- `npm run db:verify` memanggil `fn_verify_audit_chain('global')` untuk
  memastikan rantai utuh.
- Kolom `chain_scope` memungkinkan rantai terpisah per lingkup bila volume
  tumbuh besar.

### 7.1 Atribusi Aktor Audit

Migrasi `0035_audit_actor_context_binding` menutup celah atribusi. Sebelumnya
policy `audit_insert_system` memakai `WITH CHECK (true)`, sehingga sesi
`triase_app` bisa mengisi `actor_user_id` dan `actor_role` dengan nilai
 bebas, dan nilai itulah yang masuk ke digest.

Sekarang ada dua lapis yang saling melengkapi:

| Lapis | Peran | Failing test |
| --- | --- | --- |
| Trigger `fn_seal_audit_entry` | Menulis ulang keempat kolom aktor dari GUC sesi **sebelum** hashing | Payload mengklaim `ADMIN/FORGED`, tersimpan `MAHASISWA/aaaa…` |
| Policy `audit_insert_system` | `WITH CHECK` membandingkan keempat kolom dengan konteks | Dengan trigger dimatikan, baris ditolak outright |

Keduanya harus lolos. Kalau hanya trigger yang bekerja, proteksi hilang begitu
seseorang memiliki hak owner tabel. Kalau hanya policy, digest bisa
klaim yang dipalsukan.

Entri tanpa aktor tetap sah. `ZTNA_EVALUATE` sebelum autentikasi dan login
yang gagal memang tidak punya identitas, dan memaksa kolom itu terisi akan
membuat audit kehilangan nilainya. Konteks kosong menghasilkan aktor NULL
dan tetap diterima.

Residual risk yang tidak bisa dihapus di level database: sesi PostgreSQL
yang sama dapat memanggil `set_config()` langsung. Atribusi terikat ke
konteks sesi, bukan ke identitas kriptografis.

### 7.2 Batasan Penting: Jangan Pakai `INSERT ... RETURNING`

Atribusi audit mengikat baris ke GUC sesi. Kombinasi berikut **selalu
ditolak** PostgreSQL bila GUC diisi di dalam transaksi yang sama:

```sql
BEGIN;
  SELECT public.fn_ztna_set_actor_context(...);   -- mengisi GUC
  INSERT INTO public.ztna_audit_logs (...) RETURNING id;
  ERROR:  new row violates row-level security policy for table "ztna_audit_logs"
```

Polanya:

| Bentuk | Hasil |
| --- | --- |
| `INSERT ... VALUES (...)` | Lolos |
| `INSERT ... SELECT ... WHERE true` | Lolos |
| `INSERT ... VALUES (...) RETURNING id` | **Ditolak** |

Yang menentukan hanya ada/tidaknya `RETURNING`. Nilai kolom, waktu pengisian
GUC, status `STABLE`/`VOLATILE`, dan penggunaan trigger tidak mengubahnya.
Perilaku yang sama tereproduksi pada tabel minimal tanpa trigger, dan juga
pada `aduan` yang tidak pernah disentuh migrasi `0035`.

**Konvensi tim:** untuk tabel yang policy RLS-nya membaca GUC — `aduan`
dan `ztna_audit_logs` — jangan pernah memakai `INSERT ... RETURNING`.

#### Cara mendapatkannya kembali

Masalahnya ada karena `RETURNING` dipakai untuk mengambil `id`. Solusinya
bukan diambil dari database, melainkan membuatnya sendiri di
sisi aplikasi lalu menyuplaikannya saat INSERT. Kolom `id` menerima nilai
dari pemanggil dan tidak ditimpa trigger:

```ts
const auditId = crypto.randomUUID();       // dibuat di aplikasi

await sql`
  INSERT INTO public.ztna_audit_logs
    (id, trace_id, action, decision, ztna_risk_score, resource_type)
  VALUES (${auditId}::uuid, ${traceId}::uuid, ${action}, ${decision},
          ${riskScore}, ${resourceType})
`.execute(trx);                            // tidak perlu RETURNING

// auditId sekarang siap dipakai untukhattan ke baris lain
await sql`
  UPDATE public.aduan SET ztna_audit_id = ${auditId}::uuid WHERE id = ${aduanId}
`.execute(trx);
```

`aduan.ztna_audit_id` adalah referensi lunak tanpa foreign key, jadi
urutan penulisan tidak dibatasi oleh constraint. Jalankan keduanya dalam
satu `withActorContext` agar keduanya terikat ke GUC yang sama.

Atau, kalau id tidak perlu disimpan, jalankan `SELECT` terpisah pada
statement berikutnya seperti yang dilakukan probe di `scripts/verify-db.ts`.

Probe ke-16 dalam `db:verify` mengunci perilaku `RETURNING` dengan mode
`deny`, supaya tidak ada yang "memperbaiki" probe lain dengan
reintroduksi `RETURNING`.

#### Dijaga di kode, bukan cuma di probe

Probe saja bisa dihapus atau dilewati di CI. Karena itu konvensi ini juga
dipaksa oleh aturan ESLint `@triase/no-rls-guc-returning`, yang berada di
`eslint-rules/no-rls-guc-returning.mjs`. Rule menangkap tiga bentuk:

| Bentuk | Contoh |
| --- | --- |
| Tag `sql` | `` sql`INSERT INTO ztna_audit_logs (...) RETURNING id` `` |
| Template polos | `` client.query(`INSERT INTO ztna_audit_logs (...) RETURNING id`) `` |
| Builder Kysely | `db.insertInto("ztna_audit_logs").values(...).returning("id")` |

Cakupannya hanya `src/**` dan `app/**`. `scripts/**` dikecualikan karena
probe ke-16 justru harus memakai `RETURNING` untuk membuktikan bahwa
PostgreSQL menolaknya.

Pesan error aturan itu menyebutkan jalan keluarnya, bukan hanya melarang:

> Dilarang memakai RETURNING pada tabel 'ztna_audit_logs': ...
> Buat id dengan crypto.randomUUID() lalu suplai saat INSERT.

Aturan diam pada kasus yang tidak bisa ditentukan secara statis, misalnya
nama tabel yang datang dari variabel atau interpolasi. Itu pilihan sadar:
lebih baik lolos satu kasus daripada menolak kode yang benar.

Rule-nya punya 17 tes di `scripts/__tests__/` supaya tidak bisa berhenti
bekerja tanpa tanda.

---

## 8. Menjalankan

### 8.1 Bootstrap Database Baru

`db:roles` memakai `DATABASE_ADMIN_URL`, jadi hanya perlu satu kredensial
admin. Setelah itu, aplikasi dan migrasi memakai peran masing-masing.

```bash
# 1. Isi konfigurasi
Copy-Item .env.example .env.local

# 2. Buat database (satu kali)
psql -U postgres -c "CREATE DATABASE triase_net;"

# 3. Migrasi skema dasar sampai 0023 (sebagai admin)
$env:DATABASE_ADMIN_URL = "postgresql://postgres:PASS@localhost:5432/triase_net"
npm run db:migrate -- --to 0023

# 4. Buat peran LOGIN + kata sandi (sebagai admin)
$env:TRIASE_APP_PASSWORD = "..."; $env:TRIASE_DDL_PASSWORD = "..."
$env:TRIASE_VERIFY_PASSWORD = "..."; $env:TRIASE_RETENTION_PASSWORD = "..."
npm run db:roles

# 5. Selesaikan migrasi, termasuk migrasi peran 0024 dan 0031 (admin)
npm run db:migrate

# 6. Data pengembangan (opsional, lokal saja)
npm run db:seed:sql   # akun + profil + KEK pengembangan
npm run db:seed       # hash Argon2id + cetak kredensial sekali

# 7. Verifikasi 37 pemeriksaan keamanan
npm run db:verify
```

### 8.2 Mengapa Langkah 3 dan 5 Memakai Admin

Ini bukan sekadar hal yang belum dirapikan. Ada batas hak yang nyata:

| Operasi | Hak yang dibutuhkan | Peran mana |
| --- | --- | --- |
| `CREATE TABLE`, `CREATE INDEX`, `CREATE POLICY`, `CREATE FUNCTION` | `CREATE` pada schema | `triase_migrator` |
| `INSERT` ke `schema_migrations` | hak tabel | `triase_migrator` |
| `CREATE ROLE`, `DROP ROLE`, `GRANT role TO role`, `COMMENT ON ROLE` | `CREATEROLE` | admin |
| Menulis `password_hash` di `db:seed` | hak `UPDATE` | admin |

`triase_migrator` sengaja dibuat **NOCREATEROLE**. Memberinya `CREATEROLE`
berarti peran migrasi bisa membuat peran baru dan membaca kredensial
orang lain lewat `pg_authid`, yang membatalkan seluruh tujuan pemisahan
hak. Karena itu migrasi yang mengubah peran — `0024_direct_membership`
dan `0031_fixture_role_for_verification` — hanya bisa dijalankan sebagai
admin. `0025_migrator_ddl_privileges` memberi `CREATE` pada schema,
sesuai desain.

Migrasi `0034_migration_role_capability_contract` mengunci kontrak ini
sebagai regression guard: ia menolak bila `triase_migrator` sampai punya
`CREATEROLE`, kehilangan `CREATE` pada schema, bisa mengubah riwayat
migrasi, atau bisa membaca `key_material`.

### 8.3 Migrasi Biasa Setelah Bootstrap

Setelah migrasi peran selesai, migrasi skema biasa cukup memakai peran
migrasi non-superuser — sudah dibuktikan pada database `triase_bootstrap_test`:

```bash
$env:DATABASE_MIGRATION_URL = "postgresql://triase_ddl_login:PASS@localhost:5432/triase_net"
npm run db:migrate          # 0034+ berjalan sebagai NOCREATEROLE
```

`db:verify` memeriksa kontrak yang sama, jadi regresi terdeteksi tanpa
menunggu migrasi berikutnya.

### 8.4 Seed Pengembangan

`npm run db:seed:sql` menjalankan `database/seeds/0001_dev_seed.sql`
dengan hak admin. Berkas itu **sengaja dipisah** dari migrasi karena
menyertakan `key_material` KEK pengembangan. Menjalankan seed lagi aman
karena memakai `ON CONFLICT DO NOTHING` dan `scripts/apply-dev-seed.ts`
menolak jalan bila `NODE_ENV=production` atau targetnya `postgres`,
`template0`, atau `template1`.

### 8.5 Fixture Verifikasi

`db:verify` membuat seluruh data fixture di dalam satu transaksi yang
selalu di-ROLLBACK. Tidak ada hak DELETE dan tidak ada baris fixture yang
pernah di-commit. Baris `kek_versions` versi 901 milik probe dibuat
berstatus `RETIRED`, karena `uk_kek_versions_single_active` hanya
mengizinkan satu KEK ACTIVE di seluruh database.

---

## 9. Status Verifikasi

| Aspek | Status |
| --- | --- |
| Migrasi `0001`–`0035` ke PostgreSQL 18.3 | Lulus, checksum diverifikasi |
| `npm run db:verify` | **37 lulus, 0 peringatan, 0 gagal** |
| Atribusi aktor audit (`0035`) | Lulus — trigger menormalkan, policy menolak |
| Batasan `INSERT ... RETURNING` pada tabel RLS-GUC | Dikunci probe ke-16 (mode `deny`) + aturan ESLint |
| Id audit disuplai aplikasi tanpa `RETURNING` | Dikunci probe ke-17 |
| Aturan `@triase/no-rls-guc-returning` | 17 tes lulus |
| `npm test` | Lulus (17 tes) |
| Pemisahan hak DDL / runtime / fixture | Lulus (statis + fungsional) |
| `npm run typecheck` | Lulus |
| `npm run lint` | Lulus |
| `npm run build` | Lulus |
| Bootstrap database baru dari nol | Lulus diuji pada `triase_bootstrap_test` |
| Jalur migrasi non-superuser (`NOCREATEROLE`) | Lulus untuk migrasi skema biasa |
| `db:roles` menolak URL non-admin | Lulus |
| Residu fixture setelah verifikasi | 0 baris |
| `npm audit` | 7 advisory transitive tooling — belum ditangani |

### Catatan yang masih terbuka

- Dua entri audit permanen dari pengujian awal masih ada di
  `ztna_audit_logs` dengan aktor NULL. Fixture tidak pernah menyentuh
  keduanya, dan keduanya sah sebagai entri pra-autentikasi.
- Atribusi aktor terikat ke GUC sesi, yang bisa diubah oleh sesi PostgreSQL
  mana pun melalui `set_config()` langsung. Menghapus residual risk ini
  butuh jalur penulisan audit yang dipercaya di luar sesi aplikasi, bukan
  sekadar perubahan policy.
- Konvensi `INSERT ... RETURNING` pada tabel ber-RLS-GUC belum diautomasi;
  saat ini dijaga probe `db:verify`. Lint khusus atau pemeriksaan di
  `client.ts` akan menutup kemungkinan regresi.
- `npm audit` melaporkan 7 advisory pada rantai tooling/build. Semuanya
  bersifat transitif pada paket build, bukan kode aplikasi, dan
  `npm audit fix --force` akan merusak versi mayor — belum ditangani.
- Tamper probe audit membuktikan content-binding digest berubah saat
  payload dimodifikasi. Ia tidak lagi melakukan mutasi end-to-end karena
  `ALTER TABLE ... DISABLE TRIGGER` butuh hak owner tabel.

> **Catatan.** `npm run db:migrate` dan `npm run db:verify` sudah
> dijalankan terhadap instance PostgreSQL nyata dan lulus. Integrasi
> kriptografi (Tahap 2) bergantung pada nama kolom dan trigger yang
> sekarang sudah terbukti benar oleh 37 pemeriksaan tersebut.
>
> Batasan `INSERT ... RETURNING` pada tabel ber-RLS-GUC (bagian 7.2)
> adalah artefak perilaku PostgreSQL, bukan pilihan desain. Probe ke-16
> menjagainya agar tetap terdeteksi bila suatu saat ada yang mengubahnya.




Selesai
- Test suite: 100 lulus, 11 file. Lint, typecheck, build: bersih.
- Smoke test produksi jalan: / 200, area privat 307 ke /login?redirect=..., API tanpa sesi 401, /api/auth 503 karena DEMO_AUTH_ENABLED=false.
Bug asli yang ditemukan & diperbaiki
- getServerEnv() cache verdict "valid" selamanya → kini di-key sidik jari env.
- middleware tidak pernah mengarahkan sesi valid dari /login (early return).
- Nav admin menautkan /mahasiswa dan /satgas yang ditolak guard.
- Halaman detail menampilkan record.body plaintext ke staf.
- config.matcher pakai spread → build gagal.
- Client component menarik node:crypto lewat demo-store → build gagal.
- Pesan zod "Required" bocor ke user Indonesia saat variabel absen.
Perubahan架构 besar
- Body aduan disimpan sebagai bodyEnvelope (AES-256-GCM), bukan plaintext. readDemoTicketBody() hanya dipanggil setelah hak akses terbukti.
- /api/satgas/decrypt ambil ciphertext dari server, bukan dari klien, dan mencatat audit untuk sukses maupun penolak.
- src/lib/audit-log.ts baru: append-only, rantai hash SHA-256, entri di-Object.freeze.
- Route auth menolak semua login di produksi sampai DEMO_AUTH_ENABLED=true; TOTP fallback dev hilang di produksi.
- src/instrumentation.ts validasi rahasia produksi saat start.
Dua hal belum saya putuskan — keduanya butuh pilihan Anda:
1. CSP: script-src masih 'unsafe-inline' tapi komentar mengklaim sebaliknya. Memperbaikinya butuh nonce per-request via middleware. Nicolas bisa merusak app karena tidak bisa diverifikasi tanpa browser.
2. .env lokal Anda belum punya KEK_MASTER_BASE64 dan PSEUDONYM_HMAC_KEY_BASE64, jadi npm start akan menolak start sampai diisi. Saya tidak mengubah .env karena itu kredensial Anda.
▣  Build · Big Pickle · 12.4s