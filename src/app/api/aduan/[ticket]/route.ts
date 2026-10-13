import { NextResponse, type NextRequest } from "next/server";
import { apiErrorResponse } from "@/lib/api/errors";
import { requireSession } from "@/lib/api/session";
import { assertSameOrigin, changeStatusSchema, readJson, readTicketCode } from "@/lib/api/validation";
import { changeTicketStatus, ticketDetail } from "@/lib/db/tickets";

type RouteContext = { params: Promise<{ ticket: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = requireSession(request);
    const code = readTicketCode((await context.params).ticket);
    const detail = await ticketDetail(session, request.headers.get("user-agent") ?? "", code);
    return NextResponse.json({ ok: true, scope: session.role === "MAHASISWA" ? "owner" : "staff", ...detail }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const session = requireSession(request);
    const code = readTicketCode((await context.params).ticket);
    const body = await readJson(request, changeStatusSchema);
    const updated = await changeTicketStatus(session, request.headers.get("user-agent") ?? "", code, body.status, body.expectedVersion);
    return NextResponse.json({ ok: true, ticket: updated.ticketId, status: updated.status, rowVersion: updated.rowVersion, updatedAt: updated.updatedAt });
  } catch (error) { return apiErrorResponse(error); }
}
