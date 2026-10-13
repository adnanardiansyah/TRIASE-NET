import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, apiErrorResponse } from "@/lib/api/errors";
import { requireSession } from "@/lib/api/session";
import { assertSameOrigin, readJson, readTicketCode, replySchema } from "@/lib/api/validation";
import { addReply, listReplies } from "@/lib/db/tickets";

type RouteContext = { params: Promise<{ ticket: string }> };
const cursorSchema = z.object({ at: z.string().datetime(), id: z.string().uuid() });

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = requireSession(request);
    const code = readTicketCode((await context.params).ticket);
    const at = request.nextUrl.searchParams.get("beforeAt");
    const id = request.nextUrl.searchParams.get("beforeId");
    const cursor = at || id ? cursorSchema.safeParse({ at, id }) : null;
    if (cursor && !cursor.success) throw new ApiError(400, "Kursor percakapan tidak valid.");
    const data = await listReplies(session, request.headers.get("user-agent") ?? "", code, cursor?.success ? cursor.data : undefined);
    return NextResponse.json({ ok: true, ...data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    assertSameOrigin(request);
    const session = requireSession(request);
    const code = readTicketCode((await context.params).ticket);
    const body = await readJson(request, replySchema);
    const data = await addReply(session, request.headers.get("user-agent") ?? "", code, body.body, body.clientId);
    return NextResponse.json({ ok: true, ...data }, { status: 201 });
  } catch (error) { return apiErrorResponse(error); }
}
