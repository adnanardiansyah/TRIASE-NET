import { NextResponse, type NextRequest } from "next/server";

import { getRequestSession, hasAnyRole } from "@/lib/auth/request";
import {
  findDemoTicketsByEmail,
  listDemoTickets,
  toStaffView,
  createDemoTicket,
} from "@/lib/demo-store";
import { ADUAN_CATEGORY, type AduanCategory, type RiskBand } from "@/lib/domain/enums";

const MAX_SUBJECT_LENGTH = 200;
const MAX_BODY_LENGTH = 8000;

function sessionIdentity(email: string | undefined, sub: string): string {
  return (email ?? sub).trim().toLowerCase();
}

function readCategory(value: unknown): AduanCategory {
  return ADUAN_CATEGORY.includes(value as AduanCategory) ? (value as AduanCategory) : "LAINNYA";
}

/**
 * Daftar aduan.
 *
 * Mahasiswa hanya melihat tiketnya sendiri, termasuk isinya. Satuan tugas
 * dan admin menerima metadata saja: tanpa email pelapor dan tanpa isi aduan.
 * Mereka harus membaca badan aduan lewat `POST /api/satgas/decrypt`, yang
 * memeriksa sesi dan mencatat audit.
 *
 * Versi sebelumnya mengembalikan objek tiket mentah ke semua role, sehingga
 * siapa pun yang punya sesi staf bisa membaca seluruh isi aduan tanpa
 * melewati jalur dekripsi sama sekali.
 */
export async function GET(request: NextRequest) {
  const session = getRequestSession(request);

  if (!session) {
    return NextResponse.json({ ok: false, message: "Sesi diperlukan." }, { status: 401 });
  }

  if (session.role === "MAHASISWA") {
    const items = findDemoTicketsByEmail(sessionIdentity(session.email, session.sub));
    return NextResponse.json({ ok: true, scope: "owner", items });
  }

  const items = listDemoTickets().map(toStaffView);
  return NextResponse.json({ ok: true, scope: "staff", items });
}

/**
 * Membuat aduan.
 *
 * `riskBand` TIDAK diterima dari klien. Nilai itu adalah output mesin risiko
 * ZTNA, bukan pilihan pelapor; kalau klien yang menetapkannya, mahasiswa bisa
 * menandai aduan berisiko tinggi sebagai LOW dan mendapat enkripsi yang lebih
 * lemah dari yang seharusnya. Di sini band ditetapkan server dari kategori.
 */
export async function POST(request: NextRequest) {
  const session = getRequestSession(request);

  if (!hasAnyRole(session, ["MAHASISWA"])) {
    return NextResponse.json(
      { ok: false, message: "Hanya mahasiswa yang dapat membuat aduan." },
      { status: session ? 403 : 401 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    subject?: string;
    category?: string;
    body?: string;
  };

  const email = sessionIdentity(session.email, session.sub);
  const subject = body.subject?.trim().slice(0, MAX_SUBJECT_LENGTH) ?? "";
  const category = readCategory(body.category);
  const bodyText = body.body?.trim().slice(0, MAX_BODY_LENGTH) ?? "";

  if (!email || !subject || !bodyText) {
    return NextResponse.json(
      { ok: false, message: "Judul dan isi aduan wajib diisi." },
      { status: 400 },
    );
  }

  const riskBand: RiskBand = category === "KEAMANAS_INFORMASI" ? "HIGH" : "MEDIUM";
  const created = createDemoTicket({ email, subject, category, body: bodyText, riskBand });

  return NextResponse.json({
    ok: true,
    ticketId: created.ticketId,
    pseudonym: created.pseudonym,
    riskBand,
    message: "Aduan berhasil diterima dan dikirim ke antrean satgas.",
  });
}