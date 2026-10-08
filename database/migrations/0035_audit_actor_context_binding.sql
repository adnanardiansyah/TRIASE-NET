-- ===========================================================================
-- TRIASE-Net :: 0035_audit_actor_context_binding.sql
--
-- MASALAH
--     Policy `audit_insert_system` pada `ztna_audit_logs` memakai
--
--         WITH CHECK (true)
--
--     Policy itu menerima apa pun. Sesi `triase_app` boleh mengisi
--     kolom aktor dengan nilai bebas:
--
--         INSERT INTO ztna_audit_logs
--             (trace_id, actor_user_id, actor_role, actor_pseudonym_id,
--              action, decision, ztna_risk_score)
--         VALUES (..., <uuid>, 'ADMIN', 'PSA', ...);
--
--     Dua kerentanan muncul dari itu.
--
--     1. Atribusi palsu lintas pengguna.
--        `triase_app` adalah satu peran untuk semua pengguna aplikasi.
--        Dengan `WITH CHECK (true)`, sesi yang berpretensi sebagai
--        MAHASISWA PSA dapat menulis entri audit yang menyatakan
--        aktor ADMIN. Kolom `actor_user_id` dan `actor_role` tidak lagi
--        berarti apa pun.
--
--     2. Rantai hash ikut merekam kebohongannya.
--        `fn_seal_audit_entry()` menghitung `entry_hash` dari
--        `fn_audit_canonical_payload(...)` yang memuat
--        `NEW.actor_user_id`, `NEW.actor_role`, dan
--        `NEW.actor_pseudonym_id`.
--
--        Nilai itu berasal dari PEMANGGIL, bukan dari konteks sesi.
--        Akibatnya rantai hash tidak mendeteksi apa pun: ia merekam
--        klaim yang salah secara konsisten dan tetap terverifikasi
--        sebagai sah. Rantai audit yang menandatangani nilai vorba
--        memberi rasa aman semu.
--
--     Catatan jujur soal batasnya. Ini BUKAN celah yang ditutup penuh
--     oleh policy. Akar kepercayaannya adalah GUC `triase.actor_id`.
--     Sesi PostgreSQL bisa memanggil `set_config('triase.actor_id', ...)`
--     langsung dan melewati validasi di `fn_ztna_set_actor_context()`.
--     Yang bisa dan harus ditutup di sini adalah pemisahan dua sumber
--     penulisan aktor: konteks sesi dan kolom baris. Setelah migrasi
--     ini keduanya tidak lagi bisa berbeda.
--
-- KEPUTUSAN DESAIN
--
--     1. `fn_seal_audit_entry()` menormalkan kolom aktor dari konteks
--        sesi SEBELUM menghitung digest, persis seperti yang sudah
--        dilakukan pada `prev_entry_hash` dan `entry_hash`.
--
--        Dengan begitu ada satu sumber kebenaran untuk identitas aktor,
--        yaitu GUC sesi. Pemanggil tidak lagi bisa memilih nilai yang
--        dikehendakinya. Karena normalisasi terjadi sebelum hashing,
--        digest mengikat identitas konteks yang sudah diverifikasi.
--
--        Nilai GUC berasal dari `fn_ztna_set_actor_context()`, yang
--        menolak klaim yang tidak cocok dengan baris `users`. Sesi yang
--        memakai `set_config` langsung masih bisa mencocokkan, tetapi
--        itu batas inherent PostgreSQL yang didokumentasikan di sini,
--        bukan sesuatu yang bisa diperketat tanpa memindahkan
--        penulisan audit ke luar sesi aplikasi.
--
--     2. Policy `audit_insert_system` tidak lagi `WITH CHECK (true)`.
--        Policy itu mensyaratkan kolom aktor baris sama persis dengan
--        konteks sesi, memakai `IS NOT DISTINCT FROM` agar konteks
--        kosong dan NULL diperlakukan sebagai "tanpa aktor".
--
--        Entri tanpa aktor tetap sah. Dua baris di `ztna_audit_logs`
--        sekarang tidak punya aktor, dan itu memang kejadian yang
--        benar: `ZTNA_EVALUATE` sebelum autentikasi, atau login yang
--        gagal. Policy ini sengaja tidak memaksa aktor terisi.
--
--     3. Pasangan aktor diperkuat dengan CHECK: `actor_user_id` dan
--        `actor_role` harus sama-sama NULL atau sama-sama terisi.
--        Baris yang menyatakan "ada penggunanya tapi perannya tidak
--        diketahui" tidak pernah benar, dan kolom ini masuk ke digest.
--
-- TENTANG PENGGANTIAN FUNGSI INI
--     `fn_seal_audit_entry()` dimiliki oleh `postgres`, jadi
--     `CREATE OR REPLACE FUNCTION` memerlukan kepemilikan fungsi.
--     Migrasi ini karena itu harus dijalankan sebagai admin
--     (`DATABASE_ADMIN_URL`), bukan sebagai `triase_ddl_login`.
--
--     Ini bukan ketidaksempurnaan yang perlu ditambal. `ztna_audit_logs`
--     adalah log append-only, dan mengubah log audit memang harus
--     sulit bagi pihak selain pemiliknya. Perubahan pada trigger
--     penyegel adalah operasi yang secara wajar terikat pada
--     kepemilikan tabel.
--
--     Untuk migrasi skema biasa yang tidak menyentuh objek milik
--     `postgres`, `triase_ddl_login` tetap cukup (lihat 0034).
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.fn_seal_audit_entry()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
AS
$function$
DECLARE
    v_prev      bytea;
    v_canonical text;
