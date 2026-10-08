import { NextResponse, type NextRequest } from "next/server";

import {
  getAllowedRolesForPath,
  getRoleHomePath,
  normalizePathname,
} from "@/lib/auth/guard";
import { verifySessionToken, type SessionClaims } from "@/lib/auth/jwt";

export const runtime = "nodejs";

const SESSION_COOKIE = "triase-session";

function redirectToLogin(request: NextRequest, pathname: string): NextResponse {
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("redirect", pathname);
  return NextResponse.redirect(loginUrl);
}

function redirectToHome(request: NextRequest, claims: SessionClaims): NextResponse {
  return NextResponse.redirect(new URL(getRoleHomePath(claims.role), request.url));
}

export function middleware(request: NextRequest) {
  const pathname = normalizePathname(request.nextUrl.pathname);
  const sessionToken = request.cookies.get(SESSION_COOKIE)?.value;

  // Halaman login harus dicek sebelum cabik path publik. `getAllowedRolesForPath`
  // mengembalikan null untuk "/login", dan cabang null di bawah akan
  // mengembalikan `next()` lebih dulu, sehingga sesi yang sudah ada tidak
  // pernah dialihkan ke berandanya.
  if (pathname === "/login") {
    if (!sessionToken) {
      return NextResponse.next();
    }

    try {
      return redirectToHome(request, verifySessionToken(sessionToken));
    } catch {
      // Token rusak dibuang agar pengguna bisa masuk lagi.
      const response = NextResponse.next();
      response.cookies.delete(SESSION_COOKIE);
      return response;
    }
  }

  const allowedRoles = getAllowedRolesForPath(pathname);

  // Path publik, termasuk "/".
  if (allowedRoles === null) {
    return NextResponse.next();
  }

  if (!sessionToken) {
    return redirectToLogin(request, pathname);
  }

  let claims: SessionClaims;

  try {
    claims = verifySessionToken(sessionToken);
  } catch {
    return redirectToLogin(request, pathname);
  }

  // Array kosong berarti path hanya butuh sesi yang valid; keputusan
  // kepemilikan diserahkan ke halaman atau route handler.
  if (allowedRoles.length > 0 && !allowedRoles.includes(claims.role)) {
    return redirectToHome(request, claims);
  }

  return NextResponse.next();
}

/**
 * Matcher middleware.
 *
 * Nilainya harus ditulis literal. Next.js membaca `export const config` secara
 * statis saat build, jadi spread dari panggilan fungsi di sini membuat build
 * gagal dengan "Unsupported spread operator in the Array Expression".
 *
 * Daftar ini harus tetap sama dengan prefix yang ditangani `getProtectedMatchers`
 * di `src/lib/auth/guard.ts`; tes membandingkannya agar keduanya tidak
 * slippery.
 */
export const config = {
  matcher: [
    "/login",
    "/mahasiswa/:path*",
    "/satgas/:path*",
    "/admin/:path*",
    "/aduan/baru/:path*",
    "/aduan/lacak/:path*",
    "/aduan/:path*",
  ],
};