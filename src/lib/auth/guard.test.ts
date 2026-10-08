import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  getAllowedRolesForPath,
  getProtectedMatchers,
  getProtectedRoleForPath,
  isAllowedForRole,
  matchesPrefix,
  normalizePathname,
} from "./guard";

describe("guard path matching", () => {
  it("mencocokkan prefix pada batas segmen, bukan awal string", () => {
    expect(matchesPrefix("/mahasiswa", "/mahasiswa")).toBe(true);
    expect(matchesPrefix("/mahasiswa/lacak", "/mahasiswa")).toBe(true);
    expect(matchesPrefix("/mahasiswa/lacak/tiket", "/mahasiswa")).toBe(true);
    expect(matchesPrefix("/mahasiswax", "/mahasiswa")).toBe(false);
    expect(matchesPrefix("/adminskyah", "/admin")).toBe(false);
  });

  it("menormalkan garis miring di akhir", () => {
    expect(normalizePathname("/satgas/")).toBe("/satgas");
    expect(normalizePathname("/satgas///")).toBe("/satgas");
    expect(normalizePathname("/")).toBe("/");
  });

  it("melindungi path bersarang di bawah prefix yang sama", () => {
    // Versi sebelumnya memakai pencocokan persis, jadi kedua path ini lolos
    // tanpa cek peran sama sekali.
    expect(getProtectedRoleForPath("/mahasiswa/lacak")).toBe("MAHASISWA");
    expect(getProtectedRoleForPath("/satgas/antrean")).toBe("SATGAS");
    expect(getProtectedRoleForPath("/admin/pengguna")).toBe("ADMIN");
  });

  it("menyediakan tantangan pada path yang hanya butuh sesi", () => {
    const allowed = getAllowedRolesForPath("/aduan/TR-123");

    expect(allowed).toEqual([]);
    // Role apa pun boleh sampai ke sini; kepemilikan diperiksa di halaman.
    expect(isAllowedForRole("/aduan/TR-123", "MAHASISWA")).toBe(true);
    expect(isAllowedForRole("/aduan/TR-123", "SATGAS")).toBe(true);
    expect(isAllowedForRole("/aduan/TR-123", "ADMIN")).toBe(true);
  });

  it("memilih aturan paling spesifik", () => {
    // `/aduan/baru` milik MAHASISWA, dan harus menang atas `/aduan` yang
    // hanya butuh sesi.
    expect(getProtectedRoleForPath("/aduan/baru")).toBe("MAHASISWA");
    expect(getAllowedRolesForPath("/aduan/baru")).toEqual(["MAHASISWA"]);
  });

  it("membiarkan path publik terbuka", () => {
    expect(getAllowedRolesForPath("/")).toBeNull();
    expect(getAllowedRolesForPath("/login")).toBeNull();
    expect(getProtectedRoleForPath("/")).toBeNull();
  });

  it("menolak role yang salah untuk tiap area", () => {
    expect(isAllowedForRole("/satgas", "ADMIN")).toBe(false);
    expect(isAllowedForRole("/admin", "SATGAS")).toBe(false);
    expect(isAllowedForRole("/aduan/baru", "SATGAS")).toBe(false);
    expect(isAllowedForRole("/mahasiswa", "MAHASISWA")).toBe(true);
  });

  it("menghasilkan matcher yang mencakup seluruh path yang dilindungi", () => {
    const matchers = getProtectedMatchers();

    for (const prefix of ["/mahasiswa", "/satgas", "/admin", "/aduan/baru", "/aduan/lacak", "/aduan"]) {
      expect(matchers).toContain(`${prefix}/:path*`);
    }
  });

  it("matcher di src/middleware.ts tetap sama dengan prefix yang dijaga", () => {
    // Next.js membaca `export const config` secara statis saat build, jadi
    // middleware harus menuliskan literal, bukan mem-spread hasil fungsi. Itu
    // membuat kedua daftar rawan berbeda, jadi kesamaannya diperiksa di sini.
    const source = readFileSync(join(process.cwd(), "src", "middleware.ts"), "utf8");
    const match = /matcher:\s*\[([\s\S]*?)\]/.exec(source);

    expect(match).not.toBeNull();

    const literals = (match?.[1] ?? "")
      .split(",")
      .map((entry) => entry.trim().replace(/^"|"$/g, ""))
      .filter((entry) => entry.length > 0);

    expect(literals).toContain("/login");
    expect(literals.filter((entry) => entry !== "/login")).toEqual(getProtectedMatchers());
  });
});