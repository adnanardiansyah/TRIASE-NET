/**
 * Aturan ESLint internal TRIASE-Net.
 *
 * Name: no-rls-guc-returning
 * Fungsi: melarang penggunaan klausa RETURNING pada tabel yang kebijakan
 *         keamanan barisnya (row-level security) membaca variabel sesi.
 *
 * DASAR TEORI
 * -----------
 * Tabel `aduan` dan `ztna_audit_logs` memiliki kebijakan RLS yang
 * membandingkan nilai kolom bertanda aktor dengan GUC sesi melalui fungsi
 * `fn_ztna_actor_id()` beserta fungsi turunannya. Kombinasi
 * `INSERT ... RETURNING` pada tabel semacam itu ditolak PostgreSQL apabila
 * GUC diisi di dalam transaksi yang sama:
 *
 *     BEGIN;
 *       SELECT fn_ztna_set_actor_context(...);   -- mengisi GUC
 *       INSERT INTO ztna_audit_logs (...) RETURNING id;
 *       ERROR:  new row violates row-level security policy
 *
 * Gejala ini menyesatkan karena pesan galat menyalahkan mekanisme RLS,
 * padahal kekeliruan terletak pada klausanya RETURNING. Rujukan lengkap
 * tersedia pada docs/TAHAP-1.md bagian 7.2.
 *
 * PENYELESAIAN
 * ------------
 * Bentukkan `id` di sisi aplikasi melalui `crypto.randomUUID()`, kemudian
 * suplai nilai tersebut pada pernyataan INSERT. Kolom `id` tidak ditimpa
 * oleh pemicu, sehingga nilai yang disuplai tersimpan secara utuh. Pola ini
 * diuji oleh probe ke-17 di scripts/verify-db.ts.
 *
 * Keberadaan aturan ini dibutuhkan karena `db:verify` hanya menjaga melalui
 * probe. Apabila probe dihapus atau dilewati dalam CI, regresi tersebut tidak
 * akan terdeteksi.
 */

/** Kumpulan tabel yang kebijakan RLS-nya membaca GUC sesi. */
const GUARDED_TABLES = new Set(["aduan", "ztna_audit_logs"]);

/**
 * Metode pembangun Kysely yang menulis baris ke dalam tabel.
 *
 * `updateInto` sengaja tidak dicantumkan: Kysely tidak menyediakan metode
 * tersebut. Nama yang benar adalah `updateTable`. Menambahkan nama yang
 * keliru hanya menghasilkan ketelitian yang sia-sia.
 */
const WRITE_BUILDERS = new Set(["insertInto", "updateTable", "deleteFrom"]);

/** Batas atas penelusuran rantai pemanggilan, sebagai pelindung terhadap perulangan tak berujung. */
const MAX_CHAIN_WALK = 32;

/**
 * Menyusun kembali bagian statis dari literal templat.
 *
 * Bagian interpolasi `${...}` diganti oleh spasi. Konsekuensinya, nama
 * tabel yang berasal dari interpolasi tidak dapat dikenali, dan aturan
 * memilih untuk tetap diam daripada melaporkan positif palsu.
 */
function staticText(node) {
  if (!node || node.type !== "TemplateLiteral") return null;
  return node.quasis
    .map((quasi) => quasi.value.raw ?? quasi.value.cooked ?? "")
    .join(" ");
}

/** Mengembalikan nilai argumen apabila argumen tersebut literal teks. */
function staticString(node) {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  return null;
}

/** Menyatakan apakah teks memuat klausa RETURNING. */
function mentionsReturning(text) {
  return /\breturning\b/i.test(text);
}

/**
 * Mengembalikan nama tabel yang dijaga apabila tabel tersebut termuat di dalam
 * teks, atau `null` apabila tidak ditemukan.
 */
function guardedTableIn(text) {
  for (const table of GUARDED_TABLES) {
    if (new RegExp(`\\b${table}\\b`, "i").test(text)) return table;
  }
  return null;
}

/**
 * Menelusuri rantai pembangun ke arah atas, prosecara dari pemanggilan
 * `.returning()`, lalu mengembalikan nama tabel sasaran bila ditemukan.
 *
 * Nilai nama tabel dikembalikan apa adanya, termasuk apabila tabel tersebut
 * tidak dijaga. Hal ini memungkinkan pemanggil membedakan keadaan
 * "bukan pembangun Kysely" dari keadaan "pembangun Kysely, tetapi tabelnya
 * aman".
 */
