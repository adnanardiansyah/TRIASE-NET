import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiErrorResponse } from "@/lib/api/errors";
import { requireSession } from "@/lib/api/session";
import { assertSameOrigin, readJson } from "@/lib/api/validation";
import { listNotifications, readNotifications } from "@/lib/db/tickets";

const readSchema = z.object({ ids: z.array(z.string().min(1).max(160)).min(1).max(50) }).strict();
const headers = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  try {
    const items = await listNotifications(requireSession(request), request.headers.get("user-agent") ?? "");
    return NextResponse.json({ ok: true, items }, { headers });
  } catch (error) { return apiErrorResponse(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const session = requireSession(request);
    const { ids } = await readJson(request, readSchema);
    await readNotifications(session, request.headers.get("user-agent") ?? "", ids);
    return NextResponse.json({ ok: true }, { headers });
  } catch (error) { return apiErrorResponse(error); }
}
