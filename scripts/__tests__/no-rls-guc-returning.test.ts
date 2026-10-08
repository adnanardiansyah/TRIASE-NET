/**
 * Pengujian aturan ESLint internal `no-rls-guc-returning`.
 *
 * Tanpa pengujian, aturan ini dapat berhenti berfungsi tanpa tanda
 * whatsoever: tidak ada galat kompilasi, tidak ada kegagalan, dan
 * pemeriksa linter tetap lolos karena memang tidak ada kode yang melanggar.
 *
 * Pengujian ini memanfaatkan `Linter` bawaan ESLint agar tidak perlu menambah
 * dependensi baru pada proyek ini.
 */

import { Linter } from "eslint";
import { describe, expect, it } from "vitest";

import { triaseInternalRules } from "../../eslint-rules/no-rls-guc-returning.mjs";

/**
 * Menjalankan satu potongan kode melalui aturan dan mengembalikan seluruh
 * pesan galat yang dilaporkan.
 */
function lint(potongan: string): string[] {
  const linter = new Linter();
  return linter
    .verify(potongan, {
      plugins: { "@triase": { rules: triaseInternalRules } },
      rules: { "@triase/no-rls-guc-returning": "error" },
      languageOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    })
    .map((pesan) => pesan.message);
}

/** Potongan teks yang menyatakan jalan keluar dari larangan. */
const PETUNJUK = "crypto.randomUUID()";

describe("no-rls-guc-returning", () => {
  describe("wajib dilaporkan", () => {
    it("menangkap tag sql dengan RETURNING pada ztna_audit_logs", () => {
      const pesan = lint(
        "const kueri = sql`INSERT INTO ztna_audit_logs (id) VALUES (x) RETURNING id`;",
      );
      expect(pesan).toHaveLength(1);
      expect(pesan[0]).toContain("ztna_audit_logs");
    });

    it("menangkap tag sql dengan RETURNING pada aduan", () => {
      const pesan = lint(
        "const kueri = sql`INSERT INTO aduan (id) VALUES (x) RETURNING id`;",
      );
      expect(pesan).toHaveLength(1);
      expect(pesan[0]).toContain("aduan");
    });

    it("menangkap penulisan huruf besar pada RETURNING dan nama tabel", () => {
      const pesan = lint(
        "const kueri = sql`insert into ZTNA_AUDIT_LOGS (id) VALUES (x) returning id`;",
      );
      expect(pesan).toHaveLength(1);
    });

    it("menangkap literal templat polos pada client.query()", () => {
      const pesan = lint(
        "client.query(`INSERT INTO ztna_audit_logs (id) VALUES (x) RETURNING id`);",
      );
      expect(pesan).toHaveLength(1);
    });

    it("menangkap pembangun Kysely insertInto().returning()", () => {
      const pesan = lint(
        `db.insertInto("ztna_audit_logs").values({ id: "x" }).returning("id");`,
      );
      expect(pesan).toHaveLength(1);
    });

    it("menangkap pembangun dengan rantai pemanggilan yang panjang", () => {
      const pesan = lint(
        `db.insertInto("ztna_audit_logs")
           .values({ id: "x" })
           .onConflict(konflik => konflik.doNothing())
           .returning(["id", "created_at"]);`,
      );
      expect(pesan).toHaveLength(1);
    });

    it("menangkap pembangun Kysely deleteFrom().returning()", () => {
      const pesan = lint(`db.deleteFrom("ztna_audit_logs").returning("id");`);
      expect(pesan).toHaveLength(1);
    });

    it("menangkap pembangun Kysely updateTable().returning()", () => {
      const pesan = lint(
        `db.updateTable("aduan").set({ status: "x" }).returning("id");`,
      );
      expect(pesan).toHaveLength(1);
    });

    it("pesan galat menyertakan jalan keluar, bukan sekadar larangan", () => {
      const pesan = lint(
        "const kueri = sql`INSERT INTO ztna_audit_logs (id) VALUES (x) RETURNING id`;",
      );
      expect(pesan[0]).toContain(PETUNJUK);
      expect(pesan[0]).toContain("TAHAP-1.md");
    });
  });

  describe("wajib lolos", () => {
    it("melewati tabel yang tidak dijaga", () => {
      const pesan = lint(`db.insertInto("users").values({ id: "x" }).returning("id");`);
      expect(pesan).toHaveLength(0);
    });

    it("melewati INSERT tanpa RETURNING", () => {
      const pesan = lint(
        "const kueri = sql`INSERT INTO ztna_audit_logs (id) VALUES (x)`;",
      );
      expect(pesan).toHaveLength(0);
    });

    it("melewati pernyataan SELECT yang sah", () => {
      const pesan = lint("const kueri = sql`SELECT id FROM ztna_audit_logs`;");
      expect(pesan).toHaveLength(0);
    });

    it("melewati tag selain sql", () => {
      const pesan = lint(
        "const kueri = lain`INSERT INTO ztna_audit_logs (id) VALUES (x) RETURNING id`;",
      );
      expect(pesan).toHaveLength(0);
    });

    it("melewati metode objek biasa yang bernama returning", () => {
      const pesan = lint("objek.returning();");
      expect(pesan).toHaveLength(0);
    });

    it("melewati pembangun dengan nama tabel dari variabel", () => {
      // Nama tabel tidak dapat ditentukan secara statis; aturan memilih diam.
      const pesan = lint(
        `db.insertInto(namaTabel).values({ id: "x" }).returning("id");`,
      );
      expect(pesan).toHaveLength(0);
    });

    it("melewati kode tanpa pernyataan SQL", () => {
      const pesan = lint("export const nilai = 1 + 1;");
      expect(pesan).toHaveLength(0);
    });

    it("tidak memunculkan galat pada literal templat kosong", () => {
      const pesan = lint("sql``;");
      expect(pesan).toHaveLength(0);
    });
  });
});