BEGIN
    -- Advisory lock per lingkup rantai: mencegah dua INSERT paralel
    -- menghasilkan fork yang membuat rantai tidak valid.
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.chain_scope, 0));

    -- NORMALISASI IDENTITAS AKTOR
    --
    -- Kolom aktor ditulis ulang dari konteks sesi, bukan dipercaya dari
    -- pemanggil. Ini menggabungkan dua proteksi yang sebelumnya terpisah:
    --
    --   - policy INSERT (now) menolak baris yangaktor tidak cocok dengan
    --     konteks, jadi klaim palsu tidak pernah sampai ke tabel, dan
    --   - penulisan ulang di sini memastikan digest mengikat identitas
    --     konteks, bukan klaim pemanggil.
    --
    -- GUC dibaca lewat fungsi helper yang sama dengan RLS agar tidak
    -- ada dua definisi "apa itu aktor" di skema ini.
    --
    -- `IS NOT DISTINCT FROM` tidak dipakai di sini: ini assignment, bukan
    -- perbandingan, dan NULL dari `NULLIF(...)` memang nilai yang
    -- benar untuk entri tanpa aktor.
    NEW.actor_user_id       := public.fn_ztna_actor_id();
    NEW.actor_role          := public.fn_ztna_actor_role();
    NEW.actor_pseudonym_id  := public.fn_ztna_pseudonym();
    NEW.session_id          := public.fn_ztna_session_id();

    -- Dibaca sebagai pemilik tabel agar tidak terhalang RLS. Inilah
    -- perbaikan inti: sebagai INVOKER, baris sebelumnya tidak terlihat dan
    -- rantai selalu terputus.
    SELECT entry_hash
    INTO v_prev
    FROM public.ztna_audit_logs
    WHERE chain_scope = NEW.chain_scope
    ORDER BY sequence_no DESC
    LIMIT 1;

    NEW.prev_entry_hash := v_prev;

    v_canonical := public.fn_audit_canonical_payload(
        v_prev,
        NEW.sequence_no,
        NEW.occurred_at,
        NEW.trace_id,
        NEW.actor_user_id,
        NEW.actor_role::text,
        NEW.actor_pseudonym_id,
        NEW.action::text,
        NEW.decision::text,
        NEW.ztna_risk_score,
        NEW.resource_type,
        NEW.resource_id,
        NEW.ticket_code,
        NEW.reason_code
    );

    NEW.entry_hash := extensions.digest(convert_to(v_canonical, 'UTF8'), 'sha256');

    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_seal_audit_entry() IS
    'Trigger BEFORE INSERT yang menyegel baris audit. Menormalkan actor_user_id, actor_role, actor_pseudonym_id, dan session_id dari konteks sesi (GUC triase.*) sebelum digest dihitung, sehingga rantai hash mengikat identitas yang sudah diverifikasi dan bukan klaim dari pemanggil.';

-- ---------------------------------------------------------------------------
-- 2. Ganti WITH CHECK (true) dengan syarat nyata.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS audit_insert_system ON public.ztna_audit_logs;

CREATE POLICY audit_insert_system
    ON public.ztna_audit_logs
    FOR INSERT
    TO triase_app, triase_auditor
    WITH CHECK (
        actor_user_id      IS NOT DISTINCT FROM public.fn_ztna_actor_id()
        AND actor_role      IS NOT DISTINCT FROM public.fn_ztna_actor_role()
        AND actor_pseudonym_id IS NOT DISTINCT FROM public.fn_ztna_pseudonym()
        AND session_id      IS NOT DISTINCT FROM public.fn_ztna_session_id()
    );

COMMENT ON POLICY audit_insert_system ON public.ztna_audit_logs IS
    'Hanya triase_app dan triase_auditor yang boleh menyisipkan, dan hanya bila kolom aktor baris sama persis dengan konteks sesi GUC. Trigger fn_seal_audit_entry menormalkan kolom yang sama sebelum hashing, sehingga policy dan trigger mengunci satu sumber kebenaran. Entri tanpa aktor (login gagal, evaluasi ZTNA sebelum autentikasi) tetap sah karena konteks kosong menghasilkan NULL.';

