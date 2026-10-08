import type { NextRequest } from "next/server";

import { verifySessionToken, type SessionClaims, type SessionRole } from "./jwt";

export function getRequestSession(request: NextRequest): SessionClaims | null {
  const token = request.cookies.get("triase-session")?.value;

  if (!token) {
    return null;
  }

  try {
    return verifySessionToken(token);
  } catch {
    return null;
  }
}

export function hasAnyRole(
  claims: SessionClaims | null,
  roles: readonly SessionRole[],
): claims is SessionClaims {
  return claims !== null && roles.includes(claims.role);
}