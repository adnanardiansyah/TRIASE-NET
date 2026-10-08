/**
 * Deklarasi tipe untuk aturan ESLint internal TRIASE-Net.
 *
 * Berkas sumber aturan berakhiran `.mjs`, yang tidak dibaca TypeScript
 * sebagai modul. Tanpa deklarasi ini, `tsc --noEmit` akan menganggap modul
 * tersebut bertipe `any` dan pemeriksaannya akan gagal.
 */

import type { Rule } from "eslint";

/** Kumpulan aturan internal, dengan nama aturan sebagai kunci. */
declare const triaseInternalRules: Record<string, Rule.RuleModule>;

export { triaseInternalRules };