function findBuilderTable(callNode) {
  let current = callNode.callee.object;
  let steps = 0;

  while (current && steps < MAX_CHAIN_WALK) {
    steps += 1;

    if (current.type === "CallExpression") {
      const callee = current.callee;
      if (callee.type === "MemberExpression" && !callee.computed) {
        const method = callee.property.name;
        if (WRITE_BUILDERS.has(method)) {
          return staticString(current.arguments[0]);
        }
      }
      current = callee.object;
      continue;
    }

    if (current.type === "MemberExpression") {
      current = current.object;
      continue;
    }

    return null;
  }

  return null;
}

/** Menyusun nama tag untuk `sql` maupun `sql.raw`. */
function tagName(node) {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression" && !node.computed) {
    const object = tagName(node.object);
    return object ? `${object}.${node.property.name}` : null;
  }
  return null;
}

/**
 * Menyatakan bernilai benar apabila literal templat tersebut merupakan argumen bagi
 * pemanggilan `.query(...)`.
 *
 * Fungsi ini menangkap gaya penulisan
 * `client.query(\`INSERT ... RETURNING\`)` yang tidak memakai tag `sql`.
 */
function isQueryArgument(node) {
  let current = node.parent;
  for (let i = 0; i < 2 && current; i += 1) {
    if (
      current.type === "CallExpression" &&
      current.callee.type === "MemberExpression" &&
      !current.callee.computed &&
      current.callee.property.name === "query"
    ) {
      return true;
    }
    if (current.type === "TaggedTemplateExpression") return false;
    current = current.parent;
  }
  return false;
}

const RULE = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Melarang klausa RETURNING pada INSERT, UPDATE, dan DELETE terhadap " +
        "tabel yang kebijakan RLS-nya membaca GUC sesi.",
    },
    schema: [],
    messages: {
      returningOnGuardedTable:
        "Klausa RETURNING dilarang pada tabel '{{table}}': kebijakan RLS-nya " +
        "membaca GUC sesi, sehingga INSERT, UPDATE, atau DELETE yang " +
        "disertai RETURNING akan ditolak apabila konteks diisi di dalam " +
        "transaksi yang sama. Bentukkan id melalui crypto.randomUUID() di " +
        "sisi aplikasi, kemudian suplai nilai tersebut pada pernyataan " +
        "INSERT. Rujukan: docs/TAHAP-1.md bagian 7.2.",
    },
  },

  create(context) {
    /** Menerbitkan laporan pelanggaran pada simpul yang ditentukan. */
    const report = (node, table) => {
      context.report({
        node,
        messageId: "returningOnGuardedTable",
        data: { table },
      });
    };

    /** Pemeriksaan bersama terhadap teks SQL yang bersifat statis. */
    const checkSqlText = (text, node) => {
      if (text === null) return;
      if (!mentionsReturning(text)) return;
      const table = guardedTableIn(text);
      if (table) report(node, table);
    };

    return {
      // Bentuk pertama: tag Kysely.
      // Contoh: sql`INSERT INTO ztna_audit_logs (...) RETURNING id`
      TaggedTemplateExpression(node) {
        if (tagName(node.tag) !== "sql") return;
        checkSqlText(staticText(node.quasi), node.tag);
      },

      // Bentuk kedua: literal templat polos.
      // Contoh: client.query(`INSERT INTO ztna_audit_logs (...) RETURNING id`)
      TemplateLiteral(node) {
        if (isQueryArgument(node)) {
          checkSqlText(staticText(node), node);
        }
      },

      // Bentuk ketiga: pembangun Kysely.
      // Contoh: insertInto("ztna_audit_logs").values(...).returning()
      // Identifikasi tabel dilakukan melalui `findBuilderTable` dan bukan
      // melalui selektor, sebab bentuk rantainya tidak dibatasi.
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || callee.computed) return;
        if (callee.property.type !== "Identifier") return;
        if (callee.property.name !== "returning") return;

        const table = findBuilderTable(node);
        if (!table) return;
        if (GUARDED_TABLES.has(table.toLowerCase())) report(callee, table);
      },
    };
  },
};

export const triaseInternalRules = {
  "no-rls-guc-returning": RULE,
};
