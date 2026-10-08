import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { FlatCompat } from "@eslint/eslintrc";

import { triaseInternalRules } from "./eslint-rules/no-rls-guc-returning.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

/** Plugin lokal; tidak dipublikasikan ke npm. */
const triaseInternal = {
  rules: triaseInternalRules,
};

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // next-env.d.ts di-generate oleh Next.js, bukan kode milik kita.
    ignores: [
      ".next/**",
      "node_modules/**",
      "coverage/**",
      "next-env.d.ts",
    ],
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    // Aturan internal TRIASE-Net.
    //
    // `aduan` dan `ztna_audit_logs` punya policy RLS yang membaca GUC sesi.
    // `RETURNING` pada tabel semacam itu selalu ditolak PostgreSQL bila
    // konteks diisi di dalam transaksi yang sama. Lihat docs/TAHAP-1.md 7.2.
    //
    // Cakupannya hanya src/ dan app/: probe ke-16 di scripts/verify-db.ts
    // justru harus memakai RETURNING untuk membuktikan perilakunya ditolak.
    files: ["src/**/*.{ts,tsx}", "app/**/*.{ts,tsx}"],
    plugins: { "@triase": triaseInternal },
    rules: {
      "@triase/no-rls-guc-returning": "error",
    },
  },
  {
    // Skrip CLI memang harus mencetak keluaran ke terminal.
    files: ["scripts/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },
];

export default eslintConfig;
