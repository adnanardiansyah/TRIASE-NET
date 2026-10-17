import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/api/errors";
import { requireSession } from "@/lib/api/session";
import { resolveActorId } from "@/lib/db/actors";
import { withActorContext } from "@/lib/db/client";
import { assertSessionContext } from "@/lib/ztna/access-policy";

export async function GET(request: NextRequest) {
  try {
    const session = requireSession(request);
    assertSessionContext(session, request.headers.get("user-agent") ?? "");
    const id = await resolveActorId(session.email ?? session.sub, session.role, session.authVersion);
    if (id !== session.userId) throw new ApiError(401, "Silakan masuk ulang.");
    const data = await withActorContext({ userId: id, role: session.role }, async (trx) => {
      const user = await trx.selectFrom("users").select(["display_name", "role"]).where("id", "=", id).executeTakeFirstOrThrow();
      const profile = session.role === "MAHASISWA" ? null : await trx.selectFrom("satgas_profiles")
        .select(["duty_status", "authorized_categories", "max_decrypt_risk_score", "expires_at"])
        .where("user_id", "=", id).executeTakeFirst();
      return { name: user.display_name ?? "Mahasiswa", role: user.role, profile: profile ? { dutyStatus: profile.duty_status, categories: profile.authorized_categories, maxRisk: profile.max_decrypt_risk_score, expiresAt: profile.expires_at?.toISOString() ?? null } : null };
    });
    return NextResponse.json({ ok: true, ...data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