-- ---------------------------------------------------------------------------
-- 3. Pasangan aktor harus utuh.
--
--    "ada penggunanya tapi perannya tidak diketahui" tidak pernah benar,
--    dan kolom ini masuk ke digest. Baris setengah terisi akan membuat
--    rantai sulit ditafsirkan saat investigasi.
-- ---------------------------------------------------------------------------
DO
$$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.ztna_audit_logs'::regclass
          AND conname  = 'ztna_audit_actor_pair_ck'
    ) THEN
        ALTER TABLE public.ztna_audit_logs
            ADD CONSTRAINT ztna_audit_actor_pair_ck
            CHECK (
                (actor_user_id IS NULL     AND actor_role IS NULL)
                OR (actor_user_id IS NOT NULL AND actor_role IS NOT NULL)
            );
    END IF;
END
$$;

COMMENT ON CONSTRAINT ztna_audit_actor_pair_ck ON public.ztna_audit_logs IS
    'actor_user_id dan actor_role harus sama-sama NULL (entri tanpa aktor) atau sama-sama terisi. Baris yang hanya mengisi salah satu tidak pernah benar dan merusak interpretasi rantai audit.';

-- ---------------------------------------------------------------------------
-- PENEGAKAN
--   1. Policy INSERT bukan lagi WITH CHECK (true).
--   2. Policy mentions the same helper functions the trigger uses, so
--      there is only one definition of "current actor" in the schema.
--   3. The seal trigger normalizes actor columns.
--   4. The actor pair constraint exists.
--   5. Runtime still cannot UPDATE or DELETE audit rows.
-- ---------------------------------------------------------------------------
DO
$$
DECLARE
    v_bad   text := NULL;
    v_check text;
BEGIN
    -- (1) Policy harus punya WITH CHECK yang bukan TRUE.
    SELECT pg_get_expr(polwithcheck, polrelid)
    INTO v_check
    FROM pg_policy
    WHERE polrelid = 'public.ztna_audit_logs'::regclass
      AND polname   = 'audit_insert_system'
      AND polcmd    = 'a';   -- 'a' berarti INSERT

    IF v_check IS NULL THEN
        v_bad := coalesce(v_bad, '') || ' policy audit_insert_system tidak ada;';
    ELSIF btrim(v_check) = 'true' THEN
        v_bad := coalesce(v_bad, '') || ' policy audit_insert_system masih WITH CHECK (true);';
    ELSIF v_check NOT ILIKE '%fn_ztna_actor_id%'
       OR v_check NOT ILIKE '%fn_ztna_actor_role%'
       OR v_check NOT ILIKE '%fn_ztna_pseudonym%'
       OR v_check NOT ILIKE '%fn_ztna_session_id%'
    THEN
        v_bad := coalesce(v_bad, '') ||
            ' WITH CHECK policy tidak membandingkan keempat kolom aktor dengan konteks sesi;';
    END IF;

    -- (2) Policy INSERT harus berlaku untuk triase_app dan triase_auditor,
    --     dan TIDAK untuk peran lain.
    IF NOT (
        SELECT bool_and(r.rolname IN ('triase_app', 'triase_auditor'))
        FROM unnest(
            (SELECT polroles FROM pg_policy
             WHERE polrelid = 'public.ztna_audit_logs'::regclass
               AND polname = 'audit_insert_system')
        ) AS x(oid)
        JOIN pg_roles r ON r.oid = x.oid
    ) THEN
        v_bad := coalesce(v_bad, '') ||
            ' policy audit_insert_system berlaku untuk peran yang tidak seharusnya;';
    END IF;

    -- (3) Trigger penyegel harus menormalkan keempat kolom aktor.
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE pronamespace = 'public'::regnamespace
          AND proname = 'fn_seal_audit_entry'
          AND prosrc ILIKE '%actor_user_id%'
          AND prosrc ILIKE '%actor_role%'
          AND prosrc ILIKE '%actor_pseudonym_id%'
          AND prosrc ILIKE '%session_id%'
          AND prosrc ILIKE '%fn_ztna_actor_id%'
    ) THEN
        v_bad := coalesce(v_bad, '') ||
            ' fn_seal_audit_entry tidak menormalkan kolom aktor dari konteks sesi;';
    END IF;

    -- (4) Constraint pasangan aktor harus ada.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.ztna_audit_logs'::regclass
          AND conname  = 'ztna_audit_actor_pair_ck'
    ) THEN
        v_bad := coalesce(v_bad, '') || ' constraint ztna_audit_actor_pair_ck tidak ada;';
    END IF;

    -- (5) Log tetap append-only untuk semua pihak selain pemilik.
    IF has_table_privilege('triase_app', 'public.ztna_audit_logs', 'UPDATE')
       OR has_table_privilege('triase_app', 'public.ztna_audit_logs', 'DELETE')
       OR has_table_privilege('triase_auditor', 'public.ztna_audit_logs', 'UPDATE')
       OR has_table_privilege('triase_auditor', 'public.ztna_audit_logs', 'DELETE')
    THEN
        v_bad := coalesce(v_bad, '') || ' peran non-pemilik bisa mengubah log audit;';
    END IF;

    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'Pengikatan konteks aktor pada audit log belum benar:%', v_bad
            USING ERRCODE = 'insufficient_privilege';
    END IF;
END
$$;
