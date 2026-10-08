import { NextResponse, type NextRequest } from "next/server";

import { appendAuditEntry } from "@/lib/audit-log";
import { getRequestSession, hasAnyRole } from "@/lib/auth/request";
import { decryptEnvelope } from "@/lib/crypto/envelope";
import { getKekMaterial, KEK_KEY_ID } from "@/lib/crypto/kek";
import { getDemoTicket } from "@/lib/demo-store";

const PREVIEW_LIMIT = 180;

/**
 * Dekripsi badan aduan oleh satuan tugas.
 *
 * Pemeriksaan yang wajib ada di sini:
 *   1. sesi staf (SATGAS atau ADMIN). Tanpa ini endpoint terbuka untuk siapa
 *      pun yang bisa menjangkau port HTTP;
 *   2. tiket yang benar-benar ada. Versi sebelumnya mendekripsi ciphertext dari
 *      body permintaan lebih dulu dan baru melihat tiket setelahnya, jadi route
 *      ini bisa dipakai sebagai oracle dekripsi untuk data arbitrer milik
 *      siapa pun. Ciphertext sekarang diambil dari penyimpanan server, bukan
 *      dari klien, sehingga klien tidak pernah memilih apa yang didekripsi;
 *   3. material kunci dari environment, bukan yang tertanam di source code;
 *   4. penanganan galat dekripsi. AES-GCM melempar galat ketika auth tag tidak
 *      cocok, dan tanpa try/catch itu berakhir sebagai 500 beserta jejak
 *      tumpukan yang membocorkan bentuk internal;
 *   5. audit untuk setiap percobaan, yang berhasil maupun yang ditolak.
 */
export async function POST(request: NextRequest) {
  const session = getRequestSession(request);

  if (!hasAnyRole(session, ["SATGAS", "ADMIN"])) {
    return NextResponse.json(
      { ok: false, message: "Akses staf diperlukan." },
      { status: session ? 403 : 401 },
    );
  }

  const actorEmail = session?.email ?? session?.sub ?? "unknown";
  const actorRole = session?.role ?? "unknown";

  const body = (await request.json().catch(() => ({}))) as { ticket?: string };
  const ticketId = body.ticket?.trim();

  if (!ticketId) {
    return NextResponse.json(
      { ok: false, message: "Nomor tiket wajib diisi." },
      { status: 400 },
    );
  }

  const record = getDemoTicket(ticketId);

  if (!record) {
    appendAuditEntry({
      action: "DECRYPT_DENIED",
      actorEmail,
      actorRole,
      ticketId: null,
      detail: `tiket tidak ditemukan: ${ticketId}`,
    });

    return NextResponse.json(
      { ok: false, message: "Tiket tidak ditemukan." },
      { status: 404 },
    );
  }

  const keyMaterial = getKekMaterial();

  if (!keyMaterial) {
    appendAuditEntry({
      action: "DECRYPT_DENIED",
      actorEmail,
      actorRole,
      ticketId: record.ticketId,
      detail: "material kunci tidak tersedia",
    });

    return NextResponse.json(
      {
        ok: false,
        message:
          "Material kunci tidak tersedia. Isi KEK_MASTER_BASE64 dengan kunci 32 byte.",
      },
      { status: 503 },
    );
  }

  let decrypted: string;

  try {
    decrypted = decryptEnvelope(keyMaterial, record.bodyEnvelope);
  } catch {
    appendAuditEntry({
      action: "DECRYPT_DENIED",
      actorEmail,
      actorRole,
      ticketId: record.ticketId,
      detail: "dekripsi gagal: auth tag tidak cocok",
    });

    return NextResponse.json(
      { ok: false, message: "Dekripsi gagal: ciphertext rusak atau kunci tidak cocok." },
      { status: 422 },
    );
  }

  const audit = appendAuditEntry({
    action: "DECRYPT_REQUESTED",
    actorEmail,
    actorRole,
    ticketId: record.ticketId,
    detail: `risiko ${record.riskBand}`,
  });

  return NextResponse.json({
    ok: true,
    ticket: record.ticketId,
    decryptedPreview: decrypted.slice(0, PREVIEW_LIMIT),
    keyId: record.bodyEnvelope.keyId || KEK_KEY_ID,
    audit: {
      seq: audit.seq,
      at: audit.at,
      hash: audit.hash,
    },
    message: "Isi aduan didekripsi oleh satuan tugas dan tercatat di audit.",
  });
}
