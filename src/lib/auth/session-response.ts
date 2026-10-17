import { NextResponse } from "next/server";
import { issueSessionToken } from "./jwt";
import { deviceHash } from "@/lib/ztna/access-policy";
import type { AuthAccount } from "./real-accounts";
export function loginResponse(account: AuthAccount, userAgent: string, mfa: boolean, recoveryCodes?: string[]) {
  const token = issueSessionToken({ sub: account.email, email: account.email, role: account.role, userId: account.id, authVersion: account.version, authMethod: mfa ? "TOTP" : "PASSWORD", deviceHash: deviceHash(userAgent), ...(mfa ? { mfaVerifiedAt: Math.floor(Date.now() / 1000) } : {}) }, 240);
  const response = NextResponse.json({ ok: true, user: { role: account.role, name: account.name ?? "Mahasiswa" }, ...(recoveryCodes ? { recoveryCodes } : {}) }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set("triase-session", token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 14400 });
  return response;
}
