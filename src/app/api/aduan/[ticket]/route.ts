import { NextResponse, type NextRequest } from "next/server";

import { appendAuditEntry } from "@/lib/audit-log";
import { getRequestSession, hasAnyRole } from "@/lib/auth/request";
import type { SessionClaims } from "@/lib/auth/jwt";
import {
  DEMO_TICKET_STATUSES,
  getDemoTicket,
  isDemoTicketOwnedBy,
  readDemoTicketBody,
  toStaffView,
  updateDemoTicketStatus,
  type DemoTicketStatus,
} from "@/lib/demo-store";

// Kembalian boolean biasa, bukan type predicate: dengan predicate, TypeScript
// akan menyempitkan `SessionClaims | null` menjadi `never` pada cabang lain,
// padahal sesi pengguna biasa tetap ada di sana.
function isStaff(claims: SessionClaims | null): boolean {
  return hasAnyRole(claims, ["SATGAS", "ADMIN"]);
}

/**
 * Status satu tiket.
 *
 * Route ini sebelumnya tidak punya pemeriksaan akses apa pun. Kombinasi itu
 * berbahaya: id tiket hanya beberapa karakter base36 dan halaman pelacakan
 * mengizinkan siapa pun menebak-nebaknya. Siapa pun yang menebak satu id yang
 * benar sudah bisa mengetahui bahwa aduan itu ada dan sudah selesai atau belum.
 *
 * Aturan sekarang: staf melihat status, pelapor hanya melihat tiketnya
 * sendiri. Selain itu dikembalikan 404, sama seperti ketika tiket memang tidak
 * ada, supaya permintaan tidak bisa dipakai untuk memetakan tiket yang ada.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ ticket: string }> },
) {
  const session = getRequestSession(request);

  if (!session) {
    return NextResponse.json(
      { ok: false, message: "Sesi diperlukan." },
      { status: 401 },
    );
  }

  const { ticket } = await context.params;
  const record = getDemoTicket(ticket);

  if (!record) {
    return NextResponse.json({ ok: false, message: "Ticket tidak ditemukan." }, { status: 404 });
  }

  if (isStaff(session)) {
    return NextResponse.json({
      ok: true,
      scope: "staff",
      ticket: toStaffView(record),
      message: "Status tiket tersedia.",
    });
  }

  const ownerEmail = (session.email ?? session.sub).trim().toLowerCase();

  if (!isDemoTicketOwnedBy(record.ticketId, ownerEmail)) {
    return NextResponse.json({ ok: false, message: "Ticket tidak ditemukan." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    scope: "owner",
    ticket: {
      ticketId: record.ticketId,
      subject: record.subject,
      category: record.category,
      // Didekripsi di server untuk pemiliknya. Pelapor berhak membaca isi
      // aduannya sendiri; yang dibatasi adalah pihak lain.
      body: readDemoTicketBody(record.ticketId),
      riskBand: record.riskBand,
      pseudonym: record.pseudonym,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    },
    message: "Status tiket tersedia.",
  });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ ticket: string }> },
) {
  const session = getRequestSession(request);

  if (!isStaff(session)) {
    return NextResponse.json(
      { ok: false, message: "Akses staf diperlukan." },
      { status: session ? 403 : 401 },
    );
  }

  const { ticket } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { status?: string };
  const nextStatus = body.status ?? "";

  if (!DEMO_TICKET_STATUSES.includes(nextStatus as DemoTicketStatus)) {
    return NextResponse.json(
      { ok: false, message: "Status tidak valid untuk tiket ini." },
      { status: 400 },
    );
  }

  const updated = updateDemoTicketStatus(ticket, nextStatus as DemoTicketStatus);

  if (!updated) {
    return NextResponse.json({ ok: false, message: "Ticket tidak ditemukan." }, { status: 404 });
  }

  appendAuditEntry({
    action: "TICKET_STATUS_CHANGED",
    actorEmail: session?.email ?? session?.sub ?? "unknown",
    actorRole: session?.role ?? "unknown",
    ticketId: updated.ticketId,
    detail: `status -> ${updated.status}`,
  });

  return NextResponse.json({
    ok: true,
    ticket: updated.ticketId,
    status: updated.status,
    updatedAt: updated.updatedAt,
    message: `Status tiket diperbarui menjadi ${updated.status}.`,
  });
}