import type { SessionRole } from "@/lib/auth/jwt";

export const ROLE_HOME_PATH: Record<SessionRole, string> = {
  MAHASISWA: "/mahasiswa",
  SATGAS: "/satgas",
  ADMIN: "/admin",
};

interface ProtectedRule {
  /** Awalan path. Dicocokkan pada batas segmen, bukan pada awal string. */
  prefix: string;
  /**
   * Role yang boleh. Array kosong berarti "hanya butuh sesi", keputusan
   * kepemilikan diserahkan ke halaman atau route handler.
   */
  roles: readonly SessionRole[];
}

/**
 * Peta proteksi path.
 *
 * Aturannya pencocokan adalah batas segmen: `/mahasiswa` melindungi
 * `/mahasiswa` dan `/mahasiswa/apapun`, tetapi tidak `/mahasiswax`.
 * Versi sebelumnya memakai pencocokan persis, jadi setiap route bersarang di
 * bawah prefix yang sama otomatis lolos tanpa cek peran sama sekali.
 */
const PROTECTED_RULES: readonly ProtectedRule[] = [
  { prefix: "/mahasiswa", roles: ["MAHASISWA"] },
  { prefix: "/satgas", roles: ["SATGAS"] },
  { prefix: "/admin", roles: ["ADMIN"] },
  { prefix: "/aduan/baru", roles: ["MAHASISWA"] },
  { prefix: "/aduan/lacak", roles: ["MAHASISWA"] },
  // Detail tiket boleh dibuka staf untuk tiket mana pun dan pelapor untuk
  // tiketnya sendiri; penentuannya ada di dalam halaman.
  { prefix: "/aduan", roles: [] },
];

export function normalizePathname(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, "");
  return normalized.length > 0 ? normalized : "/";
}

/** True bila `pathname` adalah `prefix` sendiri atau berada di bawahnya. */
export function matchesPrefix(pathname: string, prefix: string): boolean {
  if (pathname === prefix) {
    return true;
  }

  return pathname.startsWith(`${prefix}/`);
}

export function getRoleHomePath(role: SessionRole): string {
  return ROLE_HOME_PATH[role];
}

/**
 * Role yang boleh mengakses `pathname`.
 *
 * Mengembalikan `null` untuk path publik, dan array (bisa kosong) untuk path
 * yang dilindungi.
 */
export function getAllowedRolesForPath(pathname: string): readonly SessionRole[] | null {
  const normalized = normalizePathname(pathname);

  // Aturan paling spesifik lebih dulu: `/aduan/baru` harus menang atas `/aduan`.
  const ordered = [...PROTECTED_RULES].sort(
    (left, right) => right.prefix.length - left.prefix.length,
  );

  for (const rule of ordered) {
    if (matchesPrefix(normalized, rule.prefix)) {
      return rule.roles;
    }
  }

  return null;
}

/**
 * Role tunggal yang boleh mengakses `pathname`, atau `null` bila path publik
 * atau hanya butuh sesi apa pun.
 */
export function getProtectedRoleForPath(pathname: string): SessionRole | null {
  return getAllowedRolesForPath(pathname)?.[0] ?? null;
}

export function isAllowedForRole(pathname: string, role: SessionRole): boolean {
  const allowedRoles = getAllowedRolesForPath(pathname);

  if (!allowedRoles) {
    return true;
  }

  return allowedRoles.length === 0 || allowedRoles.includes(role);
}

/** Semua prefix yang harus dicocokkan oleh middleware. */
export function getProtectedMatchers(): string[] {
  return PROTECTED_RULES.map((rule) => `${rule.prefix}/:path*`);
}