import { NextResponse, type NextRequest } from "next/server";
import { apiErrorResponse } from "@/lib/api/errors";
import { requireSession } from "@/lib/api/session";
import { assertSameOrigin, decryptSchema, readJson } from "@/lib/api/validation";
import { decryptTicket } from "@/lib/db/tickets";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const session = requireSession(request);
    const { ticket } = await readJson(request, decryptSchema);
    const data = await decryptTicket(session, request.headers.get("user-agent") ?? "", ticket);
    return NextResponse.json({ ok: true, ticket, decryptedPreview: data.body, subject: data.subject, details: data.details, attachments: data.attachments, keyId: data.keyId, audit: data.audit }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
