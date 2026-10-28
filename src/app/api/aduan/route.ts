import { NextResponse, type NextRequest } from "next/server";
import { apiErrorResponse } from "@/lib/api/errors";
import { requireSession } from "@/lib/api/session";
import { assertSameOrigin, createTicketSchema, readJson } from "@/lib/api/validation";
import { CREATE_TICKET_MAX_BYTES } from "@/lib/complaint-payload";
import { createTicket, listTickets } from "@/lib/db/tickets";

export async function GET(request: NextRequest) {
  try {
    const session = requireSession(request);
    const items = await listTickets(session, request.headers.get("user-agent") ?? "");
    return NextResponse.json({ ok: true, scope: session.role === "MAHASISWA" ? "owner" : "staff", items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const session = requireSession(request);
    const body = await readJson(request, createTicketSchema, CREATE_TICKET_MAX_BYTES);
    const ticket = await createTicket(session, request.headers.get("user-agent") ?? "", body);
    return NextResponse.json({ ok: true, ticketId: ticket.ticketId, pseudonym: ticket.pseudonym, riskBand: ticket.riskBand, message: "Aduan berhasil diterima." }, { status: 201 });
  } catch (error) { return apiErrorResponse(error); }
}
