import { NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/api/validation";
import { apiErrorResponse } from "@/lib/api/errors";

export async function POST(request: NextRequest) {
  try { assertSameOrigin(request); } catch (error) { return apiErrorResponse(error); }
  const response = NextResponse.json({ ok: true, message: "Logout berhasil." });

  response.cookies.set("triase-session", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });

  return response;
}
